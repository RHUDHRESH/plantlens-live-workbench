import type { DependencyEdge, Incident, KnowledgeProposal, KnowledgeVersion, RecoveryCheck, SourceSpan } from "@/lib/domain/types";
import type { RecoveryTemplate } from "@/lib/fixtures/templates";

/**
 * Pure helpers shared by the topology graph, the list alternative and the asset page.
 * Nothing here reads the store; callers pass records in.
 */

export interface PendingEdgeProposal {
  proposal: KnowledgeProposal;
  edge: DependencyEdge;
}

/** Dependency-edge proposals that are still pending: not rejected, not yet published into the active version. */
export function pendingEdgeProposals(proposals: KnowledgeProposal[], active: KnowledgeVersion): PendingEdgeProposal[] {
  const activeIds = new Set(active.edges.map((e) => e.id));
  const out: PendingEdgeProposal[] = [];
  for (const p of proposals) {
    if (p.payload.kind !== "DEPENDENCY_EDGE") continue;
    if (p.state === "REJECTED") continue;
    if (p.changeSummary.some((c) => c.startsWith("Published in"))) continue;
    if (activeIds.has(p.payload.edge.id)) continue;
    out.push({ proposal: p, edge: p.payload.edge });
  }
  return out;
}

/** Edge ids on the top-ranked candidate path of an incident. */
export function focusEdgeIds(incident: Incident | undefined): Set<string> {
  return new Set(incident?.diagnosis?.candidates[0]?.edgeIds ?? []);
}

export function edgesForAsset(edges: DependencyEdge[], assetId: string): { inbound: DependencyEdge[]; outbound: DependencyEdge[] } {
  return { inbound: edges.filter((e) => e.to === assetId), outbound: edges.filter((e) => e.from === assetId) };
}

/** Distinct source spans cited by a set of edges, keyed by source id + line range. */
export function citedSpans(edges: DependencyEdge[]): Array<{ span: SourceSpan; edgeIds: string[] }> {
  const byKey = new Map<string, { span: SourceSpan; edgeIds: string[] }>();
  for (const e of edges) {
    for (const s of e.evidenceRefs) {
      const key = `${s.sourceId}:${s.startLine}-${s.endLine}${s.column ? `:${s.column}` : ""}`;
      const cur = byKey.get(key);
      if (cur) cur.edgeIds.push(e.id);
      else byKey.set(key, { span: s, edgeIds: [e.id] });
    }
  }
  return Array.from(byKey.values());
}

/** Short human line for an edge, e.g. "AIR-HDR-01 → FIX-01". */
export function edgeArrow(e: DependencyEdge): string {
  return `${e.from} → ${e.to}`;
}

/** Tags, assets and edges a recovery check refers to, by kind. */
export function checkReferences(c: RecoveryCheck): { tags: string[]; assets: string[]; edges: string[] } {
  switch (c.kind) {
    case "SOURCE_QUALITY":
      return { tags: c.tags, assets: [], edges: [] };
    case "MODE_REQUIRED":
    case "STATE_TRANSITION":
    case "COMPLETE_CYCLES":
      return { tags: [], assets: [c.assetId], edges: [] };
    case "NUMERIC_BAND":
    case "STABLE_WINDOW":
      return { tags: [c.tag], assets: [], edges: [] };
    case "EVENT_SEQUENCE":
      return { tags: c.events, assets: [], edges: [] };
    case "DOWNSTREAM_ACK":
      return { tags: [c.trigger, c.acknowledgement], assets: [], edges: [] };
    case "ALARM_ABSENCE":
      return { tags: [], assets: c.assetIds, edges: [] };
    case "DEPENDENCY_COVERAGE":
      return { tags: [], assets: [], edges: c.edgeIds };
  }
}

/** Ids of the checks in a template that reference the asset (its tags, itself, or one of its edges). */
export function templateChecksForAsset(template: RecoveryTemplate, assetId: string, assetEdgeIds: Set<string>): string[] {
  const prefix = `${assetId}.`;
  const out: string[] = [];
  for (const c of template.checks) {
    const r = checkReferences(c);
    if (r.tags.some((t) => t.startsWith(prefix)) || r.assets.includes(assetId) || r.edges.some((e) => assetEdgeIds.has(e))) out.push(c.id);
  }
  return out;
}
