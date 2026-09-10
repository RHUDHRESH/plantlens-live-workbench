import { createHash } from "node:crypto";

export const MAX_LINE_BYTES = 64 * 1024;
export const RECOVERY_USB_IDS = new Set(["05c6:9008"]);

function pythonJsonString(value) {
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return pythonJsonString(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item) ?? "null").join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => canonicalJson(value[key]) !== undefined)
      .map((key) => `${pythonJsonString(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return undefined;
}

export function stableHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
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
  if (!input || typeof input !== "object" || Array.isArray(input) || input.type !== "sample") return { ok: false, error: "Unsupported frame type." };
  if (!descriptor || typeof descriptor !== "object" || !Array.isArray(descriptor.channels)) return { ok: false, error: "Invalid descriptor." };
  if (typeof input.deviceUuid !== "string" || typeof input.schemaHash !== "string" || input.deviceUuid !== descriptor.deviceUuid || input.schemaHash !== descriptor.schemaHash) return { ok: false, error: "Sample identity/schema mismatch." };
  if (typeof input.bootId !== "string" || !input.bootId || input.bootId !== descriptor.bootId) return { ok: false, error: "Sample boot identity mismatch." };
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) return { ok: false, error: "Invalid sequence." };
  if (!Number.isFinite(input.deviceTimeMs) || !Number.isFinite(input.receivedTimeMs)) return { ok: false, error: "Invalid timestamp." };
  if (!Array.isArray(input.values) || input.values.length > descriptor.channels.length) return { ok: false, error: "Invalid value batch." };
  const channels = new Map(descriptor.channels.map((channel) => [channel.id, channel]));
  const seen = new Set();
  for (const value of input.values) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.channelId !== "string") return { ok: false, error: "Invalid channel value." };
    const channel = channels.get(value.channelId);
    if (!channel) return { ok: false, error: `Unknown channel ${String(value.channelId)}.` };
    if (seen.has(value.channelId)) return { ok: false, error: `Duplicate channel ${value.channelId}.` };
    seen.add(value.channelId);
    if (!isRawValueOfType(value.rawValue, channel.valueType)) return { ok: false, error: `Invalid ${channel.valueType} value for channel ${value.channelId}.` };
    if ("unit" in value && (typeof value.unit !== "string" || value.unit !== channel.unit)) return { ok: false, error: `Unit mismatch for channel ${value.channelId}.` };
  }
  return { ok: true, sample: Object.freeze(structuredClone(input)) };
}

function isRawValueOfType(value, valueType) {
  if (valueType === "float32" || valueType === "float64") return typeof value === "number" && Number.isFinite(value);
  if (valueType === "boolean" || valueType === "bool") return typeof value === "boolean";
  if (valueType === "string" || valueType === "text") return typeof value === "string";

  const integerType = /^(u?)int(8|16|32|64)$/.exec(valueType);
  if (!integerType || !Number.isSafeInteger(value)) return false;
  const unsigned = integerType[1] === "u";
  const bits = Number(integerType[2]);
  if (bits === 64) return unsigned ? value >= 0 : true;
  const limit = 2 ** (bits - (unsigned ? 0 : 1));
  return unsigned ? value >= 0 && value < limit : value >= -limit && value < limit;
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
