import type { EpochMs, Paise, TimeStamp } from "@/lib/domain/types";

// ---------------------------------------------------------------------------
// Deterministic PRNG (sfc32) — the simulation must reproduce identically for a seed.
// ---------------------------------------------------------------------------

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // Seed expansion via splitmix-like hashing to fill four 32-bit words.
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t / 4294967296;
  }

  /** Approximately normal(0, 1) via sum of uniforms (deterministic, cheap). */
  gauss(): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return (s - 3) / Math.sqrt(0.5);
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  snapshot(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  restore(s: [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36).toUpperCase().padStart(4, "0")}`;
}

export function resetIdCounter(value = 0): void {
  counter = value;
}

/** Stable, deterministic id from parts (used inside the engine so replays match). */
export function stableId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}-${parts.map((p) => String(p).replace(/[^A-Za-z0-9_.:-]/g, "_")).join("-")}`;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function ts(ms: EpochMs, clock: TimeStamp["clock"], uncertaintyMs = 0, extra?: Partial<TimeStamp>): TimeStamp {
  return { ms, clock, uncertaintyMs, ...extra };
}

export function simTs(ms: EpochMs, uncertaintyMs = 0): TimeStamp {
  return { ms, clock: "SIMULATION", uncertaintyMs };
}

export function wallTs(): TimeStamp {
  return { ms: Date.now(), clock: "WALL", uncertaintyMs: 0 };
}

const IST_OFFSET_MIN = 330;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** Format as ISO 8601 with +05:30 offset (fictional plant is in Chennai). */
export function formatIst(ms: EpochMs, opts: { seconds?: boolean; date?: boolean; millis?: boolean } = {}): string {
  const { seconds = true, date = false, millis = false } = opts;
  const d = new Date(ms + IST_OFFSET_MIN * 60_000);
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  const msPart = millis ? `.${pad(d.getUTCMilliseconds(), 3)}` : "";
  const time = seconds ? `${h}:${mi}:${s}${msPart}` : `${h}:${mi}`;
  return date ? `${y}-${mo}-${da} ${time}` : time;
}

export function formatIso(ms: EpochMs): string {
  const d = new Date(ms + IST_OFFSET_MIN * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+05:30`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

export function formatRelative(fromMs: EpochMs, toMs: EpochMs): string {
  const d = toMs - fromMs;
  const sign = d < 0 ? "-" : "+";
  return `${sign}${formatDuration(Math.abs(d))}`;
}

// ---------------------------------------------------------------------------
// Money — INR with Indian digit grouping, decimal-safe integers in paise.
// ---------------------------------------------------------------------------

export function paise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function formatInr(p: Paise, opts: { showPaise?: boolean } = {}): string {
  const { showPaise = false } = opts;
  const negative = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const str = rupees.toString();
  let grouped: string;
  if (str.length <= 3) grouped = str;
  else {
    const last3 = str.slice(-3);
    let rest = str.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) parts.unshift(rest);
    grouped = `${parts.join(",")},${last3}`;
  }
  const body = showPaise ? `${grouped}.${pad(rem)}` : grouped;
  return `${negative ? "−" : ""}₹${body}`;
}

/** Labor cost in paise, rounded at the accounting boundary (nearest paisa). */
export function laborCostPaise(minutes: number, ratePaisePerHour: Paise): Paise {
  return Math.round((minutes * ratePaisePerHour) / 60);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Union of intervals in ms — used for downtime so overlapping intervals never double count. */
export function unionDurationMs(intervals: Array<{ startMs: number; endMs: number }>): number {
  const sorted = intervals
    .filter((i) => i.endMs > i.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const i of sorted) {
    if (i.startMs > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = i.startMs;
      curEnd = i.endMs;
    } else if (i.endMs > curEnd) {
      curEnd = i.endMs;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

// ---------------------------------------------------------------------------
// Hashing (FNV-1a, sync) — used for source fingerprints in demo; sha256 via SubtleCrypto when available.
// ---------------------------------------------------------------------------

export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export async function sha256Hex(text: string): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return `fnv-${fnv1a(text)}`;
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return `fnv-${fnv1a(text)}`;
  }
}

/** Neutralise spreadsheet formula injection in CSV cells. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
