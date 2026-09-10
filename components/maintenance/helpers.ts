import type { AuditEvent, WorkOrder, WorkOrderState } from "@/lib/domain/types";
import { ASSET_BY_ID } from "@/lib/domain/plant";

/** Maintenance-area helpers: state machine display, record labels, event merging. */

export const WO_MAIN_PATH: WorkOrderState[] = ["OPEN", "INVESTIGATING", "INTERVENTION_APPROVED", "WORK_RECORDED", "AWAITING_VERIFICATION", "VERIFICATION_IN_PROGRESS", "VERIFIED", "CLOSED"];
export const WO_BRANCHES: WorkOrderState[] = ["VERIFICATION_FAILED", "REVIEW_REQUIRED"];
export const WO_STATES: WorkOrderState[] = [...WO_MAIN_PATH, ...WO_BRANCHES];

export const WO_STATE_HINT: Record<WorkOrderState, string> = {
  OPEN: "Created; nothing has been investigated yet.",
  INVESTIGATING: "Evidence is being inspected; no intervention approved.",
  INTERVENTION_APPROVED: "A supervisor (simulated) approved the planned intervention; work may be recorded.",
  WORK_RECORDED: "Work has been recorded. A repair is an action, not a recovery result.",
  AWAITING_VERIFICATION: "Waiting for a recovery run against an approved plan.",
  VERIFICATION_IN_PROGRESS: "A recovery run is collecting evidence.",
  VERIFIED: "A PASS run and a separate reviewer are recorded; closure is possible.",
  CLOSED: "Closed with verified closure. The record is locked.",
  VERIFICATION_FAILED: "The latest run did not pass; further work or review is required.",
  REVIEW_REQUIRED: "Human review requested before proceeding.",
};

/** States in which recordWork() accepts a record (mirrors the store's guard). */
export const WORK_RECORDABLE_STATES: WorkOrderState[] = ["INTERVENTION_APPROVED", "WORK_RECORDED", "VERIFICATION_FAILED", "AWAITING_VERIFICATION"];

export function isLocked(wo: WorkOrder): boolean {
  return !!wo.locked || wo.state === "CLOSED";
}

export function assetName(id: string): string {
  return ASSET_BY_ID[id]?.name ?? id;
}

/** Work-order events plus workspace audit entries about it, newest first. */
export function mergedEvents(wo: WorkOrder, audit: AuditEvent[]): AuditEvent[] {
  const seen = new Set<string>();
  const out: AuditEvent[] = [];
  for (const e of [...wo.events, ...audit.filter((a) => a.subjectId === wo.id)]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => b.at.ms - a.at.ms);
}
