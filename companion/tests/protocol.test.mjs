import test from "node:test";
import assert from "node:assert/strict";
import { DemoTransport } from "../src/transports/demo.mjs";
import { NdjsonDecoder, stableHash, validateDescriptor, validateSample } from "../src/protocol.mjs";

test("hashes descriptors using Python's sorted-key compact JSON representation", () => {
  const channels = [{
    id: "sensor_1_raw", label: "Sensor 1 raw", valueType: "uint16", unit: "count",
    minimum: 0, maximum: 4095, sampleRateHz: 20, access: "READ_ONLY", mappingState: "UNMAPPED",
  }];
  assert.equal(stableHash(channels), "02edea6bec9593e25e8b0b28fad096402990fa3659341a52ebe06784698194cc");
  assert.equal(stableHash({ z: { b: 2, a: 1 }, a: 0 }), stableHash({ a: 0, z: { a: 1, b: 2 } }));
});

test("accepts the verified read-only demo descriptor", async () => {
  const descriptor = await new DemoTransport().verify();
  assert.equal(validateDescriptor(descriptor).ok, true);
});

test("rejects write-capable and recovery-like descriptors", async () => {
  const descriptor = await new DemoTransport().verify();
  assert.equal(validateDescriptor({ ...descriptor, writesSupported: true }).ok, false);
  assert.equal(validateDescriptor({ ...descriptor, protocol: { major: 2 } }).ok, false);
});

test("decodes partial NDJSON frames without guessing", () => {
  const decoder = new NdjsonDecoder();
  assert.deepEqual(decoder.push(Buffer.from('{"a":')), []);
  assert.deepEqual(decoder.push(Buffer.from('1}\n')), [{ a: 1 }]);
});

test("validates samples against the negotiated schema", async () => {
  const transport = new DemoTransport();
  const descriptor = await transport.verify();
  const sample = await new Promise((resolve) => {
    let stop = () => {};
    stop = transport.subscribe((value) => { queueMicrotask(stop); resolve(value); });
  });
  assert.equal(validateSample(sample, descriptor).ok, true);
  assert.equal(validateSample({ ...sample, values: [{ channelId: "invented", rawValue: 1 }] }, descriptor).ok, false);
  assert.equal(validateSample({ ...sample, bootId: "another-boot" }, descriptor).ok, false);
  assert.equal(validateSample({ ...sample, values: [sample.values[0], sample.values[0]] }, descriptor).ok, false);
  assert.equal(validateSample({ ...sample, values: [{ ...sample.values[0], rawValue: "1.5" }] }, descriptor).ok, false);
  assert.equal(validateSample({ ...sample, values: [{ ...sample.values[0], rawValue: Number.NaN }] }, descriptor).ok, false);
  assert.equal(validateSample({ ...sample, values: [{ ...sample.values[0], unit: 42 }] }, descriptor).ok, false);
});

test("validates integer samples according to their declared channel type", () => {
  const descriptor = {
    deviceUuid: "device", schemaHash: "schema", bootId: "boot",
    channels: [{ id: "sensor", valueType: "uint16", unit: "count" }],
  };
  const sample = {
    type: "sample", deviceUuid: "device", schemaHash: "schema", bootId: "boot",
    sequence: 0, deviceTimeMs: 0, receivedTimeMs: 0,
    values: [{ channelId: "sensor", rawValue: 4095, unit: "count" }],
  };
  assert.equal(validateSample(sample, descriptor).ok, true);
  assert.equal(validateSample({ ...sample, values: [{ ...sample.values[0], rawValue: 1.5 }] }, descriptor).ok, false);
  assert.equal(validateSample({ ...sample, values: [{ ...sample.values[0], rawValue: -1 }] }, descriptor).ok, false);
  assert.equal(validateSample({ ...sample, values: [{ ...sample.values[0], rawValue: 65_536 }] }, descriptor).ok, false);
});
