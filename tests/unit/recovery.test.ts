import { describe, expect, it } from "vitest";
import { ObservationStore, readerAt } from "@/lib/simulation/observation";
import { evaluateRun, matchSequence } from "@/lib/recovery/interpreter";
import { approvePlan, compilePlan, invalidateForKnowledgeChange, revisePlan } from "@/lib/recovery/compiler";
import { TEMPLATE_BY_ID } from "@/lib/fixtures/templates";
import { SEED_KNOWLEDGE_VERSION } from "@/lib/fixtures/knowledge";
import type { RecoveryRun } from "@/lib/domain/types";
import { approvedPlan, placeholderIncident, review, runPlan, runtimeFor, T0 } from "./helpers";

const cells = {
  "CELL-A": { cellId: "CELL-A" as const, recipe: "PART-A", mode: "AUTO" as const, commandedSpeedRpm: 1500, phase: "CUTTING" as const },
  "CELL-B": { cellId: "CELL-B" as const, recipe: "PART-A", mode: "AUTO" as const, commandedSpeedRpm: 1500, phase: "CUTTING" as const },
};

function freshRun(planId: string, version: number): RecoveryRun {
  return { id: "RUN-T", planId, planVersion: version, incidentId: "INC-TEST", knowledgeVersion: "k", baselineVersion: "b", outcome: "RUNNING", startedAt: { ms: T0, clock: "SIMULATION", uncertaintyMs: 0 }, evaluatedUntilMs: T0, results: [], summary: "", contextObserved: {}, completeCyclesObserved: 0, settlingRemainingSeconds: 0, reasonNotEstablished: [], retainedObservationIds: [] };
}

describe("interpreter on an empty trace", () => {
  it("never passes with zero observations", () => {
    const plan = approvedPlan("TPL-CELL-A-AIR");
    const store = new ObservationStore();
    const out = evaluateRun({ plan, run: freshRun(plan.id, 1), reader: readerAt(store, T0 + 60_000), alarms: [], cells, publishedEdges: SEED_KNOWLEDGE_VERSION.edges, nowMs: T0 + 60_000 });
    expect(out.outcome).not.toBe("PASS");
    expect(["RUNNING", "INCONCLUSIVE"]).toContain(out.outcome);
  });

  it("becomes INCONCLUSIVE, not PASS, when no valid opportunities arrive within the run limit", () => {
    const plan = approvedPlan("TPL-CELL-A-AIR");
    const store = new ObservationStore();
    for (const t of plan.requiredEvidence) store.push(t, { ms: T0, value: t.endsWith("header_pressure") ? 6.1 : false, quality: "GOOD", uncertaintyMs: 0, sourceId: "SIM" });
    const out = evaluateRun({ plan, run: freshRun(plan.id, 1), reader: readerAt(store, T0 + 25 * 60_000), alarms: [], cells, publishedEdges: SEED_KNOWLEDGE_VERSION.edges, nowMs: T0 + 25 * 60_000 });
    expect(out.outcome).toBe("INCONCLUSIVE");
  });
});

describe("sequence matching", () => {
  it("does not reuse one acknowledgement for several cycles and reports partial sequences", () => {
    const store = new ObservationStore();
    const push = (tag: string, ms: number, v: boolean) => store.push(tag, { ms, value: v, quality: "GOOD", uncertaintyMs: 0, sourceId: "SIM" });
    push("A.trig", T0, false);
    push("A.ack", T0, false);
    push("A.trig", T0 + 1000, true);
    push("A.trig", T0 + 2000, false);
    push("A.trig", T0 + 3000, true); // second trigger
    push("A.trig", T0 + 4000, false);
    push("A.ack", T0 + 5000, true); // single ack
    push("A.ack", T0 + 6000, false);
    const { occurrences } = matchSequence(readerAt(store, T0 + 10_000), ["A.trig", "A.ack"], T0, T0 + 10_000, 8);
    expect(occurrences.filter((o) => !o.partial)).toHaveLength(1);
    expect(occurrences.filter((o) => o.partial)).toHaveLength(1);
  });

  it("marks an occurrence uncertain when clock uncertainty straddles the envelope", () => {
    const store = new ObservationStore();
    store.push("A.trig", { ms: T0, value: true, quality: "GOOD", uncertaintyMs: 5000, sourceId: "SIM", clockSourceId: "ROBOT" });
    store.push("A.ack", { ms: T0 + 7000, value: true, quality: "GOOD", uncertaintyMs: 0, sourceId: "SIM" });
    const { occurrences } = matchSequence(readerAt(store, T0 + 10_000), ["A.trig", "A.ack"], T0 - 1000, T0 + 10_000, 8);
    expect(occurrences[0].uncertain).toBe(true);
  });
});

describe("recovery runs against the engine", () => {
  it("scenario 5: speed reduction yields NOT_COMPARABLE, never PASS", () => {
    const rt = runtimeFor("S05-SPEED-REDUCTION");
    const { run } = runPlan(rt, "TPL-CELL-A-MECH", { intervention: "SET_SPEED", params: { rpm: 900 }, startAtMs: T0 + 240_000, durationMs: 240_000 });
    expect(run.outcome).toBe("NOT_COMPARABLE");
    expect(run.results.find((r) => r.checkId === "CHK-MODE")?.status).toBe("NOT_COMPARABLE");
  });

  it("scenario 5: corrective repair at the approved speed passes only after the required cycles", () => {
    const rt = runtimeFor("S05-SPEED-REDUCTION");
    rt.fastForward(T0 + 240_000);
    rt.intervene("REMOVE_SPN1_RESISTANCE", undefined, "test");
    const inc = rt.incidentsList()[0];
    const plan = approvedPlan("TPL-CELL-A-MECH", inc);
    const run = rt.startRun(plan, undefined);
    rt.fastForward(rt.liveMs + 60_000);
    expect(rt.runsList().find((r) => r.id === run.id)!.outcome).toBe("RUNNING");
    rt.fastForward(rt.liveMs + 300_000);
    const final = rt.runsList().find((r) => r.id === run.id)!;
    expect(final.outcome).toBe("PASS");
    expect(final.summary).toBe("Recovery checks passed within the tested operating conditions.");
    expect(final.completeCyclesObserved).toBeGreaterThanOrEqual(3);
  });

  it("scenario 1: clearing alarms or replacing the fixture sensor cannot pass; repairing the leak can", () => {
    const misleading = runPlan(runtimeFor("S01-SHARED-AIR"), "TPL-CELL-A-AIR", { intervention: "REPLACE_FIXTURE_SENSOR", startAtMs: T0 + 300_000, durationMs: 400_000 });
    expect(misleading.run.outcome).toBe("FAIL");
    expect(misleading.run.results.some((r) => r.decisiveViolation)).toBe(true);
    const cleared = runPlan(runtimeFor("S01-SHARED-AIR"), "TPL-CELL-A-AIR", { intervention: "CLEAR_ALARMS_ONLY", startAtMs: T0 + 300_000, durationMs: 400_000 });
    expect(cleared.run.outcome).toBe("FAIL");
    const repaired = runPlan(runtimeFor("S01-SHARED-AIR"), "TPL-CELL-A-AIR", { intervention: "REPAIR_AIR_LEAK", startAtMs: T0 + 300_000, durationMs: 480_000 });
    expect(repaired.run.outcome).toBe("PASS");
  });

  it("scenario 6: thermal settling keeps the run RUNNING before PASS after a correct repair", () => {
    const rt = runtimeFor("S06-DELAYED-THERMAL");
    rt.fastForward(T0 + 300_000);
    rt.intervene("REPLACE_COOLANT_FILTER", undefined, "test");
    const plan = approvedPlan("TPL-CELL-A-COOLANT", rt.incidentsList()[0] ?? placeholderIncident());
    const run = rt.startRun(plan, undefined);
    rt.fastForward(rt.liveMs + 90_000);
    const mid = rt.runsList().find((r) => r.id === run.id)!;
    expect(mid.outcome).toBe("RUNNING");
    expect(mid.results.find((r) => r.checkId === "CHK-TEMP")?.status).toBe("PENDING");
    rt.fastForward(rt.liveMs + 420_000);
    const final = rt.runsList().find((r) => r.id === run.id)!;
    expect(final.outcome).toBe("PASS");
  });

  it("scenario 7: missing flow evidence yields INCONCLUSIVE with the exact missing channel", () => {
    const { run } = runPlan(runtimeFor("S07-MISSING-EVIDENCE"), "TPL-CELL-A-COOLANT", { intervention: "REPLACE_COOLANT_FILTER", startAtMs: T0 + 300_000, durationMs: 300_000 });
    expect(run.outcome).toBe("INCONCLUSIVE");
    const q = run.results.find((r) => r.checkId === "CHK-QUALITY")!;
    expect(q.missingChannels.join(" ")).toContain("PUMP-01.coolant_flow");
  });

  it("scenario 9: restoring cooling only FAILS on the mechanical checks while temperature improves", () => {
    const { run } = runPlan(runtimeFor("S09-TWO-MECHANISMS"), "TPL-CELL-A-MECH", { intervention: "RESTORE_COOLING", startAtMs: T0 + 300_000, durationMs: 300_000 });
    expect(run.outcome).toBe("FAIL");
    expect(run.results.find((r) => r.checkId === "CHK-CURRENT")?.status).toBe("FAIL");
  });

  it("scenario 3: proximity sensor swap fails the handshake suite; repairing the acknowledgement path passes", () => {
    const wrong = runPlan(runtimeFor("S03-HANDSHAKE"), "TPL-CELL-A-HANDSHAKE", { intervention: "REPLACE_PROXIMITY_SENSOR", startAtMs: T0 + 300_000, durationMs: 400_000 });
    expect(wrong.run.outcome).toBe("FAIL");
    const right = runPlan(runtimeFor("S03-HANDSHAKE"), "TPL-CELL-A-HANDSHAKE", { intervention: "REPAIR_ACK_PATH", startAtMs: T0 + 300_000, durationMs: 480_000 });
    expect(right.run.outcome).toBe("PASS");
  });

  it("a decisive violation stays visible alongside missing data", () => {
    const rt = runtimeFor("S07-MISSING-EVIDENCE");
    rt.fastForward(T0 + 300_000);
    // No repair: flow still restricted (decisive) AND channel missing.
    const plan = approvedPlan("TPL-CELL-A-COOLANT", rt.incidentsList()[0] ?? placeholderIncident());
    const run = rt.startRun(plan, undefined);
    rt.fastForward(rt.liveMs + 200_000);
    const final = rt.runsList().find((r) => r.id === run.id)!;
    expect(["FAIL", "INCONCLUSIVE"]).toContain(final.outcome);
    expect(final.reasonNotEstablished.length).toBeGreaterThan(0);
  });
});

describe("plan lifecycle", () => {
  it("editing a plan creates a new version and invalidates approval", () => {
    const plan = approvedPlan("TPL-CELL-A-AIR");
    const { previous, next } = revisePlan(plan, { scope: { requiredCompleteCycles: 3 } }, { ms: T0, clock: "SIMULATION", uncertaintyMs: 0 }, "fewer cycles");
    expect(previous.status).toBe("SUPERSEDED");
    expect(next.version).toBe(2);
    expect(next.status).toBe("DRAFT");
    expect(next.approval).toBeNull();
    expect(() => approvePlan(previous, review())).toThrow();
  });

  it("a knowledge publish that changes a referenced requirement invalidates the approval", () => {
    const plan = approvedPlan("TPL-CELL-A-AIR");
    const inv = invalidateForKnowledgeChange(plan, ["REQ-DEMO-AIR-01"], "plant-knowledge-2");
    expect(inv?.status).toBe("INVALIDATED");
    expect(invalidateForKnowledgeChange(plan, ["REQ-UNRELATED"], "plant-knowledge-2")).toBeNull();
  });

  it("compilation refuses a plan whose requirement is not published", () => {
    const k = { ...SEED_KNOWLEDGE_VERSION, requirements: SEED_KNOWLEDGE_VERSION.requirements.filter((r) => r.id !== "REQ-DEMO-AIR-01") };
    const { errors } = compilePlan({ template: TEMPLATE_BY_ID["TPL-CELL-A-AIR"], incident: placeholderIncident(), knowledge: k, baselineId: "PART-A-approved-demo-1", planId: "RP-X", version: 1, now: { ms: T0, clock: "SIMULATION", uncertaintyMs: 0 } });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("the runtime refuses to run an unapproved plan", () => {
    const rt = runtimeFor("S00-HEALTHY");
    const { plan } = compilePlan({ template: TEMPLATE_BY_ID["TPL-CELL-A-AIR"], incident: placeholderIncident(), knowledge: SEED_KNOWLEDGE_VERSION, baselineId: "PART-A-approved-demo-1", planId: "RP-X", version: 1, now: { ms: T0, clock: "SIMULATION", uncertaintyMs: 0 } });
    expect(() => rt.startRun(plan, undefined)).toThrow();
  });
});
