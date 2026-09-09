import type { RecoveryPlan } from "@/lib/domain/types";
import { Runtime } from "./runtime";
import { DEMO_START_MS, SCENARIO_BY_ID, type InterventionId } from "./scenarios";
import { SCENARIO_TRUTH } from "./truth";
import { SEED_BASELINES, SEED_KNOWLEDGE_VERSION } from "@/lib/fixtures/knowledge";
import { compilePlan, templatesFor } from "@/lib/recovery/compiler";

/**
 * Frozen multi-seed evaluation (Lab). Compares a naive independent-threshold/timeout
 * baseline with the full engine on the same episodes. This module may read the scenario
 * truth because it is the instructor-side harness; the diagnosis and recovery modules
 * never can. Synthetic consistency is not field validation: the simulator and the rules
 * share assumptions.
 */

export interface EvaluationConfig {
  seeds: number[];
  scenarioIds: string[];
  /** Simulation time to evaluate detection at (ms after start). */
  detectAtMs?: number;
  /** Also run recovery false-accept episodes. */
  recovery?: boolean;
}

export type CaseClass = "NORMAL" | "KNOWN" | "AMBIGUOUS" | "MISSING_DATA" | "COMPOUND" | "UNSUPPORTED";

export interface EpisodeResult {
  scenarioId: string;
  seed: number;
  caseClass: CaseClass;
  expectedFamily: string | null;
  expectedState: string;
  engine: { topFamily: string | null; state: string | null; incidents: number; groupedAssets: number };
  baseline: { incidents: number; firstAlarmAsset: string | null; alarms: number };
  detected: boolean;
  familyMatch: boolean;
  stateMatch: boolean;
  abstained: boolean;
  groupingCorrect: boolean;
  evidenceCoverage: { supported: number; pending: number; unavailable: number };
}

export interface RecoveryEpisode {
  scenarioId: string;
  seed: number;
  intervention: InterventionId;
  misleading: boolean;
  engineOutcome: string;
  baselineOutcome: "PASS" | "FAIL";
  falseAccept: { engine: boolean; baseline: boolean };
  trueAccept: { engine: boolean; baseline: boolean };
}

export interface EvaluationReport {
  ranAt: string;
  config: EvaluationConfig;
  episodes: EpisodeResult[];
  recovery: RecoveryEpisode[];
  summary: {
    n: number;
    engine: { truePositives: number; falseNegatives: number; falsePositives: number; trueNegatives: number; familyMatches: number; knownCases: number; abstainedOnUnsupported: number; unsupportedCases: number; groupingCorrect: number; groupingCases: number };
    baseline: { truePositives: number; falseNegatives: number; falsePositives: number; trueNegatives: number; groupingCorrect: number; groupingCases: number };
    recovery: { negatives: number; engineFalseAccepts: number; baselineFalseAccepts: number; positives: number; engineTrueAccepts: number; baselineTrueAccepts: number };
  };
  caveats: string[];
}

export const CASE_CLASS: Record<string, CaseClass> = {
  "S00-HEALTHY": "NORMAL",
  "S01-SHARED-AIR": "KNOWN",
  "S02-COOLANT": "KNOWN",
  "S03-HANDSHAKE": "KNOWN",
  "S04-SUPPLY-SAG": "COMPOUND",
  "S05-SPEED-REDUCTION": "KNOWN",
  "S06-DELAYED-THERMAL": "KNOWN",
  "S07-MISSING-EVIDENCE": "MISSING_DATA",
  "S08-RECIPE-CHANGE": "NORMAL",
  "S09-TWO-MECHANISMS": "COMPOUND",
  "S10-CLOCK-SKEW": "AMBIGUOUS",
  "S11-UNSUPPORTED": "UNSUPPORTED",
  "S12-RECURRING": "KNOWN",
};

/** Evaluation fixtures use different seeds from development seeds (scenario.seed + 5000 offset by default). */
export const EVALUATION_SEEDS = [7001, 7002, 7003];

const RECOVERY_CASES: Array<{ scenarioId: string; intervention: InterventionId; misleading: boolean; params?: Record<string, number | string>; template: string; waitMs: number }> = [
  { scenarioId: "S01-SHARED-AIR", intervention: "REPLACE_FIXTURE_SENSOR", misleading: true, template: "TPL-CELL-A-AIR", waitMs: 6 * 60_000 },
  { scenarioId: "S01-SHARED-AIR", intervention: "CLEAR_ALARMS_ONLY", misleading: true, template: "TPL-CELL-A-AIR", waitMs: 6 * 60_000 },
  { scenarioId: "S01-SHARED-AIR", intervention: "REPAIR_AIR_LEAK", misleading: false, template: "TPL-CELL-A-AIR", waitMs: 7 * 60_000 },
  { scenarioId: "S05-SPEED-REDUCTION", intervention: "SET_SPEED", misleading: true, params: { rpm: 900 }, template: "TPL-CELL-A-MECH", waitMs: 6 * 60_000 },
  { scenarioId: "S05-SPEED-REDUCTION", intervention: "REMOVE_SPN1_RESISTANCE", misleading: false, template: "TPL-CELL-A-MECH", waitMs: 6 * 60_000 },
  { scenarioId: "S09-TWO-MECHANISMS", intervention: "RESTORE_COOLING", misleading: true, template: "TPL-CELL-A-COOLANT", waitMs: 7 * 60_000 },
  { scenarioId: "S02-COOLANT", intervention: "REPLACE_COOLANT_FILTER", misleading: false, template: "TPL-CELL-A-COOLANT", waitMs: 8 * 60_000 },
  { scenarioId: "S03-HANDSHAKE", intervention: "REPLACE_PROXIMITY_SENSOR", misleading: true, template: "TPL-CELL-A-HANDSHAKE", waitMs: 6 * 60_000 },
  { scenarioId: "S03-HANDSHAKE", intervention: "REPAIR_ACK_PATH", misleading: false, template: "TPL-CELL-A-HANDSHAKE", waitMs: 7 * 60_000 },
];

export function runEvaluation(config: EvaluationConfig): EvaluationReport {
  const detectAt = config.detectAtMs ?? 8 * 60_000;
  const episodes: EpisodeResult[] = [];
  for (const scenarioId of config.scenarioIds) {
    const truth = SCENARIO_TRUTH[scenarioId];
    if (!truth || !SCENARIO_BY_ID[scenarioId]) continue;
    for (const seed of config.seeds) {
      const rt = new Runtime();
      rt.init({ mode: "DEMO_SIMULATION", seed, scenarioId, startMs: DEMO_START_MS, knowledge: SEED_KNOWLEDGE_VERSION, baselines: SEED_BASELINES });
      rt.fastForward(DEMO_START_MS + detectAt);
      const snap = rt.snapshot();
      const live = snap.incidents.filter((i) => !i.fixture);
      const top = live.slice().sort((a, b) => (b.diagnosis?.candidates[0]?.supportCount ?? 0) - (a.diagnosis?.candidates[0]?.supportCount ?? 0))[0];
      const topFamily = top?.diagnosis?.state === "NORMAL" ? null : (top?.diagnosis?.candidates[0]?.family ?? null);
      const state = top?.diagnosis?.state ?? null;
      const alarmAssets = new Set(snap.alarms.filter((a) => a.severity !== "INFO").map((a) => a.assetId));
      const firstAlarm = snap.alarms.filter((a) => a.severity !== "INFO").sort((a, b) => a.raisedAt.ms - b.raisedAt.ms)[0];
      const caseClass = CASE_CLASS[scenarioId] ?? "KNOWN";
      const expectedFamily = truth.answerKey.expectedTopFamily;
      const detected = live.length > 0;
      const abstained = state === "UNKNOWN" || state === "AMBIGUOUS" || state === "SENSOR_CHECK";
      const groupedAssets = top?.observedAssetIds.length ?? 0;
      // Grouping is "correct" for shared-cause scenarios when the engine groups ≥2 assets into one incident and the baseline would show ≥2 separate ones.
      const sharedCause = scenarioId === "S01-SHARED-AIR" || scenarioId === "S04-SUPPLY-SAG" || scenarioId === "S10-CLOCK-SKEW";
      const groupingCorrect = sharedCause ? groupedAssets >= 2 : true;
      const cand = top?.diagnosis?.candidates[0];
      episodes.push({
        scenarioId,
        seed,
        caseClass,
        expectedFamily,
        expectedState: truth.answerKey.expectedState,
        engine: { topFamily, state, incidents: live.length, groupedAssets },
        baseline: { incidents: alarmAssets.size, firstAlarmAsset: firstAlarm?.assetId ?? null, alarms: snap.alarms.length },
        detected,
        familyMatch: expectedFamily !== null && topFamily === expectedFamily,
        stateMatch: state === truth.answerKey.expectedState,
        abstained,
        groupingCorrect,
        evidenceCoverage: { supported: cand?.supportCount ?? 0, pending: cand?.pendingCount ?? 0, unavailable: cand?.unavailableCount ?? 0 },
      });
    }
  }

  const recovery: RecoveryEpisode[] = [];
  if (config.recovery) {
    for (const rc of RECOVERY_CASES) {
      if (!config.scenarioIds.includes(rc.scenarioId)) continue;
      const truth = SCENARIO_TRUTH[rc.scenarioId];
      const onset = Math.max(...truth.faults.map((f) => f.atOffsetMs));
      for (const seed of config.seeds) {
        const rt = new Runtime();
        rt.init({ mode: "DEMO_SIMULATION", seed, scenarioId: rc.scenarioId, startMs: DEMO_START_MS, knowledge: SEED_KNOWLEDGE_VERSION, baselines: SEED_BASELINES });
        rt.fastForward(DEMO_START_MS + onset + 150_000);
        rt.intervene(rc.intervention, rc.params, "Evaluation harness");
        const incident = rt.snapshot().incidents.find((i) => !i.fixture) ?? rt.snapshot().incidents[0];
        const tpl = templatesFor(undefined).find((t) => t.id === rc.template)!;
        const compiled = compilePlan({ template: tpl, incident: incident ?? { id: "INC-EVAL", title: "eval", status: "OPEN", openedAt: { ms: rt.liveMs, clock: "SIMULATION", uncertaintyMs: 0 }, observedAssetIds: [], potentiallyAffectedAssetIds: [], affectedCellIds: [], alarmIds: [], groupingRationale: "", workOrderIds: [], recoveryPlanIds: [], interruptions: [], safetyRelevant: false, repeatOf: [] }, knowledge: SEED_KNOWLEDGE_VERSION, baselineId: "PART-A-approved-demo-1", planId: `RP-EVAL-${rc.scenarioId}`, version: 1, now: { ms: rt.liveMs, clock: "SIMULATION", uncertaintyMs: 0 } });
        const plan: RecoveryPlan = { ...compiled.plan, status: "APPROVED", approval: { reviewer: "Evaluation harness", simulatedIdentity: true, decision: "APPROVED", reason: "eval", at: { ms: rt.liveMs, clock: "SIMULATION", uncertaintyMs: 0 } } };
        const run = rt.startRun(plan, undefined);
        const interventionMs = rt.liveMs;
        rt.fastForward(rt.liveMs + rc.waitMs);
        const final = rt.runsList().find((r) => r.id === run.id)!;
        // Baseline: "alarms cleared 60 s after the intervention" counts as recovered.
        const alarmsAfter = rt.snapshot().alarms.filter((a) => a.severity === "FAULT" && a.raisedAt.ms > interventionMs + 60_000);
        const baselineOutcome: "PASS" | "FAIL" = alarmsAfter.length === 0 ? "PASS" : "FAIL";
        recovery.push({
          scenarioId: rc.scenarioId,
          seed,
          intervention: rc.intervention,
          misleading: rc.misleading,
          engineOutcome: final.outcome,
          baselineOutcome,
          falseAccept: { engine: rc.misleading && final.outcome === "PASS", baseline: rc.misleading && baselineOutcome === "PASS" },
          trueAccept: { engine: !rc.misleading && final.outcome === "PASS", baseline: !rc.misleading && baselineOutcome === "PASS" },
        });
      }
    }
  }

  const positives = episodes.filter((e) => e.caseClass !== "NORMAL");
  const negatives = episodes.filter((e) => e.caseClass === "NORMAL");
  const known = episodes.filter((e) => e.expectedFamily !== null);
  const unsupported = episodes.filter((e) => e.caseClass === "UNSUPPORTED" || e.caseClass === "MISSING_DATA" || e.caseClass === "AMBIGUOUS");
  const grouping = episodes.filter((e) => ["S01-SHARED-AIR", "S04-SUPPLY-SAG", "S10-CLOCK-SKEW"].includes(e.scenarioId));
  const negRec = recovery.filter((r) => r.misleading);
  const posRec = recovery.filter((r) => !r.misleading);
  return {
    ranAt: new Date().toISOString(),
    config,
    episodes,
    recovery,
    summary: {
      n: episodes.length,
      engine: {
        truePositives: positives.filter((e) => e.detected).length,
        falseNegatives: positives.filter((e) => !e.detected).length,
        falsePositives: negatives.filter((e) => e.detected && e.engine.state !== "NORMAL").length,
        trueNegatives: negatives.filter((e) => !e.detected || e.engine.state === "NORMAL").length,
        familyMatches: known.filter((e) => e.familyMatch).length,
        knownCases: known.length,
        abstainedOnUnsupported: unsupported.filter((e) => e.abstained).length,
        unsupportedCases: unsupported.length,
        groupingCorrect: grouping.filter((e) => e.groupingCorrect).length,
        groupingCases: grouping.length,
      },
      baseline: {
        truePositives: positives.filter((e) => e.baseline.alarms > 0).length,
        falseNegatives: positives.filter((e) => e.baseline.alarms === 0).length,
        falsePositives: negatives.filter((e) => e.baseline.alarms > 0).length,
        trueNegatives: negatives.filter((e) => e.baseline.alarms === 0).length,
        groupingCorrect: grouping.filter((e) => e.baseline.incidents <= 1).length,
        groupingCases: grouping.length,
      },
      recovery: {
        negatives: negRec.length,
        engineFalseAccepts: negRec.filter((r) => r.falseAccept.engine).length,
        baselineFalseAccepts: negRec.filter((r) => r.falseAccept.baseline).length,
        positives: posRec.length,
        engineTrueAccepts: posRec.filter((r) => r.trueAccept.engine).length,
        baselineTrueAccepts: posRec.filter((r) => r.trueAccept.baseline).length,
      },
    },
    caveats: [
      "Synthetic consistency is not field validation: the simulator and the diagnostic rules share assumptions.",
      "Counts are shown with denominators; zero false accepts means 0 out of N tested negative cases, not zero risk.",
      "Evaluation seeds differ from the development seeds used while tuning the rules.",
    ],
  };
}
