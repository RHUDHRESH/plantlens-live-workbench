import type { Alarm, CellId, EpochMs, ExecutionMode, HealthyBaseline, Incident, KnowledgeVersion, Observation, RecoveryPlan, RecoveryRun, Workspace } from "@/lib/domain/types";
import { ASSET_BY_ID, ASSETS, TAG_BY_ID, tagId } from "@/lib/domain/plant";
import { PlantEngine, STEP_MS, type RecordedIntervention } from "./engine";
import { ObservationStore, readerAt, type Sample, type SeriesPoint } from "./observation";
import { DEMO_START_MS, type InterventionId } from "./scenarios";
import { diagnose, type CellContext, type DiagnosisGroup } from "@/lib/diagnosis/engine";
import { evaluateRun } from "@/lib/recovery/interpreter";
import { stableId } from "@/lib/util";

/**
 * Runtime orchestrator hosted in the Web Worker. Owns the engine (demo) or an imported
 * observation store (replay), runs deterministic diagnosis at the cutoff, evaluates
 * recovery runs at the live edge, and serves bounded queries for the UI.
 *
 * Replay model: the observation store is the event log. The cursor can move backwards to
 * view the recorded state at any time; nothing new is generated for the past. Playing
 * from behind the live edge scrubs through the recording until it catches up, then the
 * simulation resumes. Interventions apply at the live edge only.
 */

export type AssetStatus = "OK" | "WARNING" | "FAULT" | "SUSPECTED_CAUSE" | "POTENTIALLY_AFFECTED" | "UNAVAILABLE" | "UNKNOWN";

export interface AssetView {
  id: string;
  phase?: string;
  status: AssetStatus;
  headline: Array<{ tag: string; value: string; unit?: string; quality: string }>;
  freshnessMs: number | null;
  activeAlarmCount: number;
  incidentIds: string[];
  coverage: string;
}

export interface Checkpoint {
  ms: EpochMs;
  phases: Record<string, string>;
  activeAlarmIds: string[];
  openIncidentIds: string[];
}

export interface RuntimeSnapshot {
  mode: ExecutionMode;
  scenarioId?: string;
  seed?: number;
  clock: { liveMs: EpochMs; cursorMs: EpochMs; startMs: EpochMs; endMs?: EpochMs; running: boolean; speed: number; viewingPast: boolean; stepMs: number };
  assets: Record<string, AssetView>;
  cells: Record<CellId, ReturnType<PlantEngine["cellSummary"]> | { cellId: CellId; phase: string; recipe: string; mode: string; commandedSpeedRpm: number; overrideActive: boolean; cycleCount: number; interrupted: boolean; cycleId?: string; phaseSinceMs: number }>;
  alarms: Alarm[];
  incidents: Incident[];
  runs: RecoveryRun[];
  interventions: RecordedIntervention[];
  knowledgeVersionId: string;
  stats: { observations: number; tags: number; earliestMs: EpochMs; latestMs: EpochMs; diagnosisRuns: number };
  checkpoints: Checkpoint[];
  missingBaselines: string[];
  liveAdapter: { configured: false; reason: string };
  importInfo?: Workspace["importInfo"];
  hiddenTab: boolean;
}

export interface SeriesQuery {
  tagIds: string[];
  fromMs: EpochMs;
  toMs: EpochMs;
  maxPoints?: number;
}

export interface RuntimeInit {
  mode: ExecutionMode;
  seed?: number;
  scenarioId?: string;
  startMs?: EpochMs;
  knowledge: KnowledgeVersion;
  baselines: HealthyBaseline[];
  existingIncidents?: Incident[];
  existingRuns?: RecoveryRun[];
  interventions?: RecordedIntervention[];
  /** Live edge to fast-forward to on restore (replays recorded interventions). */
  resumeLiveMs?: EpochMs;
}

const DIAGNOSIS_INTERVAL_MS = 5000;
const CHECKPOINT_INTERVAL_MS = 30_000;

export class Runtime {
  mode: ExecutionMode = "DEMO_SIMULATION";
  private engine?: PlantEngine;
  private importedStore?: ObservationStore;
  private importedAlarms: Alarm[] = [];
  private importInfo?: Workspace["importInfo"];
  private scenarioId?: string;
  private seed?: number;
  private startMs = DEMO_START_MS;
  private endMs?: EpochMs;
  private cursorMs = DEMO_START_MS;
  running = false;
  speed = 1;
  hiddenTab = false;
  private accumulator = 0;
  private knowledge!: KnowledgeVersion;
  private baselines: HealthyBaseline[] = [];
  private incidents = new Map<string, Incident>();
  private runs = new Map<string, RecoveryRun>();
  private plans = new Map<string, RecoveryPlan>();
  private lastDiagnosisMs = -Infinity;
  private diagnosisRuns = 0;
  private incidentSeq = 0;
  private checkpoints: Checkpoint[] = [];
  private missingBaselines: string[] = [];
  private cellContextImported: Record<CellId, CellContext> | undefined;

  init(cfg: RuntimeInit): void {
    this.mode = cfg.mode;
    this.knowledge = cfg.knowledge;
    this.baselines = cfg.baselines;
    this.incidents.clear();
    this.runs.clear();
    this.checkpoints = [];
    this.lastDiagnosisMs = -Infinity;
    this.diagnosisRuns = 0;
    this.incidentSeq = 0;
    for (const i of cfg.existingIncidents ?? []) this.incidents.set(i.id, i);
    for (const r of cfg.existingRuns ?? []) this.runs.set(r.id, r);
    this.incidentSeq = Math.max(0, ...Array.from(this.incidents.keys()).map((k) => Number(k.match(/INC-DEMO-(\d+)/)?.[1] ?? 0)));
    if (cfg.mode === "DEMO_SIMULATION") {
      this.seed = cfg.seed ?? 1001;
      this.scenarioId = cfg.scenarioId ?? "S01-SHARED-AIR";
      this.startMs = cfg.startMs ?? DEMO_START_MS;
      this.engine = new PlantEngine({ seed: this.seed, scenarioId: this.scenarioId, startMs: this.startMs });
      this.importedStore = undefined;
      this.cursorMs = this.startMs;
      this.endMs = undefined;
      if (cfg.interventions?.length || cfg.resumeLiveMs) this.restore(cfg.interventions ?? [], cfg.resumeLiveMs ?? this.startMs);
    }
  }

  /** Deterministic restore: re-run the engine to the saved live edge, re-applying recorded interventions. */
  private restore(interventions: RecordedIntervention[], liveMs: EpochMs): void {
    if (!this.engine) return;
    const sorted = interventions.slice().sort((a, b) => a.atMs - b.atMs);
    for (const rec of sorted) {
      this.engine.runUntil(rec.atMs);
      this.engine.applyIntervention(rec.interventionId, rec.params, rec.recordedBy);
      this.runDiagnosis(this.engine.nowMs, true);
    }
    while (this.engine.nowMs < liveMs) {
      this.engine.step();
      this.afterStep();
    }
    this.cursorMs = this.engine.nowMs;
  }

  loadImported(samples: Array<{ tagId: string; sample: Sample }>, alarms: Alarm[], importInfo: Workspace["importInfo"]): void {
    this.mode = "IMPORTED_REPLAY";
    this.engine = undefined;
    const store = new ObservationStore(Infinity);
    for (const s of samples) store.push(s.tagId, s.sample);
    this.importedStore = store;
    this.importedAlarms = alarms;
    this.importInfo = importInfo;
    this.startMs = Number.isFinite(store.earliest) ? store.earliest : DEMO_START_MS;
    this.endMs = Number.isFinite(store.latest) ? store.latest : this.startMs;
    this.cursorMs = this.startMs;
    this.incidents.clear();
    this.runs.clear();
    this.checkpoints = [];
    this.lastDiagnosisMs = -Infinity;
    this.incidentSeq = 0;
    this.running = false;
  }

  setKnowledge(k: KnowledgeVersion): void {
    this.knowledge = k;
    this.lastDiagnosisMs = -Infinity;
    this.runDiagnosis(this.liveMs, true);
  }

  setBaselines(b: HealthyBaseline[]): void {
    this.baselines = b;
  }

  get store(): ObservationStore {
    return this.engine ? this.engine.store : (this.importedStore ?? new ObservationStore());
  }

  get liveMs(): EpochMs {
    return this.engine ? this.engine.nowMs : (this.endMs ?? this.startMs);
  }

  get cursor(): EpochMs {
    return this.cursorMs;
  }

  play(): void {
    this.running = true;
  }
  pause(): void {
    this.running = false;
  }
  setSpeed(s: number): void {
    this.speed = Math.max(0.25, Math.min(64, s));
  }

  seek(ms: EpochMs): void {
    const lo = Number.isFinite(this.store.earliest) ? this.store.earliest : this.startMs;
    this.cursorMs = Math.max(lo, Math.min(this.liveMs, ms));
    if (this.mode === "IMPORTED_REPLAY") this.runDiagnosis(this.cursorMs, true);
  }

  /** Advance by wall-clock delta. Steps are integral; playback speed never changes observation values. */
  advance(wallDeltaMs: number): void {
    if (!this.running || this.hiddenTab) return;
    this.accumulator += wallDeltaMs * this.speed;
    let steps = Math.floor(this.accumulator / STEP_MS);
    if (steps <= 0) return;
    steps = Math.min(steps, 120);
    this.accumulator -= steps * STEP_MS;
    for (let i = 0; i < steps; i++) {
      if (this.cursorMs < this.liveMs) {
        // Scrub through the recording first.
        this.cursorMs = Math.min(this.liveMs, this.cursorMs + STEP_MS);
        if (this.mode === "IMPORTED_REPLAY") this.maybeDiagnose(this.cursorMs);
        continue;
      }
      if (this.engine) {
        this.engine.step();
        this.cursorMs = this.engine.nowMs;
        this.afterStep();
      } else {
        this.running = false; // imported replay reached the end of the record
        break;
      }
    }
  }

  /** Headless fast-forward at the live edge (used by tests and the evaluation harness). */
  fastForward(toMs: EpochMs): void {
    if (!this.engine) {
      this.cursorMs = Math.min(this.liveMs, toMs);
      this.runDiagnosis(this.cursorMs, true);
      return;
    }
    while (this.engine.nowMs < toMs) {
      this.engine.step();
      this.cursorMs = this.engine.nowMs;
      this.afterStep();
    }
  }

  stepOnce(): void {
    if (this.engine && this.cursorMs >= this.liveMs) {
      this.engine.step();
      this.cursorMs = this.engine.nowMs;
      this.afterStep();
    } else this.cursorMs = Math.min(this.liveMs, this.cursorMs + STEP_MS);
  }

  private afterStep(): void {
    const now = this.liveMs;
    this.maybeDiagnose(now);
    this.evaluateRuns(now);
    this.updateInterruptions(now);
    if (now % CHECKPOINT_INTERVAL_MS === 0) this.checkpoint(now);
  }

  private maybeDiagnose(now: EpochMs): void {
    if (now - this.lastDiagnosisMs >= DIAGNOSIS_INTERVAL_MS) this.runDiagnosis(now, false);
  }

  private checkpoint(now: EpochMs): void {
    const phases: Record<string, string> = {};
    for (const a of ASSETS) {
      const s = this.store.latestAt(tagId(a.id, "phase"), now);
      if (s && typeof s.value === "string") phases[a.id] = s.value;
    }
    this.checkpoints.push({ ms: now, phases, activeAlarmIds: this.alarmsAt(now).filter((a) => !a.clearedAt || a.clearedAt.ms > now).map((a) => a.id), openIncidentIds: Array.from(this.incidents.values()).filter((i) => i.status !== "CLOSED").map((i) => i.id) });
    if (this.checkpoints.length > 400) this.checkpoints.shift();
  }

  private alarmsAt(cutoff: EpochMs): Alarm[] {
    const all = this.engine ? this.engine.state.alarms : this.importedAlarms;
    return all.filter((a) => a.raisedAt.ms <= cutoff);
  }

  cellContexts(cutoff: EpochMs): Record<CellId, CellContext> {
    const ctx = (cellId: CellId, cnc: string): CellContext => {
      const recipe = this.store.latestAt(tagId(cnc, "recipe"), cutoff)?.value;
      const mode = this.store.latestAt(tagId(cnc, "mode"), cutoff)?.value;
      const cmd = this.store.latestAt(tagId(cnc, "commanded_speed"), cutoff)?.value;
      const phase = this.store.latestAt(tagId(cnc, "phase"), cutoff)?.value;
      return {
        cellId,
        recipe: typeof recipe === "string" ? recipe : "UNKNOWN",
        mode: (typeof mode === "string" ? mode : "UNKNOWN") as CellContext["mode"],
        commandedSpeedRpm: typeof cmd === "number" ? cmd : 0,
        phase: (typeof phase === "string" ? phase : "UNCLASSIFIED") as CellContext["phase"],
      };
    };
    return { "CELL-A": ctx("CELL-A", "CNC-01"), "CELL-B": ctx("CELL-B", "CNC-02") };
  }

  runDiagnosis(cutoff: EpochMs, force: boolean): void {
    if (!force && cutoff - this.lastDiagnosisMs < DIAGNOSIS_INTERVAL_MS) return;
    this.lastDiagnosisMs = cutoff;
    this.diagnosisRuns++;
    const reader = readerAt(this.store, cutoff);
    const out = diagnose({
      reader,
      alarms: this.alarmsAt(cutoff),
      knowledge: { versionId: this.knowledge.id, edges: this.knowledge.edges, requirements: this.knowledge.requirements, reviewedNoDependency: this.knowledge.reviewedNoDependency },
      baselines: this.baselines,
      cells: this.cellContextImported ?? this.cellContexts(cutoff),
      cutoffMs: cutoff,
    });
    this.missingBaselines = out.missingBaselines;
    const seenSignatures = new Set<string>();
    for (const g of out.groups) {
      seenSignatures.add(g.signature);
      let inc = Array.from(this.incidents.values()).find((i) => !i.fixture && i.status !== "CLOSED" && i.status !== "RESOLVED" && incidentSignature(i) === g.signature);
      if (!inc) {
        // Try to match an open incident sharing observed assets (grouping may widen after a knowledge publish).
        inc = Array.from(this.incidents.values()).find((i) => !i.fixture && i.status !== "CLOSED" && i.status !== "RESOLVED" && i.observedAssetIds.some((a) => g.observedAssetIds.includes(a)) && (i.sharedCauseAssetId ?? "") === (g.sharedCauseAssetId ?? ""));
      }
      if (!inc) {
        this.incidentSeq++;
        const id = `INC-DEMO-${String(this.incidentSeq).padStart(3, "0")}`;
        inc = {
          id,
          title: g.title,
          status: "OPEN",
          openedAt: { ms: g.diagnosis.firstReliableDeviation?.ms ?? cutoff, clock: "SIMULATION", uncertaintyMs: g.diagnosis.firstReliableDeviation?.uncertaintyMs ?? 0 },
          observedAssetIds: g.observedAssetIds,
          potentiallyAffectedAssetIds: g.potentiallyAffectedAssetIds,
          affectedCellIds: g.affectedCellIds,
          alarmIds: g.alarmIds,
          groupingRationale: g.groupingRationale,
          workOrderIds: [],
          recoveryPlanIds: [],
          interruptions: [],
          safetyRelevant: g.safetyRelevant,
          repeatOf: [],
          sharedCauseAssetId: g.sharedCauseAssetId,
        };
        this.incidents.set(id, inc);
      }
      inc.title = g.title;
      inc.observedAssetIds = Array.from(new Set([...inc.observedAssetIds, ...g.observedAssetIds]));
      inc.potentiallyAffectedAssetIds = g.potentiallyAffectedAssetIds.filter((a) => !inc!.observedAssetIds.includes(a));
      inc.affectedCellIds = Array.from(new Set([...inc.affectedCellIds, ...g.affectedCellIds]));
      inc.alarmIds = Array.from(new Set([...inc.alarmIds, ...g.alarmIds]));
      inc.groupingRationale = g.groupingRationale;
      inc.sharedCauseAssetId = g.sharedCauseAssetId;
      inc.diagnosis = { incidentId: inc.id, ...g.diagnosis };
      inc.repeatOf = this.findRepeats(inc);
    }
  }

  private findRepeats(inc: Incident): string[] {
    const family = inc.diagnosis?.candidates[0]?.family;
    return Array.from(this.incidents.values())
      .filter((i) => i.id !== inc.id && (i.fixture || i.status === "CLOSED") && i.observedAssetIds.some((a) => inc.observedAssetIds.includes(a)))
      .filter((i) => !family || !i.diagnosis || i.diagnosis.candidates[0]?.family === family || true)
      .map((i) => i.id);
  }

  private updateInterruptions(now: EpochMs): void {
    if (!this.engine) return;
    for (const inc of this.incidents.values()) {
      if (inc.fixture || inc.status === "CLOSED") continue;
      for (const cell of inc.affectedCellIds) {
        const engineIntervals = this.engine.state.interruptions.filter((x) => x.cellId === cell && (x.endMs ?? now) >= inc.openedAt.ms - 30_000);
        inc.interruptions = [...inc.interruptions.filter((x) => x.cellId !== cell), ...engineIntervals.map((x) => ({ cellId: cell, startMs: x.startMs, endMs: x.endMs }))];
      }
    }
  }

  // --- Interventions ---

  intervene(id: InterventionId, params: Record<string, number | string> | undefined, by: string): RecordedIntervention {
    if (!this.engine) throw new Error("Interventions are only available in demo simulation mode. Imported traces are never mutated.");
    if (this.cursorMs < this.liveMs) this.cursorMs = this.liveMs;
    const rec = this.engine.applyIntervention(id, params, by);
    // Any run that started before this intervention is now stale for closure purposes.
    for (const r of this.runs.values()) if (r.outcome === "RUNNING" || r.outcome === "PASS") if (r.startedAt.ms <= rec.atMs && !r.finishedAt) r.staleReason = `Intervention ${id} recorded at ${rec.atMs} after the run started.`;
    this.runDiagnosis(this.liveMs, true);
    return rec;
  }

  // --- Recovery runs ---

  startRun(plan: RecoveryPlan, workOrderId: string | undefined): RecoveryRun {
    if (plan.status !== "APPROVED") throw new Error(`Plan ${plan.id} v${plan.version} is ${plan.status}; only APPROVED plans can run.`);
    this.plans.set(`${plan.id}@${plan.version}`, structuredClone(plan)); // frozen copy
    const now = this.liveMs;
    const id = stableId("RUN", plan.id, plan.version, now, this.runs.size);
    const run: RecoveryRun = {
      id,
      planId: plan.id,
      planVersion: plan.version,
      incidentId: plan.incidentId,
      knowledgeVersion: plan.knowledgeVersion,
      baselineVersion: plan.baselineVersion,
      outcome: "RUNNING",
      startedAt: { ms: now, clock: "SIMULATION", uncertaintyMs: 0 },
      evaluatedUntilMs: now,
      results: plan.checks.map((c) => ({ checkId: c.id, status: "PENDING", reason: "Not evaluated yet", detail: {}, evidenceObservationIds: [], missingChannels: [], decisiveViolation: false })),
      summary: "Collecting evidence.",
      contextObserved: {},
      completeCyclesObserved: 0,
      settlingRemainingSeconds: 0,
      reasonNotEstablished: [],
      workOrderId,
      retainedObservationIds: [],
    };
    this.runs.set(id, run);
    this.store.pin(id, now - 60_000);
    this.evaluateRuns(now);
    return run;
  }

  abortRun(runId: string): void {
    const r = this.runs.get(runId);
    if (r && r.outcome === "RUNNING") {
      r.outcome = "INCONCLUSIVE";
      r.finishedAt = { ms: this.liveMs, clock: "SIMULATION", uncertaintyMs: 0 };
      r.reasonNotEstablished = [...r.reasonNotEstablished, "Run aborted before the required opportunities were observed."];
      this.store.unpin(runId);
    }
  }

  private evaluateRuns(now: EpochMs): void {
    for (const run of this.runs.values()) {
      if (run.outcome !== "RUNNING") continue;
      const plan = this.plans.get(`${run.planId}@${run.planVersion}`);
      if (!plan) continue;
      const evaluated = evaluateRun({ plan, run, reader: readerAt(this.store, now), alarms: this.alarmsAt(now), cells: this.cellContexts(now), publishedEdges: this.knowledge.edges, nowMs: now });
      this.runs.set(run.id, evaluated);
      if (evaluated.outcome !== "RUNNING") this.store.unpin(run.id);
    }
  }

  reviewRun(runId: string, review: RecoveryRun["reviewedBy"]): void {
    const r = this.runs.get(runId);
    if (r) r.reviewedBy = review;
  }

  setIncidentStatus(id: string, status: Incident["status"]): void {
    const i = this.incidents.get(id);
    if (i) {
      i.status = status;
      if (status === "CLOSED" || status === "RESOLVED") i.closedAt = { ms: this.liveMs, clock: "SIMULATION", uncertaintyMs: 0 };
    }
  }

  linkIncident(id: string, patch: Partial<Pick<Incident, "workOrderIds" | "recoveryPlanIds">>): void {
    const i = this.incidents.get(id);
    if (!i) return;
    if (patch.workOrderIds) i.workOrderIds = Array.from(new Set([...i.workOrderIds, ...patch.workOrderIds]));
    if (patch.recoveryPlanIds) i.recoveryPlanIds = Array.from(new Set([...i.recoveryPlanIds, ...patch.recoveryPlanIds]));
  }

  // --- Queries ---

  series(q: SeriesQuery): Record<string, SeriesPoint[]> {
    const out: Record<string, SeriesPoint[]> = {};
    for (const t of q.tagIds) out[t] = this.store.series(t, q.fromMs, Math.min(q.toMs, this.cursorMs), q.maxPoints ?? 600);
    return out;
  }

  events(tagIds: string[], fromMs: EpochMs, toMs: EpochMs): Record<string, Array<{ ms: number; uncertaintyMs: number; cycleId?: string; clockSourceId?: string; rawMs?: number }>> {
    const out: Record<string, Array<{ ms: number; uncertaintyMs: number; cycleId?: string; clockSourceId?: string; rawMs?: number }>> = {};
    for (const t of tagIds) out[t] = this.store.risingEdges(t, fromMs, Math.min(toMs, this.cursorMs)).map((s) => ({ ms: s.ms, uncertaintyMs: s.uncertaintyMs, cycleId: s.context?.cycleId, clockSourceId: s.clockSourceId, rawMs: s.rawMs }));
    return out;
  }

  observations(ids: string[]): Observation[] {
    const out: Observation[] = [];
    for (const id of ids) {
      const m = id.match(/^OBS-(.+)-(\d+)$/);
      if (!m) continue;
      const tag = m[1];
      const ms = Number(m[2]);
      const s = this.store.range(tag, ms, ms)[0];
      if (s) out.push(this.store.materialize(tag, s));
    }
    return out;
  }

  exportObservations(fromMs: EpochMs, toMs: EpochMs, limitPerTag = 2000): Observation[] {
    return this.store.exportAll(fromMs, Math.min(toMs, this.liveMs), limitPerTag);
  }

  interventions(): RecordedIntervention[] {
    return this.engine ? this.engine.recordedInterventions() : [];
  }

  snapshot(): RuntimeSnapshot {
    const cursor = this.cursorMs;
    const incidents = Array.from(this.incidents.values());
    const alarms = this.alarmsAt(cursor);
    const assets: Record<string, AssetView> = {};
    for (const a of ASSETS) {
      const active = alarms.filter((x) => x.assetId === a.id && (!x.clearedAt || x.clearedAt.ms > cursor));
      const openInc = incidents.filter((i) => i.status !== "CLOSED" && !i.fixture && (i.observedAssetIds.includes(a.id) || i.potentiallyAffectedAssetIds.includes(a.id) || i.sharedCauseAssetId === a.id));
      let status: AssetStatus = "OK";
      const headline = a.headlineTags.map((tn) => {
        const t = tagId(a.id, tn);
        const s = this.store.latestAt(t, cursor);
        const def = TAG_BY_ID[t];
        return { tag: tn, value: s ? formatValue(s.value) : "—", unit: def?.unit, quality: s?.quality ?? "MISSING" };
      });
      const latestMs = Math.max(...a.headlineTags.map((tn) => this.store.latestAt(tagId(a.id, tn), cursor)?.ms ?? -Infinity));
      const freshness = Number.isFinite(latestMs) ? cursor - latestMs : null;
      if (headline.some((h) => h.quality === "MISSING" || h.quality === "SUSPECT")) status = "UNAVAILABLE";
      if (openInc.some((i) => i.potentiallyAffectedAssetIds.includes(a.id))) status = "POTENTIALLY_AFFECTED";
      if (active.some((x) => x.severity === "WARNING")) status = "WARNING";
      if (active.some((x) => x.severity === "FAULT")) status = "FAULT";
      if (openInc.some((i) => i.sharedCauseAssetId === a.id && i.diagnosis?.state !== "NORMAL")) status = "SUSPECTED_CAUSE";
      if (openInc.some((i) => i.observedAssetIds.includes(a.id)) && status === "OK") status = "WARNING";
      const phaseS = this.store.latestAt(tagId(a.id, "phase"), cursor);
      assets[a.id] = { id: a.id, phase: phaseS && typeof phaseS.value === "string" ? phaseS.value : undefined, status, headline, freshnessMs: freshness, activeAlarmCount: active.length, incidentIds: openInc.map((i) => i.id), coverage: a.coverage };
    }
    const cells = this.engine && cursor >= this.liveMs ? { "CELL-A": this.engine.cellSummary("CELL-A"), "CELL-B": this.engine.cellSummary("CELL-B") } : this.cellsAt(cursor);
    return {
      mode: this.mode,
      scenarioId: this.scenarioId,
      seed: this.seed,
      clock: { liveMs: this.liveMs, cursorMs: cursor, startMs: this.startMs, endMs: this.endMs, running: this.running, speed: this.speed, viewingPast: cursor < this.liveMs, stepMs: STEP_MS },
      assets,
      cells,
      alarms: alarms.slice(-200),
      incidents,
      runs: Array.from(this.runs.values()),
      interventions: this.interventions(),
      knowledgeVersionId: this.knowledge.id,
      stats: { observations: this.store.size(), tags: this.store.tagIds().length, earliestMs: this.store.earliest, latestMs: this.store.latest, diagnosisRuns: this.diagnosisRuns },
      checkpoints: this.checkpoints.slice(-60),
      missingBaselines: this.missingBaselines,
      liveAdapter: { configured: false, reason: "No live-source adapter is implemented. The read-only adapter contract exists (lib/ai/adapter.ts); connectivity has not been verified." },
      importInfo: this.importInfo,
      hiddenTab: this.hiddenTab,
    };
  }

  private cellsAt(cursor: EpochMs): RuntimeSnapshot["cells"] {
    const c = this.cellContexts(cursor);
    const mk = (cellId: CellId, cnc: string) => ({
      cellId,
      phase: c[cellId].phase,
      recipe: c[cellId].recipe,
      mode: c[cellId].mode,
      commandedSpeedRpm: c[cellId].commandedSpeedRpm,
      overrideActive: false,
      cycleCount: Number(this.store.latestAt(tagId(cnc, "cycle_count"), cursor)?.value ?? 0),
      interrupted: false,
      cycleId: String(this.store.latestAt(tagId(cnc, "cycle_id"), cursor)?.value ?? ""),
      phaseSinceMs: this.store.latestAt(tagId(cnc, "phase"), cursor)?.ms ?? cursor,
    });
    return { "CELL-A": mk("CELL-A", "CNC-01"), "CELL-B": mk("CELL-B", "CNC-02") };
  }

  incidentsList(): Incident[] {
    return Array.from(this.incidents.values());
  }
  runsList(): RecoveryRun[] {
    return Array.from(this.runs.values());
  }
}

function incidentSignature(i: Incident): string {
  if (i.sharedCauseAssetId === "AIR-HDR-01") return `AIR:${i.observedAssetIds.slice().sort().join(",")}`;
  if (i.sharedCauseAssetId === "FDR-01") return "SUPPLY";
  if (i.observedAssetIds.some((a) => a === "PUMP-01" || a === "SPN-01")) return "CELLA-SPINDLE";
  if (i.observedAssetIds.includes("CNC-01") && i.title.includes("acknowledgement")) return "ACK";
  if (i.observedAssetIds.includes("SPN-02")) return "CELLB-SPINDLE";
  if (i.observedAssetIds.includes("GAUGE-01")) return "GAUGE";
  if (i.observedAssetIds.length === 1 && (i.observedAssetIds[0] === "FIX-01" || i.observedAssetIds[0] === "CNC-02")) return `CLAMP:${i.observedAssetIds[0]}`;
  return i.title;
}

export function formatValue(v: Sample["value"]): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1);
  return String(v);
}

export function assetLabel(id: string): string {
  return ASSET_BY_ID[id]?.name ?? id;
}
