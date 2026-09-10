import type { z } from "zod";

export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingError";
  }
}

function rejectUnsafeKeys(value: unknown, depth = 0): void {
  if (depth > 32) throw new FramingError("NDJSON value exceeds maximum nesting depth");
  if (Array.isArray(value)) {
    for (const item of value) rejectUnsafeKeys(item, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") throw new FramingError(`Unsafe JSON key: ${key}`);
      rejectUnsafeKeys((value as Record<string, unknown>)[key], depth + 1);
    }
  }
}

/** Incremental diagnostic parser. Production transports should use bounded CBOR. */
export class BoundedNdjsonParser<T> {
  private buffer = "";
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private readonly encoder = new TextEncoder();

  constructor(private readonly schema: z.ZodType<T>, private readonly maxFrameBytes = 64 * 1024, private readonly maxBufferBytes = 128 * 1024) {
    if (maxFrameBytes < 1 || maxBufferBytes < maxFrameBytes) throw new Error("Invalid NDJSON parser bounds");
  }

  push(chunk: Uint8Array | string): T[] {
    try {
      this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new FramingError("Invalid UTF-8 in NDJSON stream");
    }
    if (this.encoder.encode(this.buffer).byteLength > this.maxBufferBytes) throw new FramingError("NDJSON buffer limit exceeded");
    const output: T[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) output.push(this.parseLine(line));
      newline = this.buffer.indexOf("\n");
    }
    if (this.encoder.encode(this.buffer).byteLength > this.maxFrameBytes) throw new FramingError("NDJSON frame limit exceeded");
    return output;
  }

  finish(): T[] {
    try {
      this.buffer += this.decoder.decode();
    } catch {
      throw new FramingError("Invalid UTF-8 in NDJSON stream");
    }
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const line = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    return [this.parseLine(line)];
  }

  reset(): void {
    this.buffer = "";
  }

  private parseLine(line: string): T {
    if (this.encoder.encode(line).byteLength > this.maxFrameBytes) throw new FramingError("NDJSON frame limit exceeded");
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new FramingError("Malformed NDJSON frame");
    }
    rejectUnsafeKeys(value);
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw new FramingError(`NDJSON schema validation failed: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
    return parsed.data;
  }
}

export function encodeNdjson(value: unknown, maxFrameBytes = 64 * 1024): Uint8Array {
  const encoded = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  if (encoded.byteLength > maxFrameBytes) throw new FramingError("NDJSON frame limit exceeded");
  return encoded;
}

export interface CborCodec {
  readonly supported: boolean;
  readonly reason?: string;
  encode(value: unknown): Uint8Array;
  decode(value: Uint8Array): unknown;
}

/** Honest placeholder until a bounded CBOR dependency is selected and audited. */
export const unsupportedCborCodec: CborCodec = {
  supported: false,
  reason: "CBOR codec is not bundled; use NDJSON diagnostic mode only",
  encode() { throw new FramingError(this.reason!); },
  decode() { throw new FramingError(this.reason!); },
};

