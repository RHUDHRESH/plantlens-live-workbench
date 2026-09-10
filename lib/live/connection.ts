import {
  DeviceCandidateSchema,
  DeviceProfileSchema,
  DeviceSessionSchema,
  HandshakeResponseSchema,
  RawSampleSchema,
  SampleBatchSchema,
  type DeviceCandidate,
  type DeviceProfile,
  type DeviceSession,
  type HandshakeRequest,
  type RawSample,
} from "./schemas";
import type { ReadOnlyTransportAdapter, ReadOnlyTransportSession } from "./transport";
import { TransportError } from "./transport";

export type ConnectionState = "DISCONNECTED" | "DISCOVERING" | "CONNECTING" | "HANDSHAKING" | "STREAMING" | "RETRY_WAIT" | "ERROR";

export class ProtocolValidationError extends Error {
  constructor(public readonly code: "RECOVERY_DEVICE" | "VERSION" | "SCHEMA" | "IDENTITY" | "HANDSHAKE" | "SAMPLE", message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

export class BoundedBackoff {
  private attempt = 0;
  constructor(private readonly initialMs = 250, private readonly maximumMs = 8_000, private readonly multiplier = 2) {
    if (initialMs < 0 || maximumMs < initialMs || multiplier < 1) throw new Error("Invalid backoff configuration");
  }
  nextMs(): number {
    const delay = Math.min(this.maximumMs, this.initialMs * this.multiplier ** this.attempt);
    this.attempt += 1;
    return delay;
  }
  reset(): void { this.attempt = 0; }
  get attempts(): number { return this.attempt; }
}

export function isRecoveryDevice(candidate: DeviceCandidate): boolean {
  const text = `${candidate.id} ${candidate.label} ${candidate.path ?? ""}`.toLowerCase();
  return candidate.recoveryMode || /\b(edl|recovery|bootloader|9008)\b/.test(text);
}

export function validateProfile(profile: unknown, expectedProtocolMajor = 1, expectedSchemaHash?: string): DeviceProfile {
  const result = DeviceProfileSchema.safeParse(profile);
  if (!result.success) throw new ProtocolValidationError("SCHEMA", result.error.issues.map((issue) => issue.message).join("; "));
  if (result.data.protocolVersion.major !== expectedProtocolMajor) {
    throw new ProtocolValidationError("VERSION", `Unsupported protocol major ${result.data.protocolVersion.major}`);
  }
  if (expectedSchemaHash && result.data.schemaHash !== expectedSchemaHash) {
    throw new ProtocolValidationError("SCHEMA", "Device schema changed during the session");
  }
  return result.data;
}

function valueMatchesChannel(value: RawSample["value"], dataType: DeviceProfile["channels"][number]["dataType"]): boolean {
  switch (dataType) {
    case "BOOLEAN": return typeof value === "boolean";
    case "STRING": return typeof value === "string";
    case "FLOAT32":
    case "FLOAT64": return typeof value === "number" && Number.isFinite(value);
    case "INT8": return typeof value === "number" && Number.isInteger(value) && value >= -128 && value <= 127;
    case "UINT8": return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
    case "INT64":
    case "UINT64": {
      if (typeof value === "number" && !Number.isSafeInteger(value)) return false;
      if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d{1,20}$/.test(value))) return false;
      const integer = BigInt(value);
      return dataType === "UINT64" ? integer >= BigInt(0) && integer <= BigInt("18446744073709551615") : integer >= BigInt("-9223372036854775808") && integer <= BigInt("9223372036854775807");
    }
    case "INT16": return typeof value === "number" && Number.isInteger(value) && value >= -32_768 && value <= 32_767;
    case "UINT16": return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65_535;
    case "INT32": return typeof value === "number" && Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647;
    case "UINT32": return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4_294_967_295;
  }
}

export interface ConnectionOptions {
  expectedProtocolMajor?: number;
  pinnedDeviceUuid?: string;
  now?: () => number;
  nonce?: () => string;
  onState?: (state: ConnectionState, detail?: string) => void;
}

export class LiveConnectionController {
  private activeTransport: ReadOnlyTransportSession | null = null;
  private sessionValue: DeviceSession | null = null;
  private profileValue: DeviceProfile | null = null;
  private stateValue: ConnectionState = "DISCONNECTED";
  private pinnedUuid?: string;
  readonly backoff = new BoundedBackoff();

  constructor(private readonly adapters: readonly ReadOnlyTransportAdapter[], private readonly options: ConnectionOptions = {}) {
    this.pinnedUuid = options.pinnedDeviceUuid;
  }

  get state(): ConnectionState { return this.stateValue; }
  get session(): DeviceSession | null { return this.sessionValue; }
  get profile(): DeviceProfile | null { return this.profileValue; }
  get pinnedDeviceUuid(): string | undefined { return this.pinnedUuid; }

  async discover(signal?: AbortSignal): Promise<DeviceCandidate[]> {
    this.setState("DISCOVERING");
    try {
      const results = (await Promise.all(this.adapters.map((adapter) => adapter.enumerate(signal)))).flat();
      const candidates = results.map((candidate) => DeviceCandidateSchema.parse(candidate));
      const ids = new Set<string>();
      for (const candidate of candidates) {
        if (ids.has(candidate.id)) throw new ProtocolValidationError("SCHEMA", `Duplicate candidate id: ${candidate.id}`);
        ids.add(candidate.id);
      }
      this.setState("DISCONNECTED");
      return candidates;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async connect(candidate: DeviceCandidate, signal?: AbortSignal): Promise<DeviceSession> {
    const parsedCandidate = DeviceCandidateSchema.parse(candidate);
    if (isRecoveryDevice(parsedCandidate)) throw this.failAndReturn(new ProtocolValidationError("RECOVERY_DEVICE", "Recovery/EDL/bootloader devices cannot be connected"));
    if (parsedCandidate.ownership === "BUSY") throw this.failAndReturn(new TransportError("BUSY", "Device is busy, possibly owned by App Lab or another process"));
    if (parsedCandidate.ownership === "UNAUTHORIZED") throw this.failAndReturn(new TransportError("UNAUTHORIZED", "Device access is not authorized"));
    const adapter = this.adapters.find((item) => item.kind === parsedCandidate.transport);
    if (!adapter) throw this.failAndReturn(new TransportError("UNSUPPORTED", `No adapter for ${parsedCandidate.transport}`));

    await this.disconnect();
    this.setState("CONNECTING");
    try {
      this.activeTransport = await adapter.open(parsedCandidate, signal);
      this.setState("HANDSHAKING");
      const nonce = this.options.nonce?.() ?? "plantlens_readonly_nonce_0001";
      const request: HandshakeRequest = { operation: "PLANTLENS_READ_ONLY_HANDSHAKE", protocolMajor: 1, nonce };
      const rawResponse = await this.activeTransport.handshake(request, signal);
      const responseResult = HandshakeResponseSchema.safeParse(rawResponse);
      if (!responseResult.success || responseResult.data.nonce !== nonce) throw new ProtocolValidationError("HANDSHAKE", "Invalid handshake response or nonce");
      const profile = validateProfile(responseResult.data.profile, this.options.expectedProtocolMajor ?? 1);
      if (this.pinnedUuid && profile.deviceUuid !== this.pinnedUuid) throw new ProtocolValidationError("IDENTITY", "Connected device does not match the verified device UUID");
      this.pinnedUuid = profile.deviceUuid;
      this.profileValue = profile;
      const now = this.options.now?.() ?? Date.now();
      this.sessionValue = DeviceSessionSchema.parse({
        id: `session-${now}`,
        deviceUuid: profile.deviceUuid,
        candidateId: parsedCandidate.id,
        transport: parsedCandidate.transport,
        bootId: responseResult.data.bootId,
        schemaHash: profile.schemaHash,
        connectedAtMs: now,
        state: "STREAMING",
        lastSequence: null,
        droppedSamples: 0,
      });
      this.backoff.reset();
      this.setState("STREAMING");
      return this.sessionValue;
    } catch (error) {
      await this.activeTransport?.close().catch(() => undefined);
      this.activeTransport = null;
      this.fail(error);
      throw error;
    }
  }

  async *samples(signal?: AbortSignal): AsyncIterable<RawSample> {
    if (!this.activeTransport || !this.sessionValue || !this.profileValue || this.state !== "STREAMING") {
      throw new TransportError("DISCONNECTED", "No verified streaming session");
    }
    const channelMap = new Map(this.profileValue.channels.map((channel) => [channel.id, channel]));
    try {
      for await (const rawBatch of this.activeTransport.sampleBatches(signal)) {
        const batch = SampleBatchSchema.parse(rawBatch);
        if (batch.schemaHash !== this.sessionValue.schemaHash) throw new ProtocolValidationError("SCHEMA", "Device schema changed during the session");
        if (batch.bootId !== this.sessionValue.bootId) throw new ProtocolValidationError("IDENTITY", "Device rebooted; a new handshake is required");
        for (const value of batch.samples) {
          const sample = RawSampleSchema.parse(value);
          const channel = channelMap.get(sample.channelId);
          if (!channel) throw new ProtocolValidationError("SAMPLE", `Unknown channel: ${sample.channelId}`);
          if (sample.calibrationRevision !== channel.calibrationRevision) throw new ProtocolValidationError("SAMPLE", `Calibration revision mismatch for ${sample.channelId}`);
          if (!valueMatchesChannel(sample.value, channel.dataType)) throw new ProtocolValidationError("SAMPLE", `Value does not match ${channel.dataType} for ${sample.channelId}`);
          const previous = this.sessionValue.lastSequence;
          if (previous !== null && sample.sequence <= previous) throw new ProtocolValidationError("SAMPLE", "Sample sequence is not strictly increasing");
          if (previous !== null && sample.sequence > previous + 1) this.sessionValue.droppedSamples += sample.sequence - previous - 1;
          this.sessionValue.lastSequence = sample.sequence;
          yield sample;
        }
      }
      if (!signal?.aborted) throw new TransportError("DISCONNECTED", "Sample stream ended unexpectedly");
    } catch (error) {
      if (!signal?.aborted) {
        this.sessionValue.state = "ERROR";
        this.setState("RETRY_WAIT", `Retry in ${this.backoff.nextMs()} ms`);
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.activeTransport?.close().catch(() => undefined);
    if (this.sessionValue) this.sessionValue.state = "CLOSED";
    this.activeTransport = null;
    this.profileValue = null;
    this.setState("DISCONNECTED");
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.stateValue = state;
    this.options.onState?.(state, detail);
  }
  private fail(error: unknown): void { this.setState("ERROR", error instanceof Error ? error.message : "Unknown connection failure"); }
  private failAndReturn<T extends Error>(error: T): T { this.fail(error); return error; }
}
