import type { CostAssumption, Incident, InventoryPart, RecoveryRun, TimeStamp, WorkOrder } from "@/lib/domain/types";
import { paise } from "@/lib/util";

/** Fictional historical fixtures. Everything here is labelled fixture: fictional. */

function wall(iso: string): TimeStamp {
  return { ms: Date.parse(iso), clock: "WALL", uncertaintyMs: 0 };
}

const FIXTURE_NOTE = "Seeded fictional historical record; not produced during the current evaluation.";

export const SEED_INVENTORY: InventoryPart[] = [
  { id: "PRT-COUPLING-12", name: "Header coupling 12 mm", unit: "ea", indivisible: true, onHand: 4, reserved: 0, minimumStock: 2, catalogPricePaise: paise(850) },
  { id: "PRT-PSW-05", name: "Clamp-proof pressure switch", unit: "ea", indivisible: true, onHand: 2, reserved: 0, minimumStock: 2, catalogPricePaise: paise(2400) },
  { id: "PRT-FILTER-CF20", name: "Coolant suction filter CF-20", unit: "ea", indivisible: true, onHand: 6, reserved: 0, minimumStock: 3, catalogPricePaise: paise(1150) },
  { id: "PRT-PROX-M12", name: "Proximity sensor M12", unit: "ea", indivisible: true, onHand: 5, reserved: 0, minimumStock: 2, catalogPricePaise: paise(1900) },
  { id: "PRT-BRG-6205", name: "Spindle bearing set 6205", unit: "ea", indivisible: true, onHand: 1, reserved: 0, minimumStock: 1, catalogPricePaise: paise(14500) },
  { id: "PRT-RTD-PT100", name: "RTD Pt100 probe", unit: "ea", indivisible: true, onHand: 3, reserved: 0, minimumStock: 1, catalogPricePaise: paise(1600) },
  { id: "PRT-COOLANT-20L", name: "Coolant concentrate", unit: "L", indivisible: false, onHand: 60, reserved: 0, minimumStock: 20, catalogPricePaise: paise(320) },
];

export const SEED_COST_ASSUMPTIONS: CostAssumption[] = [
  { id: "COST-CELL-A", cellId: "CELL-A", interruptionPaisePerMinute: paise(1200), laborPaisePerHour: paise(600), downtimeBasis: "CELL_MINUTES", budgetPaise: paise(250000), note: "Editable fictional assumptions, not customer results" },
  { id: "COST-CELL-B", cellId: "CELL-B", interruptionPaisePerMinute: paise(1100), laborPaisePerHour: paise(600), downtimeBasis: "CELL_MINUTES", budgetPaise: paise(200000), note: "Editable fictional assumptions, not customer results" },
];

function historicalWo(
  id: string,
  title: string,
  assetId: string,
  cellId: "CELL-A" | "CELL-B",
  created: string,
  closed: string,
  suspectedMechanism: string,
  plannedAction: string,
  workDone: string,
  laborMinutes: number,
  parts: Array<{ partId: string; quantity: number; unitPrice: number }>,
  testScope: WorkOrder["testScope"],
  faultFamily: WorkOrder["faultFamily"],
  runId: string,
): WorkOrder {
  return {
    id,
    assetId,
    cellId,
    title,
    state: "CLOSED",
    priority: "P2",
    assignee: "Technician R. (simulated)",
    evidenceRefs: [],
    suspectedMechanism,
    plannedAction,
    approvals: [{ reviewer: "Supervisor M. (simulated)", simulatedIdentity: true, decision: "APPROVED", reason: "Historical fixture approval", at: wall(created) }],
    workPerformed: [{ id: `${id}-WP1`, at: wall(closed), by: "Technician R. (simulated)", description: workDone }],
    labor: [{ id: `${id}-L1`, who: "Technician R. (simulated)", minutes: laborMinutes, ratePaisePerHour: paise(600), at: wall(closed), note: "Historical labor record" }],
    parts: parts.map((p, i) => ({ transactionId: `${id}-TX${i + 1}`, partId: p.partId, quantity: p.quantity, unitPricePaise: paise(p.unitPrice) })),
    runIds: [runId],
    review: { reviewer: "Supervisor M. (simulated)", simulatedIdentity: true, decision: "APPROVED", reason: "Closed on the test scope stated at the time", at: wall(closed) },
    closure: { at: wall(closed), runId, reviewer: "Supervisor M. (simulated)", wording: "Recovery checks passed within the tested operating conditions" },
    events: [],
    createdAt: wall(created),
    fixture: { fictional: true, note: FIXTURE_NOTE },
    testScope,
    faultFamily,
    locked: true,
  };
}

/** Three fictional prior work orders on the same SPN-01 mechanism, each with a narrower test scope. */
export const SEED_WORK_ORDERS: WorkOrder[] = [
  historicalWo(
    "WO-H-2026-014",
    "SPN-01 elevated current — bearing set replaced",
    "SPN-01",
    "CELL-A",
    "2026-03-11T09:00:00+05:30",
    "2026-03-12T16:30:00+05:30",
    "Mechanical load increase (bearing)",
    "Replace front bearing set",
    "Replaced bearing set 6205; spun up in MANUAL, no load.",
    240,
    [{ partId: "PRT-BRG-6205", quantity: 1, unitPrice: 13800 }],
    { tested: ["Startup at 1500 rpm, no load, 2 minutes"], notTested: ["PART-A cutting", "PART-B cutting", "Sustained production"], modes: ["MANUAL"] },
    "MECHANICAL_LOAD_INCREASE",
    "RUN-H-2026-014",
  ),
  historicalWo(
    "WO-H-2026-031",
    "SPN-01 vibration — coupling re-aligned",
    "SPN-01",
    "CELL-A",
    "2026-05-19T08:30:00+05:30",
    "2026-05-19T15:00:00+05:30",
    "Mechanical load increase (misalignment suspected)",
    "Re-align spindle coupling",
    "Re-aligned coupling; one PART-A cycle observed.",
    180,
    [],
    { tested: ["One PART-A cycle at 1500 rpm"], notTested: ["Five consecutive cycles", "PART-B cutting"], modes: ["AUTO PART-A (1 cycle)"] },
    "MECHANICAL_LOAD_INCREASE",
    "RUN-H-2026-031",
  ),
  historicalWo(
    "WO-H-2026-047",
    "SPN-01 current high — tool holder cleaned",
    "SPN-01",
    "CELL-A",
    "2026-07-02T10:00:00+05:30",
    "2026-07-02T13:20:00+05:30",
    "Mechanical load increase (tooling interface)",
    "Clean and re-seat tool holder",
    "Cleaned taper; idle run at 900 rpm looked normal.",
    90,
    [],
    { tested: ["Idle run at 900 rpm"], notTested: ["Approved 1500 rpm cutting context", "Heavy recipe"], modes: ["MANUAL 900 rpm"] },
    "MECHANICAL_LOAD_INCREASE",
    "RUN-H-2026-047",
  ),
  historicalWo(
    "WO-H-2026-052",
    "FIX-01 clamp delays — clamp-proof switch replaced",
    "FIX-01",
    "CELL-A",
    "2026-08-12T07:45:00+05:30",
    "2026-08-12T11:10:00+05:30",
    "Local fixture sensor",
    "Replace clamp-proof pressure switch",
    "Replaced switch; clamp proved once after restart. Header pressure not recorded.",
    120,
    [{ partId: "PRT-PSW-05", quantity: 1, unitPrice: 2300 }],
    { tested: ["Single clamp after restart"], notTested: ["Header pressure under demand", "Five handshake cycles", "Cell B clamp"], modes: ["MANUAL"] },
    "LOCAL_FIXTURE_SENSOR",
    "RUN-H-2026-052",
  ),
];

function historicalRun(id: string, woId: string, scope: string, note: string, at: string): RecoveryRun {
  return {
    id,
    planId: `RP-H-${woId}`,
    planVersion: 1,
    incidentId: `INC-H-${woId}`,
    knowledgeVersion: "plant-knowledge-0 (historical)",
    baselineVersion: "historical",
    outcome: "PASS",
    startedAt: wall(at),
    finishedAt: wall(at),
    evaluatedUntilMs: Date.parse(at),
    results: [],
    summary: `Historical PASS scoped to: ${scope}. ${note}`,
    contextObserved: {},
    completeCyclesObserved: 0,
    settlingRemainingSeconds: 0,
    reasonNotEstablished: [],
    workOrderId: woId,
    fixture: { fictional: true, note: FIXTURE_NOTE, testScope: scope },
    retainedObservationIds: [],
  };
}

export const SEED_RUNS: RecoveryRun[] = [
  historicalRun("RUN-H-2026-014", "WO-H-2026-014", "Startup at 1500 rpm, no load, 2 minutes", "Not evidence for sustained production.", "2026-03-12T16:00:00+05:30"),
  historicalRun("RUN-H-2026-031", "WO-H-2026-031", "One PART-A cycle at 1500 rpm", "Single cycle; no repeat coverage.", "2026-05-19T14:40:00+05:30"),
  historicalRun("RUN-H-2026-047", "WO-H-2026-047", "Idle run at 900 rpm", "Not the approved 1500 rpm context.", "2026-07-02T13:00:00+05:30"),
  historicalRun("RUN-H-2026-052", "WO-H-2026-052", "Single clamp after restart", "Header pressure not part of the test.", "2026-08-12T11:00:00+05:30"),
];

export const SEED_INCIDENTS: Incident[] = SEED_WORK_ORDERS.map((wo) => ({
  id: `INC-H-${wo.id}`,
  title: wo.title,
  status: "CLOSED",
  openedAt: wo.createdAt,
  closedAt: wo.closure?.at,
  observedAssetIds: [wo.assetId],
  potentiallyAffectedAssetIds: [],
  affectedCellIds: wo.cellId ? [wo.cellId] : [],
  alarmIds: [],
  groupingRationale: "Historical fixture; alarms not retained.",
  workOrderIds: [wo.id],
  recoveryPlanIds: [],
  fixture: { fictional: true, note: FIXTURE_NOTE },
  interruptions: [],
  safetyRelevant: false,
  repeatOf: [],
}));
