import { describe, expect, it } from "vitest";
import { DeviceProfileSchema, RawSampleSchema } from "@/lib/live/schemas";
import { ProtocolValidationError, validateProfile } from "@/lib/live/connection";
import { BoundedNdjsonParser, FramingError, encodeNdjson, unsupportedCborCodec } from "@/lib/live/framing";
import { DEMO_PROFILE } from "@/lib/live/demo";

describe("live protocol schemas", () => {
  it("accepts the strict demo profile and every channel is read only", () => {
    const profile = DeviceProfileSchema.parse(DEMO_PROFILE);
    expect(profile.channels).toHaveLength(7);
    expect(profile.channels.every((channel) => channel.access === "READ_ONLY")).toBe(true);
    expect(profile.channels.every((channel) => channel.mappingStatus === "UNMAPPED")).toBe(true);
  });

  it("rejects duplicate channel ids and mismatched counts", () => {
    const duplicate = { ...DEMO_PROFILE, channelCount: 99, channels: [...DEMO_PROFILE.channels, DEMO_PROFILE.channels[0]] };
    const result = DeviceProfileSchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining(["channelCount does not match channels", expect.stringContaining("Duplicate channel id")]));
  });

  it("rejects extra fields at trust boundaries", () => {
    expect(RawSampleSchema.safeParse({ sequence: 1, deviceMonotonicUs: 1, hostReceiveTimeMs: 1, channelId: "x", value: 1, quality: ["GOOD"], calibrationRevision: 0, writeRegister: true }).success).toBe(false);
  });

  it("rejects unsupported protocol majors and unexpected schema revisions", () => {
    expect(() => validateProfile({ ...DEMO_PROFILE, protocolVersion: { major: 2, minor: 0 } })).toThrow(ProtocolValidationError);
    expect(() => validateProfile(DEMO_PROFILE, 1, "f".repeat(64))).toThrow("schema changed");
  });
});

describe("bounded NDJSON framing", () => {
  const sample = { sequence: 1, deviceMonotonicUs: 2, hostReceiveTimeMs: 3, channelId: "sensor.x", value: 4.5, quality: ["GOOD"] as const, calibrationRevision: 1 };

  it("parses fragmented and coalesced frames", () => {
    const parser = new BoundedNdjsonParser(RawSampleSchema, 1024, 2048);
    const bytes = new TextDecoder().decode(encodeNdjson(sample));
    expect(parser.push(bytes.slice(0, 10))).toEqual([]);
    expect(parser.push(`${bytes.slice(10)}${bytes}`)).toEqual([sample, sample]);
  });

  it("rejects oversized, malformed, unsafe, and schema-invalid frames", () => {
    expect(() => new BoundedNdjsonParser(RawSampleSchema, 10, 20).push("12345678901")).toThrow(FramingError);
    expect(() => new BoundedNdjsonParser(RawSampleSchema).push("{oops}\n")).toThrow("Malformed NDJSON frame");
    expect(() => new BoundedNdjsonParser(RawSampleSchema).push('{"__proto__":{},"sequence":1}\n')).toThrow("Unsafe JSON key");
    expect(() => new BoundedNdjsonParser(RawSampleSchema).push('{"sequence":1}\n')).toThrow("schema validation failed");
  });

  it("advertises CBOR as unavailable rather than silently falling back", () => {
    expect(unsupportedCborCodec.supported).toBe(false);
    expect(() => unsupportedCborCodec.encode(sample)).toThrow("CBOR codec is not bundled");
  });
});
