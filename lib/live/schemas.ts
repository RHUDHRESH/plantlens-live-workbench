import { z } from "zod";

const safeId = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:/+\-]+$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");

export const TransportKindSchema = z.enum(["COM", "USB_SERVICE", "NETWORK", "DEMO"]);
export const TransportOwnershipSchema = z.enum(["AVAILABLE", "BUSY", "UNAUTHORIZED"]);

export const DeviceCandidateSchema = z.object({
  id: safeId,
  transport: TransportKindSchema,
  label: z.string().min(1).max(200),
  ownership: TransportOwnershipSchema,
  vendorId: z.string().max(16).optional(),
  productId: z.string().max(16).optional(),
  path: z.string().max(500).optional(),
  recoveryMode: z.boolean().default(false),
}).strict();

export const ChannelDataTypeSchema = z.enum(["FLOAT32", "FLOAT64", "INT16", "UINT16", "INT32", "UINT32", "BOOLEAN", "STRING"]);
export const ChannelSourceKindSchema = z.enum(["RAW_ADC", "ANALOG_4_20_MA", "ANALOG_0_10_V", "PULSE", "DIGITAL", "I2C", "SPI", "CAN", "MODBUS_RTU"]);

export const ChannelDescriptorSchema = z.object({
  id: safeId,
  label: z.string().min(1).max(200),
  dataType: ChannelDataTypeSchema,
  sourceKind: ChannelSourceKindSchema,
  rawUnit: z.string().min(1).max(40),
  samplingRateHz: z.number().positive().max(20_000),
  calibrationRevision: z.number().int().nonnegative(),
  access: z.literal("READ_ONLY"),
  mappingStatus: z.enum(["UNMAPPED", "MAPPED"]).default("UNMAPPED"),
  registerAddress: z.number().int().nonnegative().max(65_535).optional(),
}).strict().superRefine((channel, context) => {
  if (channel.sourceKind === "MODBUS_RTU" && channel.registerAddress === undefined) {
    context.addIssue({ code: "custom", message: "A Modbus channel requires a register address", path: ["registerAddress"] });
  }
});

export const DeviceProfileSchema = z.object({
  deviceUuid: z.string().uuid(),
  boardModel: z.string().min(1).max(120),
  firmwareHash: sha256,
  protocolVersion: z.object({ major: z.number().int().nonnegative(), minor: z.number().int().nonnegative() }).strict(),
  schemaHash: sha256,
  capabilities: z.array(z.enum(["SENSOR_STREAM", "CLOCK_MONOTONIC", "READ_ONLY_MODBUS", "NDJSON_DIAGNOSTIC", "CBOR_STREAM"])).max(16),
  clock: z.object({ source: z.enum(["DEVICE_MONOTONIC", "PTP", "NTP"]), resolutionUs: z.number().int().positive(), uncertaintyUs: z.number().int().nonnegative() }).strict(),
  channelCount: z.number().int().nonnegative().max(128),
  maximumRateHz: z.number().positive().max(20_000),
  channels: z.array(ChannelDescriptorSchema).max(128),
}).strict().superRefine((profile, context) => {
  if (profile.channelCount !== profile.channels.length) {
    context.addIssue({ code: "custom", message: "channelCount does not match channels", path: ["channelCount"] });
  }
  const seen = new Set<string>();
  for (const [index, channel] of profile.channels.entries()) {
    if (seen.has(channel.id)) context.addIssue({ code: "custom", message: `Duplicate channel id: ${channel.id}`, path: ["channels", index, "id"] });
    seen.add(channel.id);
  }
});

export const HandshakeRequestSchema = z.object({
  operation: z.literal("PLANTLENS_READ_ONLY_HANDSHAKE"),
  protocolMajor: z.literal(1),
  nonce: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export const HandshakeResponseSchema = z.object({
  operation: z.literal("PLANTLENS_READ_ONLY_HANDSHAKE_ACK"),
  nonce: z.string().min(16).max(128),
  bootId: safeId,
  readOnly: z.literal(true),
  profile: DeviceProfileSchema,
}).strict();

export const RawValueSchema = z.union([z.number().finite(), z.boolean(), z.string().max(1_024)]);
export const QualityFlagSchema = z.enum(["GOOD", "STALE", "OUT_OF_RANGE", "SENSOR_FAULT", "CLOCK_UNCERTAIN", "DROPPED_BEFORE"]);

export const RawSampleSchema = z.object({
  sequence: z.number().int().nonnegative().safe(),
  deviceMonotonicUs: z.number().int().nonnegative().safe(),
  hostReceiveTimeMs: z.number().int().nonnegative().safe(),
  channelId: safeId,
  value: RawValueSchema,
  quality: z.array(QualityFlagSchema).min(1).max(8),
  calibrationRevision: z.number().int().nonnegative(),
}).strict();

export const SampleBatchSchema = z.object({
  schemaHash: sha256,
  bootId: safeId,
  samples: z.array(RawSampleSchema).min(1).max(128),
}).strict();

export const DeviceSessionSchema = z.object({
  id: safeId,
  deviceUuid: z.string().uuid(),
  candidateId: safeId,
  transport: TransportKindSchema,
  bootId: safeId,
  schemaHash: sha256,
  connectedAtMs: z.number().int().nonnegative(),
  state: z.enum(["CONNECTING", "HANDSHAKING", "STREAMING", "CLOSED", "ERROR"]),
  lastSequence: z.number().int().nonnegative().nullable(),
  droppedSamples: z.number().int().nonnegative(),
}).strict();

export type DeviceCandidate = z.infer<typeof DeviceCandidateSchema>;
export type ChannelDescriptor = z.infer<typeof ChannelDescriptorSchema>;
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;
export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>;
export type HandshakeResponse = z.infer<typeof HandshakeResponseSchema>;
export type RawSample = z.infer<typeof RawSampleSchema>;
export type SampleBatch = z.infer<typeof SampleBatchSchema>;
export type DeviceSession = z.infer<typeof DeviceSessionSchema>;
