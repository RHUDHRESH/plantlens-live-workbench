import type { Observation, SessionBundle } from "@/lib/domain/types";
import { BundleSchema, safeJsonParse } from "@/lib/domain/schemas";
import { csvCell, formatIso } from "@/lib/util";

/**
 * Evidence bundle export/import and telemetry CSV. Bundles never include the scenario
 * answer key (containsGroundTruth is always false) and never include provider secrets.
 */

export function serializeBundle(bundle: SessionBundle): string {
  const safe: SessionBundle = { ...bundle, containsGroundTruth: false };
  return JSON.stringify(safe, null, 2);
}

export function parseBundle(text: string): { ok: true; bundle: SessionBundle; warnings: string[] } | { ok: false; error: string } {
  const parsed = safeJsonParse(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const res = BundleSchema.safeParse(parsed.value);
  if (!res.success) return { ok: false, error: `Bundle failed validation: ${res.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const bundle = res.data as unknown as SessionBundle;
  const warnings: string[] = [];
  // Referential integrity: every run's plan must exist; every plan's incident must exist.
  const planIds = new Set(bundle.plans.map((p) => p.id));
  const incidentIds = new Set(bundle.incidents.map((i) => i.id));
  for (const r of bundle.runs) if (!planIds.has(r.planId) && !r.planId.startsWith("RP-H-")) return { ok: false, error: `Run ${r.id} references missing plan ${r.planId}.` };
  for (const p of bundle.plans) if (!incidentIds.has(p.incidentId)) warnings.push(`Plan ${p.id} references incident ${p.incidentId}, which is not in the bundle.`);
  // Inventory ledger consistency: no negative stock, reserved ≤ onHand.
  for (const part of bundle.inventory) if (part.reserved > part.onHand) return { ok: false, error: `Inventory ledger inconsistent for ${part.id}: reserved ${part.reserved} > on hand ${part.onHand}.` };
  // Timestamps must be plausible.
  for (const o of bundle.observations.slice(0, 1000)) if (o.eventTime.ms < Date.UTC(1990, 0, 1) || o.eventTime.ms > Date.UTC(2100, 0, 1)) return { ok: false, error: `Observation ${o.id} has an impossible timestamp.` };
  if (!bundle.knowledgeVersions.some((k) => k.id === bundle.activeKnowledgeVersionId)) return { ok: false, error: "Active knowledge version is not present in the bundle." };
  return { ok: true, bundle, warnings };
}

export function observationsCsv(observations: Observation[]): string {
  const header = ["event_time", "ingestion_time", "asset_id", "tag", "value", "unit", "quality", "source_id", "source_row", "recipe", "phase", "cycle_id", "uncertainty_ms", "clock_source"];
  const rows = observations.map((o) => [
    formatIso(o.eventTime.ms),
    o.ingestionTime ? formatIso(o.ingestionTime.ms) : "",
    o.assetId,
    o.tagId.split(".").slice(1).join("."),
    o.value.value === null ? "" : String(o.value.value),
    o.unit ?? "",
    o.quality,
    o.sourceId,
    o.sourceRow ?? "",
    o.context?.recipe ?? "",
    o.context?.phase ?? "",
    o.context?.cycleId ?? "",
    o.eventTime.uncertaintyMs,
    o.eventTime.clockSourceId ?? "",
  ]);
  return [header.join(","), ...rows.map((r) => r.map((c) => csvCell(c)).join(","))].join("\n") + "\n";
}

export function downloadText(fileName: string, text: string, mimeType = "text/plain"): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
