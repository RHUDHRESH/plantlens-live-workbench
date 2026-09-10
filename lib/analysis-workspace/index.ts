import { createCadDocument } from "@/lib/cad/document";
import type { CadAsset, CadDocument } from "@/lib/cad/types";
import type { EngineeringBinding } from "@/lib/engineering";

export type RelationshipKind = "DAG" | "LOOP";
export type RelationshipSign = 1 | -1;
export interface AnalysisRelationship {
  id: string;
  fromAssetId: string;
  toAssetId: string;
  label: string;
  kind: RelationshipKind;
  sign: RelationshipSign;
  note: string;
}
export interface AnalysisDocument {
  schemaVersion: 1;
  id: string;
  revision: number;
  relationships: AnalysisRelationship[];
}
export type CoverageStatus = "MAPPED" | "UNVERIFIED" | "MISSING";
export interface CoverageRow {
  assetId: string;
  assetName: string;
  bindingCount: number;
  channels: string[];
  status: CoverageStatus;
  detail: string;
}

export const ANALYSIS_STORAGE_KEY = "plantlens.analysis-workspace.v1";
export const EMPTY_ANALYSIS_DOCUMENT: AnalysisDocument = {
  schemaVersion: 1,
  id: "PL-ANALYSIS-001",
  revision: 0,
  relationships: [],
};

export function createAnalysisDocument(): AnalysisDocument {
  return structuredClone(EMPTY_ANALYSIS_DOCUMENT);
}

/** Returns the first directed cycle in DAG relationships, or null when acyclic. */
export function findDagCycle(
  relationships: readonly AnalysisRelationship[],
): string[] | null {
  const edges = relationships.filter((r) => r.kind === "DAG");
  const graph = new Map<string, string[]>();
  for (const edge of edges)
    graph.set(edge.fromAssetId, [
      ...(graph.get(edge.fromAssetId) ?? []),
      edge.toAssetId,
    ]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  function visit(node: string): string[] | null {
    if (visiting.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

export function validateRelationship(
  relationship: AnalysisRelationship,
  assets: readonly CadAsset[],
  existing: readonly AnalysisRelationship[],
): string[] {
  const errors: string[] = [];
  if (!isRelationship(relationship)) return ["Relationship fields exceed supported bounds or are invalid."];
  if (existing.length >= 128) errors.push("The analysis document supports at most 128 relationships.");
  if (existing.some(r => r.id === relationship.id || (r.kind === relationship.kind && r.fromAssetId === relationship.fromAssetId && r.toAssetId === relationship.toAssetId))) errors.push("This relationship already exists.");
  if (
    !assets.some((a) => a.id === relationship.fromAssetId) ||
    !assets.some((a) => a.id === relationship.toAssetId)
  )
    errors.push("Both endpoints must be actual CAD assets.");
  if (relationship.fromAssetId === relationship.toAssetId)
    errors.push("A relationship cannot point to itself.");
  if (!relationship.label.trim())
    errors.push("A relationship label is required.");
  if (relationship.kind === "DAG" && findDagCycle([...existing, relationship]))
    errors.push(
      "This edge would create a cycle in the bounded DAG. Add feedback as a signed causal loop instead.",
    );
  return errors;
}

/** Coverage is grounded in actual CAD assets and descriptor-pinned approved bindings. */
export function buildCoverageRows(
  assets: readonly CadAsset[],
  bindings: readonly EngineeringBinding[],
): CoverageRow[] {
  return assets.map((asset) => {
    const matched = bindings.filter((b) => b.assetId === asset.id);
    const approved = matched.filter((b) => b.state === "APPROVED");
    const pinned = approved.filter((b) =>
      Boolean(b.deviceUuid && b.schemaHash && b.channelId),
    );
    if (!matched.length)
      return {
        assetId: asset.id,
        assetName: asset.name,
        bindingCount: 0,
        channels: [],
        status: "MISSING",
        detail: "No engineering binding recorded.",
      };
    if (!pinned.length)
      return {
        assetId: asset.id,
        assetName: asset.name,
        bindingCount: matched.length,
        channels: matched.map((b) => b.channelId).filter(Boolean),
        status: "UNVERIFIED",
        detail: approved.length
          ? "Binding is missing a descriptor pin."
          : "Binding is proposed; approval is required.",
      };
    return {
      assetId: asset.id,
      assetName: asset.name,
      bindingCount: matched.length,
      channels: pinned.map((b) => b.channelId),
      status: "MAPPED",
      detail: `${pinned.length} approved descriptor-pinned channel${pinned.length === 1 ? "" : "s"}.`,
    };
  });
}

export async function loadAnalysisDocument(): Promise<AnalysisDocument> {
  if (typeof window === "undefined") return createAnalysisDocument();
  try {
    const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY);
    if (!raw) return createAnalysisDocument();
    const parsed: unknown = JSON.parse(raw);
    if (!isAnalysisDocument(parsed)) throw new Error("Invalid stored analysis");
    return parsed;
  } catch {
    throw new Error("Stored analysis could not be validated. The original data was retained; restore a valid backup before saving.");
  }
}
function isAnalysisDocument(value: unknown): value is AnalysisDocument {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<AnalysisDocument>;
  return (
    d.schemaVersion === 1 &&
    typeof d.id === "string" &&
    Number.isSafeInteger(d.revision) && (d.revision ?? -1) >= 0 &&
    Array.isArray(d.relationships) &&
    d.relationships.length <= 128 &&
    d.relationships.every((r) => isRelationship(r)) &&
    new Set(d.relationships.map(r => r.id)).size === d.relationships.length &&
    !findDagCycle(d.relationships)
  );
}
function isRelationship(value: unknown): value is AnalysisRelationship {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<AnalysisRelationship>;
  return (
    typeof r.id === "string" && r.id.length > 0 && r.id.length <= 100 &&
    typeof r.fromAssetId === "string" && r.fromAssetId.length > 0 && r.fromAssetId.length <= 100 &&
    typeof r.toAssetId === "string" && r.toAssetId.length > 0 && r.toAssetId.length <= 100 && r.toAssetId !== r.fromAssetId &&
    typeof r.label === "string" && r.label.trim().length > 0 && r.label.length <= 120 &&
    (r.kind === "DAG" || r.kind === "LOOP") &&
    (r.sign === 1 || r.sign === -1) &&
    typeof r.note === "string" && r.note.length <= 240
  );
}
export async function loadCadAssets(): Promise<CadAsset[]> {
  const fallback = createCadDocument().assets;
  if (typeof window === "undefined") return fallback;
  try {
    const api = (
      window as unknown as {
        plantlensDesktop?: {
          workspaceLoad?: () => Promise<CadDocument | null>;
        };
      }
    ).plantlensDesktop;
    const native = api?.workspaceLoad ? await api.workspaceLoad() : null;
    if (native && validCadDocument(native)) return native.assets;
    const raw = localStorage.getItem("plantlens.cad.workspace.v1");
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return validCadDocument(parsed) ? parsed.assets : fallback;
  } catch {
    return fallback;
  }
}
function validCadDocument(value: unknown): value is CadDocument {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<CadDocument>;
  return (
    d.schemaVersion === 1 &&
    typeof d.id === "string" &&
    Array.isArray(d.assets) &&
    d.assets.every(
      (a) =>
        !!a &&
        typeof a.id === "string" &&
        typeof a.name === "string" &&
        Array.isArray(a.terminalIds),
    )
  );
}
export async function saveAnalysisDocument(
  document: AnalysisDocument,
  expectedRevision: number,
): Promise<AnalysisDocument> {
  if (!isAnalysisDocument(document)) throw new Error("Analysis document failed validation.");
  if (typeof window === "undefined") return document;
  const current = await loadAnalysisDocument();
  if (current.revision !== expectedRevision)
    throw new Error(
      `Version conflict: expected revision ${expectedRevision}, found ${current.revision}.`,
    );
  const next = { ...document, revision: expectedRevision + 1 };
  localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(next));
  return next;
}
