import { randomUUID } from "node:crypto";
import { stableHash } from "../protocol.mjs";

const channels = [
  ["motor_current", "Motor current", "A", 0, 40],
  ["vibration_rms", "Vibration RMS", "mm/s", 0, 20],
  ["bearing_temperature", "Bearing temperature", "°C", -20, 180],
  ["vfd_output_frequency", "VFD output frequency", "Hz", 0, 100],
  ["vfd_dc_bus", "VFD DC bus", "V", 0, 900],
  ["vfd_status", "VFD status word", "word", 0, 65535],
].map(([id, label, unit, minimum, maximum]) => ({ id, label, unit, minimum, maximum, valueType: "float64", sampleRateHz: 20, access: "READ_ONLY", mappingState: "UNMAPPED" }));

export class DemoTransport {
  constructor() {
    this.deviceUuid = "157d85ed-83de-4f67-a3c1-b828999f6840";
    this.bootId = randomUUID();
    this.sequence = 0;
    this.timer = null;
    this.startedAt = Date.now();
    this.descriptor = {
      magic: "PLANTLENS/1",
      protocol: { major: 1, minor: 0, encoding: "json" },
      deviceUuid: this.deviceUuid,
      boardModel: "Arduino UNO Q (verified simulator)",
      firmwareHash: stableHash({ firmware: "plantlens-companion-demo", version: "0.1.0" }),
      bootId: this.bootId,
      schemaHash: stableHash(channels),
      capabilities: ["DESCRIBE", "STREAM", "HEALTH"],
      writesSupported: false,
      clock: { kind: "MONOTONIC_MS", uncertaintyMs: 1 },
      channelCount: channels.length,
      maximumRateHz: 20,
      channels,
    };
  }

  async verify() { return this.descriptor; }

  subscribe(onSample) {
    const tick = () => {
      const t = (Date.now() - this.startedAt) / 1000;
      const load = 0.62 + Math.sin(t / 8) * 0.05;
      const raw = [11.2 + load * 8 + Math.sin(t * 3) * 0.18, 2.1 + load * 1.5 + Math.sin(t * 5) * 0.08, 47 + t / 600 + Math.sin(t / 25), 50, 585 + Math.sin(t / 6) * 2, 3];
      onSample({
        type: "sample", deviceUuid: this.deviceUuid, schemaHash: this.descriptor.schemaHash, bootId: this.bootId,
        sequence: this.sequence++, deviceTimeMs: Date.now() - this.startedAt, receivedTimeMs: Date.now(), quality: "GOOD",
        values: channels.map((channel, index) => ({ channelId: channel.id, rawValue: Number(raw[index].toFixed(3)), unit: channel.unit })),
      });
    };
    tick();
    this.timer = setInterval(tick, 50);
    return () => { if (this.timer) clearInterval(this.timer); this.timer = null; };
  }
}
