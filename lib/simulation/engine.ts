import type { Alarm, CellId, EpochMs, EvidenceQuality, MachinePhase, OperatingMode } from "@/lib/domain/types";
import { Rng, clamp, stableId } from "@/lib/util";
import { ObservationStore, type Sample } from "./observation";
import { SCENARIO_TRUTH, type FaultKind } from "./truth";
import { HANDSHAKE_ENVELOPE_S, INTERVENTION_BY_ID, RECIPES, SCENARIO_BY_ID, type InterventionId } from "./scenarios";

/**
 * Seeded, fixed-step (1 s) plant simulator. Same seed + scenario + recorded interventions
 * produce identical observations regardless of playback speed. The engine emits
 * observations and PLC-style alarms only; it never emits scenario identifiers or fault
 * truth into the store.
 */

export const STEP_MS = 1000;
export const SIM_SOURCE_ID = "SIM-DEMO-PLANT";

export interface RecordedIntervention {
  id: string;
  interventionId: InterventionId;
  atMs: EpochMs;
  params?: Record<string, number | string>;
  recordedBy: string;
}

interface ActiveFaults {
  airLeakTargetBar?: number;
  coolant?: { startMs: EpochMs; startFlow: number; targetFlow: number; rampMs: number };
  ackDelayMs?: number;
  supplySagTargetV?: number;
  spn1Res: number;
  spn1LoadDependent: boolean;
  spn2Res: number;
  flowMissing: boolean;
  tempStuck?: number;
  gaugeShiftUm: number;
  clockSkew?: { source: string; offsetMs: number; uncertaintyMs: number };
}

interface CellSim {
  cellId: CellId;
  cncId: string;
  spnId: string;
  pumpId: string;
  phase: MachinePhase;
  phaseSinceMs: EpochMs;
  mode: OperatingMode;
  recipe: string;
  speedOverrideRpm?: number;
  cycleSeq: number;
  cycleId?: string;
  cycleStartMs?: EpochMs;
  cycleCount: number;
  lastCycleDurationS: number | null;
  clampDelayTargetS: number;
  clampProofAt?: EpochMs;
  lastClampDelayS: number | null;
  envelopeAlarmRaisedForCycle?: string;
  moveCompleteAt?: EpochMs;
  unloadAckAt?: EpochMs;
  ackAlarmRaisedForCycle?: string;
  actualSpeed: number;
  current: number;
  vibration: number;
  temp: number;
  physicalFlow: number;
  interruptedSince?: EpochMs;
  pendingDownstream: Array<{ dueMs: EpochMs; cycleId: string }>;
  pendingGauge: Array<{ dueMs: EpochMs }>;
}

export interface SimState {
  nowMs: EpochMs;
  step: number;
  feederV: number;
  headerP: number;
  headerDemand: number;
  compLoad: number;
  chillerT: number;
  bufferOccupancy: number;
  assembled: number;
  packed: number;
  gaugeN: number;
  gaugeLastDev: number | null;
  cells: Record<CellId, CellSim>;
  faults: ActiveFaults;
  alarms: Alarm[];
  interruptions: Array<{ cellId: CellId; startMs: EpochMs; endMs?: EpochMs }>;
  robotClockSourceId: string;
  robotUncertaintyMs: number;
  robotOffsetMs: number;
}

export interface EngineInit {
  seed: number;
  scenarioId: string;
  startMs: EpochMs;
}

function makeCell(cellId: CellId, cncId: string, spnId: string, pumpId: string, recipe: string, startMs: EpochMs): CellSim {
  return {
    cellId,
    cncId,
    spnId,
    pumpId,
    phase: "IDLE",
    phaseSinceMs: startMs,
    mode: "AUTO",
    recipe,
    cycleSeq: 0,
    cycleCount: 0,
    lastCycleDurationS: null,
    clampDelayTargetS: 1.5,
    lastClampDelayS: null,
    actualSpeed: 0,
    current: 0.8,
    vibration: 0.2,
    temp: 30,
    physicalFlow: 0,
    pendingDownstream: [],
    pendingGauge: [],
  };
}

const BUFFER_CAPACITY = 20;

export class PlantEngine {
  readonly store = new ObservationStore();
  readonly init: EngineInit;
  state: SimState;
  private rng: Rng;
  private interventions: RecordedIntervention[] = [];
  private scheduledFaults: Array<{ atMs: EpochMs; kind: FaultKind; params?: Record<string, number | string> }>;
  /** Alarm hysteresis timers keyed by alarm key. */
  private alarmTimers = new Map<string, number>();
  private activeAlarmIdx = new Map<string, number>();
  private interventionsApplied = new Set<string>();

  constructor(init: EngineInit) {
    this.init = init;
    this.rng = new Rng(init.seed);
    const scenario = SCENARIO_BY_ID[init.scenarioId];
    const truth = SCENARIO_TRUTH[init.scenarioId];
    if (!scenario || !truth) throw new Error(`Unknown scenario ${init.scenarioId}`);
    this.scheduledFaults = truth.faults.map((f) => ({ atMs: init.startMs + f.atOffsetMs, kind: f.kind, params: f.params }));
    this.state = {
      nowMs: init.startMs,
      step: 0,
      feederV: 400,
      headerP: 6.2,
      headerDemand: 20,
      compLoad: 45,
      chillerT: 18,
      bufferOccupancy: 3,
      assembled: 0,
      packed: 0,
      gaugeN: 0,
      gaugeLastDev: null,
      cells: {
        "CELL-A": makeCell("CELL-A", "CNC-01", "SPN-01", "PUMP-01", scenario.recipes["CELL-A"], init.startMs),
        "CELL-B": makeCell("CELL-B", "CNC-02", "SPN-02", "PUMP-02", scenario.recipes["CELL-B"], init.startMs),
      },
      faults: { spn1Res: 0, spn1LoadDependent: false, spn2Res: 0, flowMissing: false, gaugeShiftUm: 0 },
      alarms: [],
      interruptions: [],
      robotClockSourceId: "PLC-MAIN",
      robotUncertaintyMs: 0,
      robotOffsetMs: 0,
    };
    // Offset cell B so the two cells are not in lockstep: it starts mid-cut.
    const b = this.state.cells["CELL-B"];
    b.cycleSeq = 100;
    b.cycleId = "CNC-02-C100";
    b.cycleStartMs = init.startMs - 35_000;
    b.phase = "CUTTING";
    b.phaseSinceMs = init.startMs - 23_000;
    b.actualSpeed = RECIPES[b.recipe].commandedSpeedRpm;
    this.emitAll();
  }

  get nowMs(): EpochMs {
    return this.state.nowMs;
  }

  recordedInterventions(): RecordedIntervention[] {
    return this.interventions.slice();
  }

  /** Interventions are applied at the live edge only; they are recorded so a replay reproduces them. */
  applyIntervention(interventionId: InterventionId, params: Record<string, number | string> | undefined, recordedBy: string): RecordedIntervention {
    const rec: RecordedIntervention = {
      id: stableId("INT", interventionId, this.state.nowMs, this.interventions.length),
      interventionId,
      atMs: this.state.nowMs,
      params,
      recordedBy,
    };
    this.interventions.push(rec);
    this.applyInterventionEffect(rec);
    return rec;
  }

  private applyInterventionEffect(rec: RecordedIntervention): void {
    if (this.interventionsApplied.has(rec.id)) return;
    this.interventionsApplied.add(rec.id);
    const f = this.state.faults;
    const a = this.state.cells["CELL-A"];
    switch (rec.interventionId) {
      case "REPAIR_AIR_LEAK":
        f.airLeakTargetBar = undefined;
        break;
      case "CLEAR_ALARMS_ONLY":
        for (const al of this.state.alarms) if (!al.clearedAt) al.clearedAt = { ms: this.state.nowMs, clock: "SIMULATION", uncertaintyMs: 0 };
        this.activeAlarmIdx.clear();
        this.alarmTimers.clear();
        break;
      case "REPLACE_FIXTURE_SENSOR":
      case "REPLACE_PROXIMITY_SENSOR":
        // Physical sensor swap; no effect on the underlying mechanism.
        break;
      case "REPLACE_COOLANT_FILTER":
      case "RESTORE_COOLING":
        f.coolant = undefined;
        break;
      case "REPAIR_ACK_PATH":
        f.ackDelayMs = undefined;
        break;
      case "RESTORE_FEEDER":
        f.supplySagTargetV = undefined;
        break;
      case "REMOVE_SPN1_RESISTANCE":
        f.spn1Res = 0;
        break;
      case "REMOVE_SPN2_RESISTANCE":
        f.spn2Res = 0;
        break;
      case "RESTORE_FLOW_SENSOR":
        f.flowMissing = false;
        break;
      case "REPLACE_TEMP_SENSOR":
        f.tempStuck = undefined;
        break;
      case "SET_SPEED": {
        const rpm = Number(rec.params?.rpm);
        if (Number.isFinite(rpm) && rpm > 0) a.speedOverrideRpm = rpm;
        break;
      }
      case "RESTORE_RECIPE_SPEED":
        a.speedOverrideRpm = undefined;
        break;
      case "SET_RECIPE": {
        const r = String(rec.params?.recipe ?? "");
        if (RECIPES[r]) {
          a.recipe = r;
          a.speedOverrideRpm = undefined;
        }
        break;
      }
      case "SYNC_ROBOT_CLOCK":
        this.state.robotUncertaintyMs = 200;
        this.state.robotOffsetMs = 0;
        break;
    }
  }

  private applyFault(kind: FaultKind, params: Record<string, number | string> | undefined): void {
    const f = this.state.faults;
    const a = this.state.cells["CELL-A"];
    switch (kind) {
      case "AIR_LEAK":
        f.airLeakTargetBar = Number(params?.targetBar ?? 4.4);
        break;
      case "COOLANT_RESTRICTION":
      case "COOLING_DEGRADATION":
        f.coolant = {
          startMs: this.state.nowMs,
          startFlow: RECIPES[a.recipe].coolantFlowLpm,
          targetFlow: Number(params?.targetFlow ?? 5.5),
          rampMs: Number(params?.rampMs ?? 60_000),
        };
        break;
      case "ACK_DELAY":
        f.ackDelayMs = Number(params?.delayMs ?? 12_000);
        break;
      case "SUPPLY_SAG":
        f.supplySagTargetV = Number(params?.targetV ?? 340);
        break;
      case "SPN1_MECH_RESISTANCE":
        f.spn1Res = Number(params?.resistance ?? 0.4);
        f.spn1LoadDependent = Number(params?.loadDependent ?? 0) === 1;
        break;
      case "SPN2_MECH_RESISTANCE":
        f.spn2Res = Number(params?.resistance ?? 0.35);
        break;
      case "FLOW_SENSOR_MISSING":
        f.flowMissing = true;
        break;
      case "TEMP_SENSOR_STUCK":
        f.tempStuck = Math.round(a.temp * 10) / 10;
        break;
      case "GAUGE_SHIFT":
        f.gaugeShiftUm = Number(params?.um ?? 25);
        break;
      case "CLOCK_SKEW":
        this.state.robotClockSourceId = String(params?.source ?? "ROBOT-CTRL");
        this.state.robotOffsetMs = Number(params?.offsetMs ?? -4000);
        this.state.robotUncertaintyMs = Number(params?.uncertaintyMs ?? 5000);
        break;
      case "RECIPE_CHANGE": {
        const r = String(params?.recipe ?? "PART-A");
        if (RECIPES[r]) {
          a.recipe = r;
          a.speedOverrideRpm = undefined;
        }
        break;
      }
      case "OPERATOR_SPEED_OVERRIDE":
        a.speedOverrideRpm = Number(params?.rpm ?? 900);
        break;
    }
  }

  // ---------------------------------------------------------------------
  // Emission helpers
  // ---------------------------------------------------------------------

  private lastEmitted = new Map<string, Sample["value"]>();

  private emit(assetId: string, tagName: string, value: Sample["value"], opts: { quality?: EvidenceQuality; onChange?: boolean; heartbeatS?: number; context?: Sample["context"] } = {}): void {
    const tagId = `${assetId}.${tagName}`;
    const { quality = value === null ? "MISSING" : "GOOD", onChange = false, heartbeatS = 10, context } = opts;
    if (onChange) {
      const prev = this.lastEmitted.get(tagId);
      const heartbeatDue = this.state.step % heartbeatS === 0;
      if (prev === value && !heartbeatDue) return;
    }
    this.lastEmitted.set(tagId, value);
    let ms = this.state.nowMs;
    let uncertaintyMs = 0;
    let clockSourceId = "PLC-MAIN";
    let rawMs: number | undefined;
    if (assetId === "ROB-01") {
      clockSourceId = this.state.robotClockSourceId;
      uncertaintyMs = this.state.robotUncertaintyMs;
      if (this.state.robotOffsetMs !== 0) {
        rawMs = ms + this.state.robotOffsetMs;
        ms = rawMs;
      }
    }
    this.store.push(tagId, {
      ms,
      value,
      quality,
      ingestionMs: this.state.nowMs,
      uncertaintyMs,
      clockSourceId,
      rawMs,
      sourceId: SIM_SOURCE_ID,
      context,
    });
  }

  private cellContext(c: CellSim): Sample["context"] {
    return {
      recipe: c.recipe,
      mode: c.mode,
      phase: c.phase,
      commandedSpeed: this.commandedSpeed(c),
      actualSpeed: Math.round(c.actualSpeed),
      cycleId: c.cycleId,
    };
  }

  private commandedSpeed(c: CellSim): number {
    return c.speedOverrideRpm ?? RECIPES[c.recipe].commandedSpeedRpm;
  }

  // ---------------------------------------------------------------------
  // Alarms (PLC-style thresholds with hysteresis). Keys are stable per condition.
  // ---------------------------------------------------------------------

  private alarmCondition(key: string, assetId: string, tagName: string | undefined, severity: Alarm["severity"], message: string, active: boolean, holdSeconds = 3): void {
    const idx = this.activeAlarmIdx.get(key);
    if (active) {
      const t = (this.alarmTimers.get(key) ?? 0) + 1;
      this.alarmTimers.set(key, t);
      if (idx === undefined && t >= holdSeconds) {
        const alarm: Alarm = {
          id: stableId("ALM", key, this.state.nowMs),
          assetId,
          tagId: tagName ? `${assetId}.${tagName}` : undefined,
          severity,
          message,
          raisedAt: { ms: this.state.nowMs, clock: "SIMULATION", uncertaintyMs: 0 },
        };
        this.state.alarms.push(alarm);
        this.activeAlarmIdx.set(key, this.state.alarms.length - 1);
      }
    } else {
      this.alarmTimers.set(key, 0);
      if (idx !== undefined) {
        const al = this.state.alarms[idx];
        if (al && !al.clearedAt) al.clearedAt = { ms: this.state.nowMs, clock: "SIMULATION", uncertaintyMs: 0 };
        this.activeAlarmIdx.delete(key);
      }
    }
  }

  private pulse(key: string, assetId: string, tagName: string | undefined, severity: Alarm["severity"], message: string): void {
    const alarm: Alarm = {
      id: stableId("ALM", key, this.state.nowMs),
      assetId,
      tagId: tagName ? `${assetId}.${tagName}` : undefined,
      severity,
      message,
      raisedAt: { ms: this.state.nowMs, clock: "SIMULATION", uncertaintyMs: 0 },
      clearedAt: { ms: this.state.nowMs + 30_000, clock: "SIMULATION", uncertaintyMs: 0 },
    };
    this.state.alarms.push(alarm);
  }

  private setInterrupted(c: CellSim, interrupted: boolean): void {
    if (interrupted && c.interruptedSince === undefined) {
      c.interruptedSince = this.state.nowMs;
      this.state.interruptions.push({ cellId: c.cellId, startMs: this.state.nowMs });
    } else if (!interrupted && c.interruptedSince !== undefined) {
      const open = this.state.interruptions.find((i) => i.cellId === c.cellId && i.endMs === undefined);
      if (open) open.endMs = this.state.nowMs;
      c.interruptedSince = undefined;
    }
  }

  // ---------------------------------------------------------------------
  // Step
  // ---------------------------------------------------------------------

  step(): void {
    const s = this.state;
    s.nowMs += STEP_MS;
    s.step += 1;
    const now = s.nowMs;

    for (const f of this.scheduledFaults) if (f.atMs === now) this.applyFault(f.kind, f.params);
    for (const i of this.interventions) if (i.atMs === now) this.applyInterventionEffect(i);

    // Utilities
    const vTarget = s.faults.supplySagTargetV ?? 400;
    s.feederV += (vTarget - s.feederV) * 0.3 + this.rng.gauss() * 0.5;

    const clampsActive = (Object.values(s.cells) as CellSim[]).filter((c) => c.phase === "CLAMPING").length;
    s.headerDemand = clamp(20 + clampsActive * 18 + this.rng.gauss() * 1.5, 0, 100);
    const pTarget = (s.faults.airLeakTargetBar ?? 6.2) - (s.headerDemand - 20) * 0.004;
    s.headerP += (pTarget - s.headerP) * (1 - Math.exp(-1 / 15)) + this.rng.gauss() * 0.02;
    s.compLoad = clamp(45 + (6.5 - s.headerP) * 20 + this.rng.gauss() * 1.0, 0, 100);
    s.chillerT = 18 + this.rng.gauss() * 0.15;

    this.emit("FDR-01", "supply_voltage", round1(s.feederV));
    this.emit("FDR-01", "supply_frequency", round2(50 + this.rng.gauss() * 0.02));
    this.emit("FDR-01", "breaker_closed", true, { onChange: true });
    this.emit("COMP-01", "running", true, { onChange: true });
    this.emit("COMP-01", "load_pct", round1(s.compLoad));
    this.emit("COMP-01", "discharge_pressure", round2(s.headerP + 0.8 + this.rng.gauss() * 0.02));
    this.emit("AIR-HDR-01", "header_pressure", round2(s.headerP));
    this.emit("AIR-HDR-01", "demand_pct", round1(s.headerDemand));
    this.emit("CHLR-01", "supply_temp", round1(s.chillerT));
    this.emit("CHLR-01", "running", true, { onChange: true });

    // Cells
    for (const c of Object.values(s.cells) as CellSim[]) this.stepCell(c, now);

    // Downstream stations
    this.emit("CONV-01", "running", true, { onChange: true });
    this.emit("CONV-01", "belt_speed", round1(12 + this.rng.gauss() * 0.1));
    this.emit("BUF-01", "occupancy", s.bufferOccupancy, { onChange: true, heartbeatS: 5 });
    this.emit("BUF-01", "capacity", BUFFER_CAPACITY, { onChange: true, heartbeatS: 30 });
    this.emit("FAN-01", "running", true, { onChange: true });
    this.emit("ASM-01", "assembled_count", s.assembled, { onChange: true, heartbeatS: 5 });
    this.emit("PACK-01", "packed_count", s.packed, { onChange: true, heartbeatS: 5 });
    this.emit("GAUGE-01", "parts_measured", s.gaugeN, { onChange: true, heartbeatS: 5 });
    if (s.step % 30 === 0) this.emit("GAUGE-01", "dimension_dev_um", s.gaugeLastDev, { onChange: true, heartbeatS: 30 });

    // Utility alarms
    this.alarmCondition("AIR-HDR-01.low_pressure", "AIR-HDR-01", "header_pressure", "WARNING", "Header pressure below 5.0 bar", s.headerP < 5.0, 5);
    this.alarmCondition("FDR-01.undervoltage", "FDR-01", "supply_voltage", "FAULT", "Supply voltage below 360 V", s.feederV < 360, 3);
    this.alarmCondition("GAUGE-01.out_of_tolerance", "GAUGE-01", "dimension_dev_um", "WARNING", "Dimensional deviation beyond ±15 µm", (s.gaugeLastDev ?? 0) > 15 || (s.gaugeLastDev ?? 0) < -15, 3);

    if (s.step % 60 === 0) this.store.evict(now);
  }

  private stepCell(c: CellSim, now: EpochMs): void {
    const s = this.state;
    const f = s.faults;
    const recipe = RECIPES[c.recipe];
    const elapsed = (now - c.phaseSinceMs) / 1000;
    const isA = c.cellId === "CELL-A";
    const cabinetV = s.feederV - (isA ? 2 : 3) + this.rng.gauss() * 0.3;
    const clampAssetId = isA ? "FIX-01" : "CNC-02";

    // Event pulses default false each step; set true when they fire.
    let robotClear = false;
    let partPresent = false;
    let clampCmd = false;
    let clampProof = c.phase === "CUTTING"; // level: clamp stays proved while cutting
    let cycleReady = false;
    let cycleComplete = false;
    let moveComplete = false;
    let unloadComplete = false;
    let robotState: string = "IDLE";
    let interrupted = false;

    switch (c.phase) {
      case "IDLE": {
        if (c.mode === "AUTO") {
          if (s.bufferOccupancy >= BUFFER_CAPACITY) {
            this.transition(c, "BLOCKED", now);
          } else {
            c.cycleSeq += 1;
            c.cycleId = `${c.cncId}-C${c.cycleSeq}`;
            c.cycleStartMs = now;
            this.transition(c, "LOADING", now);
          }
        }
        break;
      }
      case "BLOCKED": {
        interrupted = true;
        if (s.bufferOccupancy < BUFFER_CAPACITY) this.transition(c, "IDLE", now);
        break;
      }
      case "LOADING": {
        robotState = "LOADING";
        if (elapsed >= recipe.loadSeconds) {
          robotClear = true;
          partPresent = true;
          this.transition(c, "CLAMPING", now);
          clampCmd = true;
          const shortfall = Math.max(0, 5.5 - s.headerP);
          c.clampDelayTargetS = 1.5 + shortfall * 7 + this.rng.gauss() * 0.15;
          c.clampProofAt = undefined;
        }
        break;
      }
      case "CLAMPING": {
        const since = (now - c.phaseSinceMs) / 1000;
        if (c.clampProofAt === undefined) {
          if (since >= c.clampDelayTargetS) {
            c.clampProofAt = now;
            clampProof = true;
            c.lastClampDelayS = Math.round(since * 10) / 10;
          } else {
            interrupted = since > HANDSHAKE_ENVELOPE_S;
            if (since > HANDSHAKE_ENVELOPE_S && c.envelopeAlarmRaisedForCycle !== c.cycleId) {
              c.envelopeAlarmRaisedForCycle = c.cycleId;
              this.pulse(`${clampAssetId}.clamp_envelope`, clampAssetId, "clamp_proof", "FAULT", `Clamp proof not received within ${HANDSHAKE_ENVELOPE_S} s envelope (cycle ${c.cycleId})`);
              this.pulse(`${c.cncId}.waiting_clamp`, c.cncId, "phase", "WARNING", `${c.cncId} waiting for clamp proof`);
              if (isA) this.pulse("ROB-01.waiting_sequence", "ROB-01", "state", "INFO", "ROB-01 waiting on machining-cell sequence");
            }
          }
        } else {
          clampProof = true;
          if (now - c.clampProofAt >= 1000) {
            cycleReady = true;
            this.transition(c, "CUTTING", now);
          }
        }
        break;
      }
      case "CUTTING": {
        clampProof = true;
        if (elapsed >= recipe.cutSeconds) {
          cycleComplete = true;
          c.cycleCount += 1;
          c.lastCycleDurationS = c.cycleStartMs !== undefined ? Math.round((now - c.cycleStartMs) / 100) / 10 : null;
          s.bufferOccupancy = Math.min(BUFFER_CAPACITY, s.bufferOccupancy + 1);
          c.pendingDownstream.push({ dueMs: now + 1500 + Math.round(this.rng.next() * 500), cycleId: c.cycleId ?? "" });
          c.pendingGauge.push({ dueMs: now + 6000 });
          this.transition(c, "UNLOADING", now);
          c.moveCompleteAt = undefined;
          c.unloadAckAt = undefined;
        }
        break;
      }
      case "UNLOADING": {
        robotState = "UNLOADING";
        if (c.moveCompleteAt === undefined) {
          if (elapsed >= recipe.unloadSeconds) {
            c.moveCompleteAt = now;
            moveComplete = true;
            const ackDelay = isA ? (f.ackDelayMs ?? 0) : 0;
            c.unloadAckAt = now + 1000 + ackDelay;
          }
        } else {
          const waited = (now - c.moveCompleteAt) / 1000;
          if (c.unloadAckAt !== undefined && now >= c.unloadAckAt) {
            unloadComplete = true;
            this.transition(c, "IDLE", now);
          } else {
            interrupted = waited > HANDSHAKE_ENVELOPE_S;
            if (waited > HANDSHAKE_ENVELOPE_S && c.ackAlarmRaisedForCycle !== c.cycleId) {
              c.ackAlarmRaisedForCycle = c.cycleId;
              this.pulse(`${c.cncId}.unload_ack_envelope`, c.cncId, "cycle_complete", "FAULT", `Unload-complete acknowledgement not received within ${HANDSHAKE_ENVELOPE_S} s (cycle ${c.cycleId})`);
              if (isA) this.pulse("ROB-01.waiting_ack", "ROB-01", "unload_complete", "INFO", "ROB-01 movement complete; waiting for acknowledgement");
            }
          }
        }
        break;
      }
      default:
        break;
    }
    this.setInterrupted(c, interrupted);

    // Spindle / pump dynamics
    const commanded = this.commandedSpeed(c);
    const targetSpeed = c.phase === "CUTTING" ? commanded : 0;
    c.actualSpeed += (targetSpeed - c.actualSpeed) * (1 - Math.exp(-1 / 2));
    const res = isA ? f.spn1Res * (f.spn1LoadDependent ? (recipe.loadFactor > 1.2 ? 1 : 0.12) : 1) : f.spn2Res;
    const speedRatio = c.actualSpeed / recipe.commandedSpeedRpm;
    const voltageFactor = 400 / Math.max(300, cabinetV);
    const cutting = c.actualSpeed > 50;
    c.current = cutting ? recipe.baseCurrentA * speedRatio * (1 + res) * voltageFactor + this.rng.gauss() * 0.15 : 0.8 + this.rng.gauss() * 0.05;
    c.vibration = cutting ? 1.2 * Math.pow(Math.max(0.05, speedRatio), 1.5) * (1 + 2.5 * res) + this.rng.gauss() * 0.08 : 0.2 + this.rng.gauss() * 0.02;

    // Pump: runs whenever the machine is in AUTO. Physical flow may be restricted (cell A only in demo).
    const pumpRun = c.mode === "AUTO";
    let physicalFlow = pumpRun ? recipe.coolantFlowLpm : 0;
    if (isA && f.coolant && pumpRun) {
      const t = clamp((now - f.coolant.startMs) / f.coolant.rampMs, 0, 1);
      physicalFlow = f.coolant.startFlow + (f.coolant.targetFlow - f.coolant.startFlow) * t;
    }
    c.physicalFlow = physicalFlow;
    const heat = cutting ? 3.5 * c.current : 1.5;
    const coolingDeficit = cutting ? Math.max(0, recipe.coolantFlowLpm - physicalFlow) * 1.5 : 0;
    const tEq = 25 + heat + coolingDeficit;
    c.temp += (tEq - c.temp) * (1 - Math.exp(-1 / 90));

    const ctx = this.cellContext(c);
    // CNC tags
    this.emit(c.cncId, "phase", c.phase, { onChange: true, heartbeatS: 5, context: ctx });
    this.emit(c.cncId, "mode", c.mode, { onChange: true, heartbeatS: 30 });
    this.emit(c.cncId, "recipe", c.recipe, { onChange: true, heartbeatS: 30 });
    this.emit(c.cncId, "cycle_id", c.cycleId ?? null, { onChange: true, heartbeatS: 30 });
    this.emit(c.cncId, "cycle_count", c.cycleCount, { onChange: true, heartbeatS: 30 });
    this.emit(c.cncId, "cycle_complete", cycleComplete, { onChange: true, heartbeatS: 30, context: ctx });
    this.emit(c.cncId, "supply_voltage", round1(cabinetV));
    this.emit(c.cncId, "commanded_speed", commanded, { onChange: true, heartbeatS: 10, context: ctx });
    if (c.lastCycleDurationS !== null) this.emit(c.cncId, "cycle_duration_s", c.lastCycleDurationS, { onChange: true, heartbeatS: 30, context: ctx });
    if (isA) {
      this.emit("CNC-01", "part_present", partPresent || c.phase === "CLAMPING" || c.phase === "CUTTING", { onChange: true, context: ctx });
      this.emit("CNC-01", "cycle_ready", cycleReady, { onChange: true, heartbeatS: 30, context: ctx });
      this.emit("SPN-01", "actual_speed", Math.round(c.actualSpeed), { context: ctx });
      this.emit("SPN-01", "motor_current", round2(c.current), { context: ctx });
      this.emit("SPN-01", "vibration_rms", round2(c.vibration), { context: ctx });
      const tempReported = f.tempStuck !== undefined ? f.tempStuck : round1(c.temp);
      this.emit("SPN-01", "bearing_temp", tempReported, { context: ctx });
      this.emit("SPN-01", "load_pct", round1(cutting ? clamp((c.current / 12) * 100, 0, 100) : 5));
      this.emit("PUMP-01", "run_feedback", pumpRun, { onChange: true });
      if (f.flowMissing) this.emit("PUMP-01", "coolant_flow", null, { quality: "MISSING", context: ctx });
      else this.emit("PUMP-01", "coolant_flow", round1(physicalFlow + this.rng.gauss() * 0.2), { context: ctx });
      this.emit("PUMP-01", "coolant_temp", round1(s.chillerT + 4 + (c.temp - 30) * 0.1));
      this.emit("ROB-01", "robot_clear", robotClear || c.phase === "CLAMPING" || c.phase === "CUTTING", { onChange: true, context: ctx });
      this.emit("ROB-01", "move_complete", moveComplete, { onChange: true, heartbeatS: 30, context: ctx });
      this.emit("ROB-01", "unload_complete", unloadComplete, { onChange: true, heartbeatS: 30, context: ctx });
      this.emit("ROB-01", "state", robotState, { onChange: true, heartbeatS: 10 });
      this.emit("FIX-01", "clamp_cmd", clampCmd || c.phase === "CLAMPING" || c.phase === "CUTTING", { onChange: true, context: ctx });
      this.emit("FIX-01", "clamp_proof", clampProof, { onChange: true, context: ctx });
      if (c.lastClampDelayS !== null) this.emit("FIX-01", "clamp_delay_s", c.lastClampDelayS, { onChange: true, heartbeatS: 30, context: ctx });
    } else {
      this.emit("SPN-02", "actual_speed", Math.round(c.actualSpeed), { context: ctx });
      this.emit("SPN-02", "motor_current", round2(c.current), { context: ctx });
      this.emit("SPN-02", "vibration_rms", round2(c.vibration), { context: ctx });
      this.emit("PUMP-02", "run_feedback", pumpRun, { onChange: true });
      this.emit("CNC-02", "clamp_proof", clampProof, { onChange: true, context: ctx });
      if (c.lastClampDelayS !== null) this.emit("CNC-02", "clamp_delay_s", c.lastClampDelayS, { onChange: true, heartbeatS: 30, context: ctx });
    }

    // Downstream accept / gauge
    let accept = false;
    c.pendingDownstream = c.pendingDownstream.filter((p) => {
      if (now >= p.dueMs) {
        accept = true;
        s.bufferOccupancy = Math.max(0, s.bufferOccupancy - 1);
        s.assembled += 1;
        if (s.assembled % 2 === 0) s.packed += 1;
        return false;
      }
      return true;
    });
    if (isA) this.emit("ASM-01", "downstream_accept", accept, { onChange: true, heartbeatS: 30, context: ctx });
    c.pendingGauge = c.pendingGauge.filter((p) => {
      if (now >= p.dueMs) {
        s.gaugeN += 1;
        s.gaugeLastDev = round1(2 + this.rng.gauss() * 3 + (isA ? f.gaugeShiftUm : 0));
        this.emit("GAUGE-01", "dimension_dev_um", s.gaugeLastDev, { context: { cycleId: c.cycleId, recipe: c.recipe } });
        this.emit("GAUGE-01", "result", Math.abs(s.gaugeLastDev) > 15 ? "REWORK" : "PASS", { onChange: true, heartbeatS: 30 });
        return false;
      }
      return true;
    });

    // Cell alarms
    if (isA) {
      const flowMeasured = f.flowMissing ? null : physicalFlow;
      this.alarmCondition("PUMP-01.low_flow", "PUMP-01", "coolant_flow", "FAULT", "Coolant flow below 12 L/min while pump running", flowMeasured !== null && pumpRun && flowMeasured < 12, 10);
      const tempReported = f.tempStuck !== undefined ? f.tempStuck : c.temp;
      this.alarmCondition("SPN-01.high_temp", "SPN-01", "bearing_temp", "WARNING", "Bearing temperature above 60 °C", tempReported > 60, 5);
      this.alarmCondition("SPN-01.high_vibration", "SPN-01", "vibration_rms", "WARNING", "Vibration above 3.0 mm/s", cutting && c.vibration > 3.0, 5);
      this.alarmCondition("SPN-01.high_current", "SPN-01", "motor_current", "WARNING", "Motor current above recipe limit", cutting && c.current > recipe.baseCurrentA * 1.3 + 0.5, 5);
      this.alarmCondition("CNC-01.undervoltage", "CNC-01", "supply_voltage", "FAULT", "Cabinet voltage below 360 V", cabinetV < 360, 3);
    } else {
      this.alarmCondition("SPN-02.high_vibration", "SPN-02", "vibration_rms", "WARNING", "Vibration above 3.0 mm/s", cutting && c.vibration > 3.0, 5);
      this.alarmCondition("SPN-02.high_current", "SPN-02", "motor_current", "WARNING", "Motor current above recipe limit", cutting && c.current > recipe.baseCurrentA * 1.3 + 0.5, 5);
      this.alarmCondition("CNC-02.undervoltage", "CNC-02", "supply_voltage", "FAULT", "Cabinet voltage below 360 V", cabinetV < 360, 3);
    }
  }

  private transition(c: CellSim, to: MachinePhase, now: EpochMs): void {
    c.phase = to;
    c.phaseSinceMs = now;
  }

  private emitAll(): void {
    // Initial values so the store has a sample for every tag at start.
    const s = this.state;
    this.emit("FDR-01", "supply_voltage", 400);
    this.emit("FDR-01", "supply_frequency", 50);
    this.emit("FDR-01", "breaker_closed", true);
    this.emit("COMP-01", "running", true);
    this.emit("COMP-01", "load_pct", 45);
    this.emit("COMP-01", "discharge_pressure", 7.0);
    this.emit("AIR-HDR-01", "header_pressure", 6.2);
    this.emit("AIR-HDR-01", "demand_pct", 20);
    this.emit("CHLR-01", "supply_temp", 18);
    this.emit("CHLR-01", "running", true);
    for (const c of Object.values(s.cells) as CellSim[]) {
      this.emit(c.cncId, "phase", c.phase);
      this.emit(c.cncId, "mode", c.mode);
      this.emit(c.cncId, "recipe", c.recipe);
      this.emit(c.cncId, "cycle_count", 0);
      this.emit(c.cncId, "cycle_complete", false);
      this.emit(c.cncId, "supply_voltage", 398);
      this.emit(c.cncId, "commanded_speed", RECIPES[c.recipe].commandedSpeedRpm);
      const spn = c.spnId;
      this.emit(spn, "actual_speed", 0);
      this.emit(spn, "motor_current", 0.8);
      this.emit(spn, "vibration_rms", 0.2);
      this.emit(c.pumpId, "run_feedback", true);
    }
    this.emit("SPN-01", "bearing_temp", 30);
    this.emit("SPN-01", "load_pct", 5);
    this.emit("PUMP-01", "coolant_flow", 18);
    this.emit("PUMP-01", "coolant_temp", 22);
    this.emit("CNC-01", "part_present", false);
    this.emit("CNC-01", "cycle_ready", false);
    this.emit("ROB-01", "robot_clear", false);
    this.emit("ROB-01", "move_complete", false);
    this.emit("ROB-01", "unload_complete", false);
    this.emit("ROB-01", "state", "IDLE");
    this.emit("FIX-01", "clamp_cmd", false);
    this.emit("FIX-01", "clamp_proof", false);
    this.emit("CNC-02", "clamp_proof", false);
    this.emit("CONV-01", "running", true);
    this.emit("CONV-01", "belt_speed", 12);
    this.emit("BUF-01", "occupancy", s.bufferOccupancy);
    this.emit("BUF-01", "capacity", BUFFER_CAPACITY);
    this.emit("FAN-01", "running", true);
    this.emit("GAUGE-01", "dimension_dev_um", null, { quality: "MISSING" });
    this.emit("GAUGE-01", "parts_measured", 0);
    this.emit("GAUGE-01", "result", "PASS");
    this.emit("ASM-01", "downstream_accept", false);
    this.emit("ASM-01", "assembled_count", 0);
    this.emit("PACK-01", "packed_count", 0);
  }

  /** Run until the given simulation time (inclusive). */
  runUntil(ms: EpochMs): void {
    while (this.state.nowMs < ms) this.step();
  }

  /** Public state summary for the UI (no fault truth). */
  cellSummary(cellId: CellId) {
    const c = this.state.cells[cellId];
    return {
      cellId,
      phase: c.phase,
      phaseSinceMs: c.phaseSinceMs,
      recipe: c.recipe,
      mode: c.mode,
      commandedSpeedRpm: this.commandedSpeed(c),
      overrideActive: c.speedOverrideRpm !== undefined,
      cycleId: c.cycleId,
      cycleCount: c.cycleCount,
      interrupted: c.interruptedSince !== undefined,
    };
  }

  activeAlarms(): Alarm[] {
    const now = this.state.nowMs;
    return this.state.alarms.filter((a) => !a.clearedAt || a.clearedAt.ms > now);
  }

  interventionLabel(id: InterventionId): string {
    return INTERVENTION_BY_ID[id]?.title ?? id;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
