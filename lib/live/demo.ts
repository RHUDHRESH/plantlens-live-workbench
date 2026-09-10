import type { DeviceCandidate, DeviceProfile, HandshakeRequest, HandshakeResponse, RawSample, SampleBatch } from "./schemas";
import type { ReadOnlyTransportAdapter, ReadOnlyTransportSession } from "./transport";
import { TransportError } from "./transport";

export const DEMO_DEVICE_UUID = "157d85ed-83de-4f67-a3c1-b828999f6840";
export const DEMO_SCHEMA_HASH = "341bca7809722dcbfe31fac476065c39c22ed88554f225bb9d0b84df5617421f";
const DEMO_FIRMWARE_HASH = "94b597bb88c84d741193dd74a36946d558fc447b462543d4bde207647c22c4df";

export const DEMO_CANDIDATE: DeviceCandidate = {
  id: "demo:uno-q-01",
  transport: "DEMO",
  label: "UNO Q — induction motor demonstration",
  ownership: "AVAILABLE",
  path: "demo://uno-q-01",
  recoveryMode: false,
};

export const DEMO_PROFILE: DeviceProfile = {
  deviceUuid: DEMO_DEVICE_UUID,
  boardModel: "Arduino UNO Q (deterministic demonstration)",
  firmwareHash: DEMO_FIRMWARE_HASH,
  protocolVersion: { major: 1, minor: 0 },
  schemaHash: DEMO_SCHEMA_HASH,
  capabilities: ["SENSOR_STREAM", "CLOCK_MONOTONIC", "READ_ONLY_MODBUS", "NDJSON_DIAGNOSTIC"],
  clock: { source: "DEVICE_MONOTONIC", resolutionUs: 1_000, uncertaintyUs: 2_000 },
  channelCount: 7,
  maximumRateHz: 140,
  channels: [
    { id: "sensor.vibration_rms", label: "Motor vibration sensor (raw)", dataType: "FLOAT32", sourceKind: "ANALOG_0_10_V", rawUnit: "V", samplingRateHz: 20, calibrationRevision: 1, access: "READ_ONLY", mappingStatus: "UNMAPPED" },
    { id: "sensor.bearing_temperature", label: "Bearing temperature sensor (raw)", dataType: "FLOAT32", sourceKind: "ANALOG_4_20_MA", rawUnit: "mA", samplingRateHz: 20, calibrationRevision: 1, access: "READ_ONLY", mappingStatus: "UNMAPPED" },
    { id: "sensor.shaft_pulses", label: "Shaft speed pulse sensor (raw)", dataType: "UINT32", sourceKind: "PULSE", rawUnit: "pulses", samplingRateHz: 20, calibrationRevision: 1, access: "READ_ONLY", mappingStatus: "UNMAPPED" },
    { id: "vfd.output_frequency", label: "VFD output frequency register", dataType: "UINT16", sourceKind: "MODBUS_RTU", rawUnit: "0.01Hz", samplingRateHz: 10, calibrationRevision: 1, access: "READ_ONLY", mappingStatus: "UNMAPPED", registerAddress: 4096 },
    { id: "vfd.output_current", label: "VFD output current register", dataType: "UINT16", sourceKind: "MODBUS_RTU", rawUnit: "0.1A", samplingRateHz: 10, calibrationRevision: 1, access: "READ_ONLY", mappingStatus: "UNMAPPED", registerAddress: 4097 },
    { id: "vfd.dc_bus_voltage", label: "VFD DC bus voltage register", dataType: "UINT16", sourceKind: "MODBUS_RTU", rawUnit: "V", samplingRateHz: 5, calibrationRevision: 1, access: "READ_ONLY", mappingStatus: "UNMAPPED", registerAddress: 4098 },
    { id: "vfd.status_word", label: "VFD status word register", dataType: "UINT16", sourceKind: "MODBUS_RTU", rawUnit: "bitfield", samplingRateHz: 5, calibrationRevision: 1, access: "READ_ONLY", mappingStatus: "UNMAPPED", registerAddress: 4099 },
  ],
};

export interface DemoTransportOptions { seed?: number; sampleCycles?: number; hostStartMs?: number }

class DemoSession implements ReadOnlyTransportSession {
  private closed = false;
  constructor(private readonly options: Required<DemoTransportOptions>) {}

  async handshake(request: HandshakeRequest, signal?: AbortSignal): Promise<HandshakeResponse> {
    if (this.closed || signal?.aborted) throw new TransportError("DISCONNECTED", "Demo session is closed");
    return { operation: "PLANTLENS_READ_ONLY_HANDSHAKE_ACK", nonce: request.nonce, bootId: `demo-boot-${this.options.seed}`, readOnly: true, profile: DEMO_PROFILE };
  }

  async *sampleBatches(signal?: AbortSignal): AsyncIterable<SampleBatch> {
    let randomState = this.options.seed >>> 0;
    const random = () => {
      randomState = (Math.imul(1_664_525, randomState) + 1_013_904_223) >>> 0;
      return randomState / 0x1_0000_0000;
    };
    let sequence = 0;
    for (let cycle = 0; cycle < this.options.sampleCycles && !this.closed && !signal?.aborted; cycle += 1) {
      const phase = cycle / 20;
      const values: Array<RawSample["value"]> = [
        Number((2.4 + Math.sin(phase) * 0.15 + random() * 0.02).toFixed(4)),
        Number((11.8 + cycle * 0.002 + random() * 0.03).toFixed(4)),
        30 + (cycle % 2),
        5000,
        86 + Math.round(random() * 2),
        565 + Math.round(random() * 2),
        3,
      ];
      const samples = DEMO_PROFILE.channels.map((channel, channelIndex): RawSample => ({
        sequence: sequence++,
        deviceMonotonicUs: cycle * 50_000,
        hostReceiveTimeMs: this.options.hostStartMs + cycle * 50,
        channelId: channel.id,
        value: values[channelIndex],
        quality: ["GOOD"],
        calibrationRevision: channel.calibrationRevision,
      }));
      yield { schemaHash: DEMO_SCHEMA_HASH, bootId: `demo-boot-${this.options.seed}`, samples };
    }
  }

  async close(): Promise<void> { this.closed = true; }
}

export class DemoReadOnlyTransport implements ReadOnlyTransportAdapter {
  readonly kind = "DEMO" as const;
  private readonly options: Required<DemoTransportOptions>;
  constructor(options: DemoTransportOptions = {}) {
    this.options = { seed: options.seed ?? 42, sampleCycles: options.sampleCycles ?? 200, hostStartMs: options.hostStartMs ?? 1_750_000_000_000 };
  }
  async enumerate(signal?: AbortSignal): Promise<readonly DeviceCandidate[]> {
    return signal?.aborted ? [] : [DEMO_CANDIDATE];
  }
  async open(candidate: DeviceCandidate, signal?: AbortSignal): Promise<ReadOnlyTransportSession> {
    if (signal?.aborted || candidate.id !== DEMO_CANDIDATE.id) throw new TransportError("NOT_FOUND", "Demo device not found");
    return new DemoSession(this.options);
  }
}

