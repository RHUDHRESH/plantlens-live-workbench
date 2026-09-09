"use client";

import { Bot, Boxes, Cog, Disc, Droplets, Fan, Gauge, Grip, MoveRight, Package, Puzzle, Ruler, Snowflake, Wind, Zap, type LucideIcon } from "lucide-react";
import type { CostAssumption, Incident, ModelCoverage, RelationType } from "@/lib/domain/types";
import type { AssetStatus } from "@/lib/simulation/runtime";
import type { Tone } from "@/components/ui";
import { ASSET_BY_ID } from "@/lib/domain/plant";

/* ------------------------------------------------------------------ Icons */

const ICON_BY_ASSET: Record<string, LucideIcon> = {
  "FDR-01": Zap,
  "COMP-01": Wind,
  "AIR-HDR-01": Gauge,
  "CHLR-01": Snowflake,
  "CNC-01": Cog,
  "CNC-02": Cog,
  "SPN-01": Disc,
  "SPN-02": Disc,
  "PUMP-01": Droplets,
  "PUMP-02": Droplets,
  "ROB-01": Bot,
  "FIX-01": Grip,
  "CONV-01": MoveRight,
  "BUF-01": Boxes,
  "FAN-01": Fan,
  "GAUGE-01": Ruler,
  "ASM-01": Puzzle,
  "PACK-01": Package,
};

export function assetIcon(assetId: string): LucideIcon {
  const known = ICON_BY_ASSET[assetId];
  if (known) return known;
  const a = ASSET_BY_ID[assetId];
  if (a?.kind === "SUBSYSTEM") return Disc;
  if (a?.zone === "UTIL") return Zap;
  if (a?.zone === "HANDLING") return MoveRight;
  if (a?.zone === "QUALITY") return Ruler;
  return Cog;
}

/* ------------------------------------------------------------------ Status */

export interface StatusVisual {
  /** Tailwind classes for the card border/background. */
  frame: string;
  /** Short explanatory label shown under the badge; empty for OK. */
  hint: string;
  tone: Tone;
  /** Colour used in the mini-map. */
  mapColor: string;
}

const HATCH = "bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,var(--grey-soft)_6px,var(--grey-soft)_8px)]";

export function statusVisual(status: AssetStatus | undefined): StatusVisual {
  switch (status) {
    case "FAULT":
      return { frame: "border-2 border-red bg-surface", hint: "observed fault", tone: "red", mapColor: "var(--red)" };
    case "SUSPECTED_CAUSE":
      return { frame: "border-2 border-dashed border-red bg-surface", hint: "suspected cause", tone: "red", mapColor: "var(--red)" };
    case "POTENTIALLY_AFFECTED":
      return { frame: "border-2 border-dashed border-amber bg-surface", hint: "may be affected (conditional)", tone: "amber", mapColor: "var(--amber)" };
    case "WARNING":
      return { frame: "border-2 border-amber bg-surface", hint: "warning alarm or observed deviation", tone: "amber", mapColor: "var(--amber)" };
    case "UNAVAILABLE":
      return { frame: `border border-grey ${HATCH}`, hint: "evidence unavailable — not healthy", tone: "grey", mapColor: "var(--grey)" };
    case "OK":
      return { frame: "border border-border bg-surface", hint: "", tone: "green", mapColor: "var(--green)" };
    default:
      return { frame: "border border-border bg-surface", hint: "unknown", tone: "grey", mapColor: "var(--border-strong)" };
  }
}

export const FRESH_LIMIT_MS = 5000;

export function freshnessLabel(freshnessMs: number | null): { text: string; stale: boolean } {
  if (freshnessMs === null) return { text: "no data", stale: true };
  if (freshnessMs <= FRESH_LIMIT_MS) return { text: "fresh", stale: false };
  return { text: `stale ${Math.round(freshnessMs / 1000)}s`, stale: true };
}

/* ------------------------------------------------------------------ Relations */

export interface RelationStyle {
  label: string;
  stroke: string;
  /** SVG dash array; undefined = solid. */
  dash?: string;
}

export const RELATION_STYLE: Record<RelationType, RelationStyle> = {
  ELECTRICAL_SUPPLY: { label: "Electrical supply", stroke: "var(--amber)" },
  PNEUMATIC_PREREQUISITE: { label: "Pneumatic prerequisite", stroke: "var(--accent)" },
  COOLING: { label: "Cooling", stroke: "var(--green)" },
  THERMAL_SUPPLY: { label: "Thermal supply", stroke: "var(--green)", dash: "6 3" },
  MATERIAL_FLOW: { label: "Material flow", stroke: "var(--muted)" },
  HANDSHAKE: { label: "Handshake", stroke: "var(--text)", dash: "2 3" },
  COMPONENT_OF: { label: "Component of", stroke: "var(--border-strong)" },
  REVIEWED_NO_DEPENDENCY: { label: "Reviewed: no dependency", stroke: "var(--grey)", dash: "1 4" },
};

export function relationTitle(r: RelationType): string {
  return RELATION_STYLE[r]?.label ?? r.replace(/_/g, " ").toLowerCase();
}

/* ------------------------------------------------------------------ Coverage */

export const COVERAGE_LEGEND: Array<{ value: ModelCoverage; label: string; explanation: string }> = [
  { value: "RECOVERY_COVERED", label: "Recovery covered", explanation: "Approved rules, sequence model and recovery templates exist; recovery checks can be compiled." },
  { value: "SEQUENCE_COVERED", label: "Sequence covered", explanation: "Handshake or phase timing is modelled; mechanical faults are not diagnosable from available tags." },
  { value: "RULE_COVERED", label: "Rule covered", explanation: "One or more approved threshold rules exist; no sequence model or recovery template." },
  { value: "CONTEXTUAL_ONLY", label: "Contextual only", explanation: "Instrumented for context (run bits, counts). Values inform other assets but carry no approved rule." },
  { value: "INSUFFICIENT_DATA", label: "Insufficient data", explanation: "Channels are too sparse to support any approved rule. Absence of alarms here is not evidence of health." },
];

export function coverageLabel(value: string): string {
  return COVERAGE_LEGEND.find((c) => c.value === value)?.label ?? value.replace(/_/g, " ").toLowerCase();
}

/* ------------------------------------------------------------------ Incidents */

export function openIncidents(incidents: Incident[]): Incident[] {
  return incidents.filter((i) => !i.fixture && i.status !== "CLOSED" && i.status !== "RESOLVED");
}

export function incidentTouchesAsset(i: Incident, assetId: string): boolean {
  return i.observedAssetIds.includes(assetId) || i.potentiallyAffectedAssetIds.includes(assetId) || i.sharedCauseAssetId === assetId;
}

export function interruptionOngoing(i: Incident): boolean {
  return i.interruptions.some((x) => x.endMs === undefined);
}

/** Interruption minutes × the cell's stated interruption rate, in paise. Ongoing interruptions run to `nowMs`. */
export function lossEstimatePaise(i: Incident, costs: CostAssumption[], nowMs: number): number {
  let total = 0;
  for (const x of i.interruptions) {
    const rate = costs.find((c) => c.cellId === x.cellId)?.interruptionPaisePerMinute ?? 0;
    const minutes = Math.max(0, ((x.endMs ?? nowMs) - x.startMs) / 60_000);
    total += minutes * rate;
  }
  return Math.round(total);
}

export function interruptionMinutes(i: Incident, nowMs: number): number {
  return i.interruptions.reduce((acc, x) => acc + Math.max(0, ((x.endMs ?? nowMs) - x.startMs) / 60_000), 0);
}

export function hasUnresolvedDependency(i: Incident): boolean {
  const d = i.diagnosis;
  if (!d) return true;
  return d.state === "AMBIGUOUS" || d.state === "UNKNOWN" || d.orderingUnresolved || d.unresolvedQuestions.length > 0;
}

/** Alarm groups: one per cell stoppage (interruption); at least one group when alarms exist. */
export function groupedAlarmCount(i: Incident): { groups: number; alarms: number } {
  const alarms = i.alarmIds.length;
  const stoppages = i.interruptions.length;
  return { groups: alarms === 0 ? 0 : Math.max(1, stoppages), alarms };
}

export const ATTENTION_ORDER = ["interruption ongoing", "safety-relevant", "repeated incident", "loss estimate (interruption minutes × cell rate)", "evidence completeness (fewer missing inputs first)", "unresolved dependency first"] as const;

export function sortByAttention(incidents: Incident[], costs: CostAssumption[], nowMs: number): Incident[] {
  const key = (i: Incident) => ({
    ongoing: interruptionOngoing(i) ? 1 : 0,
    safety: i.safetyRelevant ? 1 : 0,
    repeat: i.repeatOf.length > 0 ? 1 : 0,
    loss: lossEstimatePaise(i, costs, nowMs),
    missing: i.diagnosis?.missingInputs.length ?? Number.MAX_SAFE_INTEGER,
    unresolved: hasUnresolvedDependency(i) ? 1 : 0,
  });
  return incidents
    .map((i) => ({ i, k: key(i) }))
    .sort((a, b) => b.k.ongoing - a.k.ongoing || b.k.safety - a.k.safety || b.k.repeat - a.k.repeat || b.k.loss - a.k.loss || a.k.missing - b.k.missing || b.k.unresolved - a.k.unresolved || a.i.openedAt.ms - b.i.openedAt.ms)
    .map((x) => x.i);
}
