import type { AuditEvent, CellId, CostAssumption, Incident, InventoryPart, InventoryTransaction, Paise, RecoveryPlan, RecoveryRun, ReviewRecord, TimeStamp, WorkOrder, WorkOrderState } from "@/lib/domain/types";
import { laborCostPaise, stableId, unionDurationMs } from "@/lib/util";

/**
 * Work-order state machine, inventory ledger, and cost derivation. All money is in paise.
 * Closed records are locked; corrections produce new events, never silent edits.
 */

export class WorkflowError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

const TRANSITIONS: Record<WorkOrderState, WorkOrderState[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["INTERVENTION_APPROVED", "REVIEW_REQUIRED"],
  INTERVENTION_APPROVED: ["WORK_RECORDED"],
  WORK_RECORDED: ["AWAITING_VERIFICATION"],
  AWAITING_VERIFICATION: ["VERIFICATION_IN_PROGRESS"],
  VERIFICATION_IN_PROGRESS: ["VERIFIED", "VERIFICATION_FAILED", "AWAITING_VERIFICATION"],
  VERIFICATION_FAILED: ["INVESTIGATING", "REVIEW_REQUIRED", "INTERVENTION_APPROVED"],
  REVIEW_REQUIRED: ["INVESTIGATING", "INTERVENTION_APPROVED"],
  VERIFIED: ["CLOSED"],
  CLOSED: [],
};

export function canTransition(from: WorkOrderState, to: WorkOrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function audit(actor: string, kind: string, subjectId: string, detail: string, at: TimeStamp): AuditEvent {
  return { id: stableId("AUD", kind, subjectId, at.ms, Math.floor(Math.random() * 1e6)), at, actor, simulatedIdentity: true, kind, subjectId, detail };
}

export function assertEditable(wo: WorkOrder): void {
  if (wo.locked || wo.state === "CLOSED") throw new WorkflowError(`Work order ${wo.id} is closed and cannot be edited. Record a follow-up work order instead.`, "LOCKED");
}

export function transitionWorkOrder(wo: WorkOrder, to: WorkOrderState, actor: string, reason: string, at: TimeStamp): WorkOrder {
  assertEditable(wo);
  if (!canTransition(wo.state, to)) throw new WorkflowError(`Cannot move ${wo.id} from ${wo.state} to ${to}.`, "INVALID_TRANSITION");
  return { ...wo, state: to, events: [...wo.events, audit(actor, "WO_STATE", wo.id, `${wo.state} → ${to}: ${reason}`, at)] };
}

export interface ClosureCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * Verified closure requires: an APPROVED plan at the run's version, a current PASS run
 * started after the last recorded work, no later intervention/plan change, and a reviewer
 * separate from the repairer.
 */
export function checkVerifiedClosure(wo: WorkOrder, plan: RecoveryPlan | undefined, runs: RecoveryRun[], review: ReviewRecord | undefined): ClosureCheck {
  const reasons: string[] = [];
  if (!plan) reasons.push("No recovery plan is linked to this work order.");
  const woRuns = runs.filter((r) => wo.runIds.includes(r.id) && r.planId === plan?.id);
  const latest = woRuns.slice().sort((a, b) => b.startedAt.ms - a.startedAt.ms)[0];
  if (!latest) reasons.push("No recovery run has been executed for the linked plan.");
  else {
    if (latest.outcome !== "PASS") reasons.push(`Latest run ${latest.id} is ${latest.outcome}, not PASS.`);
    if (plan && latest.planVersion !== plan.version) reasons.push(`Run ${latest.id} evaluated plan version ${latest.planVersion}; the current plan is version ${plan.version}.`);
    if (plan && plan.status !== "APPROVED") reasons.push(`Plan ${plan.id} v${plan.version} is ${plan.status}, not APPROVED.`);
    const lastWork = wo.workPerformed.reduce((m, w) => Math.max(m, w.at.ms), 0);
    if (lastWork > latest.startedAt.ms) reasons.push("Work was recorded after the passing run started; the run is stale and cannot authorise closure.");
    if (latest.staleReason) reasons.push(`Run is stale: ${latest.staleReason}`);
  }
  if (!review) reasons.push("A separate reviewer record is required.");
  else {
    const repairers = new Set([...wo.workPerformed.map((w) => w.by), ...wo.labor.map((l) => l.who)]);
    if (repairers.has(review.reviewer)) reasons.push("Reviewer must be a different (simulated) identity from the repairer.");
    if (review.decision !== "APPROVED") reasons.push(`Reviewer decision is ${review.decision}.`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function closeWorkOrder(wo: WorkOrder, plan: RecoveryPlan | undefined, runs: RecoveryRun[], review: ReviewRecord, actor: string, at: TimeStamp): WorkOrder {
  assertEditable(wo);
  const check = checkVerifiedClosure(wo, plan, runs, review);
  if (!check.ok) throw new WorkflowError(check.reasons.join(" "), "CLOSURE_BLOCKED");
  const latest = runs.filter((r) => wo.runIds.includes(r.id)).sort((a, b) => b.startedAt.ms - a.startedAt.ms)[0];
  let next = wo.state === "VERIFIED" ? wo : transitionWorkOrder(wo, "VERIFIED", actor, "Passing run and separate review recorded", at);
  next = transitionWorkOrder(next, "CLOSED", actor, "Verified closure", at);
  return {
    ...next,
    review,
    closure: { at, runId: latest.id, reviewer: review.reviewer, wording: "Recovery checks passed within the tested operating conditions" },
    locked: true,
  };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface InventoryState {
  parts: InventoryPart[];
  transactions: InventoryTransaction[];
}

function validateQuantity(part: InventoryPart, quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new WorkflowError(`Quantity must be positive (got ${quantity}).`, "INVALID_QUANTITY");
  if (part.indivisible && !Number.isInteger(quantity)) throw new WorkflowError(`${part.name} is indivisible; quantity must be a whole number.`, "FRACTIONAL_QUANTITY");
}

/** Atomic apply: returns a new state or throws; never partially mutates. Idempotent by key. */
export function applyInventory(state: InventoryState, tx: Omit<InventoryTransaction, "id" | "unitPricePaise"> & { unitPricePaise?: Paise }): { state: InventoryState; transaction: InventoryTransaction; duplicate: boolean } {
  const existing = state.transactions.find((t) => t.idempotencyKey === tx.idempotencyKey);
  if (existing) return { state, transaction: existing, duplicate: true };
  const part = state.parts.find((p) => p.id === tx.partId);
  if (!part) throw new WorkflowError(`Unknown part ${tx.partId}.`, "UNKNOWN_PART");
  validateQuantity(part, tx.quantity);
  const next = { ...part };
  switch (tx.kind) {
    case "RESERVE":
      if (next.onHand - next.reserved < tx.quantity) throw new WorkflowError(`Cannot reserve ${tx.quantity} × ${part.name}: only ${next.onHand - next.reserved} available.`, "INSUFFICIENT_STOCK");
      next.reserved += tx.quantity;
      break;
    case "RELEASE":
      if (next.reserved < tx.quantity) throw new WorkflowError(`Cannot release ${tx.quantity}; only ${next.reserved} reserved.`, "INVALID_RELEASE");
      next.reserved -= tx.quantity;
      break;
    case "CONSUME": {
      // Consumption uses reservation first, then free stock; never negative.
      if (next.onHand < tx.quantity) throw new WorkflowError(`Cannot consume ${tx.quantity} × ${part.name}: only ${next.onHand} on hand.`, "INSUFFICIENT_STOCK");
      next.onHand -= tx.quantity;
      next.reserved = Math.max(0, next.reserved - tx.quantity);
      break;
    }
    case "RETURN":
    case "RECEIVE":
      next.onHand += tx.quantity;
      break;
  }
  const transaction: InventoryTransaction = {
    id: stableId("TX", tx.kind, tx.partId, tx.at.ms, state.transactions.length),
    idempotencyKey: tx.idempotencyKey,
    kind: tx.kind,
    partId: tx.partId,
    quantity: tx.quantity,
    unitPricePaise: tx.unitPricePaise ?? part.catalogPricePaise, // price at consumption time is frozen here
    workOrderId: tx.workOrderId,
    at: tx.at,
  };
  return {
    state: { parts: state.parts.map((p) => (p.id === part.id ? next : p)), transactions: [...state.transactions, transaction] },
    transaction,
    duplicate: false,
  };
}

export function lowStock(parts: InventoryPart[]): InventoryPart[] {
  return parts.filter((p) => p.onHand - p.reserved <= p.minimumStock);
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

export interface CellCost {
  cellId: CellId;
  downtimeMs: number;
  basis: "CELL_MINUTES";
  interruptionEstimatePaise: Paise;
  laborPaise: Paise;
  partsPaise: Paise;
  maintenancePaise: Paise;
  committedPaise: Paise;
  budgetPaise: Paise;
}

export function workOrderCost(wo: WorkOrder): { laborPaise: Paise; partsPaise: Paise; totalPaise: Paise } {
  const laborPaise = wo.labor.reduce((s, l) => s + laborCostPaise(l.minutes, l.ratePaisePerHour), 0);
  const partsPaise = wo.parts.reduce((s, p) => s + p.quantity * p.unitPricePaise, 0);
  return { laborPaise, partsPaise, totalPaise: laborPaise + partsPaise };
}

/** Downtime per cell = union of interruption intervals; child spindle and parent CNC never double count. */
export function cellCosts(incidents: Incident[], workOrders: WorkOrder[], assumptions: CostAssumption[], parts: InventoryPart[], nowMs: number): CellCost[] {
  return assumptions.map((a) => {
    const intervals = incidents.flatMap((i) => i.interruptions.filter((x) => x.cellId === a.cellId).map((x) => ({ startMs: x.startMs, endMs: x.endMs ?? nowMs })));
    const downtimeMs = unionDurationMs(intervals);
    const minutes = downtimeMs / 60_000;
    const interruptionEstimatePaise = Math.round(minutes * a.interruptionPaisePerMinute);
    const wos = workOrders.filter((w) => w.cellId === a.cellId && !w.fixture);
    const labor = wos.reduce((s, w) => s + workOrderCost(w).laborPaise, 0);
    const partsCost = wos.reduce((s, w) => s + workOrderCost(w).partsPaise, 0);
    const committed = parts.reduce((s, p) => s + p.reserved * p.catalogPricePaise, 0);
    return {
      cellId: a.cellId,
      downtimeMs,
      basis: "CELL_MINUTES",
      interruptionEstimatePaise,
      laborPaise: labor,
      partsPaise: partsCost,
      maintenancePaise: labor + partsCost,
      committedPaise: a.cellId === "CELL-A" ? committed : 0,
      budgetPaise: a.budgetPaise,
    };
  });
}

export function whatIfDifference(baseDowntimeMs: number, scenarioDowntimeMs: number, ratePaisePerMinute: Paise): { differencePaise: Paise; assumption: string } {
  const diffMin = (baseDowntimeMs - scenarioDowntimeMs) / 60_000;
  return { differencePaise: Math.round(diffMin * ratePaisePerMinute), assumption: "Scenario difference under the stated interruption rate; not verified ROI." };
}
