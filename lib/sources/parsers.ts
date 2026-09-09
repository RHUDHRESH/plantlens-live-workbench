import Papa from "papaparse";
import type { EvidenceQuality, MachinePhase, OperatingMode, SourceCategory, SourceDocument, SourceType, TagDefinition, TimeStamp } from "@/lib/domain/types";
import { ASSET_BY_ID, TAGS } from "@/lib/domain/plant";
import { PHASES, MODES } from "@/lib/domain/schemas";
import type { Sample } from "@/lib/simulation/observation";
import { fnv1a } from "@/lib/util";

/**
 * Deterministic parsers for the supported subset: CSV, JSON, TXT (engineer notes and
 * text-based sequence excerpts). Proprietary binary PLC projects are reported as
 * unsupported with the export that is required instead. No uploaded content is executed.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS = 250_000;

export const BINARY_EXTENSIONS: Record<string, string> = {
  ".ap15": "Siemens TIA Portal project — export the tag table as CSV/XLSX and the sequence as a text listing (SCL/AWL source export).",
  ".ap16": "Siemens TIA Portal project — export the tag table as CSV/XLSX and the sequence as a text listing (SCL/AWL source export).",
  ".ap17": "Siemens TIA Portal project — export the tag table as CSV/XLSX and the sequence as a text listing (SCL/AWL source export).",
  ".ap18": "Siemens TIA Portal project — export the tag table as CSV/XLSX and the sequence as a text listing (SCL/AWL source export).",
  ".zap16": "Siemens TIA Portal archive — extract and export tag tables as CSV; PlantLens does not parse the archive.",
  ".s7p": "Siemens STEP 7 project — export symbol table (.sdf/.csv) and source listing.",
  ".acd": "Rockwell Studio 5000 project — export as L5K/L5X text and tag CSV.",
  ".l5x": "Rockwell L5X is XML; only tag CSV export is supported in this build.",
  ".pro": "Schneider/Codesys project — export tag list CSV and ST source as text.",
  ".xef": "Schneider Unity project export — not supported; export variables as CSV.",
  ".gxw": "Mitsubishi GX Works project — export device comments as CSV.",
  ".zip": "Archives are not extracted in this build; upload the contained CSV/JSON/TXT files.",
  ".pdf": "PDF text extraction is not implemented in this build; export the manual section as TXT.",
  ".docx": "Word documents are not parsed in this build; export as TXT.",
  ".xlsx": "Excel workbooks are not parsed in this build; export the sheet as CSV.",
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4096);
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) control++;
  }
  return control > sample.length * 0.05;
}

export function detectSourceType(fileName: string, text: string): SourceType {
  const ext = extensionOf(fileName);
  const lower = fileName.toLowerCase();
  if (BINARY_EXTENSIONS[ext] || looksBinary(text)) return "UNSUPPORTED";
  if (lower.includes("manifest")) return "MANIFEST";
  if (lower.includes("baseline")) return "HEALTHY_BASELINES";
  if (lower.includes("template")) return "RECOVERY_TEMPLATES";
  if (lower.includes("registry") || lower.includes("asset")) return "ASSET_REGISTRY";
  if (lower.includes("tag")) return "TAG_LIST";
  if (lower.includes("sequence") || /STATE:\s*\w+/.test(text)) return "PLC_SEQUENCE_EXCERPT";
  if (lower.includes("alarm")) return "ALARM_HISTORY";
  if (lower.includes("maintenance") || lower.includes("work_order")) return "MAINTENANCE_HISTORY";
  if (lower.includes("note")) return "ENGINEER_NOTES";
  if (lower.includes("trace") || lower.includes("telemetry") || lower.includes("observ")) return "OPERATING_TRACE";
  if (ext === ".csv") return "OPERATING_TRACE";
  if (ext === ".json") return "MANIFEST";
  if (ext === ".txt" || ext === ".md") return "MANUAL_TEXT";
  return "UNSUPPORTED";
}

export function categoryFor(t: SourceType): SourceCategory {
  switch (t) {
    case "OPERATING_TRACE":
    case "ALARM_HISTORY":
      return "OBSERVATION";
    case "MAINTENANCE_HISTORY":
      return "HISTORICAL";
    case "ASSET_REGISTRY":
    case "TAG_LIST":
    case "PLC_SEQUENCE_EXCERPT":
    case "RECOVERY_TEMPLATES":
    case "HEALTHY_BASELINES":
    case "MANIFEST":
      return "CONFIGURATION";
    default:
      return "EXPLANATORY";
  }
}

export interface ParsedFile {
  document: SourceDocument;
  csv?: { headers: string[]; rows: string[][]; errors: string[] };
  json?: unknown;
  sequence?: SequenceParse;
  notes?: NotesParse;
}

export function makeDocument(id: string, fileName: string, text: string, importedAt: TimeStamp, sizeBytes = text.length, mimeType = "text/plain"): SourceDocument {
  const type = detectSourceType(fileName, text);
  const lines = type === "UNSUPPORTED" ? [] : text.split(/\r?\n/);
  const ext = extensionOf(fileName);
  const doc: SourceDocument = {
    id,
    fileName,
    sourceType: type,
    category: categoryFor(type),
    mimeType,
    sizeBytes,
    lines,
    sha256: `fnv-${fnv1a(text)}`,
    importedAt,
    parseStatus: type === "UNSUPPORTED" ? "UNSUPPORTED" : "PARSED",
    parseMessages: [],
    fictional: true,
    requiredExport: type === "UNSUPPORTED" ? (BINARY_EXTENSIONS[ext] ?? "Binary or unknown format. Export as CSV, JSON, or TXT.") : undefined,
    rowCount: undefined,
  };
  if (sizeBytes > MAX_FILE_BYTES) {
    doc.parseStatus = "FAILED";
    doc.parseMessages.push(`File exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit.`);
    doc.lines = [];
  }
  const rev = text.match(/Revision:\s*([^\n]+)/i) ?? text.match(/Last edited:\s*([^\n]+)/i);
  if (rev) doc.revision = rev[1].trim();
  return doc;
}

export function parseFile(id: string, fileName: string, text: string, importedAt: TimeStamp): ParsedFile {
  const document = makeDocument(id, fileName, text, importedAt);
  const out: ParsedFile = { document };
  if (document.parseStatus !== "PARSED") return out;
  const ext = extensionOf(fileName);
  if (ext === ".csv") {
    const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
    const rows = res.data as string[][];
    const headers = rows.shift() ?? [];
    out.csv = { headers, rows: rows.slice(0, MAX_ROWS), errors: res.errors.slice(0, 20).map((e) => `Row ${e.row}: ${e.message}`) };
    document.rowCount = rows.length;
    if (rows.length > MAX_ROWS) document.parseMessages.push(`Only the first ${MAX_ROWS} rows were parsed.`);
    if (out.csv.errors.length) {
      document.parseStatus = "PARTIAL";
      document.parseMessages.push(...out.csv.errors);
    }
  } else if (ext === ".json") {
    try {
      out.json = JSON.parse(text);
    } catch (e) {
      document.parseStatus = "FAILED";
      document.parseMessages.push(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (document.sourceType === "PLC_SEQUENCE_EXCERPT") {
    out.sequence = parseSequence(document.lines);
    document.parseMessages.push(`${out.sequence.states.length} STATE blocks, ${out.sequence.prerequisites.length} prerequisite(s), ${out.sequence.obsolete.length} obsolete section(s).`);
  } else if (document.sourceType === "ENGINEER_NOTES" || document.sourceType === "MANUAL_TEXT") {
    out.notes = parseNotes(document.lines);
    document.parseMessages.push(`${out.notes.entries.length} dated entries.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sequence excerpt
// ---------------------------------------------------------------------------

export interface SequenceState {
  name: string;
  required: string[];
  transition?: { from: string; to: string; condition?: string };
  timing?: string;
  startLine: number;
  endLine: number;
}

export interface SequenceParse {
  revision?: string;
  states: SequenceState[];
  prerequisites: Array<{ text: string; tag?: string; operator?: string; value?: number; unit?: string; revision?: string; startLine: number; endLine: number }>;
  obsolete: Array<{ title: string; startLine: number; endLine: number }>;
  ackPath?: { startLine: number; endLine: number; text: string };
}

export function parseSequence(lines: string[]): SequenceParse {
  const out: SequenceParse = { states: [], prerequisites: [], obsolete: [] };
  const rev = lines.find((l) => /^Revision:/i.test(l));
  if (rev) out.revision = rev.replace(/^Revision:\s*/i, "").trim();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^STATE:\s*([A-Z_]+)/);
    if (m) {
      const st: SequenceState = { name: m[1], required: [], startLine: i + 1, endLine: i + 1 };
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "" && !/^STATE:/.test(lines[j])) {
        const r = lines[j].match(/^Required observations:\s*(.*)$/);
        if (r) st.required = r[1].split(/[,;]/).map((s) => s.trim().replace(/\s*\(.*\)$/, "")).filter((s) => s && s !== "none");
        const t = lines[j].match(/^Expected transition:\s*([A-Z_]+)\s*->\s*([A-Z_]+)(?:\s+when\s+(.*))?/);
        if (t) st.transition = { from: t[1], to: t[2], condition: t[3]?.trim() };
        const tm = lines[j].match(/^Timing reference:\s*(.*)$/);
        if (tm) st.timing = tm[1].trim();
        j++;
      }
      st.endLine = j;
      out.states.push(st);
      i = j - 1;
      continue;
    }
    const p = l.match(/^([A-Z ]+PREREQUISITE)(?:\s*\((REV [A-Z0-9]+)\))?/);
    if (p) {
      let j = i + 1;
      let text = "";
      let cond: RegExpMatchArray | null = null;
      while (j < lines.length && lines[j].trim() !== "") {
        text += lines[j] + " ";
        cond = cond ?? lines[j].match(/(\w+)\s*(>=|<=|>|<|==)\s*([\d.]+)\s*(\w+)/);
        j++;
      }
      out.prerequisites.push({ text: text.trim(), tag: cond?.[1], operator: cond?.[2], value: cond ? Number(cond[3]) : undefined, unit: cond?.[4], revision: p[2], startLine: i + 1, endLine: j });
      i = j - 1;
      continue;
    }
    const o = l.match(/^(PROCEDURE [A-Z0-9-]+)\s*\(OBSOLETE/i);
    if (o) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") j++;
      out.obsolete.push({ title: o[1], startLine: i + 1, endLine: j });
      i = j - 1;
      continue;
    }
    if (/^ACKNOWLEDGEMENT PATH/.test(l)) {
      let j = i + 1;
      let text = "";
      while (j < lines.length && lines[j].trim() !== "") text += lines[j++] + " ";
      out.ackPath = { startLine: i + 1, endLine: j, text: text.trim() };
      i = j - 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engineer notes
// ---------------------------------------------------------------------------

export interface NoteEntry {
  date?: string;
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
  bodyStartLine: number;
}

export interface NotesParse {
  entries: NoteEntry[];
}

export function parseNotes(lines: string[]): NotesParse {
  const entries: NoteEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/);
    if (!m) continue;
    let j = i + 1;
    const body: string[] = [];
    while (j < lines.length && lines[j].trim() !== "") body.push(lines[j++]);
    entries.push({ date: m[1], heading: m[2].trim(), body: body.join("\n"), startLine: i + 1, endLine: j, bodyStartLine: i + 2 });
    i = j - 1;
  }
  return { entries };
}

// ---------------------------------------------------------------------------
// Trace normalisation
// ---------------------------------------------------------------------------

export type ColumnRole = "eventTime" | "ingestionTime" | "asset" | "tag" | "value" | "unit" | "quality" | "recipe" | "phase" | "mode" | "cycleId" | "commandedSpeed" | "actualSpeed" | "ignore";

export type ColumnMapping = Record<string, ColumnRole>;

const ROLE_HINTS: Array<[RegExp, ColumnRole]> = [
  [/^(timestamp|time|event_time|eventtime|datetime|ts)$/i, "eventTime"],
  [/^(ingest|ingestion|received|arrival)/i, "ingestionTime"],
  [/^(asset|asset_id|machine|equipment|device)$/i, "asset"],
  [/^(tag|tagname|tag_name|signal|point)$/i, "tag"],
  [/^(value|val|reading)$/i, "value"],
  [/^(unit|units|engineeringunit|eu)$/i, "unit"],
  [/^(quality|q|status)$/i, "quality"],
  [/^(recipe|program|part)$/i, "recipe"],
  [/^(phase|state|machine_phase)$/i, "phase"],
  [/^(mode)$/i, "mode"],
  [/^(cycle_id|cycle|cycleid)$/i, "cycleId"],
  [/^(commanded_speed|cmd_speed)$/i, "commandedSpeed"],
  [/^(actual_speed)$/i, "actualSpeed"],
];

export function proposeMapping(headers: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  for (const h of headers) {
    const hit = ROLE_HINTS.find(([re]) => re.test(h.trim()));
    m[h] = hit ? hit[1] : "ignore";
  }
  return m;
}

export interface NormalizeOptions {
  /** Assumed offset for local timestamps without a zone, e.g. "+05:30". Required if any row lacks a zone. */
  timeZoneAssumption?: string;
  /** Alias -> canonical asset id. */
  assetAliases: Record<string, string>;
  /** Tag alias -> canonical tag id (asset.tag). */
  tagAliases: Record<string, string>;
  /** Unit conversions approved by the user: key `${tagId}|${unit}` -> factor to canonical unit. */
  unitApprovals: Record<string, number>;
  sourceId: string;
  clockSourceId?: string;
  uncertaintyMs?: number;
}

export interface QualityReport {
  rowsParsed: number;
  accepted: number;
  duplicates: number;
  missingTimestamps: number;
  invalidTimestamps: number;
  localTimestampsAssumed: number;
  outOfOrder: number;
  unmatchedTags: Record<string, number>;
  unmatchedAssets: Record<string, number>;
  unknownUnits: Array<{ tagId: string; unit: string; count: number }>;
  unitConflicts: Array<{ tagId: string; expected: string; found: string; count: number }>;
  invalidValues: number;
  nullValues: number;
  range?: { startMs: number; endMs: number };
  notes: string[];
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

export function parseTimestamp(raw: string, assumption?: string): { ms: number; assumed: boolean } | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(ISO_RE);
  if (!m) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 1e11 && n < 1e13) return { ms: n, assumed: false };
    if (Number.isFinite(n) && n > 1e8 && n < 1e10) return { ms: n * 1000, assumed: false };
    return null;
  }
  const [, y, mo, d, h, mi, sec = "0", frac = "0", zone] = m;
  let offsetMin = 0;
  let assumed = false;
  const z = zone ?? assumption;
  if (!z) return null;
  if (z !== "Z") {
    const zm = z.match(/([+-])(\d{2}):?(\d{2})/);
    if (!zm) return null;
    offsetMin = (zm[1] === "-" ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3]));
  }
  if (!zone) assumed = true;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec), Number(frac.padEnd(3, "0"))) - offsetMin * 60_000;
  if (!Number.isFinite(ms) || ms < Date.UTC(1990, 0, 1) || ms > Date.UTC(2100, 0, 1)) return null;
  return { ms, assumed };
}

const TAG_BY_ID_MAP: Record<string, TagDefinition> = Object.fromEntries(TAGS.map((t) => [t.id, t]));
const TAG_ALIAS_INDEX: Record<string, string> = {};
for (const t of TAGS) {
  TAG_ALIAS_INDEX[t.name.toLowerCase()] = t.id; // name only (needs asset)
  for (const a of t.aliases) TAG_ALIAS_INDEX[a.toLowerCase()] = t.id;
}

export function resolveTag(assetId: string | undefined, rawTag: string, aliases: Record<string, string>): string | undefined {
  const key = rawTag.trim();
  if (aliases[key]) return aliases[key];
  if (assetId && TAG_BY_ID_MAP[`${assetId}.${key}`]) return `${assetId}.${key}`;
  const viaAlias = TAG_ALIAS_INDEX[key.toLowerCase()];
  if (viaAlias && (!assetId || viaAlias.startsWith(`${assetId}.`))) return viaAlias;
  if (TAG_BY_ID_MAP[key]) return key;
  return undefined;
}

const QUALITY_MAP: Record<string, EvidenceQuality> = { good: "GOOD", ok: "GOOD", "192": "GOOD", bad: "INVALID", invalid: "INVALID", missing: "MISSING", null: "MISSING", stale: "STALE", suspect: "SUSPECT", uncertain: "SUSPECT", "0": "INVALID" };

export interface NormalizedTrace {
  samples: Array<{ tagId: string; sample: Sample; rawTag: string; rawAsset: string }>;
  report: QualityReport;
}

export function normalizeTrace(headers: string[], rows: string[][], mapping: ColumnMapping, opts: NormalizeOptions): NormalizedTrace {
  const idx = (role: ColumnRole) => headers.findIndex((h) => mapping[h] === role);
  const iTime = idx("eventTime");
  const iIngest = idx("ingestionTime");
  const iAsset = idx("asset");
  const iTag = idx("tag");
  const iValue = idx("value");
  const iUnit = idx("unit");
  const iQuality = idx("quality");
  const iRecipe = idx("recipe");
  const iPhase = idx("phase");
  const iMode = idx("mode");
  const iCycle = idx("cycleId");
  const iCmd = idx("commandedSpeed");
  const iAct = idx("actualSpeed");
  const report: QualityReport = { rowsParsed: rows.length, accepted: 0, duplicates: 0, missingTimestamps: 0, invalidTimestamps: 0, localTimestampsAssumed: 0, outOfOrder: 0, unmatchedTags: {}, unmatchedAssets: {}, unknownUnits: [], unitConflicts: [], invalidValues: 0, nullValues: 0, notes: [] };
  const samples: NormalizedTrace["samples"] = [];
  if (iTime === -1 || iTag === -1 || iValue === -1) {
    report.notes.push("Mapping must assign event time, tag, and value columns.");
    return { samples, report };
  }
  const seen = new Set<string>();
  const lastMs = new Map<string, number>();
  const unknownUnits = new Map<string, number>();
  const unitConflicts = new Map<string, number>();
  let minMs = Infinity;
  let maxMs = -Infinity;
  rows.forEach((row, r) => {
    const rawTime = row[iTime] ?? "";
    if (!rawTime.trim()) {
      report.missingTimestamps++;
      return;
    }
    const t = parseTimestamp(rawTime, opts.timeZoneAssumption);
    if (!t) {
      report.invalidTimestamps++;
      return;
    }
    if (t.assumed) report.localTimestampsAssumed++;
    const rawAsset = iAsset >= 0 ? (row[iAsset] ?? "").trim() : "";
    const rawTag = (row[iTag] ?? "").trim();
    let assetId: string | undefined = rawAsset ? (opts.assetAliases[rawAsset] ?? (ASSET_BY_ID[rawAsset] ? rawAsset : undefined)) : undefined;
    if (rawAsset && !assetId) report.unmatchedAssets[rawAsset] = (report.unmatchedAssets[rawAsset] ?? 0) + 1;
    const tagId = resolveTag(assetId, rawTag, opts.tagAliases);
    if (!tagId) {
      report.unmatchedTags[rawTag] = (report.unmatchedTags[rawTag] ?? 0) + 1;
      return;
    }
    if (!assetId) assetId = tagId.split(".")[0];
    const def = TAG_BY_ID_MAP[tagId];
    const key = `${tagId}|${t.ms}`;
    if (seen.has(key)) {
      report.duplicates++;
      return;
    }
    seen.add(key);
    const prev = lastMs.get(tagId);
    if (prev !== undefined && t.ms < prev) report.outOfOrder++;
    lastMs.set(tagId, Math.max(prev ?? -Infinity, t.ms));
    const rawValue = (row[iValue] ?? "").trim();
    const unit = iUnit >= 0 ? (row[iUnit] ?? "").trim() : "";
    let value: Sample["value"] = null;
    let quality: EvidenceQuality = "GOOD";
    if (iQuality >= 0) {
      const q = QUALITY_MAP[(row[iQuality] ?? "").trim().toLowerCase()];
      if (q) quality = q;
    }
    if (rawValue === "" || rawValue.toLowerCase() === "null" || rawValue.toLowerCase() === "nan") {
      value = null;
      quality = "MISSING";
      report.nullValues++;
    } else if (def?.valueType === "NUMERIC") {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        report.invalidValues++;
        quality = "INVALID";
        value = null;
      } else {
        value = n;
        if (unit && def.unit && unit !== def.unit) {
          const factor = opts.unitApprovals[`${tagId}|${unit}`];
          if (factor !== undefined) value = n * factor;
          else {
            const k = `${tagId}|${def.unit}|${unit}`;
            unitConflicts.set(k, (unitConflicts.get(k) ?? 0) + 1);
            quality = "SUSPECT";
          }
        } else if (unit && !def.unit) unknownUnits.set(`${tagId}|${unit}`, (unknownUnits.get(`${tagId}|${unit}`) ?? 0) + 1);
      }
    } else if (def?.valueType === "BOOLEAN") {
      const v = rawValue.toLowerCase();
      if (["true", "1", "on", "yes"].includes(v)) value = true;
      else if (["false", "0", "off", "no"].includes(v)) value = false;
      else {
        report.invalidValues++;
        quality = "INVALID";
      }
    } else if (def?.valueType === "ENUM") {
      value = rawValue.toUpperCase();
      if (def.enumValues && !def.enumValues.includes(value)) {
        quality = "SUSPECT";
      }
    } else value = rawValue;
    const context: Sample["context"] = {};
    if (iRecipe >= 0 && row[iRecipe]) context.recipe = row[iRecipe].trim();
    if (iPhase >= 0 && row[iPhase]) context.phase = (PHASES as readonly string[]).includes(row[iPhase].trim().toUpperCase()) ? (row[iPhase].trim().toUpperCase() as MachinePhase) : "UNCLASSIFIED";
    if (iMode >= 0 && row[iMode]) context.mode = (MODES as readonly string[]).includes(row[iMode].trim().toUpperCase()) ? (row[iMode].trim().toUpperCase() as OperatingMode) : "UNKNOWN";
    if (iCycle >= 0 && row[iCycle]) context.cycleId = row[iCycle].trim();
    if (iCmd >= 0 && row[iCmd] && Number.isFinite(Number(row[iCmd]))) context.commandedSpeed = Number(row[iCmd]);
    if (iAct >= 0 && row[iAct] && Number.isFinite(Number(row[iAct]))) context.actualSpeed = Number(row[iAct]);
    const ingestion = iIngest >= 0 && row[iIngest] ? parseTimestamp(row[iIngest], opts.timeZoneAssumption)?.ms : undefined;
    samples.push({
      tagId,
      rawTag,
      rawAsset,
      sample: { ms: t.ms, value, quality, ingestionMs: ingestion, uncertaintyMs: opts.uncertaintyMs ?? 0, clockSourceId: opts.clockSourceId, sourceId: opts.sourceId, sourceRow: r + 2, context: Object.keys(context).length ? context : undefined, rawMs: undefined },
    });
    minMs = Math.min(minMs, t.ms);
    maxMs = Math.max(maxMs, t.ms);
    report.accepted++;
  });
  for (const [k, count] of unknownUnits) {
    const [tagId, unit] = k.split("|");
    report.unknownUnits.push({ tagId, unit, count });
  }
  for (const [k, count] of unitConflicts) {
    const [tagId, expected, found] = k.split("|");
    report.unitConflicts.push({ tagId, expected, found, count });
  }
  if (report.accepted) report.range = { startMs: minMs, endMs: maxMs };
  if (report.localTimestampsAssumed && !opts.timeZoneAssumption) report.notes.push("Local timestamps without a zone were found; an explicit workspace import assumption is required.");
  return { samples, report };
}
