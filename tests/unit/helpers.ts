import type { Incident, RecoveryPlan, ReviewRecord } from "@/lib/domain/types";
import { Runtime } from "@/lib/simulation/runtime";
import { DEMO_START_MS, type InterventionId } from "@/lib/simulation/scenarios";
import { SEED_BASELINES, SEED_KNOWLEDGE_VERSION } from "@/lib/fixtures/knowledge";
import { compilePlan, approvePlan } from "@/lib/recovery/compiler";
import { TEMPLATE_BY_ID } from "@/lib/fixtures/templates";

export const T0 = DEMO_START_MS;

export function runtimeFor(scenarioId: string, seed = 4242, knowledge = SEED_KNOWLEDGE_VERSION): Runtime {
  const rt = new Runtime();
  rt.init({ mode: "DEMO_SIMULATION", seed, scenarioId, startMs: T0, knowledge, baselines: SEED_BASELINES });
  return rt;
}

export const review = (who = "Supervisor M. (simulated)", decision: ReviewRecord["decision"] = "APPROVED"): ReviewRecord => ({ reviewer: who, simulatedIdentity: true, decision, reason: "test", at: { ms: Date.now(), clock: "WALL", uncertaintyMs: 0 } });

export function placeholderIncident(id = "INC-TEST"): Incident {
  return { id, title: "test", status: "OPEN", openedAt: { ms: T0, clock: "SIMULATION", uncertaintyMs: 0 }, observedAssetIds: [], potentiallyAffectedAssetIds: [], affectedCellIds: [], alarmIds: [], groupingRationale: "", workOrderIds: [], recoveryPlanIds: [], interruptions: [], safetyRelevant: false, repeatOf: [] };
}

export function approvedPlan(templateId: string, incident: Incident = placeholderIncident(), knowledge = SEED_KNOWLEDGE_VERSION, baselineId = "PART-A-approved-demo-1"): RecoveryPlan {
  const { plan, errors } = compilePlan({ template: TEMPLATE_BY_ID[templateId], incident, knowledge, baselineId, planId: `RP-${templateId}`, version: 1, now: { ms: T0, clock: "SIMULATION", uncertaintyMs: 0 } });
  if (errors.length) throw new Error(errors.join("; "));
  return approvePlan(plan, review());
}

export function runPlan(rt: Runtime, templateId: string, opts: { intervention?: InterventionId; params?: Record<string, number | string>; startAtMs: number; durationMs: number; incidentPred?: (i: Incident) => boolean }) {
  rt.fastForward(opts.startAtMs);
  if (opts.intervention) rt.intervene(opts.intervention, opts.params, "test");
  const inc = rt.incidentsList().find((i) => !i.fixture && (!opts.incidentPred || opts.incidentPred(i))) ?? placeholderIncident();
  const plan = approvedPlan(templateId, inc);
  const run = rt.startRun(plan, undefined);
  rt.fastForward(rt.liveMs + opts.durationMs);
  return { plan, run: rt.runsList().find((r) => r.id === run.id)!, incident: inc };
}
