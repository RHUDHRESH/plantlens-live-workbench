import type { Alarm, CellId, CheckResult, CheckStatus, DependencyEdge, EpochMs, RecoveryCheck, RecoveryPlan, RecoveryRun, RunOutcome } from "@/lib/domain/types";
import type { ObservationReader, Sample } from "@/lib/simulation/observation";
import { observationId } from "@/lib/simulation/observation";
import type { CellContext } from "@/lib/diagnosis/engine";

/**
 * Recovery plan interpreter. Plans are constrained JSON; nothing here evaluates strings
 * as code. The interpreter reads observations from the run start up to the cutoff and
 * never sees future samples.
 *
 * Aggregate precedence (documented in the UI):
 *   1. Any NOT_COMPARABLE check      -> NOT_COMPARABLE
 *   2. Any decisive FAIL              -> FAIL (missing evidence still listed)
 *   3. Any INCONCLUSIVE (no failure)  -> INCONCLUSIVE
 *   4. Any PENDING                    -> RUNNING (until MAX_RUN_MS, then INCONCLUSIVE)
 *   5. All PASS                       -> PASS
 * Zero valid opportunities is never a pass.
 */

export const MAX_RUN_MS = 20 * 60_000;

export interface EvaluationInput {
  plan: RecoveryPlan;
  run: RecoveryRun;
  reader: ObservationReader;
  alarms: Alarm[];
  cells: Record<CellId, CellContext>;
  publishedEdges: DependencyEdge[];
  nowMs: EpochMs;
}

function result(checkId: string, status: CheckStatus, reason: string, extra: Partial<CheckResult> = {}): CheckResult {
  return { checkId, status, reason, detail: {}, evidenceObservationIds: [], missingChannels: [], decisiveViolation: false, ...extra };
}

function ids(tag: string, samples: Sample[], limit = 10): string[] {
  const step = Math.max(1, Math.ceil(samples.length / limit));
  const out: string[] = [];
  for (let i = 0; i < samples.length; i += step) out.push(observationId(tag, samples[i].ms));
  return out;
}

const dedupeEdges = (edges: Sample[]): Sample[] => {
  const out: Sample[] = [];
  for (const e of edges) if (!out.length || e.ms - out[out.length - 1].ms > 500) out.push(e);
  return out;
};

/**
 * Sequence matcher: rising edges only; each later event is bound to the first event's
 * cycle id when both carry one; an acknowledgement edge can satisfy at most one
 * occurrence; duplicates within 500 ms are collapsed; partial sequences are reported.
 */
export function matchSequence(reader: ObservationReader, events: string[], fromMs: EpochMs, toMs: EpochMs, maxElapsedS: number) {
  const lanes = events.map((tag) => dedupeEdges(reader.risingEdges(tag, fromMs, toMs)));
  const used = lanes.map(() => new Set<number>());
  const occurrences: Array<{ startMs: EpochMs; endMs?: EpochMs; elapsedS?: number; valid?: boolean; uncertain?: boolean; partial: boolean; cycleId?: string; sampleIds: string[] }> = [];
  const cycleBound = lanes.every((l) => l.every((s) => !!s.context?.cycleId));
  for (let i = 0; i < lanes[0].length; i++) {
    const first = lanes[0][i];
    used[0].add(i);
    let cursorMs = first.ms;
    let uncertainty = first.uncertaintyMs;
    const sampleIds = [observationId(events[0], first.ms)];
    let partial = false;
    let last: Sample = first;
    for (let k = 1; k < lanes.length; k++) {
      const idx = lanes[k].findIndex((s, j) => !used[k].has(j) && s.ms >= cursorMs - s.uncertaintyMs - uncertainty && (!cycleBound || !first.context?.cycleId || s.context?.cycleId === first.context.cycleId));
      if (idx === -1) {
        partial = true;
        break;
      }
      used[k].add(idx);
      last = lanes[k][idx];
      cursorMs = last.ms;
      uncertainty += last.uncertaintyMs;
      sampleIds.push(observationId(events[k], last.ms));
    }
    if (partial) {
      occurrences.push({ startMs: first.ms, partial: true, cycleId: first.context?.cycleId, sampleIds });
      continue;
    }
    const elapsedS = (last.ms - first.ms) / 1000;
    const uS = uncertainty / 1000;
    const uncertain = Math.abs(elapsedS - maxElapsedS) < uS;
    occurrences.push({ startMs: first.ms, endMs: last.ms, elapsedS, valid: elapsedS <= maxElapsedS, uncertain, partial: false, cycleId: first.context?.cycleId, sampleIds });
  }
  return { occurrences, cycleBound };
}

function evalCheck(check: RecoveryCheck, input: EvaluationInput): CheckResult {
  const { plan, run, reader, nowMs } = input;
  const from = run.startedAt.ms;
  switch (check.kind) {
    case "SOURCE_QUALITY": {
      const missing: string[] = [];
      let sampleCount = 0;
      for (const tag of check.tags) {
        if (!reader.hasTag(tag)) {
          missing.push(`${tag} (not present)`);
          continue;
        }
        const samples = reader.range(tag, from, nowMs);
        sampleCount += samples.length;
        const bad = samples.filter((s) => s.quality === "MISSING" || s.quality === "INVALID" || (check.qualityPolicy === "REQUIRE_GOOD" && s.quality !== "GOOD"));
        if (bad.length) missing.push(`${tag} (${bad.length} ${bad[0].quality} samples since run start)`);
      }
      if (missing.length) return result(check.id, "INCONCLUSIVE", `Required channel(s) unavailable during the run: ${missing.join("; ")}. A new complete run is required once evidence is valid.`, { missingChannels: missing, detail: { samples: sampleCount } });
      if (sampleCount === 0) return result(check.id, "PENDING", "No samples yet on the required channels.");
      return result(check.id, "PASS", `All ${check.tags.length} required channels reported ${check.qualityPolicy === "REQUIRE_GOOD" ? "GOOD" : "acceptable"} quality.`, { detail: { samples: sampleCount } });
    }
    case "MODE_REQUIRED": {
      const recipeSamples = reader.range(`${check.assetId}.recipe`, from, nowMs);
      const modeSamples = reader.range(`${check.assetId}.mode`, from, nowMs);
      const cmdSamples = reader.range(`${check.assetId}.commanded_speed`, from, nowMs);
      const latestRecipe = reader.latestAt(`${check.assetId}.recipe`, nowMs)?.value;
      const latestMode = reader.latestAt(`${check.assetId}.mode`, nowMs)?.value;
      const latestCmd = reader.latestAt(`${check.assetId}.commanded_speed`, nowMs)?.value;
      if (latestRecipe === undefined && latestMode === undefined) return result(check.id, "PENDING", "No context samples yet.");
      const mismatches: string[] = [];
      if (check.recipe && (recipeSamples.some((s) => s.value !== check.recipe) || latestRecipe !== check.recipe)) mismatches.push(`recipe ${String(latestRecipe)} ≠ ${check.recipe}`);
      if (check.mode && (modeSamples.some((s) => s.value !== check.mode) || latestMode !== check.mode)) mismatches.push(`mode ${String(latestMode)} ≠ ${check.mode}`);
      if (check.commandedSpeedRpm !== undefined && (cmdSamples.some((s) => s.value !== check.commandedSpeedRpm) || latestCmd !== check.commandedSpeedRpm)) mismatches.push(`commanded speed ${String(latestCmd)} rpm ≠ ${check.commandedSpeedRpm} rpm`);
      if (mismatches.length) return result(check.id, "NOT_COMPARABLE", `Operating context differs from the frozen plan scope (${mismatches.join(", ")}). Results in this context cannot be compared with the approved baseline.`, { detail: { recipe: String(latestRecipe), mode: String(latestMode), commandedSpeed: latestCmd === undefined ? null : Number(latestCmd) } });
      return result(check.id, "PASS", `Context matches the frozen scope (${[check.recipe, check.mode, check.commandedSpeedRpm ? `${check.commandedSpeedRpm} rpm` : null].filter(Boolean).join(", ")}).`);
    }
    case "NUMERIC_BAND": {
      if (!reader.hasTag(check.tag)) return result(check.id, "INCONCLUSIVE", `${check.tag} is not present in the observation record.`, { missingChannels: [check.tag] });
      const all = reader.range(check.tag, from, nowMs).filter((s) => !check.phase || s.context?.phase === check.phase);
      const missing = all.filter((s) => s.quality === "MISSING" || s.value === null);
      const good = all.filter((s) => typeof s.value === "number" && (check.qualityPolicy === "ALLOW_STALE" ? s.quality !== "MISSING" && s.quality !== "INVALID" : s.quality === "GOOD"));
      const out = good.filter((s) => (s.value as number) < check.minimum || (s.value as number) > check.maximum);
      // Decisive violation: at least 3 consecutive out-of-band samples or >10% of samples.
      let consecutive = 0;
      let maxConsecutive = 0;
      for (const s of good) {
        const bad = (s.value as number) < check.minimum || (s.value as number) > check.maximum;
        consecutive = bad ? consecutive + 1 : 0;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
      }
      const decisive = good.length >= 3 && (maxConsecutive >= 3 || out.length / good.length > 0.1);
      const detail = { samples: good.length, outOfBand: out.length, minimum: check.minimum, maximum: check.maximum, unit: check.unit, phase: check.phase ?? "any", latest: good.length ? (good[good.length - 1].value as number) : null };
      if (decisive) return result(check.id, "FAIL", `${out.length} of ${good.length} ${check.phase ?? ""} samples outside ${check.minimum}–${check.maximum} ${check.unit} (longest run ${maxConsecutive}). Decisive violation.`, { detail, decisiveViolation: true, evidenceObservationIds: ids(check.tag, out) });
      if (missing.length && good.length < check.minimumSamples) return result(check.id, "INCONCLUSIVE", `${missing.length} MISSING samples; only ${good.length} valid samples (need ${check.minimumSamples}).`, { missingChannels: [check.tag], detail });
      if (good.length < check.minimumSamples) return result(check.id, "PENDING", `${good.length} of ${check.minimumSamples} valid ${check.phase ?? ""} samples collected.`, { detail });
      if (out.length) return result(check.id, "PENDING", `${out.length} isolated out-of-band sample(s) among ${good.length}; continuing to observe.`, { detail });
      return result(check.id, "PASS", `${good.length} valid samples within ${check.minimum}–${check.maximum} ${check.unit}.`, { detail, evidenceObservationIds: ids(check.tag, good) });
    }
    case "STATE_TRANSITION": {
      const samples = reader.range(`${check.assetId}.phase`, from, nowMs);
      let count = 0;
      for (let i = 1; i < samples.length; i++) if (samples[i - 1].value === check.from && samples[i].value === check.to) count++;
      if (count >= check.minimumOccurrences) return result(check.id, "PASS", `${count} ${check.from}→${check.to} transitions observed.`, { detail: { count } });
      return result(check.id, "PENDING", `${count} of ${check.minimumOccurrences} ${check.from}→${check.to} transitions observed.`, { detail: { count } });
    }
    case "EVENT_SEQUENCE":
    case "DOWNSTREAM_ACK": {
      const events = check.kind === "EVENT_SEQUENCE" ? check.events : [check.trigger, check.acknowledgement];
      const missingTags = events.filter((t) => !reader.hasTag(t));
      if (missingTags.length) return result(check.id, "INCONCLUSIVE", `Event channel(s) not present: ${missingTags.join(", ")}. An absent channel is not an absent event.`, { missingChannels: missingTags });
      const { occurrences, cycleBound } = matchSequence(reader, events, from, nowMs, check.maximumElapsedSeconds);
      const complete = occurrences.filter((o) => !o.partial);
      const valid = complete.filter((o) => o.valid && !o.uncertain);
      const uncertain = complete.filter((o) => o.uncertain);
      const violations = complete.filter((o) => !o.valid && !o.uncertain);
      // Partial sequences older than the envelope (+ margin) count as violations: the later event never came.
      const stale = occurrences.filter((o) => o.partial && nowMs - o.startMs > (check.maximumElapsedSeconds + 5) * 1000);
      const detail = { occurrences: occurrences.length, valid: valid.length, violations: violations.length + stale.length, partial: occurrences.filter((o) => o.partial).length, uncertain: uncertain.length, cycleBound, envelopeSeconds: check.maximumElapsedSeconds, required: check.minimumValidOccurrences, note: cycleBound ? "Events bound to cycle ids" : "Cycle ids unavailable on some events; matched by time order without acknowledgement reuse" };
      const evid = complete.slice(0, 6).flatMap((o) => o.sampleIds);
      if (violations.length || stale.length) {
        const worst = violations.length ? Math.max(...violations.map((v) => v.elapsedS ?? 0)) : null;
        return result(check.id, "FAIL", `${violations.length + stale.length} sequence(s) exceeded the ${check.maximumElapsedSeconds} s envelope${worst !== null ? ` (worst ${worst.toFixed(1)} s)` : ""}${stale.length ? `; ${stale.length} never completed` : ""}. Decisive violation.`, { detail, decisiveViolation: true, evidenceObservationIds: evid });
      }
      if (uncertain.length && valid.length < check.minimumValidOccurrences) {
        return result(check.id, "INCONCLUSIVE", `${uncertain.length} sequence(s) cannot be judged against the ${check.maximumElapsedSeconds} s envelope because timestamp uncertainty exceeds the margin. Establish the clock contract before rerunning.`, { detail, evidenceObservationIds: evid });
      }
      if (valid.length >= check.minimumValidOccurrences) return result(check.id, "PASS", `${valid.length} valid sequences within ${check.maximumElapsedSeconds} s (required ${check.minimumValidOccurrences}).`, { detail, evidenceObservationIds: evid });
      if (occurrences.length === 0) return result(check.id, "PENDING", "No trigger observed yet; zero opportunities is not a pass.", { detail });
      return result(check.id, "PENDING", `${valid.length} of ${check.minimumValidOccurrences} valid sequences observed.`, { detail, evidenceObservationIds: evid });
    }
    case "ALARM_ABSENCE": {
      const hits = input.alarms.filter((a) => check.assetIds.includes(a.assetId) && check.severities.includes(a.severity) && a.raisedAt.ms >= from && a.raisedAt.ms <= nowMs);
      if (hits.length) return result(check.id, "FAIL", `${hits.length} ${check.severities.join("/")} alarm(s) raised on ${Array.from(new Set(hits.map((h) => h.assetId))).join(", ")} during the run: ${hits[0].message}.`, { decisiveViolation: true, detail: { alarms: hits.length } });
      if (nowMs - from < 30_000) return result(check.id, "PENDING", "Alarm-free window too short to be meaningful (30 s minimum).");
      return result(check.id, "PASS", `No ${check.severities.join("/")} alarms on ${check.assetIds.join(", ")} while alarm coverage was valid.`);
    }
    case "COMPLETE_CYCLES": {
      const tag = `${check.assetId}.cycle_complete`;
      if (!reader.hasTag(tag)) return result(check.id, "INCONCLUSIVE", `${tag} not present.`, { missingChannels: [tag] });
      const edges = dedupeEdges(reader.risingEdges(tag, from, nowMs));
      const count = edges.length;
      if (count >= check.count) return result(check.id, "PASS", `${count} complete cycles observed (required ${check.count}).`, { detail: { count }, evidenceObservationIds: ids(tag, edges) });
      return result(check.id, "PENDING", `${count} of ${check.count} complete cycles observed.`, { detail: { count }, evidenceObservationIds: ids(tag, edges) });
    }
    case "STABLE_WINDOW": {
      if (!reader.hasTag(check.tag)) return result(check.id, "INCONCLUSIVE", `${check.tag} not present.`, { missingChannels: [check.tag] });
      const settledAt = from + check.settlingSeconds * 1000;
      const windowEnd = settledAt + check.windowSeconds * 1000;
      const detail = { settlingSeconds: check.settlingSeconds, windowSeconds: check.windowSeconds, minimum: check.minimum, maximum: check.maximum, unit: check.unit, latest: (reader.latestAt(check.tag, nowMs)?.value as number | null) ?? null };
      if (nowMs < settledAt) return result(check.id, "PENDING", `Settling: ${Math.ceil((settledAt - nowMs) / 1000)} s remaining before the evaluation window opens.`, { detail });
      const samples = reader.range(check.tag, settledAt, Math.min(nowMs, windowEnd));
      const missing = samples.filter((s) => s.quality === "MISSING" || s.value === null);
      if (missing.length) return result(check.id, "INCONCLUSIVE", `${missing.length} MISSING samples inside the evaluation window; the requirement cannot be established from the remaining channels.`, { missingChannels: [check.tag], detail });
      const good = samples.filter((s) => typeof s.value === "number" && s.quality === "GOOD");
      const values = good.map((s) => s.value as number);
      const out = values.filter((v) => v < check.minimum || v > check.maximum);
      if (good.length >= 10 && out.length / good.length > 0.05) return result(check.id, "FAIL", `${out.length} of ${good.length} samples outside ${check.minimum}–${check.maximum} ${check.unit} after ${check.settlingSeconds} s settling. Persistent violation is not averaged away.`, { detail, decisiveViolation: true, evidenceObservationIds: ids(check.tag, good.filter((s) => (s.value as number) < check.minimum || (s.value as number) > check.maximum)) });
      if (nowMs < windowEnd) return result(check.id, "PENDING", `Evaluation window: ${Math.ceil((windowEnd - nowMs) / 1000)} s remaining (${good.length} samples so far${out.length ? `, ${out.length} out of band` : ""}).`, { detail });
      if (good.length < check.windowSeconds * 0.8) return result(check.id, "INCONCLUSIVE", `Only ${good.length} GOOD samples in a ${check.windowSeconds} s window.`, { missingChannels: [check.tag], detail });
      if (new Set(values).size === 1 && values.length >= 30) return result(check.id, "INCONCLUSIVE", `Channel reported exactly ${values[0]} ${check.unit} for the whole window; suspicious constancy requires a sensor check before this evidence is used.`, { missingChannels: [`${check.tag} (SUSPECT)`], detail });
      if (out.length) return result(check.id, "PENDING", `${out.length} isolated out-of-band samples; window complete but not clean.`, { detail });
      return result(check.id, "PASS", `${good.length} samples stable within ${check.minimum}–${check.maximum} ${check.unit} after ${check.settlingSeconds} s settling.`, { detail, evidenceObservationIds: ids(check.tag, good) });
    }
    case "DEPENDENCY_COVERAGE": {
      const notPublished = check.edgeIds.filter((id) => !input.publishedEdges.some((e) => e.id === id && (e.reviewStatus === "PUBLISHED" || e.reviewStatus === "APPROVED")));
      if (notPublished.length) return result(check.id, "INCONCLUSIVE", `Coverage references dependency edge(s) not published in ${plan.knowledgeVersion}: ${notPublished.join(", ")}. Required coverage cannot be established.`, { detail: { notPublished: notPublished.join(",") } });
      const missingChecks = check.coveredByCheckIds.filter((id) => !plan.checks.some((c) => c.id === id));
      if (missingChecks.length) return result(check.id, "INCONCLUSIVE", `Covering check(s) missing from the plan: ${missingChecks.join(", ")}.`);
      return result(check.id, "PENDING", "Evaluated after the covering checks.", { detail: { edges: check.edgeIds.join(","), checks: check.coveredByCheckIds.join(",") } });
    }
  }
}

export function evaluateRun(input: EvaluationInput): RecoveryRun {
  const { plan, run, nowMs } = input;
  const results: CheckResult[] = plan.checks.map((c) => evalCheck(c, input));
  // Resolve coverage checks from their covering checks.
  for (const c of plan.checks) {
    if (c.kind !== "DEPENDENCY_COVERAGE") continue;
    const r = results.find((x) => x.checkId === c.id)!;
    if (r.status !== "PENDING") continue;
    const covering = c.coveredByCheckIds.map((id) => results.find((x) => x.checkId === id)!).filter(Boolean);
    const worst = covering.reduce<CheckStatus>((acc, x) => rankStatus(x.status) > rankStatus(acc) ? x.status : acc, "PASS");
    r.status = worst;
    r.reason = worst === "PASS" ? `Edges ${c.edgeIds.join(", ")} covered by ${c.coveredByCheckIds.join(", ")}.` : `Coverage depends on ${c.coveredByCheckIds.join(", ")} (${worst}).`;
    r.decisiveViolation = covering.some((x) => x.decisiveViolation);
  }
  const statuses = results.map((r) => r.status);
  let outcome: RunOutcome;
  const elapsed = nowMs - run.startedAt.ms;
  if (statuses.includes("NOT_COMPARABLE")) outcome = "NOT_COMPARABLE";
  else if (results.some((r) => r.status === "FAIL" && r.decisiveViolation)) outcome = "FAIL";
  else if (statuses.includes("INCONCLUSIVE")) outcome = "INCONCLUSIVE";
  else if (statuses.includes("PENDING")) outcome = elapsed > MAX_RUN_MS ? "INCONCLUSIVE" : "RUNNING";
  else outcome = "PASS";

  const reasons: string[] = [];
  for (const r of results) {
    if (r.status === "NOT_COMPARABLE" || r.status === "FAIL" || r.status === "INCONCLUSIVE") reasons.push(`${r.checkId}: ${r.reason}`);
    if (r.missingChannels.length && r.status !== "INCONCLUSIVE") reasons.push(`${r.checkId}: missing ${r.missingChannels.join(", ")}`);
  }
  if (outcome === "INCONCLUSIVE" && elapsed > MAX_RUN_MS && !statuses.includes("INCONCLUSIVE")) reasons.push(`Run exceeded ${MAX_RUN_MS / 60_000} minutes without the required valid opportunities.`);
  if (outcome === "PASS" && reasons.length === 0) reasons.push("All required checks passed with adequate coverage.");

  const cycles = results.find((r) => plan.checks.find((c) => c.id === r.checkId)?.kind === "COMPLETE_CYCLES");
  const stable = results.filter((r) => plan.checks.find((c) => c.id === r.checkId)?.kind === "STABLE_WINDOW" && r.status === "PENDING");
  const settlingRemaining = stable.length ? Math.max(0, ...stable.map((r) => Number(String(r.reason).match(/(\d+) s remaining/)?.[1] ?? 0))) : 0;
  const cell = input.cells[plan.scope.cellId === "PLANT" ? "CELL-A" : plan.scope.cellId];
  const summary =
    outcome === "PASS"
      ? "Recovery checks passed within the tested operating conditions."
      : outcome === "RUNNING"
        ? `Collecting evidence: ${results.filter((r) => r.status === "PASS").length}/${results.length} checks satisfied so far.`
        : outcome === "NOT_COMPARABLE"
          ? "Operating context differs from the frozen plan scope; the result cannot be compared with the approved baseline."
          : outcome === "FAIL"
            ? `Required behaviour did not return: ${results.filter((r) => r.status === "FAIL").map((r) => r.checkId).join(", ")}.`
            : `Recovery cannot be established: ${results.filter((r) => r.status === "INCONCLUSIVE").map((r) => r.checkId).join(", ")}.`;
  const retained = Array.from(new Set(results.flatMap((r) => r.evidenceObservationIds))).slice(0, 200);
  return {
    ...run,
    outcome,
    evaluatedUntilMs: nowMs,
    finishedAt: outcome === "RUNNING" ? undefined : { ms: nowMs, clock: "SIMULATION", uncertaintyMs: 0 },
    results,
    summary,
    contextObserved: {
      recipe: cell?.recipe,
      mode: cell?.mode,
      commandedSpeedRpm: cell?.commandedSpeedRpm,
      actualSpeedRpm: (input.reader.latestAt(plan.scope.cellId === "CELL-B" ? "SPN-02.actual_speed" : "SPN-01.actual_speed", nowMs)?.value as number | undefined) ?? undefined,
    },
    completeCyclesObserved: Number(cycles?.detail.count ?? 0),
    settlingRemainingSeconds: settlingRemaining,
    reasonNotEstablished: reasons,
    retainedObservationIds: retained,
  };
}

function rankStatus(s: CheckStatus): number {
  return { PASS: 0, PENDING: 1, INCONCLUSIVE: 2, FAIL: 3, NOT_COMPARABLE: 4 }[s];
}

export const AGGREGATE_PRECEDENCE = [
  "NOT_COMPARABLE when any check finds the operating context differs from the frozen scope.",
  "FAIL when any valid check observes a decisive requirement violation (missing evidence is still listed).",
  "INCONCLUSIVE when required evidence is missing and no decisive failure was observed.",
  "RUNNING while checks are still collecting valid opportunities; zero opportunities is never a pass.",
  "PASS only when every required check passes with adequate coverage.",
];
