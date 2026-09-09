import { z } from "zod";
import { SCHEMA_VERSION } from "./types";

/**
 * Zod schemas for everything that crosses a trust boundary: uploaded JSON, imported
 * bundles, and recovery plans. Uploaded strings are never evaluated; they are validated.
 */

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9 _.:()\/+\-]+$/);
const ts = z.object({ ms: z.number().finite(), clock: z.enum(["SIMULATION", "EVENT", "INGESTION", "WALL"]), uncertaintyMs: z.number().min(0), raw: z.string().optional(), clockSourceId: z.string().optional() });

export const PHASES = ["OFF", "STARTING", "IDLE", "LOADING", "CLAMPING", "CUTTING", "UNLOADING", "BLOCKED", "STARVED", "STOPPING", "UNCLASSIFIED"] as const;
export const MODES = ["AUTO", "MANUAL", "MAINTENANCE", "OFF", "UNKNOWN"] as const;

const qualityPolicy = z.enum(["REQUIRE_GOOD", "ALLOW_STALE"]);
const severity = z.enum(["FAULT", "WARNING", "INFO"]);

export const RecoveryCheckSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("SOURCE_QUALITY"), tags: z.array(id).min(1).max(20), qualityPolicy, requirementRef: id }),
  z.object({ id, kind: z.literal("MODE_REQUIRED"), assetId: id, recipe: z.string().optional(), mode: z.enum(MODES).optional(), commandedSpeedRpm: z.number().positive().optional(), requirementRef: id }),
  z.object({ id, kind: z.literal("NUMERIC_BAND"), tag: id, minimum: z.number(), maximum: z.number(), unit: z.string(), phase: z.enum(PHASES).optional(), qualityPolicy, minimumSamples: z.number().int().min(1).max(10000), requirementRef: id }).refine((c) => c.minimum <= c.maximum, "minimum must be ≤ maximum"),
  z.object({ id, kind: z.literal("STATE_TRANSITION"), assetId: id, from: z.enum(PHASES), to: z.enum(PHASES), minimumOccurrences: z.number().int().min(1), requirementRef: id }),
  z.object({ id, kind: z.literal("EVENT_SEQUENCE"), events: z.array(id).min(2).max(8), maximumElapsedSeconds: z.number().positive(), minimumValidOccurrences: z.number().int().min(1), requirementRef: id }),
  z.object({ id, kind: z.literal("DOWNSTREAM_ACK"), trigger: id, acknowledgement: id, maximumElapsedSeconds: z.number().positive(), minimumValidOccurrences: z.number().int().min(1), requirementRef: id }),
  z.object({ id, kind: z.literal("ALARM_ABSENCE"), assetIds: z.array(id).min(1), severities: z.array(severity).min(1), requirementRef: id }),
  z.object({ id, kind: z.literal("COMPLETE_CYCLES"), assetId: id, count: z.number().int().min(1).max(1000), requirementRef: id }),
  z.object({ id, kind: z.literal("STABLE_WINDOW"), tag: id, minimum: z.number(), maximum: z.number(), unit: z.string(), settlingSeconds: z.number().min(0), windowSeconds: z.number().positive(), qualityPolicy, requirementRef: id }),
  z.object({ id, kind: z.literal("DEPENDENCY_COVERAGE"), edgeIds: z.array(id).min(1), coveredByCheckIds: z.array(id).min(1), requirementRef: id }),
]);

export const RecoveryPlanSchema = z.object({
  id,
  version: z.number().int().min(1),
  status: z.enum(["DRAFT", "APPROVED", "SUPERSEDED", "INVALIDATED"]),
  incidentId: id,
  knowledgeVersion: z.string(),
  baselineVersion: z.string(),
  scope: z.object({ cellId: z.enum(["CELL-A", "CELL-B", "PLANT"]), recipe: z.string(), mode: z.enum(MODES), requiredCompleteCycles: z.number().int().min(0), commandedSpeedRpm: z.number().optional() }),
  requiredEvidence: z.array(id),
  checks: z.array(RecoveryCheckSchema).min(1).max(40),
  incidentEvidenceSnapshot: z.array(z.string()),
  healthyReferenceId: z.string(),
  validityLimits: z.array(z.string()),
  approval: z.any().nullable(),
  invalidationReason: z.string().optional(),
  warning: z.string(),
  createdAt: ts,
  templateIds: z.array(z.string()),
  checkJustifications: z.record(z.string(), z.string()),
});

export const BaselineSchema = z.object({
  id,
  recipe: z.string(),
  mode: z.enum(MODES),
  cellId: z.enum(["CELL-A", "CELL-B"]),
  commandedSpeedRpm: z.number().positive(),
  bands: z.array(z.object({ tagId: id, min: z.number(), max: z.number(), unit: z.string(), phase: z.enum(PHASES).optional() })),
  cycleDurationSeconds: z.object({ min: z.number(), max: z.number() }),
  evidenceRefs: z.array(z.object({ sourceId: z.string(), startLine: z.number().int().min(1), endLine: z.number().int().min(1) })),
  reviewStatus: z.string(),
  limitations: z.array(z.string()),
});

export const TemplateSchema = z.object({
  id,
  title: z.string(),
  faultFamilies: z.array(z.string()),
  cellId: z.enum(["CELL-A", "CELL-B", "PLANT"]),
  recipe: z.string(),
  requiredCompleteCycles: z.number().int().min(0),
  requiredEvidence: z.array(id),
  checks: z.array(RecoveryCheckSchema),
  justifications: z.record(z.string(), z.string()),
  validityLimits: z.array(z.string()),
});

export const ManifestSchema = z.object({
  pack: z.string(),
  fictional: z.literal(true),
  generatedAt: z.string(),
  files: z.array(z.object({ name: z.string(), rows: z.number().int().optional(), lines: z.number().int().optional(), sha: z.string().optional() })),
  clockContracts: z.array(z.object({ sourceId: z.string(), uncertaintyMs: z.number().min(0), note: z.string() })),
  timeZone: z.string(),
  counts: z.record(z.string(), z.number()),
});

const MAX_ITEMS = 20000;

/** Structural validation for session bundles (deep content checked at use sites). */
export const BundleSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  exportedAt: ts,
  workspace: z.object({ id, name: z.string().max(200), mode: z.enum(["DEMO_SIMULATION", "IMPORTED_REPLAY", "LIVE_ADAPTER"]), createdAt: ts }).passthrough(),
  sources: z.array(z.object({ id, fileName: z.string().max(300), lines: z.array(z.string()).max(200000) }).passthrough()).max(200),
  proposals: z.array(z.object({ id }).passthrough()).max(MAX_ITEMS),
  knowledgeVersions: z.array(z.object({ id, number: z.number().int() }).passthrough()).max(500),
  activeKnowledgeVersionId: z.string(),
  baselines: z.array(BaselineSchema).max(500),
  incidents: z.array(z.object({ id }).passthrough()).max(MAX_ITEMS),
  alarms: z.array(z.object({ id }).passthrough()).max(MAX_ITEMS),
  plans: z.array(RecoveryPlanSchema).max(MAX_ITEMS),
  runs: z.array(z.object({ id, planId: id, outcome: z.enum(["NOT_STARTED", "RUNNING", "PASS", "FAIL", "INCONCLUSIVE", "NOT_COMPARABLE"]) }).passthrough()).max(MAX_ITEMS),
  workOrders: z.array(z.object({ id }).passthrough()).max(MAX_ITEMS),
  inventory: z.array(z.object({ id, onHand: z.number().min(0), reserved: z.number().min(0) }).passthrough()).max(5000),
  inventoryTransactions: z.array(z.object({ id, idempotencyKey: z.string(), quantity: z.number().positive() }).passthrough()).max(MAX_ITEMS),
  costAssumptions: z.array(z.object({ id }).passthrough()).max(50),
  audit: z.array(z.object({ id }).passthrough()).max(MAX_ITEMS),
  observations: z.array(z.object({ id, tagId: z.string(), eventTime: ts }).passthrough()).max(200000),
  containsGroundTruth: z.literal(false),
});

/** Reject unsafe object keys anywhere in a parsed JSON tree. */
export function hasUnsafeKeys(value: unknown, depth = 0): string | null {
  if (depth > 40) return "Nesting too deep";
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = hasUnsafeKeys(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value as object)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return `Unsafe key "${k}"`;
      const r = hasUnsafeKeys((value as Record<string, unknown>)[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export function safeJsonParse(text: string, maxBytes = 25 * 1024 * 1024): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.length > maxBytes) return { ok: false, error: `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit` };
  try {
    const value = JSON.parse(text);
    const unsafe = hasUnsafeKeys(value);
    if (unsafe) return { ok: false, error: unsafe };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}
