import type { DependencyEdge, KnowledgeProposal, KnowledgeVersion, RecoveryRequirement, ReviewRecord, TagMapping, TimeStamp } from "@/lib/domain/types";

/**
 * Knowledge versioning. Published versions are immutable: publishing creates a new
 * version from the current one plus approved proposals, and marks the parent SUPERSEDED.
 */

export interface PublishResult {
  next: KnowledgeVersion;
  superseded: KnowledgeVersion;
  changedIds: string[];
}

export function reviewProposal(p: KnowledgeProposal, review: ReviewRecord, edits?: { edge?: Partial<DependencyEdge>; resolution?: { chosen: number; reason: string } }): KnowledgeProposal {
  const next: KnowledgeProposal = structuredClone(p);
  next.review = review;
  if (edits?.edge && (next.payload.kind === "DEPENDENCY_EDGE" || next.payload.kind === "UNCITED_DRAFT")) {
    next.payload.edge = { ...next.payload.edge, ...edits.edge };
    next.changeSummary.push(`Edited: ${Object.keys(edits.edge).join(", ")}`);
  }
  if (edits?.resolution && next.payload.kind === "SOURCE_CONFLICT") {
    next.payload.resolution = edits.resolution;
    next.changeSummary.push(`Resolved: option ${edits.resolution.chosen + 1} — ${edits.resolution.reason}`);
  }
  switch (review.decision) {
    case "APPROVED":
      if (!next.validation.ok && next.kind !== "SOURCE_CONFLICT" && next.kind !== "ALIAS_MERGE") throw new Error(`Cannot approve ${p.id}: validation errors — ${next.validation.errors.join("; ")}`);
      if (next.kind === "UNCITED_DRAFT") throw new Error(`Cannot approve ${p.id}: an uncited draft cannot be published without evidence.`);
      if (next.kind === "UNTRUSTED_INSTRUCTION") throw new Error(`Cannot approve ${p.id}: untrusted instruction text is never a workflow action.`);
      next.state = "APPROVED";
      break;
    case "REJECTED":
      next.state = "REJECTED";
      break;
    case "DEFERRED":
      next.state = "DEFERRED";
      break;
    case "EVIDENCE_REQUESTED":
      next.state = "EVIDENCE_REQUESTED";
      break;
    case "EDITED":
      next.state = "NEEDS_REVIEW";
      break;
  }
  return next;
}

export function publishVersion(current: KnowledgeVersion, approved: KnowledgeProposal[], reviewer: string, reason: string, now: TimeStamp): PublishResult {
  const number = current.number + 1;
  const id = `plant-knowledge-${number}`;
  const edges: DependencyEdge[] = structuredClone(current.edges).map((e) => ({ ...e }));
  const requirements: RecoveryRequirement[] = structuredClone(current.requirements);
  const mappings: TagMapping[] = structuredClone(current.mappings);
  const reviewedNoDependency = current.reviewedNoDependency.slice();
  const changedIds: string[] = [];
  const changeLog: KnowledgeVersion["changeLog"] = [];
  for (const p of approved) {
    if (p.state !== "APPROVED") continue;
    const reviewerName = p.review?.reviewer ?? reviewer;
    const why = p.review?.reason ?? reason;
    switch (p.payload.kind) {
      case "DEPENDENCY_EDGE": {
        const e = p.payload.edge;
        if (e.relation === "REVIEWED_NO_DEPENDENCY") {
          const key = `${e.from}->${e.to}`;
          if (!reviewedNoDependency.includes(key)) reviewedNoDependency.push(key);
          changedIds.push(key);
        } else {
          const idx = edges.findIndex((x) => x.id === e.id);
          const published = { ...e, reviewStatus: "PUBLISHED" as const, knowledgeVersion: id };
          if (idx >= 0) edges[idx] = published;
          else edges.push(published);
          changedIds.push(e.id);
        }
        changeLog.push({ proposalId: p.id, summary: `Published ${e.id}: ${e.summary}`, reviewer: reviewerName, reason: why });
        break;
      }
      case "REQUIREMENT": {
        const r = p.payload.requirement;
        const idx = requirements.findIndex((x) => x.id === r.id);
        const published = { ...r, reviewStatus: "PUBLISHED" as const, knowledgeVersion: id };
        if (idx >= 0) requirements[idx] = published;
        else requirements.push(published);
        changedIds.push(r.id);
        changeLog.push({ proposalId: p.id, summary: `Published requirement ${r.id}`, reviewer: reviewerName, reason: why });
        break;
      }
      case "ALIAS_MERGE": {
        const m = { ...p.payload.mapping, status: "APPROVED" as const, reviewer: p.review };
        const idx = mappings.findIndex((x) => x.alias === m.alias);
        if (idx >= 0) mappings[idx] = m;
        else mappings.push(m);
        changedIds.push(m.id);
        changeLog.push({ proposalId: p.id, summary: `Mapping ${m.alias} → ${m.assetId}`, reviewer: reviewerName, reason: why });
        break;
      }
      case "SOURCE_CONFLICT": {
        const res = p.payload.resolution;
        if (res) {
          const chosen = p.payload.options[res.chosen];
          const value = Number(chosen.value.split(" ")[0]);
          for (const rid of p.payload.affectedRequirementIds) {
            const r = requirements.find((x) => x.id === rid);
            if (r && r.predicate && Number.isFinite(value)) {
              r.predicate = { ...r.predicate, value };
              if (r.band) r.band = { ...r.band, min: value };
              r.limitations = [...r.limitations.filter((l) => !l.startsWith("Conflict resolved")), `Conflict resolved in ${id}: ${res.reason}`];
              r.knowledgeVersion = id;
              changedIds.push(rid);
            }
          }
          for (const eid of p.payload.affectedEdgeIds) {
            const e = edges.find((x) => x.id === eid);
            if (e?.predicate && Number.isFinite(value)) {
              e.predicate = { ...e.predicate, value };
              e.limitations = e.limitations.filter((l) => !l.includes("conflict recorded"));
              changedIds.push(eid);
            }
          }
          changeLog.push({ proposalId: p.id, summary: `Conflict resolved: ${p.payload.subject} = ${chosen.value}`, reviewer: reviewerName, reason: res.reason });
        }
        break;
      }
      case "MISSING_CHANNEL": {
        changeLog.push({ proposalId: p.id, summary: `Recorded missing channel ${p.payload.assetId}.${p.payload.tagName}`, reviewer: reviewerName, reason: why });
        break;
      }
      default:
        break;
    }
  }
  const next: KnowledgeVersion = {
    id,
    number,
    status: "PUBLISHED",
    createdAt: now,
    publishedAt: now,
    parentId: current.id,
    edges,
    requirements,
    mappings,
    reviewedNoDependency,
    changeLog,
    reviewer,
    publishReason: reason,
  };
  const superseded: KnowledgeVersion = { ...current, status: "SUPERSEDED" };
  return { next, superseded, changedIds: Array.from(new Set(changedIds)) };
}

export interface VersionDiff {
  addedEdges: DependencyEdge[];
  removedEdges: DependencyEdge[];
  changedEdges: Array<{ before: DependencyEdge; after: DependencyEdge }>;
  addedRequirements: RecoveryRequirement[];
  changedRequirements: Array<{ before: RecoveryRequirement; after: RecoveryRequirement }>;
  addedMappings: TagMapping[];
  changedNoDependency: string[];
}

export function diffVersions(a: KnowledgeVersion, b: KnowledgeVersion): VersionDiff {
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const ea = byId(a.edges);
  const eb = byId(b.edges);
  const ra = byId(a.requirements);
  const rb = byId(b.requirements);
  const ma = new Set(a.mappings.map((m) => m.alias));
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  return {
    addedEdges: b.edges.filter((e) => !ea.has(e.id)),
    removedEdges: a.edges.filter((e) => !eb.has(e.id)),
    changedEdges: b.edges.filter((e) => ea.has(e.id) && !same({ ...ea.get(e.id), knowledgeVersion: "", reviewStatus: "" }, { ...e, knowledgeVersion: "", reviewStatus: "" })).map((e) => ({ before: ea.get(e.id)!, after: e })),
    addedRequirements: b.requirements.filter((r) => !ra.has(r.id)),
    changedRequirements: b.requirements.filter((r) => ra.has(r.id) && !same({ ...ra.get(r.id), knowledgeVersion: "" }, { ...r, knowledgeVersion: "" })).map((r) => ({ before: ra.get(r.id)!, after: r })),
    addedMappings: b.mappings.filter((m) => !ma.has(m.alias)),
    changedNoDependency: b.reviewedNoDependency.filter((k) => !a.reviewedNoDependency.includes(k)),
  };
}

/** Matrix D view built from the same records that power the graph and table. */
export function dependencyMatrix(version: KnowledgeVersion, assetIds: string[], pending: DependencyEdge[] = []) {
  const cells: Record<string, { edges: DependencyEdge[]; pending: DependencyEdge[]; noDependency: boolean }> = {};
  for (const from of assetIds) for (const to of assetIds) cells[`${from}|${to}`] = { edges: [], pending: [], noDependency: version.reviewedNoDependency.includes(`${from}->${to}`) };
  for (const e of version.edges) cells[`${e.from}|${e.to}`]?.edges.push(e);
  for (const e of pending) cells[`${e.from}|${e.to}`]?.pending.push(e);
  return cells;
}
