import type { DependencyEdge, KnowledgeProposal, ProposalKind, ProposalState, RecoveryPlan, RelationType, SourceDocument, SourceSpan } from "@/lib/domain/types";
import { ANCHORED_DOCS } from "@/lib/fixtures/documents";

/**
 * Pure helpers shared by the knowledge pages. No store access, no side effects.
 */

export const RELATION_TYPES: RelationType[] = ["ELECTRICAL_SUPPLY", "PNEUMATIC_PREREQUISITE", "COOLING", "THERMAL_SUPPLY", "MATERIAL_FLOW", "HANDSHAKE", "COMPONENT_OF", "REVIEWED_NO_DEPENDENCY"];

export const RELATION_INITIALS: Record<RelationType, string> = {
  ELECTRICAL_SUPPLY: "EL",
  PNEUMATIC_PREREQUISITE: "PN",
  COOLING: "CL",
  THERMAL_SUPPLY: "TH",
  MATERIAL_FLOW: "MF",
  HANDSHAKE: "HS",
  COMPONENT_OF: "CO",
  REVIEWED_NO_DEPENDENCY: "—",
};

export function relationTitle(r: string): string {
  return r.replace(/_/g, " ").toLowerCase();
}

export const PROPOSAL_KINDS: ProposalKind[] = ["ALIAS_MERGE", "DEPENDENCY_EDGE", "REQUIREMENT", "SOURCE_CONFLICT", "UNCITED_DRAFT", "UNTRUSTED_INSTRUCTION", "MISSING_CHANNEL", "UNMATCHED_TAG"];

/** Display order for the grouped proposal list: work first, then terminal states. */
export const PROPOSAL_STATE_ORDER: ProposalState[] = ["NEEDS_REVIEW", "NEEDS_MAPPING", "PROPOSAL_READY", "EVIDENCE_REQUESTED", "DEFERRED", "APPROVED", "FAILED", "REJECTED", "QUEUED", "PARSING"];

export function kindLabel(k: ProposalKind): string {
  return k.replace(/_/g, " ").toLowerCase();
}

/**
 * Resolve a source id to an imported document. Fixture ids such as SRC-NOTE-01 (used by
 * seeded knowledge and guided deep links) are matched by file name to the imported copy;
 * the result says when that alias was used so the UI can label it.
 */
export function resolveSource(sources: SourceDocument[], id: string | undefined): { doc?: SourceDocument; aliased: boolean } {
  if (!id) return { aliased: false };
  const exact = sources.find((s) => s.id === id);
  if (exact) return { doc: exact, aliased: false };
  const fixture = ANCHORED_DOCS.find((d) => d.id === id);
  if (fixture) {
    const byName = sources.find((s) => s.fileName === fixture.fileName);
    if (byName) return { doc: byName, aliased: true };
  }
  return { aliased: false };
}

export interface CitedLine {
  n: number;
  text: string;
}

/** Cited lines for a span, clipped to the document; empty when the document is missing. */
export function spanLines(sources: SourceDocument[], span: SourceSpan, maxLines = 12): { doc?: SourceDocument; aliased: boolean; lines: CitedLine[]; truncated: boolean; outOfRange: boolean } {
  const { doc, aliased } = resolveSource(sources, span.sourceId);
  if (!doc) return { doc, aliased, lines: [], truncated: false, outOfRange: false };
  const start = Math.max(1, span.startLine);
  const end = Math.min(doc.lines.length, span.endLine);
  const outOfRange = span.startLine < 1 || span.endLine > doc.lines.length || span.startLine > span.endLine;
  const lines: CitedLine[] = [];
  for (let n = start; n <= end && lines.length < maxLines; n++) lines.push({ n, text: doc.lines[n - 1] ?? "" });
  return { doc, aliased, lines, truncated: end - start + 1 > maxLines, outOfRange };
}

export function viewerHref(span: SourceSpan): string {
  return `/knowledge/sources?doc=${encodeURIComponent(span.sourceId)}&line=${span.startLine}`;
}

export function isPublishedProposal(p: KnowledgeProposal): boolean {
  return p.changeSummary.some((c) => c.startsWith("Published in"));
}

export interface PendingEdge {
  edge: DependencyEdge;
  proposalId: string;
  state: ProposalState;
  uncited: boolean;
}

/** Edges proposed but not yet published (or rejected); powers the dotted matrix cells. */
export function pendingEdges(proposals: KnowledgeProposal[]): PendingEdge[] {
  const out: PendingEdge[] = [];
  for (const p of proposals) {
    if (p.state === "REJECTED" || isPublishedProposal(p)) continue;
    if (p.payload.kind === "DEPENDENCY_EDGE" || p.payload.kind === "UNCITED_DRAFT") out.push({ edge: p.payload.edge, proposalId: p.id, state: p.state, uncited: p.payload.kind === "UNCITED_DRAFT" });
  }
  return out;
}

/** Record ids a proposal will change when published (mirrors publishVersion). */
export function proposalChangeIds(p: KnowledgeProposal): string[] {
  switch (p.payload.kind) {
    case "DEPENDENCY_EDGE":
      return [p.payload.edge.relation === "REVIEWED_NO_DEPENDENCY" ? `${p.payload.edge.from}->${p.payload.edge.to}` : p.payload.edge.id];
    case "REQUIREMENT":
      return [p.payload.requirement.id];
    case "ALIAS_MERGE":
      return [p.payload.mapping.id];
    case "SOURCE_CONFLICT":
      return p.payload.resolution ? [...p.payload.affectedRequirementIds, ...p.payload.affectedEdgeIds] : [];
    default:
      return [];
  }
}

/** Requirement and edge ids a plan's checks reference (mirrors invalidateForKnowledgeChange). */
export function planReferenceIds(plan: RecoveryPlan): Set<string> {
  const refs = new Set<string>();
  for (const c of plan.checks) {
    refs.add(c.requirementRef);
    if (c.kind === "DEPENDENCY_COVERAGE") c.edgeIds.forEach((e) => refs.add(e));
  }
  return refs;
}

/** Latest version of every plan id. */
export function latestPlans(plans: RecoveryPlan[]): RecoveryPlan[] {
  const byId = new Map<string, RecoveryPlan>();
  for (const p of plans) {
    const cur = byId.get(p.id);
    if (!cur || p.version > cur.version) byId.set(p.id, p);
  }
  return Array.from(byId.values());
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
