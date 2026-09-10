import { describe, expect, it } from "vitest";
import { BoundedBackoff, LiveConnectionController, ProtocolValidationError, isRecoveryDevice } from "@/lib/live/connection";
import { DEMO_CANDIDATE, DEMO_DEVICE_UUID, DemoReadOnlyTransport } from "@/lib/live/demo";
import type { DeviceCandidate, HandshakeResponse, SampleBatch } from "@/lib/live/schemas";
import type { ReadOnlyTransportAdapter, ReadOnlyTransportSession } from "@/lib/live/transport";

describe("safe live connection", () => {
  it("discovers without opening, handshakes only after selection, and streams deterministic raw data", async () => {
    const adapter = new DemoReadOnlyTransport({ seed: 7, sampleCycles: 2, hostStartMs: 1000 });
    const states: string[] = [];
    const controller = new LiveConnectionController([adapter], { now: () => 999, nonce: () => "0123456789abcdef", onState: (state) => states.push(state) });
    const candidates = await controller.discover();
    expect(candidates).toEqual([DEMO_CANDIDATE]);
    const session = await controller.connect(candidates[0]);
    expect(session.deviceUuid).toBe(DEMO_DEVICE_UUID);
    expect(controller.pinnedDeviceUuid).toBe(DEMO_DEVICE_UUID);
    const abort = new AbortController();
    const received = [];
    try {
      for await (const sample of controller.samples(abort.signal)) received.push(sample);
    } catch { /* finite demo stream intentionally ends as a disconnect */ }
    expect(received).toHaveLength(14);
    expect(received.slice(0, 7).map((sample) => sample.channelId)).toEqual(controller.profile?.channels.map((channel) => channel.id));
    expect(states).toEqual(expect.arrayContaining(["DISCOVERING", "CONNECTING", "HANDSHAKING", "STREAMING", "RETRY_WAIT"]));
  });

  it("rejects EDL/recovery and busy devices before opening them", async () => {
    let opens = 0;
    const adapter = new DemoReadOnlyTransport();
    const wrapped: ReadOnlyTransportAdapter = { ...adapter, kind: "DEMO", enumerate: adapter.enumerate.bind(adapter), open: async (...args) => { opens += 1; return adapter.open(...args); } };
    const controller = new LiveConnectionController([wrapped]);
    const recovery: DeviceCandidate = { ...DEMO_CANDIDATE, id: "usb:9008", label: "Qualcomm EDL", recoveryMode: true };
    await expect(controller.connect(recovery)).rejects.toMatchObject({ code: "RECOVERY_DEVICE" });
    await expect(controller.connect({ ...DEMO_CANDIDATE, ownership: "BUSY" })).rejects.toMatchObject({ code: "BUSY" });
    expect(isRecoveryDevice(recovery)).toBe(true);
    expect(opens).toBe(0);
  });

  it("pins identity and rejects a different UUID on reconnect", async () => {
    const controller = new LiveConnectionController([new DemoReadOnlyTransport()], { pinnedDeviceUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nonce: () => "0123456789abcdef" });
    await expect(controller.connect(DEMO_CANDIDATE)).rejects.toMatchObject({ code: "IDENTITY" });
    expect(controller.state).toBe("ERROR");
  });

  it("rejects nonce mismatch and schema change before yielding unsafe samples", async () => {
    const base = new DemoReadOnlyTransport({ sampleCycles: 1 });
    const raw = await base.open(DEMO_CANDIDATE);
    const badSession: ReadOnlyTransportSession = {
      handshake: async (request): Promise<HandshakeResponse> => ({ ...(await raw.handshake(request)), nonce: "wrong-nonce-value" }),
      sampleBatches: raw.sampleBatches.bind(raw),
      close: raw.close.bind(raw),
    };
    const badHandshake: ReadOnlyTransportAdapter = { kind: "DEMO", enumerate: base.enumerate.bind(base), open: async () => badSession };
    await expect(new LiveConnectionController([badHandshake], { nonce: () => "0123456789abcdef" }).connect(DEMO_CANDIDATE)).rejects.toBeInstanceOf(ProtocolValidationError);

    const raw2 = await base.open(DEMO_CANDIDATE);
    const changed: ReadOnlyTransportSession = {
      handshake: raw2.handshake.bind(raw2),
      async *sampleBatches(): AsyncIterable<SampleBatch> {
        yield {
          schemaHash: "f".repeat(64),
          bootId: "demo-boot-42",
          samples: [{ sequence: 0, deviceMonotonicUs: 0, hostReceiveTimeMs: 1, channelId: "sensor.vibration_rms", value: 2.4, quality: ["GOOD"], calibrationRevision: 1 }],
        };
      },
      close: raw2.close.bind(raw2),
    };
    const controller = new LiveConnectionController([{ kind: "DEMO", enumerate: base.enumerate.bind(base), open: async () => changed }], { nonce: () => "0123456789abcdef" });
    await controller.connect(DEMO_CANDIDATE);
    await expect(async () => { for await (const _sample of controller.samples()) void _sample; }).rejects.toThrow("schema");
  });

  it("uses deterministic bounded reconnect backoff", () => {
    const backoff = new BoundedBackoff(100, 500, 2);
    expect([backoff.nextMs(), backoff.nextMs(), backoff.nextMs(), backoff.nextMs(), backoff.nextMs()]).toEqual([100, 200, 400, 500, 500]);
    backoff.reset();
    expect(backoff.nextMs()).toBe(100);
  });

  it("counts sequence gaps and rejects values that violate channel datatypes", async () => {
    const base = new DemoReadOnlyTransport({ sampleCycles: 1 });
    const makeController = async (samples: SampleBatch["samples"]) => {
      const raw = await base.open(DEMO_CANDIDATE);
      const session: ReadOnlyTransportSession = {
        handshake: raw.handshake.bind(raw),
        async *sampleBatches() { yield { schemaHash: "341bca7809722dcbfe31fac476065c39c22ed88554f225bb9d0b84df5617421f", bootId: "demo-boot-42", samples }; },
        close: raw.close.bind(raw),
      };
      const controller = new LiveConnectionController([{ kind: "DEMO", enumerate: base.enumerate.bind(base), open: async () => session }], { nonce: () => "0123456789abcdef" });
      await controller.connect(DEMO_CANDIDATE);
      return controller;
    };

    const valid = (sequence: number) => ({ sequence, deviceMonotonicUs: sequence, hostReceiveTimeMs: sequence + 1, channelId: "vfd.output_current", value: 86, quality: ["GOOD" as const], calibrationRevision: 1 });
    const gapController = await makeController([valid(0), valid(3)]);
    await expect(async () => { for await (const _sample of gapController.samples()) void _sample; }).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(gapController.session?.droppedSamples).toBe(2);

    const wrongTypeController = await makeController([{ ...valid(0), value: 1.25 }]);
    await expect(async () => { for await (const _sample of wrongTypeController.samples()) void _sample; }).rejects.toThrow("UINT16");
  });
});
