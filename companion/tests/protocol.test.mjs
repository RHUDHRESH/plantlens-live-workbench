import test from "node:test";
import assert from "node:assert/strict";
import { DemoTransport } from "../src/transports/demo.mjs";
import { NdjsonDecoder, validateDescriptor, validateSample } from "../src/protocol.mjs";

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
});
