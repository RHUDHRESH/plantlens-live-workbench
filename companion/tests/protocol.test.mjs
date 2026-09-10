import test from "node:test";
import assert from "node:assert/strict";
import { DemoTransport } from "../src/transports/demo.mjs";
import { NdjsonDecoder, stableHash, validateDescriptor, validateSample } from "../src/protocol.mjs";
import { readFile } from "node:fs/promises";
import { openUnoQHttp, validateAppLabAddress } from "../src/transports/http.mjs";

test("accepts the shared firmware golden descriptor", async () => {
  const value = JSON.parse(await readFile(new URL("../contract/golden-v1.json", import.meta.url), "utf8"));
  assert.equal(validateDescriptor(value).ok, true);
});

test("UNO Q HTTP adapter restricts addresses and verifies selected identity", async () => {
  assert.throws(() => validateAppLabAddress("http://example.com"), /loopback/);
  assert.throws(() => validateAppLabAddress("https://8.8.8.8", "secret"), /private literal/);
  assert.throws(() => validateAppLabAddress("https://uno-q.local", "secret"), /private literal/);
  assert.throws(() => validateAppLabAddress("https://192.168.1.20"), /credential/);
  const descriptor = JSON.parse(await readFile(new URL("../contract/golden-v1.json", import.meta.url), "utf8"));
  const fetchImpl = async (url) => new Response(JSON.stringify(String(url).endsWith("descriptor") ? descriptor : { descriptor, samples: [] }), { status: 200 });
  await assert.rejects(openUnoQHttp({ address: "http://127.0.0.1:7000", expectedDeviceUuid: "00000000-0000-4000-8000-000000000000", fetchImpl }), /expected UUID/);
  const transport = await openUnoQHttp({ address: "http://127.0.0.1:7000", expectedDeviceUuid: descriptor.deviceUuid, fetchImpl });
  assert.equal((await transport.verify()).deviceUuid, descriptor.deviceUuid);
  await transport.close();
});

test("UNO Q HTTP adapter bounds bodies and makes identity changes require reconnect", async () => {
  const descriptor = JSON.parse(await readFile(new URL("../contract/golden-v1.json", import.meta.url), "utf8"));
  await assert.rejects(openUnoQHttp({ address: "http://localhost:7000", expectedDeviceUuid: descriptor.deviceUuid, maximumResponseBytes: 8, fetchImpl: async () => new Response(JSON.stringify(descriptor)) }), /exceeds/);
  let requests = 0;
  const fetchImpl = async url => {
    requests++;
    const body = String(url).endsWith("descriptor") ? descriptor : { descriptor: { ...descriptor, bootId: "different-boot" }, samples: [] };
    return new Response(JSON.stringify(body));
  };
  const transport = await openUnoQHttp({ address: "http://localhost:7000", expectedDeviceUuid: descriptor.deviceUuid, pollMs: 100, fetchImpl });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(transport.diagnostics().requiresReconnect, true);
  assert.match(transport.diagnostics().error, /reconnect/);
  const stoppedAt = requests;
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(requests, stoppedAt);
  await transport.close();
});

test("closing UNO Q HTTP transport aborts an active bounded poll", async () => {
  const descriptor = JSON.parse(await readFile(new URL("../contract/golden-v1.json", import.meta.url), "utf8"));
  let call = 0, aborted = false;
  const fetchImpl = async (_url, options) => {
    if (call++ === 0) return new Response(JSON.stringify(descriptor));
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { aborted = true; reject(options.signal.reason); }, { once: true }));
  };
  const transport = await openUnoQHttp({ address: "http://localhost:7000", expectedDeviceUuid: descriptor.deviceUuid, fetchImpl });
  await new Promise(resolve => setTimeout(resolve, 20));
  await transport.close();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(aborted, true);
});

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
