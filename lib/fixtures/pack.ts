import { ASSETS, TAGS } from "@/lib/domain/plant";
import { csvCell, fnv1a, formatIso } from "@/lib/util";
import { PlantEngine } from "@/lib/simulation/engine";
import { DEMO_START_MS, SCENARIO_BY_ID } from "@/lib/simulation/scenarios";
import { ENGINEER_NOTES, PLC_SEQUENCE, docText } from "./documents";
import { SEED_BASELINES } from "./knowledge";
import { SEED_WORK_ORDERS } from "./history";
import { RECOVERY_TEMPLATES } from "./templates";

/**
 * Builds the downloadable sample factory pack. Every file is generated from the same
 * fixtures and the seeded engine, so IDs are consistent and every cited row exists.
 * The pack contains no instructor answer key.
 */

export interface PackFile {
  name: string;
  mimeType: string;
  text: string;
  rows?: number;
  lines?: number;
}

export interface SamplePack {
  files: PackFile[];
  counts: Record<string, number>;
  manifest: Record<string, unknown>;
}

const PACK_SCENARIO = "S01-SHARED-AIR";
const PACK_DURATION_MS = 12 * 60_000;

export function buildSamplePack(): SamplePack {
  const scenario = SCENARIO_BY_ID[PACK_SCENARIO];
  const engine = new PlantEngine({ seed: scenario.seed, scenarioId: scenario.id, startMs: DEMO_START_MS });
  engine.runUntil(DEMO_START_MS + PACK_DURATION_MS);

  // asset_registry.csv
  const registryRows = ASSETS.map((a) => [a.id, a.name, a.zone, a.kind, a.parentId ?? "", a.cellId ?? "", TAGS.filter((t) => t.assetId === a.id).flatMap((t) => t.aliases.filter((x) => /^[A-Za-z]+[_-]?[A-Za-z]*\d*$/.test(x) && !x.includes("."))).slice(0, 2).join(";"), a.coverage, a.description]);
  const registry = toCsv(["asset_id", "name", "zone", "kind", "parent_id", "cell_id", "aliases", "model_coverage", "description"], registryRows);

  // plc_tags.csv (with a deliberately ambiguous alias, an unmatched tag, and a not-installed channel)
  const tagRows = TAGS.map((t) => [t.aliases[0] ?? t.name, t.assetId, t.name, t.description, t.unit ?? "", t.valueType, "yes"]);
  tagRows.push(["CoolantPump_Run", "CoolantPump", "run_feedback", "Coolant pump run feedback (older export column)", "", "BOOLEAN", "yes"]);
  tagRows.push(["MIST_COLL_02_RUN", "MistCollector2", "running", "Mist collector 2 run feedback (no registry asset)", "", "BOOLEAN", "yes"]);
  tagRows.push(["TT-202", "SPN-02", "bearing_temp", "Spindle B bearing temperature (planned, never fitted)", "°C", "NUMERIC", "no"]);
  const plcTags = toCsv(["tag", "asset_alias", "canonical_tag", "description", "unit", "value_type", "installed"], tagRows);

  // operating_trace.csv from the engine store
  const traceHeader = ["timestamp", "asset_id", "tag", "value", "unit", "quality", "recipe", "phase", "cycle_id", "clock_source", "uncertainty_ms"];
  const traceRows: string[][] = [];
  for (const tagId of engine.store.tagIds()) {
    const [assetId, tagName] = tagId.split(".");
    const def = TAGS.find((t) => t.id === tagId);
    for (const s of engine.store.range(tagId, DEMO_START_MS, DEMO_START_MS + PACK_DURATION_MS)) {
      traceRows.push([formatIso(s.ms), assetId, tagName, s.value === null ? "" : String(s.value), def?.unit ?? "", s.quality, s.context?.recipe ?? "", s.context?.phase ?? "", s.context?.cycleId ?? "", s.clockSourceId ?? "PLC-MAIN", String(s.uncertaintyMs)]);
    }
  }
  traceRows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].localeCompare(b[1]) || a[2].localeCompare(b[2])));
  const trace = toCsv(traceHeader, traceRows);

  // alarm_history.csv
  const alarmRows = engine.state.alarms.map((a) => [a.id, formatIso(a.raisedAt.ms), a.clearedAt ? formatIso(a.clearedAt.ms) : "", a.assetId, a.tagId ?? "", a.severity, a.message]);
  const alarms = toCsv(["alarm_id", "raised_at", "cleared_at", "asset_id", "tag", "severity", "message"], alarmRows);

  // maintenance_history.csv (fictional fixtures)
  const woRows = SEED_WORK_ORDERS.map((w) => [w.id, w.assetId, w.cellId ?? "", w.title, formatIso(w.createdAt.ms), w.closure ? formatIso(w.closure.at.ms) : "", w.suspectedMechanism, w.plannedAction, w.workPerformed.map((x) => x.description).join(" | "), String(w.labor.reduce((s, l) => s + l.minutes, 0)), w.parts.map((p) => `${p.partId}x${p.quantity}`).join(";"), w.testScope?.tested.join("; ") ?? "", w.testScope?.notTested.join("; ") ?? "", "FICTIONAL_FIXTURE"]);
  const maintenance = toCsv(["work_order_id", "asset_id", "cell_id", "title", "opened_at", "closed_at", "suspected_mechanism", "planned_action", "work_performed", "labor_minutes", "parts", "tested", "not_tested", "record_kind"], woRows);

  const notes = docText(ENGINEER_NOTES);
  const sequence = docText(PLC_SEQUENCE);
  const templates = JSON.stringify(RECOVERY_TEMPLATES, null, 2);
  const baselines = JSON.stringify(SEED_BASELINES, null, 2);

  const files: PackFile[] = [
    { name: "asset_registry.csv", mimeType: "text/csv", text: registry, rows: registryRows.length },
    { name: "plc_tags.csv", mimeType: "text/csv", text: plcTags, rows: tagRows.length },
    { name: "plc_sequence_excerpt.txt", mimeType: "text/plain", text: sequence, lines: PLC_SEQUENCE.lines.length },
    { name: "operating_trace.csv", mimeType: "text/csv", text: trace, rows: traceRows.length },
    { name: "alarm_history.csv", mimeType: "text/csv", text: alarms, rows: alarmRows.length },
    { name: "maintenance_history.csv", mimeType: "text/csv", text: maintenance, rows: woRows.length },
    { name: "engineer_notes.txt", mimeType: "text/plain", text: notes, lines: ENGINEER_NOTES.lines.length },
    { name: "recovery_templates.json", mimeType: "application/json", text: templates },
    { name: "healthy_baselines.json", mimeType: "application/json", text: baselines },
  ];
  const cycleCompletes = engine.store.risingEdges("CNC-01.cycle_complete", DEMO_START_MS, DEMO_START_MS + PACK_DURATION_MS).length + engine.store.risingEdges("CNC-02.cycle_complete", DEMO_START_MS, DEMO_START_MS + PACK_DURATION_MS).length;
  const counts = {
    assets: ASSETS.length,
    tags: tagRows.length,
    traceRows: traceRows.length,
    traceMinutes: PACK_DURATION_MS / 60_000,
    alarms: alarmRows.length,
    workOrders: woRows.length,
    completeCycles: cycleCompletes,
    templates: RECOVERY_TEMPLATES.length,
    baselines: SEED_BASELINES.length,
    noteEntries: ENGINEER_NOTES.lines.filter((l) => /^\[\d{4}/.test(l)).length,
  };
  const manifest = {
    pack: "VoltMind Components — Demo Plant sample factory pack",
    fictional: true,
    generatedAt: formatIso(DEMO_START_MS + PACK_DURATION_MS),
    note: "All content is fictional demonstration material generated by the seeded PlantLens engine and fixtures. No real manufacturer supplied data.",
    timeZone: "+05:30 (Asia/Kolkata) — all timestamps carry an explicit offset",
    observedRange: { start: formatIso(DEMO_START_MS), end: formatIso(DEMO_START_MS + PACK_DURATION_MS) },
    clockContracts: [
      { sourceId: "PLC-MAIN", uncertaintyMs: 0, note: "Main PLC clock; event timestamps are exact within the simulation step." },
      { sourceId: "ROBOT-CTRL", uncertaintyMs: 5000, note: "Robot controller clock is not synchronised; documented offset unknown, ±5 s. Applies when robot events carry clock_source=ROBOT-CTRL." },
    ],
    files: files.map((f) => ({ name: f.name, rows: f.rows, lines: f.lines, sha: `fnv-${fnv1a(f.text)}` })),
    counts,
    excluded: ["Instructor answer keys are not part of this pack."],
  };
  files.push({ name: "manifest.json", mimeType: "application/json", text: JSON.stringify(manifest, null, 2) });
  return { files, counts, manifest };
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map((c) => csvCell(c)).join(","))].join("\n") + "\n";
}
