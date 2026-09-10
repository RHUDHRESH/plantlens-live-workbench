import { createHash } from "node:crypto";

export const MAX_LINE_BYTES = 64 * 1024;
export const RECOVERY_USB_IDS = new Set(["05c6:9008"]);

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function isRecoveryDevice(port) {
  const id = `${String(port.vendorId ?? "").toLowerCase()}:${String(port.productId ?? "").toLowerCase()}`;
  return RECOVERY_USB_IDS.has(id);
}

export function validateDescriptor(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "Descriptor must be an object." };
  if (input.magic !== "PLANTLENS/1") return { ok: false, error: "Not a PlantLens device." };
  if (input.protocol?.major !== 1) return { ok: false, error: "Unsupported protocol major." };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.deviceUuid ?? "")) return { ok: false, error: "Device has no durable provisioned UUID." };
  if (!/^[0-9a-f]{64}$/i.test(input.firmwareHash ?? "")) return { ok: false, error: "Device firmware hash is invalid." };
  if (input.writesSupported !== false) return { ok: false, error: "Device does not prove read-only capability." };
  if (!Array.isArray(input.channels) || input.channels.length > 128) return { ok: false, error: "Channel count exceeds the 128-channel contract." };
  const ids = input.channels.map((channel) => channel?.id);
  if (ids.some((id) => typeof id !== "string" || !id || id.length > 80)) return { ok: false, error: "Invalid channel identifier." };
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Duplicate channel identifiers." };
  if (input.channels.some((channel) => channel.access !== "READ_ONLY")) return { ok: false, error: "A channel is not read-only." };
  const computed = stableHash(input.channels);
  if (input.schemaHash !== computed) return { ok: false, error: "Schema hash mismatch." };
  return { ok: true, descriptor: Object.freeze(structuredClone(input)) };
}

export function validateSample(input, descriptor) {
  if (!input || input.type !== "sample") return { ok: false, error: "Unsupported frame type." };
  if (input.deviceUuid !== descriptor.deviceUuid || input.schemaHash !== descriptor.schemaHash) return { ok: false, error: "Sample identity/schema mismatch." };
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) return { ok: false, error: "Invalid sequence." };
  if (!Number.isFinite(input.deviceTimeMs) || !Number.isFinite(input.receivedTimeMs)) return { ok: false, error: "Invalid timestamp." };
  if (!Array.isArray(input.values) || input.values.length > descriptor.channels.length) return { ok: false, error: "Invalid value batch." };
  const allowed = new Set(descriptor.channels.map((channel) => channel.id));
  for (const value of input.values) {
    if (!allowed.has(value?.channelId)) return { ok: false, error: `Unknown channel ${String(value?.channelId)}.` };
    if (typeof value.rawValue === "number" && !Number.isFinite(value.rawValue)) return { ok: false, error: "Non-finite numeric value." };
  }
  return { ok: true, sample: Object.freeze(structuredClone(input)) };
}

export class NdjsonDecoder {
  #buffer = "";

  push(chunk) {
    this.#buffer += chunk.toString("utf8");
    if (Buffer.byteLength(this.#buffer) > MAX_LINE_BYTES) {
      this.#buffer = "";
      throw new Error("Frame exceeds 64 KiB limit.");
    }
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";
    return lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
  }
}
