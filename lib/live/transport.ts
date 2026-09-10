import type { DeviceCandidate, HandshakeRequest, HandshakeResponse, SampleBatch } from "./schemas";

/**
 * Deliberately capability-minimal. There is no generic send, terminal, register-write,
 * reset, or firmware method on either interface.
 */
export interface ReadOnlyTransportSession {
  handshake(request: HandshakeRequest, signal?: AbortSignal): Promise<HandshakeResponse>;
  sampleBatches(signal?: AbortSignal): AsyncIterable<SampleBatch>;
  close(): Promise<void>;
}

export interface ReadOnlyTransportAdapter {
  readonly kind: DeviceCandidate["transport"];
  enumerate(signal?: AbortSignal): Promise<readonly DeviceCandidate[]>;
  open(candidate: DeviceCandidate, signal?: AbortSignal): Promise<ReadOnlyTransportSession>;
}

export class TransportError extends Error {
  constructor(public readonly code: "BUSY" | "UNAUTHORIZED" | "NOT_FOUND" | "UNSUPPORTED" | "DISCONNECTED" | "PROTOCOL", message: string) {
    super(message);
    this.name = "TransportError";
  }
}

