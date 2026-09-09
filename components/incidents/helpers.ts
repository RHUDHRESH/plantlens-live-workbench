import type { Incident, RecoveryPlan, RecoveryRun, WorkOrder } from "@/lib/domain/types";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import { ASSET_BY_ID, TAG_BY_ID } from "@/lib/domain/plant";

/** Incident-room helpers shared by the list, the room, and the recurrence view. */

export const INCIDENT_TABS = ["summary", "timeline", "evidence", "path", "recovery", "history"] as const;
export type IncidentTab = (typeof INCIDENT_TABS)[number];

export function tabFromParam(p: string | null | undefined): IncidentTab {
  return (INCIDENT_TABS as readonly string[]).includes(p ?? "") ? (p as IncidentTab) : "summary";
}

export function findIncident(snapshot: RuntimeSnapshot | null, historical: Incident[], id: string): Incident | undefined {
  return snapshot?.incidents.find((i) => i.id === id) ?? historical.find((i) => i.id === id);
}

/** Latest version per plan id. */
export function latestPlans(plans: RecoveryPlan[]): RecoveryPlan[] {
  const byId = new Map<string, RecoveryPlan>();
  for (const p of plans) {
    const cur = byId.get(p.id);
    if (!cur || p.version > cur.version) byId.set(p.id, p);
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function plansForIncident(plans: RecoveryPlan[], incidentId: string): RecoveryPlan[] {
  return latestPlans(plans.filter((p) => p.incidentId === incidentId));
}

export function runsForPlans(runs: RecoveryRun[], planIds: string[]): RecoveryRun[] {
  return runs.filter((r) => planIds.includes(r.planId)).sort((a, b) => b.startedAt.ms - a.startedAt.ms);
}

export function assetName(id: string): string {
  return ASSET_BY_ID[id]?.name ?? id;
}

export function tagLabel(tagId: string): string {
  const t = TAG_BY_ID[tagId];
  return t ? `${t.assetId}.${t.name}` : tagId;
}

export function tagUnit(tagId: string): string | undefined {
  return TAG_BY_ID[tagId]?.unit;
}

/** Edge ids referenced by a plan's checks (directly or through the requirement that justifies them). */
export function edgeIdsCoveredByPlan(plan: RecoveryPlan, requirements: Array<{ id: string; coversEdgeIds: string[] }>): string[] {
  const out = new Set<string>();
  for (const c of plan.checks) {
    if (c.kind === "DEPENDENCY_COVERAGE") for (const e of c.edgeIds) out.add(e);
    const req = requirements.find((r) => r.id === c.requirementRef);
    if (req) for (const e of req.coversEdgeIds) out.add(e);
  }
  return Array.from(out);
}

/** Tag names (e.g. "header_pressure") mentioned in a free-text summary. */
export function tagNamesMentioned(text: string, tagIds: string[]): string[] {
  const lower = text.toLowerCase();
  const names = new Set<string>();
  for (const id of tagIds) {
    const t = TAG_BY_ID[id];
    if (!t) continue;
    const plain = t.name.toLowerCase();
    const spaced = plain.replace(/_/g, " ");
    if (lower.includes(plain) || lower.includes(spaced)) names.add(t.name);
  }
  return Array.from(names);
}

export function isHistoricalWorkOrder(wo: WorkOrder): boolean {
  return !!wo.fixture;
}

/** ±uncertainty rendered as words, never as a bare number without unit. */
export function formatUncertainty(ms: number | undefined): string {
  if (!ms) return "±0 s (source claimed exactness)";
  return ms >= 1000 ? `±${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s` : `±${ms} ms`;
}
