import type { Incident, RecoveryCheck, RecoveryCheckKind, RecoveryPlan, RecoveryRun } from "@/lib/domain/types";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import { stableId } from "@/lib/util";

/** Recovery-area helpers shared by the plan list, the test runner, and the work-order page. */

export const RECOVERY_TABS = ["checks", "coverage", "runs", "history"] as const;
export type RecoveryTab = (typeof RECOVERY_TABS)[number];

export function recoveryTabFromParam(p: string | null | undefined): RecoveryTab {
  return (RECOVERY_TABS as readonly string[]).includes(p ?? "") ? (p as RecoveryTab) : "checks";
}

/** Highest version for a plan id, or undefined when the id is unknown in this browser. */
export function latestPlanVersion(plans: RecoveryPlan[], planId: string | undefined): RecoveryPlan | undefined {
  if (!planId) return undefined;
  return plans.filter((p) => p.id === planId).sort((a, b) => b.version - a.version)[0];
}

/** Exact version a run evaluated; falls back to the latest version when the exact one is not stored. */
export function planForRun(plans: RecoveryPlan[], run: RecoveryRun): RecoveryPlan | undefined {
  return plans.find((p) => p.id === run.planId && p.version === run.planVersion) ?? latestPlanVersion(plans, run.planId);
}

export function versionsOf(plans: RecoveryPlan[], planId: string): RecoveryPlan[] {
  return plans.filter((p) => p.id === planId).sort((a, b) => b.version - a.version);
}

export function runsForPlanId(runs: RecoveryRun[], planId: string): RecoveryRun[] {
  return runs.filter((r) => r.planId === planId).sort((a, b) => b.startedAt.ms - a.startedAt.ms);
}

export function findIncidentAnywhere(snapshot: RuntimeSnapshot | null, historical: Incident[], id: string | undefined): Incident | undefined {
  if (!id) return undefined;
  return snapshot?.incidents.find((i) => i.id === id) ?? historical.find((i) => i.id === id);
}

/** Incidents a plan can be built for: live, still open, and diagnosed. */
export function buildableIncidents(snapshot: RuntimeSnapshot | null): Incident[] {
  return (snapshot?.incidents ?? []).filter((i) => !i.fixture && i.status !== "CLOSED" && i.status !== "RESOLVED" && !!i.diagnosis);
}

export const CHECK_KIND_LABEL: Record<RecoveryCheckKind, string> = {
  SOURCE_QUALITY: "Source quality",
  MODE_REQUIRED: "Mode required",
  NUMERIC_BAND: "Numeric band",
  STATE_TRANSITION: "State transition",
  EVENT_SEQUENCE: "Event sequence",
  DOWNSTREAM_ACK: "Downstream ack",
  ALARM_ABSENCE: "Alarm absence",
  COMPLETE_CYCLES: "Complete cycles",
  STABLE_WINDOW: "Stable window",
  DEPENDENCY_COVERAGE: "Dependency coverage",
};

/** Human-readable parameter pairs for a check, in display order. */
export function checkParams(c: RecoveryCheck): Array<{ k: string; v: string }> {
  switch (c.kind) {
    case "SOURCE_QUALITY":
      return [
        { k: "tags", v: c.tags.join(", ") },
        { k: "policy", v: c.qualityPolicy },
      ];
    case "MODE_REQUIRED":
      return [
        { k: "asset", v: c.assetId },
        ...(c.recipe ? [{ k: "recipe", v: c.recipe }] : []),
        ...(c.mode ? [{ k: "mode", v: c.mode }] : []),
        ...(c.commandedSpeedRpm !== undefined ? [{ k: "commanded speed", v: `${c.commandedSpeedRpm} rpm` }] : []),
      ];
    case "NUMERIC_BAND":
      return [
        { k: "tag", v: c.tag },
        { k: "band", v: `${c.minimum}–${c.maximum} ${c.unit}` },
        { k: "phase", v: c.phase ?? "any" },
        { k: "min samples", v: String(c.minimumSamples) },
        { k: "policy", v: c.qualityPolicy },
      ];
    case "STATE_TRANSITION":
      return [
        { k: "asset", v: c.assetId },
        { k: "transition", v: `${c.from} → ${c.to}` },
        { k: "min occurrences", v: String(c.minimumOccurrences) },
      ];
    case "EVENT_SEQUENCE":
      return [
        { k: "events", v: c.events.join(" → ") },
        { k: "envelope", v: `${c.maximumElapsedSeconds} s` },
        { k: "min valid", v: String(c.minimumValidOccurrences) },
      ];
    case "DOWNSTREAM_ACK":
      return [
        { k: "trigger", v: c.trigger },
        { k: "ack", v: c.acknowledgement },
        { k: "envelope", v: `${c.maximumElapsedSeconds} s` },
        { k: "min valid", v: String(c.minimumValidOccurrences) },
      ];
    case "ALARM_ABSENCE":
      return [
        { k: "assets", v: c.assetIds.join(", ") },
        { k: "severities", v: c.severities.join("/") },
      ];
    case "COMPLETE_CYCLES":
      return [
        { k: "asset", v: c.assetId },
        { k: "count", v: String(c.count) },
      ];
    case "STABLE_WINDOW":
      return [
        { k: "tag", v: c.tag },
        { k: "band", v: `${c.minimum}–${c.maximum} ${c.unit}` },
        { k: "settling", v: `${c.settlingSeconds} s` },
        { k: "window", v: `${c.windowSeconds} s` },
        { k: "policy", v: c.qualityPolicy },
      ];
    case "DEPENDENCY_COVERAGE":
      return [
        { k: "edges", v: c.edgeIds.join(", ") },
        { k: "covered by", v: c.coveredByCheckIds.join(", ") },
      ];
  }
}

export interface EditableField {
  key: string;
  label: string;
  integer?: boolean;
  min?: number;
}

/** Numeric fields an engineer may tune per check kind. Tags, assets, and requirement refs are fixed by the template. */
export const EDITABLE_FIELDS: Partial<Record<RecoveryCheckKind, EditableField[]>> = {
  NUMERIC_BAND: [
    { key: "minimum", label: "Minimum" },
    { key: "maximum", label: "Maximum" },
    { key: "minimumSamples", label: "Min samples", integer: true, min: 1 },
  ],
  STABLE_WINDOW: [
    { key: "minimum", label: "Minimum" },
    { key: "maximum", label: "Maximum" },
    { key: "settlingSeconds", label: "Settling s", integer: true, min: 0 },
    { key: "windowSeconds", label: "Window s", integer: true, min: 1 },
  ],
  EVENT_SEQUENCE: [
    { key: "maximumElapsedSeconds", label: "Envelope s", min: 0 },
    { key: "minimumValidOccurrences", label: "Min valid", integer: true, min: 1 },
  ],
  DOWNSTREAM_ACK: [
    { key: "maximumElapsedSeconds", label: "Envelope s", min: 0 },
    { key: "minimumValidOccurrences", label: "Min valid", integer: true, min: 1 },
  ],
  STATE_TRANSITION: [{ key: "minimumOccurrences", label: "Min occurrences", integer: true, min: 1 }],
  COMPLETE_CYCLES: [{ key: "count", label: "Cycles", integer: true, min: 1 }],
};

export function readNumericField(c: RecoveryCheck, key: string): number {
  const v = (c as unknown as Record<string, unknown>)[key];
  return typeof v === "number" ? v : Number.NaN;
}

/** Returns a new check with one numeric field replaced; keys are restricted to EDITABLE_FIELDS. */
export function withNumericField(c: RecoveryCheck, key: string, value: number): RecoveryCheck {
  const allowed = EDITABLE_FIELDS[c.kind]?.some((f) => f.key === key);
  if (!allowed || !Number.isFinite(value)) return c;
  return { ...c, [key]: value } as RecoveryCheck;
}

export function checksDiffer(a: RecoveryCheck[], b: RecoveryCheck[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Fresh idempotency key per user click. */
export function actionKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return stableId("KEY", Date.now(), Math.floor(Math.random() * 1e9));
}

export const PASS_WORDING = "Recovery checks passed within the tested operating conditions.";

export function planStatusHint(p: RecoveryPlan): string {
  switch (p.status) {
    case "DRAFT":
      return "Awaiting approval; runs cannot start.";
    case "APPROVED":
      return `Approved by ${p.approval?.reviewer ?? "—"}; runs may start.`;
    case "INVALIDATED":
      return p.invalidationReason ?? "Approval invalidated; migration review required.";
    case "SUPERSEDED":
      return p.invalidationReason ?? "Superseded by a later version.";
  }
}
