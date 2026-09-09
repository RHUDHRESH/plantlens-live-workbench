import { describe, expect, it } from "vitest";
import type { RecoveryRun, WorkOrder } from "@/lib/domain/types";
import { applyInventory, checkVerifiedClosure, closeWorkOrder, transitionWorkOrder, WorkflowError, cellCosts, workOrderCost } from "@/lib/workflow";
import { SEED_INVENTORY, SEED_COST_ASSUMPTIONS } from "@/lib/fixtures/history";
import { unionDurationMs, formatInr, paise } from "@/lib/util";
import { approvedPlan, review, T0 } from "./helpers";

const ts = (ms: number) => ({ ms, clock: "SIMULATION" as const, uncertaintyMs: 0 });

function wo(): WorkOrder {
  return { id: "WO-001", assetId: "AIR-HDR-01", cellId: "CELL-A", title: "t", state: "OPEN", priority: "P1", assignee: "Technician R. (simulated)", evidenceRefs: [], suspectedMechanism: "", plannedAction: "", approvals: [], workPerformed: [], labor: [], parts: [], runIds: [], events: [], createdAt: ts(T0) };
}

function run(id: string, planId: string, version: number, outcome: RecoveryRun["outcome"], startedMs: number): RecoveryRun {
  return { id, planId, planVersion: version, incidentId: "INC", knowledgeVersion: "k", baselineVersion: "b", outcome, startedAt: ts(startedMs), evaluatedUntilMs: startedMs, results: [], summary: "", contextObserved: {}, completeCyclesObserved: 0, settlingRemainingSeconds: 0, reasonNotEstablished: [], retainedObservationIds: [] };
}

describe("work order closure rules", () => {
  it("recording a repair cannot set PASS; closure needs a current passing run and a separate reviewer", () => {
    const plan = approvedPlan("TPL-CELL-A-AIR");
    let w = transitionWorkOrder(wo(), "INVESTIGATING", "eng", "start", ts(T0));
    w = transitionWorkOrder(w, "INTERVENTION_APPROVED", "sup", "ok", ts(T0));
    w = { ...w, workPerformed: [{ id: "wp", at: ts(T0 + 1000), by: "Technician R. (simulated)", description: "repair" }], recoveryPlanId: plan.id, runIds: ["R1"] };
    w = transitionWorkOrder(w, "WORK_RECORDED", "tech", "done", ts(T0 + 1000));
    // No passing run -> blocked.
    expect(checkVerifiedClosure(w, plan, [run("R1", plan.id, 1, "FAIL", T0 + 2000)], review()).ok).toBe(false);
    // Passing run started before the work -> stale.
    const stale = checkVerifiedClosure(w, plan, [run("R1", plan.id, 1, "PASS", T0 - 5000)], review());
    expect(stale.ok).toBe(false);
    expect(stale.reasons.join(" ")).toMatch(/stale/i);
    // Passing run at a different plan version -> blocked.
    expect(checkVerifiedClosure(w, plan, [run("R1", plan.id, 2, "PASS", T0 + 3000)], review()).ok).toBe(false);
    // Reviewer same as repairer -> blocked.
    expect(checkVerifiedClosure(w, plan, [run("R1", plan.id, 1, "PASS", T0 + 3000)], review("Technician R. (simulated)")).ok).toBe(false);
    // Everything right -> ok, and closing locks the record.
    const good = checkVerifiedClosure(w, plan, [run("R1", plan.id, 1, "PASS", T0 + 3000)], review());
    expect(good.ok).toBe(true);
    w = transitionWorkOrder(w, "AWAITING_VERIFICATION", "sys", "run", ts(T0 + 3000));
    w = transitionWorkOrder(w, "VERIFICATION_IN_PROGRESS", "sys", "run", ts(T0 + 3000));
    const closed = closeWorkOrder(w, plan, [run("R1", plan.id, 1, "PASS", T0 + 3000)], review(), "sup", ts(T0 + 4000));
    expect(closed.state).toBe("CLOSED");
    expect(closed.locked).toBe(true);
    expect(closed.closure?.wording).toBe("Recovery checks passed within the tested operating conditions");
    expect(() => transitionWorkOrder(closed, "OPEN", "x", "edit", ts(T0 + 5000))).toThrow(WorkflowError);
  });

  it("rejects invalid transitions", () => {
    expect(() => transitionWorkOrder(wo(), "CLOSED", "x", "skip", ts(T0))).toThrow(WorkflowError);
  });
});

describe("inventory", () => {
  const state = { parts: structuredClone(SEED_INVENTORY), transactions: [] };
  it("rejects negative, zero, and fractional quantities for indivisible parts", () => {
    expect(() => applyInventory(state, { idempotencyKey: "a", kind: "CONSUME", partId: "PRT-PSW-05", quantity: 0, at: ts(T0) })).toThrow(WorkflowError);
    expect(() => applyInventory(state, { idempotencyKey: "b", kind: "CONSUME", partId: "PRT-PSW-05", quantity: -1, at: ts(T0) })).toThrow(WorkflowError);
    expect(() => applyInventory(state, { idempotencyKey: "c", kind: "CONSUME", partId: "PRT-PSW-05", quantity: 0.5, at: ts(T0) })).toThrow(WorkflowError);
  });
  it("never goes negative and applies atomically", () => {
    expect(() => applyInventory(state, { idempotencyKey: "d", kind: "CONSUME", partId: "PRT-BRG-6205", quantity: 2, at: ts(T0) })).toThrow(/only 1 on hand/);
    expect(state.parts.find((p) => p.id === "PRT-BRG-6205")!.onHand).toBe(1);
  });
  it("duplicate idempotency keys do not double-consume and the price is frozen at consumption", () => {
    const r1 = applyInventory(state, { idempotencyKey: "same", kind: "CONSUME", partId: "PRT-FILTER-CF20", quantity: 1, at: ts(T0) });
    const r2 = applyInventory(r1.state, { idempotencyKey: "same", kind: "CONSUME", partId: "PRT-FILTER-CF20", quantity: 1, at: ts(T0) });
    expect(r2.duplicate).toBe(true);
    expect(r2.state.parts.find((p) => p.id === "PRT-FILTER-CF20")!.onHand).toBe(5);
    expect(r1.transaction.unitPricePaise).toBe(paise(1150));
    // Catalogue price change afterwards does not rewrite the transaction.
    const changed = { ...r2.state, parts: r2.state.parts.map((p) => (p.id === "PRT-FILTER-CF20" ? { ...p, catalogPricePaise: paise(9999) } : p)) };
    expect(changed.transactions[0].unitPricePaise).toBe(paise(1150));
  });
  it("reservation cannot exceed availability", () => {
    expect(() => applyInventory(state, { idempotencyKey: "r1", kind: "RESERVE", partId: "PRT-PSW-05", quantity: 3, at: ts(T0) })).toThrow(/only 2 available/);
  });
});

describe("costs", () => {
  it("overlapping interruption intervals are not double counted", () => {
    expect(unionDurationMs([{ startMs: 0, endMs: 60_000 }, { startMs: 30_000, endMs: 90_000 }, { startMs: 200_000, endMs: 260_000 }])).toBe(150_000);
  });
  it("derives work cost from labor and parts and formats INR with Indian grouping", () => {
    const w: WorkOrder = { ...wo(), labor: [{ id: "l", who: "t", minutes: 30, ratePaisePerHour: paise(600), at: ts(T0), note: "" }], parts: [{ transactionId: "t", partId: "PRT-PSW-05", quantity: 1, unitPricePaise: paise(2400) }] };
    const c = workOrderCost(w);
    expect(c.laborPaise).toBe(paise(300));
    expect(c.totalPaise).toBe(paise(2700));
    expect(formatInr(paise(210000))).toBe("₹2,10,000");
    expect(formatInr(paise(30000))).toBe("₹30,000");
  });
  it("a single stopped cell with many alarms is counted once via interval union", () => {
    const incidents = [{ ...placeholder(), interruptions: [{ cellId: "CELL-A" as const, startMs: T0, endMs: T0 + 25 * 60_000 }, { cellId: "CELL-A" as const, startMs: T0 + 5 * 60_000, endMs: T0 + 20 * 60_000 }] }];
    const costs = cellCosts(incidents, [], SEED_COST_ASSUMPTIONS, [], T0 + 60 * 60_000);
    const a = costs.find((c) => c.cellId === "CELL-A")!;
    expect(a.downtimeMs).toBe(25 * 60_000);
    expect(a.interruptionEstimatePaise).toBe(paise(30000));
  });
});

function placeholder() {
  return { id: "INC", title: "", status: "OPEN" as const, openedAt: ts(T0), observedAssetIds: [], potentiallyAffectedAssetIds: [], affectedCellIds: ["CELL-A" as const], alarmIds: [], groupingRationale: "", workOrderIds: [], recoveryPlanIds: [], interruptions: [], safetyRelevant: false, repeatOf: [] };
}
