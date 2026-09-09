import type {
  Alarm,
  CellId,
  DependencyEdge,
  Diagnosis,
  DiagnosticGraph,
  DiagnosticState,
  EpochMs,
  EvidenceItem,
  EvidenceRelation,
  FaultCandidate,
  FaultFamilyId,
  HealthyBaseline,
  MachinePhase,
  NextCheck,
  OperatingMode,
  RecoveryRequirement,
} from "@/lib/domain/types";
import type { ObservationReader, Sample } from "@/lib/simulation/observation";
import { observationId } from "@/lib/simulation/observation";
import { ASSET_BY_ID } from "@/lib/domain/plant";
import { FAMILY_CONFIG, NEXT_CHECK_LIBRARY } from "./config";

/**
 * Deterministic, versioned diagnosis. Input contract: observations up to a cutoff,
 * PUBLISHED knowledge only, asset context, baselines, and quality metadata. No scenario
 * identifiers, injected faults, or future observations are available here.
 */

export interface CellContext {
  cellId: CellId;
  recipe: string;
  mode: OperatingMode;
  commandedSpeedRpm: number;
  phase: MachinePhase;
}

export interface PublishedKnowledge {
  versionId: string;
  edges: DependencyEdge[];
  requirements: RecoveryRequirement[];
  reviewedNoDependency: string[];
}

export interface DiagnosisInput {
  reader: ObservationReader;
  alarms: Alarm[];
  knowledge: PublishedKnowledge;
  baselines: HealthyBaseline[];
  cells: Record<CellId, CellContext>;
  cutoffMs: EpochMs;
  windowMs?: number;
}

export interface DiagnosisGroup {
  /** Stable signature used by the runtime to keep incident ids across recomputation. */
  signature: string;
  title: string;
  observedAssetIds: string[];
  potentiallyAffectedAssetIds: string[];
  affectedCellIds: CellId[];
  alarmIds: string[];
  groupingRationale: string;
  sharedCauseAssetId?: string;
  diagnosis: Omit<Diagnosis, "incidentId">;
  safetyRelevant: boolean;
}

export interface DiagnosisOutput {
  groups: DiagnosisGroup[];
  /** Evidence items that produced no group (normal operation). */
  quiet: boolean;
  missingBaselines: string[];
}

const DEFAULT_WINDOW_MS = 6 * 60_000;

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

interface Deviation extends EvidenceItem {
  family: string; // evidence family key used by the config (AIR, CLAMP_A, ...)
  cellId?: CellId;
}

function numeric(s: Sample | undefined): number | null {
  return s && typeof s.value === "number" ? s.value : null;
}

function bandFor(baselines: HealthyBaseline[], cell: CellContext | undefined, tagId: string) {
  if (!cell) return undefined;
  const b = baselines.find((x) => x.recipe === cell.recipe && x.cellId === cell.cellId && x.mode === cell.mode);
  return b?.bands.find((band) => band.tagId === tagId);
}

function baselineFor(baselines: HealthyBaseline[], cell: CellContext | undefined) {
  if (!cell) return undefined;
  return baselines.find((x) => x.recipe === cell.recipe && x.cellId === cell.cellId && x.mode === cell.mode);
}

/** First sample where predicate holds for at least `holdMs` continuously. */
function sustainedOnset(samples: Sample[], pred: (s: Sample) => boolean, holdMs: number): Sample | undefined {
  let start: Sample | undefined;
  for (const s of samples) {
    if (pred(s)) {
      start = start ?? s;
      if (s.ms - start.ms >= holdMs) return start;
    } else start = undefined;
  }
  return undefined;
}

function isPhase(s: Sample, phase: MachinePhase): boolean {
  return s.context?.phase === phase;
}

/** Never compare observations from a previous recipe/mode with the active baseline. */
function isComparableContext(s: Sample, cell: CellContext | undefined): boolean {
  if (!cell) return false;
  return (!s.context?.recipe || s.context.recipe === cell.recipe) && (!s.context?.mode || s.context.mode === cell.mode);
}

function mk(partial: Omit<Deviation, "id" | "observationIds"> & { observationIds?: string[] }): Deviation {
  return { id: `EV-${partial.family}-${partial.tagId}-${partial.onsetMs ?? partial.window.startMs}`, observationIds: [], ...partial };
}

function obsIds(tagId: string, samples: Sample[], limit = 12): string[] {
  const step = Math.max(1, Math.ceil(samples.length / limit));
  const out: string[] = [];
  for (let i = 0; i < samples.length; i += step) out.push(observationId(tagId, samples[i].ms));
  return out;
}

export function extractEvidence(input: DiagnosisInput): { deviations: Deviation[]; missingBaselines: string[]; quality: Deviation[] } {
  const { reader, baselines, cells, cutoffMs } = input;
  const from = cutoffMs - (input.windowMs ?? DEFAULT_WINDOW_MS);
  const deviations: Deviation[] = [];
  const quality: Deviation[] = [];
  const missingBaselines: string[] = [];
  const window = { startMs: from, endMs: cutoffMs };

  // --- Shared air ---
  {
    const tag = "AIR-HDR-01.header_pressure";
    const samples = reader.range(tag, from);
    const onset = sustainedOnset(samples, (s) => typeof s.value === "number" && s.value < 5.5, 3000);
    if (onset) {
      const latest = numeric(reader.latestAt(tag));
      deviations.push(
        mk({
          family: "AIR",
          assetId: "AIR-HDR-01",
          tagId: tag,
          group: "AIR",
          title: "Header pressure below the approved 5.5 bar condition",
          description: `Header pressure fell below 5.5 bar and stayed there. Latest ${latest?.toFixed(2) ?? "—"} bar.`,
          quality: "GOOD",
          window,
          observedValue: latest !== null ? `${latest.toFixed(2)} bar` : undefined,
          referenceValue: "≥ 5.5 bar (REQ-DEMO-AIR-01)",
          orderingReliable: onset.uncertaintyMs <= 1000,
          referenceId: "REQ-DEMO-AIR-01",
          onsetMs: onset.ms,
          onsetUncertaintyMs: onset.uncertaintyMs,
          observationIds: obsIds(tag, samples.filter((s) => s.ms >= onset.ms)),
        }),
      );
    }
    // Compressor running is context, recorded as evidence that running alone is not delivery.
  }

  // --- Clamp delays (cell A: FIX-01, cell B: CNC-02) ---
  for (const [tag, assetId, cellId, family] of [
    ["FIX-01.clamp_delay_s", "FIX-01", "CELL-A", "CLAMP_A"],
    ["CNC-02.clamp_delay_s", "CNC-02", "CELL-B", "CLAMP_B"],
  ] as const) {
    const band = bandFor(baselines, cells[cellId], tag);
    const max = band?.max ?? 4;
    const samples = reader.range(tag, from).filter((s) => typeof s.value === "number");
    const bad = samples.filter((s) => (s.value as number) > max);
    // Also count envelope alarms (clamp proof not received) as clamp deviations even before the delay is reported.
    const envelopeAlarms = input.alarms.filter((a) => a.assetId === assetId && a.message.startsWith("Clamp proof not received") && a.raisedAt.ms >= from && a.raisedAt.ms <= cutoffMs);
    if (bad.length || envelopeAlarms.length) {
      const onsetMs = Math.min(bad[0]?.ms ?? Infinity, envelopeAlarms[0]?.raisedAt.ms ?? Infinity);
      const worst = bad.reduce((m, s) => Math.max(m, s.value as number), 0);
      deviations.push(
        mk({
          family,
          assetId,
          tagId: tag,
          group: family,
          cellId,
          title: `${assetId} clamp proof delayed beyond ${max} s`,
          description: `${bad.length + envelopeAlarms.length} clamp(s) exceeded the approved band; worst reported delay ${worst ? worst.toFixed(1) + " s" : "> 8 s (proof not received in envelope)"}.`,
          quality: "GOOD",
          window,
          observedValue: worst ? `${worst.toFixed(1)} s` : "> 8 s",
          referenceValue: `≤ ${max} s (${baselineFor(baselines, cells[cellId])?.id ?? "no baseline"})`,
          orderingReliable: true,
          referenceId: baselineFor(baselines, cells[cellId])?.id,
          onsetMs,
          onsetUncertaintyMs: 1000,
          observationIds: obsIds(tag, bad),
        }),
      );
    }
  }

  // --- Unload acknowledgement (cell A) ---
  {
    const moves = reader.risingEdges("ROB-01.move_complete", from);
    const acks = reader.risingEdges("ROB-01.unload_complete", from);
    let usedAck = 0;
    const late: Array<{ move: Sample; ack?: Sample; elapsedS: number }> = [];
    for (const m of moves) {
      while (usedAck < acks.length && acks[usedAck].ms < m.ms) usedAck++;
      const ack = acks[usedAck];
      if (ack) {
        const elapsedS = (ack.ms - m.ms) / 1000;
        if (elapsedS > 8) late.push({ move: m, ack, elapsedS });
        usedAck++;
      } else if (cutoffMs - m.ms > 8000) {
        late.push({ move: m, elapsedS: (cutoffMs - m.ms) / 1000 });
      }
    }
    if (late.length) {
      const u = Math.max(...late.map((l) => l.move.uncertaintyMs));
      deviations.push(
        mk({
          family: "ACK",
          assetId: "CNC-01",
          tagId: "ROB-01.unload_complete",
          group: "ACK",
          cellId: "CELL-A",
          title: "Unload-complete acknowledgement outside the 8 s envelope",
          description: `${late.length} unload sequence(s) exceeded the approved 8 s envelope; longest observed ${Math.max(...late.map((l) => l.elapsedS)).toFixed(1)} s. The robot reported move_complete; the acknowledgement CNC-01 waits for arrived late or not at all.`,
          quality: "GOOD",
          window,
          observedValue: `${Math.max(...late.map((l) => l.elapsedS)).toFixed(1)} s`,
          referenceValue: "≤ 8 s (REQ-DEMO-UNLOAD-01)",
          orderingReliable: u <= 1000,
          referenceId: "REQ-DEMO-UNLOAD-01",
          onsetMs: late[0].move.ms,
          onsetUncertaintyMs: u,
          observationIds: late.slice(0, 6).flatMap((l) => [observationId("ROB-01.move_complete", l.move.ms), ...(l.ack ? [observationId("ROB-01.unload_complete", l.ack.ms)] : [])]),
        }),
      );
    }
  }

  // --- Coolant flow (cell A) ---
  {
    const tag = "PUMP-01.coolant_flow";
    const cell = cells["CELL-A"];
    const band = bandFor(baselines, cell, tag);
    const samples = reader.range(tag, from).filter((s) => isComparableContext(s, cell));
    const missing = samples.filter((s) => s.quality === "MISSING" || s.value === null);
    if (missing.length >= 3) {
      quality.push(
        mk({
          family: "FLOW_MISSING",
          assetId: "PUMP-01",
          tagId: tag,
          group: "FLOW",
          cellId: "CELL-A",
          title: "Coolant flow channel unavailable",
          description: `${missing.length} samples reported MISSING. Flow cannot be asserted from pump run feedback.`,
          quality: "MISSING",
          window,
          orderingReliable: true,
          onsetMs: missing[0].ms,
          onsetUncertaintyMs: 0,
          observationIds: obsIds(tag, missing),
        }),
      );
    }
    if (band) {
      const cutting = samples.filter((s) => isPhase(s, "CUTTING") && typeof s.value === "number");
      const onset = sustainedOnset(cutting, (s) => (s.value as number) < band.min, 10_000);
      if (onset) {
        const latest = numeric(reader.latestAt(tag));
        const run = reader.latestAt("PUMP-01.run_feedback")?.value === true;
        deviations.push(
          mk({
            family: "FLOW",
            assetId: "PUMP-01",
            tagId: tag,
            group: "FLOW",
            cellId: "CELL-A",
            title: "Measured coolant flow below the approved band while the pump reports running",
            description: `Flow fell below ${band.min} ${band.unit} during CUTTING (latest ${latest?.toFixed(1) ?? "—"}). Run feedback is ${run ? "TRUE" : "FALSE"}; run feedback proves the contactor, not delivery.`,
            quality: "GOOD",
            window,
            observedValue: latest !== null ? `${latest.toFixed(1)} ${band.unit}` : undefined,
            referenceValue: `${band.min}–${band.max} ${band.unit} (${baselineFor(baselines, cell)?.id})`,
            orderingReliable: true,
            referenceId: baselineFor(baselines, cell)?.id,
            onsetMs: onset.ms,
            onsetUncertaintyMs: onset.uncertaintyMs,
            observationIds: obsIds(tag, cutting.filter((s) => s.ms >= onset.ms)),
          }),
        );
      }
    } else if (cell && cell.recipe) missingBaselines.push(`${cell.recipe} / ${cell.cellId}`);
  }

  // --- Bearing temperature (cell A) ---
  {
    const tag = "SPN-01.bearing_temp";
    const cell = cells["CELL-A"];
    const band = bandFor(baselines, cell, tag);
    const samples = reader.range(tag, from).filter((s) => isComparableContext(s, cell));
    const recent = samples.filter((s) => s.ms >= cutoffMs - 120_000 && typeof s.value === "number");
    if (recent.length >= 60) {
      const values = new Set(recent.map((s) => s.value as number));
      const currents = reader.range("SPN-01.motor_current", cutoffMs - 120_000).filter((s) => typeof s.value === "number").map((s) => s.value as number);
      const currentRange = currents.length ? Math.max(...currents) - Math.min(...currents) : 0;
      if (values.size === 1 && currentRange > 2) {
        quality.push(
          mk({
            family: "TEMP_SUSPECT",
            assetId: "SPN-01",
            tagId: tag,
            group: "TEMP",
            cellId: "CELL-A",
            title: "Bearing temperature exactly constant while operating context changed",
            description: `Temperature reported ${[...values][0]} °C for ${recent.length} consecutive samples while motor current varied by ${currentRange.toFixed(1)} A. Suspicious constancy; sensor check recommended.`,
            quality: "SUSPECT",
            window,
            orderingReliable: true,
            onsetMs: recent[0].ms,
            onsetUncertaintyMs: 0,
            observationIds: obsIds(tag, recent),
          }),
        );
      }
    }
    if (band) {
      const cutting = samples.filter((s) => isPhase(s, "CUTTING") && typeof s.value === "number");
      const onset = sustainedOnset(cutting, (s) => (s.value as number) > band.max, 10_000);
      if (onset) {
        const latest = numeric(reader.latestAt(tag));
        deviations.push(
          mk({
            family: "TEMP",
            assetId: "SPN-01",
            tagId: tag,
            group: "TEMP",
            cellId: "CELL-A",
            title: "Bearing temperature above the approved band",
            description: `Temperature exceeded ${band.max} °C during CUTTING (latest ${latest?.toFixed(1) ?? "—"}). Thermal response lags its cause by tens of seconds.`,
            quality: "GOOD",
            window,
            observedValue: latest !== null ? `${latest.toFixed(1)} °C` : undefined,
            referenceValue: `${band.min}–${band.max} °C`,
            orderingReliable: true,
            referenceId: baselineFor(baselines, cell)?.id,
            onsetMs: onset.ms,
            onsetUncertaintyMs: onset.uncertaintyMs,
            observationIds: obsIds(tag, cutting.filter((s) => s.ms >= onset.ms)),
          }),
        );
      }
    }
  }

  // --- Spindle current / vibration / speed (both cells) ---
  for (const [spn, cellId] of [
    ["SPN-01", "CELL-A"],
    ["SPN-02", "CELL-B"],
  ] as const) {
    const cell = cells[cellId];
    const base = baselineFor(baselines, cell);
    if (!base) {
      if (cell?.recipe && !missingBaselines.includes(`${cell.recipe} / ${cellId}`)) missingBaselines.push(`${cell.recipe} / ${cellId}`);
      continue;
    }
    const speedTag = `${spn}.actual_speed`;
    const speedBand = base.bands.find((b) => b.tagId === speedTag);
    const speedSamples = reader.range(speedTag, from).filter((s) => isComparableContext(s, cell) && isPhase(s, "CUTTING") && typeof s.value === "number");
    const speedInBand = (s: Sample) => !speedBand || ((s.value as number) >= speedBand.min && (s.value as number) <= speedBand.max);
    // Context deviation: commanded speed differs from the recipe.
    if (cell && cell.commandedSpeedRpm !== base.commandedSpeedRpm) {
      deviations.push(
        mk({
          family: `CONTEXT_${cellId}`,
          assetId: cell.cellId === "CELL-A" ? "CNC-01" : "CNC-02",
          tagId: `${cell.cellId === "CELL-A" ? "CNC-01" : "CNC-02"}.commanded_speed`,
          group: `CONTEXT_${cellId}`,
          cellId,
          title: `Commanded speed ${cell.commandedSpeedRpm} rpm differs from the approved ${base.commandedSpeedRpm} rpm for ${cell.recipe}`,
          description: "Operating context changed. Comparisons against the approved baseline are not comparable while the override is active.",
          quality: "GOOD",
          window,
          observedValue: `${cell.commandedSpeedRpm} rpm`,
          referenceValue: `${base.commandedSpeedRpm} rpm (${base.id})`,
          orderingReliable: true,
          referenceId: base.id,
          onsetMs: cutoffMs,
          onsetUncertaintyMs: 0,
        }),
      );
    }
    for (const [tagName, famKey, label] of [
      ["motor_current", "CURRENT", "motor current"],
      ["vibration_rms", "VIB", "vibration"],
    ] as const) {
      const tag = `${spn}.${tagName}`;
      const band = base.bands.find((b) => b.tagId === tag);
      if (!band) continue;
      const samples = reader.range(tag, from).filter((s) => isComparableContext(s, cell) && isPhase(s, "CUTTING") && typeof s.value === "number");
      // Only samples where speed is in the approved band count as matched-condition evidence.
      const matched = samples.filter((s) => {
        const sp = speedSamples.find((x) => x.ms === s.ms);
        return sp ? speedInBand(sp) : true;
      });
      const onset = sustainedOnset(matched, (s) => (s.value as number) > band.max, 8000);
      if (onset) {
        const latest = numeric(reader.latestAt(tag));
        deviations.push(
          mk({
            family: `${famKey}_${cellId}`,
            assetId: spn,
            tagId: tag,
            group: `${famKey}_${cellId}`,
            cellId,
            title: `${spn} ${label} above the approved band at matched speed`,
            description: `${label[0].toUpperCase() + label.slice(1)} exceeded ${band.max} ${band.unit} during CUTTING with speed inside the approved band (latest ${latest?.toFixed(2) ?? "—"}).`,
            quality: "GOOD",
            window,
            observedValue: latest !== null ? `${latest.toFixed(2)} ${band.unit}` : undefined,
            referenceValue: `${band.min}–${band.max} ${band.unit} (${base.id})`,
            orderingReliable: true,
            referenceId: base.id,
            onsetMs: onset.ms,
            onsetUncertaintyMs: onset.uncertaintyMs,
            observationIds: obsIds(tag, matched.filter((s) => s.ms >= onset.ms)),
          }),
        );
      }
    }
  }

  // --- Supply voltage ---
  {
    const tag = "FDR-01.supply_voltage";
    const samples = reader.range(tag, from);
    const onset = sustainedOnset(samples, (s) => typeof s.value === "number" && s.value < 380, 3000);
    if (onset) {
      const latest = numeric(reader.latestAt(tag));
      deviations.push(
        mk({
          family: "SUPPLY",
          assetId: "FDR-01",
          tagId: tag,
          group: "SUPPLY",
          title: "Feeder voltage below 380 V",
          description: `Supply voltage fell to ${latest?.toFixed(0) ?? "—"} V (nominal 400 V, fictional).`,
          quality: "GOOD",
          window,
          observedValue: latest !== null ? `${latest.toFixed(0)} V` : undefined,
          referenceValue: "380–420 V (REQ-DEMO-VOLT-01)",
          orderingReliable: true,
          referenceId: "REQ-DEMO-VOLT-01",
          onsetMs: onset.ms,
          onsetUncertaintyMs: onset.uncertaintyMs,
          observationIds: obsIds(tag, samples.filter((s) => s.ms >= onset.ms)),
        }),
      );
      for (const [cab, cellId] of [
        ["CNC-01", "CELL-A"],
        ["CNC-02", "CELL-B"],
      ] as const) {
        const t = `${cab}.supply_voltage`;
        const ss = reader.range(t, from);
        const on = sustainedOnset(ss, (s) => typeof s.value === "number" && s.value < 380, 3000);
        if (on) {
          deviations.push(
            mk({
              family: `CABINET_${cellId}`,
              assetId: cab,
              tagId: t,
              group: "SUPPLY",
              cellId,
              title: `${cab} cabinet voltage below 380 V`,
              description: "Cabinet voltage follows the feeder along the approved electrical edge.",
              quality: "GOOD",
              window,
              observedValue: `${numeric(reader.latestAt(t))?.toFixed(0) ?? "—"} V`,
              referenceValue: "380–420 V",
              orderingReliable: true,
              referenceId: "REQ-DEMO-VOLT-01",
              onsetMs: on.ms,
              onsetUncertaintyMs: on.uncertaintyMs,
              observationIds: obsIds(t, ss.filter((s) => s.ms >= on.ms)),
            }),
          );
        }
      }
    }
  }

  // --- Gauge ---
  {
    const tag = "GAUGE-01.dimension_dev_um";
    const samples = reader.range(tag, from).filter((s) => typeof s.value === "number");
    const bad = samples.filter((s) => Math.abs(s.value as number) > 15);
    if (bad.length >= 3) {
      deviations.push(
        mk({
          family: "GAUGE",
          assetId: "GAUGE-01",
          tagId: tag,
          group: "GAUGE",
          title: "Dimensional result shifted beyond ±15 µm",
          description: `${bad.length} measured parts exceeded ±15 µm (latest ${(numeric(reader.latestAt(tag)) ?? 0).toFixed(1)} µm). No approved rule links this to machine evidence.`,
          quality: "GOOD",
          window,
          observedValue: `${(numeric(reader.latestAt(tag)) ?? 0).toFixed(1)} µm`,
          referenceValue: "±15 µm (fictional tolerance)",
          orderingReliable: true,
          onsetMs: bad[0].ms,
          onsetUncertaintyMs: 0,
          observationIds: obsIds(tag, bad),
        }),
      );
    }
  }

  return { deviations, missingBaselines, quality };
}

// ---------------------------------------------------------------------------
// Candidate evaluation
// ---------------------------------------------------------------------------

function edgeActive(e: DependencyEdge): boolean {
  return e.reviewStatus === "PUBLISHED" || e.reviewStatus === "APPROVED";
}

function pathExists(edges: DependencyEdge[], from: string, to: string, maxDepth = 4): DependencyEdge[] | null {
  const active = edges.filter((e) => edgeActive(e) && !e.physicalFeedback && e.relation !== "REVIEWED_NO_DEPENDENCY");
  const visit = (node: string, depth: number, path: DependencyEdge[]): DependencyEdge[] | null => {
    if (node === to) return path;
    if (depth === 0) return null;
    for (const e of active) {
      if (e.from === node && !path.includes(e)) {
        const r = visit(e.to, depth - 1, [...path, e]);
        if (r) return r;
      }
    }
    return null;
  };
  return visit(from, maxDepth, []);
}

function evaluateCandidates(all: Deviation[], quality: Deviation[], input: DiagnosisInput): FaultCandidate[] {
  const families = new Set(all.map((d) => d.family));
  const qualityFamilies = new Set(quality.map((d) => d.family));
  const candidates: FaultCandidate[] = [];
  for (const cfg of FAMILY_CONFIG) {
    const links: FaultCandidate["links"] = [];
    let support = 0;
    let contradiction = 0;
    let pending = 0;
    let unavailable = 0;
    const notEstablished = [...cfg.notEstablished];
    const usedGroups = new Set<string>();
    // Trigger: at least one primary evidence family present.
    const triggered = cfg.primary.some((f) => families.has(f));
    if (!triggered) continue;
    // Required published edges.
    const edgeIds: string[] = [];
    let missingEdge = false;
    for (const [from, to] of cfg.requiredPaths) {
      const p = pathExists(input.knowledge.edges, from, to);
      if (p) edgeIds.push(...p.map((e) => e.id));
      else missingEdge = true;
    }
    if (missingEdge && cfg.requiredPaths.length) {
      notEstablished.push("A required dependency path is not published in the active knowledge version.");
    }
    for (const d of all) {
      if (cfg.supports.includes(d.family) && !usedGroups.has(d.group)) {
        usedGroups.add(d.group);
        support++;
        links.push({ evidenceId: d.id, relation: "SUPPORT", reason: cfg.supportReason[d.family] ?? "Supports this mechanism." });
      } else if (cfg.supports.includes(d.family)) {
        links.push({ evidenceId: d.id, relation: "SUPPORT", reason: "Same evidence group as another witness; not counted twice." });
      } else if (cfg.contradicts.includes(d.family)) {
        contradiction++;
        links.push({ evidenceId: d.id, relation: "CONTRADICT", reason: cfg.contradictReason[d.family] ?? "Not expected under this mechanism." });
      }
    }
    // Families whose absence contradicts (e.g. the cause itself absent for shared families).
    for (const f of cfg.absentContradicts) {
      if (!families.has(f)) {
        contradiction++;
        links.push({ evidenceId: `ABSENT-${f}`, relation: "CONTRADICT", reason: cfg.absentReason[f] ?? `${f} evidence is within band; this mechanism would show it.` });
      }
    }
    // Pending / unavailable expectations.
    for (const f of cfg.pendingIfAbsent) {
      if (!families.has(f)) {
        if (qualityFamilies.has(`${f}_MISSING`) || qualityFamilies.has(`${f}_SUSPECT`)) {
          unavailable++;
          const q = quality.find((d) => d.family === `${f}_MISSING` || d.family === `${f}_SUSPECT`);
          links.push({ evidenceId: q?.id ?? `UNAVAILABLE-${f}`, relation: "UNAVAILABLE", reason: `${f} channel unavailable or suspect; not evidence against this mechanism.` });
        } else {
          pending++;
          links.push({ evidenceId: `PENDING-${f}`, relation: "PENDING", reason: cfg.pendingReason[f] ?? `${f} evidence expected later.` });
        }
      }
    }
    for (const f of cfg.unavailableFamilies) {
      unavailable++;
      links.push({ evidenceId: `UNAVAILABLE-${f}`, relation: "UNAVAILABLE", reason: cfg.unavailableReason[f] ?? `${f} is not instrumented.` });
    }
    if (missingEdge) support = Math.min(support, 1);
    candidates.push({
      family: cfg.family,
      title: cfg.title,
      mechanism: cfg.mechanism,
      edgeIds: Array.from(new Set(edgeIds)),
      links,
      supportCount: support,
      contradictionCount: contradiction,
      pendingCount: pending,
      unavailableCount: unavailable,
      distinguishingCheckId: cfg.distinguishingCheckId,
      notEstablished,
      rank: 0,
    });
  }
  candidates.sort((a, b) => {
    const sa = a.supportCount - a.contradictionCount * 2;
    const sb = b.supportCount - b.contradictionCount * 2;
    if (sb !== sa) return sb - sa;
    if (a.contradictionCount !== b.contradictionCount) return a.contradictionCount - b.contradictionCount;
    return a.family.localeCompare(b.family);
  });
  candidates.forEach((c, i) => (c.rank = i + 1));
  return candidates;
}

function stateFor(candidates: FaultCandidate[], deviations: Deviation[], quality: Deviation[]): { state: DiagnosticState; disposition: Diagnosis["disposition"]; summary: string } {
  const suspect = quality.filter((q) => q.quality === "SUSPECT" || q.quality === "MISSING");
  if (!deviations.length) {
    if (suspect.length) return { state: "SENSOR_CHECK", disposition: "HUMAN_REVIEW", summary: `${suspect[0].title}. No fault deviation is observed, but the channel needs a sensor check.` };
    return { state: "NORMAL", disposition: "NONE", summary: "No deviation from the approved baselines within the observation window." };
  }
  const supported = candidates.filter((c) => c.supportCount > 0 && c.contradictionCount === 0);
  if (!supported.length) {
    if (suspect.length) return { state: "SENSOR_CHECK", disposition: "HUMAN_REVIEW", summary: `${suspect[0].title}. Deviations exist but the available channels cannot be trusted without a sensor check.` };
    return { state: "UNKNOWN", disposition: "HUMAN_REVIEW", summary: "Observed deviations do not match any approved fault family with supporting dependencies. Human review required; no recovery plan can be drafted from the library." };
  }
  const top = supported[0];
  const runnerUp = supported[1];
  if (suspect.length && top.unavailableCount > 0) {
    return { state: "SENSOR_CHECK", disposition: "HUMAN_REVIEW", summary: `${top.title} is the leading explanation, but a required channel is missing or suspect. Sensor check before concluding.` };
  }
  if (runnerUp && runnerUp.supportCount >= top.supportCount) {
    return { state: "AMBIGUOUS", disposition: "NONE", summary: `${top.title} and ${runnerUp.title} are equally supported by the available evidence. The next check should distinguish them.` };
  }
  if (top.supportCount === 1 && runnerUp) {
    return { state: "AMBIGUOUS", disposition: "NONE", summary: `${top.title} has one supporting evidence group; ${runnerUp.title} remains possible.` };
  }
  return { state: "SUPPORTED", disposition: "NONE", summary: "" };
}

// ---------------------------------------------------------------------------
// Grouping into candidate incidents
// ---------------------------------------------------------------------------

export function diagnose(input: DiagnosisInput): DiagnosisOutput {
  const { deviations, missingBaselines, quality } = extractEvidence(input);
  const groups: DiagnosisGroup[] = [];
  const consumed = new Set<string>();
  const alarmsInWindow = input.alarms.filter((a) => a.raisedAt.ms <= input.cutoffMs);

  const alarmIdsFor = (assetIds: string[], fromMs: number) =>
    alarmsInWindow.filter((a) => assetIds.includes(a.assetId) && a.raisedAt.ms >= fromMs - 30_000).map((a) => a.id);

  const buildGroup = (
    signature: string,
    title: string,
    devs: Deviation[],
    quals: Deviation[],
    sharedCauseAssetId: string | undefined,
    rationale: string,
    potentiallyAffected: string[],
  ): DiagnosisGroup => {
    const candidates = evaluateCandidates(devs, quals, input);
    const st = stateFor(candidates, devs, quals);
    const evidence: EvidenceItem[] = [...devs, ...quals].map((d) => ({ ...d }));
    const reliable = devs.filter((d) => d.orderingReliable && d.onsetMs !== undefined).sort((a, b) => (a.onsetMs ?? 0) - (b.onsetMs ?? 0));
    const first = reliable[0];
    // Ordering: unresolved when the earliest two onsets overlap within combined uncertainty.
    let orderingUnresolved = false;
    let orderingNote: string | undefined;
    const sorted = devs.filter((d) => d.onsetMs !== undefined).sort((a, b) => (a.onsetMs ?? 0) - (b.onsetMs ?? 0));
    if (sorted.length >= 2) {
      const a = sorted[0];
      const b = sorted[1];
      const sep = Math.abs((b.onsetMs ?? 0) - (a.onsetMs ?? 0));
      const u = (a.onsetUncertaintyMs ?? 0) + (b.onsetUncertaintyMs ?? 0);
      if (sep < u) {
        orderingUnresolved = true;
        orderingNote = `${a.title} and ${b.title} are ${Math.round(sep / 1000)} s apart, but their clocks carry ±${Math.round((a.onsetUncertaintyMs ?? 0) / 1000)} s and ±${Math.round((b.onsetUncertaintyMs ?? 0) / 1000)} s uncertainty. The order cannot be established from these timestamps.`;
      }
    }
    if (!orderingUnresolved && sharedCauseAssetId === "AIR-HDR-01") {
      const uncertainRobotEvents = input.reader.range("ROB-01.robot_clear", input.cutoffMs - 10 * 60_000, input.cutoffMs).filter((s) => s.uncertaintyMs >= 5000);
      if (uncertainRobotEvents.length) {
        orderingUnresolved = true;
        orderingNote = "Robot sequence timestamps carry ±5 s uncertainty. The dependency evidence supports a shared pneumatic cause, but ordering claims involving the robot clock are not established.";
      }
    }
    const top = candidates[0];
    let summary = st.summary;
    if (st.state === "SUPPORTED" && top) {
      summary = FAMILY_CONFIG.find((c) => c.family === top.family)?.supportedSummary ?? `${top.title} is supported by the available evidence.`;
      if (orderingUnresolved) summary += " Event ordering is unresolved within clock uncertainty; the shared cause is supported by dependencies, not by timestamp order.";
    }
    const state: DiagnosticState = orderingUnresolved && st.state === "SUPPORTED" ? "AMBIGUOUS" : st.state;
    const nextChecks = pickNextChecks(candidates, state);
    const missingInputs = [
      ...quals.filter((q) => q.quality === "MISSING").map((q) => `${q.tagId} (MISSING)`),
      ...quals.filter((q) => q.quality === "SUSPECT").map((q) => `${q.tagId} (SUSPECT — constant while context changed)`),
      ...(top?.unavailableCount ? top.links.filter((l) => l.relation === "UNAVAILABLE").map((l) => l.reason) : []),
      ...missingBaselines.map((m) => `No approved baseline for ${m}`),
    ];
    const unresolvedQuestions = top ? top.notEstablished.slice() : ["Which fault family, if any, explains the observed deviation?"];
    if (orderingUnresolved) unresolvedQuestions.push("Which deviation occurred first? The clock contract between sources is inadequate.");
    const residual = devs.filter((d) => top && !top.links.some((l) => l.evidenceId === d.id && l.relation === "SUPPORT")).map((d) => d.id);
    const diagnosis: Omit<Diagnosis, "incidentId"> = {
      computedAtMs: input.cutoffMs,
      cutoffMs: input.cutoffMs,
      knowledgeVersion: input.knowledge.versionId,
      baselineIds: Array.from(new Set(devs.map((d) => d.referenceId).filter((x): x is string => !!x))),
      state,
      disposition: st.disposition === "HUMAN_REVIEW" || state === "UNKNOWN" ? "HUMAN_REVIEW" : "NONE",
      summary,
      firstReliableDeviation: first ? { evidenceId: first.id, ms: first.onsetMs ?? 0, uncertaintyMs: first.onsetUncertaintyMs ?? 0 } : undefined,
      orderingUnresolved,
      orderingNote,
      candidates,
      evidence,
      missingInputs,
      unresolvedQuestions,
      nextChecks,
      graph: buildGraph(candidates, evidence, input),
      residualDeviations: residual,
    };
    const observedAssetIds = Array.from(new Set(devs.map((d) => d.assetId)));
    const affectedCellIds = Array.from(new Set(devs.map((d) => d.cellId).filter((c): c is CellId => !!c)));
    const firstMs = Math.min(...devs.map((d) => d.onsetMs ?? input.cutoffMs));
    return {
      signature,
      title,
      observedAssetIds,
      potentiallyAffectedAssetIds: potentiallyAffected.filter((a) => !observedAssetIds.includes(a)),
      affectedCellIds,
      alarmIds: alarmIdsFor([...observedAssetIds, ...(sharedCauseAssetId ? [sharedCauseAssetId] : []), "ROB-01"], firstMs).filter((id) => {
        const al = alarmsInWindow.find((a) => a.id === id);
        return !!al && (observedAssetIds.includes(al.assetId) || (al.assetId === "ROB-01" && observedAssetIds.some((x) => x === "CNC-01" || x === "FIX-01")));
      }),
      groupingRationale: rationale,
      sharedCauseAssetId,
      diagnosis,
      safetyRelevant: false,
    };
  };

  const take = (pred: (d: Deviation) => boolean) => {
    const out = deviations.filter((d) => !consumed.has(d.id) && pred(d));
    out.forEach((d) => consumed.add(d.id));
    return out;
  };
  const edges = input.knowledge.edges;

  // 1. Shared pneumatic loss: AIR + clamp deviations connected by published edges with compatible timing.
  const air = take((d) => d.family === "AIR");
  if (air.length) {
    const cause = air[0];
    const members: Deviation[] = [...air];
    const rationaleParts: string[] = ["AIR-HDR-01 pressure deviation observed."];
    for (const [fam, target] of [
      ["CLAMP_A", "FIX-01"],
      ["CLAMP_B", "CNC-02"],
    ] as const) {
      const path = pathExists(edges, "AIR-HDR-01", target);
      const clamp = deviations.find((d) => d.family === fam && !consumed.has(d.id));
      if (clamp && path) {
        const timingOk = (clamp.onsetMs ?? 0) + (clamp.onsetUncertaintyMs ?? 0) >= (cause.onsetMs ?? 0) - (cause.onsetUncertaintyMs ?? 0);
        if (timingOk) {
          members.push(clamp);
          consumed.add(clamp.id);
          rationaleParts.push(`${target} clamp delay grouped via ${path.map((e) => e.id).join(" → ")} (timing compatible).`);
        } else rationaleParts.push(`${target} clamp delay precedes the pressure deviation; kept separate.`);
      } else if (clamp && !path) {
        rationaleParts.push(`${target} clamp delay NOT grouped: no published dependency from AIR-HDR-01 to ${target} in ${input.knowledge.versionId}.`);
      }
    }
    // Downstream ack deviations in cell A while clamps are delayed are sequence consequences, not grouped as cause.
    const affected = edges.filter((e) => edgeActive(e) && e.from === "AIR-HDR-01").map((e) => e.to);
    groups.push(buildGroup(`AIR:${members.map((m) => m.assetId).sort().join(",")}`, "Shared header pressure deviation with clamp delays", members, [], "AIR-HDR-01", rationaleParts.join(" "), [...affected, "CNC-01", "ROB-01"]));
  }

  // 2. Supply sag: SUPPLY + cabinet deviations along electrical edges.
  const supply = take((d) => d.family === "SUPPLY");
  if (supply.length) {
    const members = [...supply];
    const rationaleParts = ["FDR-01 undervoltage observed."];
    for (const fam of ["CABINET_CELL-A", "CABINET_CELL-B"]) {
      const cab = deviations.find((d) => d.family === fam && !consumed.has(d.id));
      if (cab) {
        const path = pathExists(edges, "FDR-01", cab.assetId);
        if (path) {
          members.push(cab);
          consumed.add(cab.id);
          rationaleParts.push(`${cab.assetId} grouped via ${path.map((e) => e.id).join(" → ")}.`);
        }
      }
    }
    // Current rises with sagging voltage are explained by the supply; group SPN current deviations only when they started after the sag.
    for (const fam of ["CURRENT_CELL-A", "CURRENT_CELL-B"]) {
      const cur = deviations.find((d) => d.family === fam && !consumed.has(d.id));
      if (cur && (cur.onsetMs ?? 0) >= (supply[0].onsetMs ?? 0) - 2000) {
        const vib = deviations.find((d) => d.family === fam.replace("CURRENT", "VIB") && !consumed.has(d.id));
        if (!vib) {
          members.push(cur);
          consumed.add(cur.id);
          rationaleParts.push(`${cur.assetId} current rise began after the sag and has no vibration counterpart; grouped as an electrical consequence.`);
        } else rationaleParts.push(`${cur.assetId} current and vibration deviations are NOT explained by the supply sag (vibration is not a supply effect); kept as a separate incident.`);
      }
    }
    const affected = edges.filter((e) => edgeActive(e) && e.from === "FDR-01").map((e) => e.to);
    groups.push(buildGroup("SUPPLY", "Feeder supply sag with downstream cabinet effects", members, [], "FDR-01", rationaleParts.join(" "), affected));
  }

  // 3. Coolant delivery / thermal (cell A): FLOW (+TEMP pending or present) along cooling edge; compound with mechanical when present.
  const flow = take((d) => d.family === "FLOW");
  const flowQuality = quality.filter((q) => q.family === "FLOW_MISSING");
  const tempQuality = quality.filter((q) => q.family === "TEMP_SUSPECT");
  const mechA = deviations.filter((d) => (d.family === "CURRENT_CELL-A" || d.family === "VIB_CELL-A") && !consumed.has(d.id));
  const tempA = deviations.find((d) => d.family === "TEMP" && !consumed.has(d.id));
  if (flow.length || tempA || mechA.length || flowQuality.length || tempQuality.length) {
    const members: Deviation[] = [...flow];
    const rationaleParts: string[] = [];
    if (flow.length) rationaleParts.push("PUMP-01 flow deviation observed while run feedback is TRUE.");
    if (tempA) {
      const path = pathExists(edges, "PUMP-01", "SPN-01");
      members.push(tempA);
      consumed.add(tempA.id);
      rationaleParts.push(path ? `SPN-01 temperature grouped via ${path.map((e) => e.id).join(" → ")} (delayed thermal response).` : "SPN-01 temperature deviation kept with the spindle evidence.");
    }
    for (const m of mechA) {
      members.push(m);
      consumed.add(m.id);
    }
    if (mechA.length) rationaleParts.push("SPN-01 matched-speed current/vibration deviations retained as a separate mechanical candidate within the same cell incident.");
    const contextA = deviations.find((d) => d.family === "CONTEXT_CELL-A" && !consumed.has(d.id));
    if (contextA && (members.length || mechA.length)) {
      members.push(contextA);
      consumed.add(contextA.id);
      rationaleParts.push("Commanded-speed override recorded as a context change, not a repair.");
    }
    const quals = [...flowQuality, ...tempQuality];
    if (members.length || quals.length) {
      const affected = edges.filter((e) => edgeActive(e) && e.from === "PUMP-01").map((e) => e.to);
      groups.push(buildGroup(`CELLA-SPINDLE`, flow.length ? "Coolant delivery deviation in cell A" : mechA.length ? "SPN-01 mechanical deviation at matched speed" : "Cell A spindle channel quality issue", members, quals, flow.length ? "PUMP-01" : undefined, rationaleParts.join(" ") || "Channel quality issue on cell A spindle evidence.", affected));
    }
  }

  // 4. Handshake acknowledgement (cell A).
  const ack = take((d) => d.family === "ACK");
  if (ack.length) {
    groups.push(buildGroup("ACK", "Unload-complete acknowledgement delay between ROB-01 and CNC-01", ack, [], undefined, "Sequence transition exceeded the approved envelope; pressure and supply remain within their approved ranges.", ["CNC-01", "ROB-01"]));
  }

  // 5. Remaining clamp deviations not grouped (no published edge or timing mismatch).
  for (const fam of ["CLAMP_A", "CLAMP_B"]) {
    const c = take((d) => d.family === fam);
    if (c.length) {
      const assetId = c[0].assetId;
      groups.push(buildGroup(`CLAMP:${assetId}`, `${assetId} clamp delays (not grouped to a shared cause)`, c, [], undefined, `No published dependency connects a shared cause to ${assetId} in ${input.knowledge.versionId}, or timing is incompatible. Kept separate; a proposed edge may be awaiting review.`, []));
    }
  }

  // 6. SPN-02 mechanical residual.
  const mechB = take((d) => d.family === "CURRENT_CELL-B" || d.family === "VIB_CELL-B");
  if (mechB.length) {
    groups.push(buildGroup("CELLB-SPINDLE", "SPN-02 mechanical deviation at matched speed", mechB, [], undefined, "Persistent local deviation not explained by shared causes; retained as an independent incident.", []));
  }

  // 7. Gauge (unsupported anomaly).
  const gauge = take((d) => d.family === "GAUGE");
  if (gauge.length) {
    groups.push(buildGroup("GAUGE", "GAUGE-01 dimensional result shift", gauge, [], undefined, "No approved rule links dimensional results to machine evidence; kept separate from other incidents.", []));
  }

  // 8. Leftover context-only deviations.
  const leftovers = take(() => true);
  if (leftovers.length) {
    groups.push(buildGroup(`CTX:${leftovers.map((l) => l.assetId).join(",")}`, "Operating context change", leftovers, [], undefined, "Context change without a supported fault family.", []));
  }

  return { groups, quiet: groups.length === 0, missingBaselines };
}

function pickNextChecks(candidates: FaultCandidate[], state: DiagnosticState): NextCheck[] {
  const fams = candidates.slice(0, 3).map((c) => c.family);
  const out: NextCheck[] = [];
  for (const c of NEXT_CHECK_LIBRARY) {
    if (c.distinguishes.some((f) => fams.includes(f))) out.push(c);
  }
  if (state === "UNKNOWN") out.push(NEXT_CHECK_LIBRARY.find((c) => c.id === "CHK-REQUEST-EVIDENCE")!);
  if (state === "SENSOR_CHECK") out.unshift(NEXT_CHECK_LIBRARY.find((c) => c.id === "CHK-SENSOR")!);
  return Array.from(new Set(out)).slice(0, 4);
}

function buildGraph(candidates: FaultCandidate[], evidence: EvidenceItem[], input: DiagnosisInput): DiagnosticGraph {
  const nodes: DiagnosticGraph["nodes"] = [];
  const edges: DiagnosticGraph["edges"] = [];
  for (const c of candidates.slice(0, 3)) {
    nodes.push({ id: `H:${c.family}`, type: "HYPOTHESIS", label: c.title, state: c.rank === 1 ? "leading" : "alternative" });
    nodes.push({ id: `M:${c.family}`, type: "MECHANISM", label: c.mechanism });
    edges.push({ from: `H:${c.family}`, to: `M:${c.family}` });
    for (const l of c.links) {
      if (l.relation === "SUPPORT" || l.relation === "CONTRADICT") {
        const ev = evidence.find((e) => e.id === l.evidenceId);
        if (ev && !nodes.some((n) => n.id === `O:${ev.id}`)) nodes.push({ id: `O:${ev.id}`, type: "OBSERVATION", label: ev.title, state: ev.quality });
        if (ev) edges.push({ from: `O:${ev.id}`, to: `M:${c.family}`, label: l.relation === "SUPPORT" ? "supports" : "contradicts" });
      }
    }
    for (const eid of c.edgeIds) {
      const e = input.knowledge.edges.find((x) => x.id === eid);
      if (e) {
        const reqs = input.knowledge.requirements.filter((r) => r.coversEdgeIds.includes(eid));
        for (const r of reqs) {
          if (!nodes.some((n) => n.id === `R:${r.id}`)) nodes.push({ id: `R:${r.id}`, type: "REQUIREMENT", label: r.title });
          edges.push({ from: `M:${c.family}`, to: `R:${r.id}`, label: "verify via" });
        }
      }
    }
  }
  return { nodes, edges };
}

export function relationLabel(r: EvidenceRelation): string {
  return { SUPPORT: "Supports", CONTRADICT: "Contradicts", PENDING: "Pending", UNAVAILABLE: "Unavailable" }[r];
}

export function assetName(id: string): string {
  return ASSET_BY_ID[id]?.name ?? id;
}

export type { FaultFamilyId };
