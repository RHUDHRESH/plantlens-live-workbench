import type { EpochMs, EvidenceQuality, Observation, ObservationValue, OperatingContext, TagValueType, TimeStamp } from "@/lib/domain/types";
import { TAG_BY_ID } from "@/lib/domain/plant";

/**
 * Columnar, bounded observation store. This is the event log the replay reads.
 * Each tag keeps parallel arrays; Observation records are materialised on demand with
 * stable ids (OBS-<tag>-<eventMs>) so evidence references survive re-materialisation.
 *
 * Eviction never removes samples newer than the oldest pin (open recovery runs pin
 * their start time), so evidence used by an open test is never discarded because it
 * fell outside a chart window.
 */

export type Sample = {
  ms: EpochMs;
  value: number | boolean | string | null;
  quality: EvidenceQuality;
  ingestionMs?: EpochMs;
  uncertaintyMs: number;
  clockSourceId?: string;
  rawMs?: EpochMs;
  sourceId: string;
  sourceRow?: number;
  context?: OperatingContext;
};

type Column = {
  tagId: string;
  assetId: string;
  valueType: TagValueType;
  unit?: string;
  samples: Sample[];
};

export interface SeriesPoint {
  ms: number;
  v: number | null;
  q: EvidenceQuality;
}

export class ObservationStore {
  private columns = new Map<string, Column>();
  private pins = new Map<string, EpochMs>();
  /** Retain at most this much history in ms (simulation time) beyond the oldest pin. */
  retentionMs: number;
  private latestMs: EpochMs = -Infinity;
  private earliestMs: EpochMs = Infinity;

  constructor(retentionMs = 90 * 60_000) {
    this.retentionMs = retentionMs;
  }

  get latest(): EpochMs {
    return this.latestMs;
  }
  get earliest(): EpochMs {
    return this.earliestMs;
  }

  tagIds(): string[] {
    return Array.from(this.columns.keys());
  }

  private column(tagId: string): Column {
    let c = this.columns.get(tagId);
    if (!c) {
      const def = TAG_BY_ID[tagId];
      c = {
        tagId,
        assetId: def?.assetId ?? tagId.split(".")[0],
        valueType: def?.valueType ?? "NUMERIC",
        unit: def?.unit,
        samples: [],
      };
      this.columns.set(tagId, c);
    }
    return c;
  }

  push(tagId: string, s: Sample): void {
    const c = this.column(tagId);
    const last = c.samples[c.samples.length - 1];
    if (last && s.ms < last.ms) {
      // Out-of-order arrival: insert in event-time order (bounded scan from the end).
      let i = c.samples.length - 1;
      while (i >= 0 && c.samples[i].ms > s.ms) i--;
      c.samples.splice(i + 1, 0, s);
    } else {
      c.samples.push(s);
    }
    if (s.ms > this.latestMs) this.latestMs = s.ms;
    if (s.ms < this.earliestMs) this.earliestMs = s.ms;
  }

  pin(key: string, fromMs: EpochMs): void {
    this.pins.set(key, fromMs);
  }
  unpin(key: string): void {
    this.pins.delete(key);
  }

  evict(nowMs: EpochMs): void {
    let cutoff = nowMs - this.retentionMs;
    for (const p of this.pins.values()) cutoff = Math.min(cutoff, p);
    if (!Number.isFinite(cutoff)) return;
    let newEarliest = Infinity;
    for (const c of this.columns.values()) {
      let i = 0;
      while (i < c.samples.length && c.samples[i].ms < cutoff) i++;
      if (i > 0) c.samples.splice(0, i);
      if (c.samples.length) newEarliest = Math.min(newEarliest, c.samples[0].ms);
    }
    this.earliestMs = newEarliest;
  }

  /** Remove all samples after ms (used when a replay branch is cut). */
  truncateAfter(ms: EpochMs): void {
    for (const c of this.columns.values()) {
      let i = c.samples.length;
      while (i > 0 && c.samples[i - 1].ms > ms) i--;
      c.samples.length = i;
    }
    this.latestMs = ms;
  }

  clear(): void {
    this.columns.clear();
    this.latestMs = -Infinity;
    this.earliestMs = Infinity;
  }

  private indexAtOrBefore(c: Column, ms: EpochMs): number {
    let lo = 0;
    let hi = c.samples.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c.samples[mid].ms <= ms) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  private indexAtOrAfter(c: Column, ms: EpochMs): number {
    let lo = 0;
    let hi = c.samples.length - 1;
    let ans = c.samples.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c.samples[mid].ms >= ms) {
        ans = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    return ans;
  }

  latestAt(tagId: string, ms: EpochMs): Sample | undefined {
    const c = this.columns.get(tagId);
    if (!c || !c.samples.length) return undefined;
    const i = this.indexAtOrBefore(c, ms);
    return i >= 0 ? c.samples[i] : undefined;
  }

  range(tagId: string, fromMs: EpochMs, toMs: EpochMs): Sample[] {
    const c = this.columns.get(tagId);
    if (!c) return [];
    const a = this.indexAtOrAfter(c, fromMs);
    const b = this.indexAtOrBefore(c, toMs);
    if (a > b) return [];
    return c.samples.slice(a, b + 1);
  }

  count(tagId: string, fromMs: EpochMs, toMs: EpochMs): number {
    return this.range(tagId, fromMs, toMs).length;
  }

  /** Rising edges (false->true) for a boolean tag within the window. */
  risingEdges(tagId: string, fromMs: EpochMs, toMs: EpochMs): Sample[] {
    const c = this.columns.get(tagId);
    if (!c) return [];
    const a = this.indexAtOrAfter(c, fromMs);
    const b = this.indexAtOrBefore(c, toMs);
    const out: Sample[] = [];
    let prev: Sample | undefined = a > 0 ? c.samples[a - 1] : undefined;
    for (let i = a; i <= b; i++) {
      const s = c.samples[i];
      if (s.value === true && (!prev || prev.value !== true)) out.push(s);
      prev = s;
    }
    return out;
  }

  /** Decimated numeric series for display only; evidence is always evaluated on raw samples. */
  series(tagId: string, fromMs: EpochMs, toMs: EpochMs, maxPoints = 600): SeriesPoint[] {
    const raw = this.range(tagId, fromMs, toMs);
    const toPoint = (s: Sample): SeriesPoint => ({
      ms: s.ms,
      v: typeof s.value === "number" ? s.value : typeof s.value === "boolean" ? (s.value ? 1 : 0) : null,
      q: s.quality,
    });
    if (raw.length <= maxPoints) return raw.map(toPoint);
    const bucket = Math.ceil(raw.length / maxPoints);
    const out: SeriesPoint[] = [];
    for (let i = 0; i < raw.length; i += bucket) {
      // Keep min and max per bucket so deviations survive decimation.
      let min = raw[i];
      let max = raw[i];
      let bad: Sample | undefined;
      for (let j = i; j < Math.min(i + bucket, raw.length); j++) {
        const s = raw[j];
        if (s.quality !== "GOOD") bad = bad ?? s;
        if (typeof s.value === "number" && typeof min.value === "number" && s.value < min.value) min = s;
        if (typeof s.value === "number" && typeof max.value === "number" && s.value > max.value) max = s;
      }
      if (bad) out.push(toPoint(bad));
      if (min.ms <= max.ms) {
        out.push(toPoint(min));
        if (max !== min) out.push(toPoint(max));
      } else {
        out.push(toPoint(max));
        out.push(toPoint(min));
      }
    }
    return out;
  }

  materialize(tagId: string, s: Sample): Observation {
    const c = this.column(tagId);
    const value = toObservationValue(c.valueType, s.value);
    const eventTime: TimeStamp = {
      ms: s.ms,
      clock: s.sourceId.startsWith("SIM") ? "SIMULATION" : "EVENT",
      uncertaintyMs: s.uncertaintyMs,
      clockSourceId: s.clockSourceId,
      raw: s.rawMs !== undefined ? String(s.rawMs) : undefined,
    };
    return {
      id: observationId(tagId, s.ms),
      assetId: c.assetId,
      tagId,
      rawTag: tagId,
      eventTime,
      ingestionTime: s.ingestionMs !== undefined ? { ms: s.ingestionMs, clock: "INGESTION", uncertaintyMs: 0 } : undefined,
      value,
      unit: c.unit,
      quality: s.quality,
      sourceId: s.sourceId,
      sourceRow: s.sourceRow,
      context: s.context,
    };
  }

  /** Total sample count across tags. */
  size(): number {
    let n = 0;
    for (const c of this.columns.values()) n += c.samples.length;
    return n;
  }

  /** Export all samples (bounded) as Observation records, for bundles/CSV. */
  exportAll(fromMs: EpochMs, toMs: EpochMs, limitPerTag = 5000): Observation[] {
    const out: Observation[] = [];
    for (const [tagId, c] of this.columns) {
      const r = this.range(tagId, fromMs, toMs);
      const step = Math.max(1, Math.ceil(r.length / limitPerTag));
      for (let i = 0; i < r.length; i += step) out.push(this.materialize(c.tagId, r[i]));
    }
    out.sort((a, b) => a.eventTime.ms - b.eventTime.ms);
    return out;
  }
}

export function observationId(tagId: string, ms: EpochMs): string {
  return `OBS-${tagId}-${ms}`;
}

export function toObservationValue(valueType: TagValueType, v: Sample["value"]): ObservationValue {
  switch (valueType) {
    case "NUMERIC":
      return { kind: "NUMERIC", value: typeof v === "number" && Number.isFinite(v) ? v : null };
    case "BOOLEAN":
      return { kind: "BOOLEAN", value: typeof v === "boolean" ? v : null };
    case "ENUM":
      return { kind: "ENUM", value: typeof v === "string" ? v : null };
    case "TEXT":
      return { kind: "TEXT", value: v === null || v === undefined ? null : String(v) };
  }
}

/** Read-only view used by diagnosis and recovery: no access to future samples beyond cutoff. */
export interface ObservationReader {
  cutoffMs: EpochMs;
  latestAt(tagId: string, ms?: EpochMs): Sample | undefined;
  range(tagId: string, fromMs: EpochMs, toMs?: EpochMs): Sample[];
  risingEdges(tagId: string, fromMs: EpochMs, toMs?: EpochMs): Sample[];
  hasTag(tagId: string): boolean;
}

export function readerAt(store: ObservationStore, cutoffMs: EpochMs): ObservationReader {
  const clampTo = (ms?: EpochMs) => Math.min(ms ?? cutoffMs, cutoffMs);
  return {
    cutoffMs,
    latestAt: (tagId, ms) => store.latestAt(tagId, clampTo(ms)),
    range: (tagId, fromMs, toMs) => store.range(tagId, fromMs, clampTo(toMs)),
    risingEdges: (tagId, fromMs, toMs) => store.risingEdges(tagId, fromMs, clampTo(toMs)),
    hasTag: (tagId) => store.tagIds().includes(tagId),
  };
}
