import type { ChannelDescriptor } from "@/lib/live";
import type { EngineeringBinding, EngineeringState } from "./types";

export interface BindingValidationContext {
  advertisedChannels: readonly ChannelDescriptor[];
  deviceUuid: string;
  schemaHash: string;
}

export interface LiveEngineeringValue {
  raw: number | boolean | string;
  normalized?: number | boolean | string;
  atMs: number;
  ageMs: number;
  quality: "GOOD" | "STALE" | "OUT_OF_RANGE" | "UNAVAILABLE";
}

const NUMERIC_TYPES = new Set(["FLOAT32", "FLOAT64", "INT8", "UINT8", "INT16", "UINT16", "INT32", "UINT32", "INT64", "UINT64"]);

export function validateUnitConversion(binding: Pick<EngineeringBinding, "sourceUnit" | "canonicalUnit" | "scale" | "offset">): string | null {
  if (binding.sourceUnit === binding.canonicalUnit) return binding.scale === 1 && binding.offset === 0 ? null : "Same-unit bindings require identity scale and offset unless a cited conversion registry entry exists.";
  const encoded = binding.sourceUnit.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.+)$/);
  if (encoded && encoded[2] === binding.canonicalUnit && Number(encoded[1]) === binding.scale && binding.offset === 0) return null;
  return `Unsupported unit conversion ${binding.sourceUnit} → ${binding.canonicalUnit}; attach a reviewed conversion registry entry before activation.`;
}

export function validateLiveEngineeringSample(binding: EngineeringBinding, sample: { value: number | boolean | string; atMs: number; quality: "GOOD" | "STALE" } | undefined, nowMs: number): string[] {
  const errors: string[] = [];
  if (!sample) return ["A live sample from the pinned channel is required."];
  if (!Number.isFinite(sample.atMs) || sample.atMs < 0 || sample.atMs > nowMs) errors.push("Live sample timestamp is invalid or in the future.");
  if (sample.quality !== "GOOD" || nowMs - sample.atMs > binding.cadenceMs * 2) errors.push("Live sample is stale or not GOOD.");
  if (NUMERIC_TYPES.has(binding.dataType) && (typeof sample.value !== "number" || !Number.isFinite(sample.value))) errors.push("Live sample does not match the numeric channel data type.");
  if (binding.dataType === "BOOLEAN" && typeof sample.value !== "boolean") errors.push("Live sample does not match the boolean channel data type.");
  if (binding.dataType === "STRING" && typeof sample.value !== "string") errors.push("Live sample does not match the string channel data type.");
  return errors;
}

export const EMPTY_ENGINEERING_STATE: EngineeringState = { schemaVersion: 1, revision: 0, bindings: [], proposals: [] };

export function normalizeEngineeringValue(raw: number | boolean | string, binding: Pick<EngineeringBinding, "scale" | "offset">): number | boolean | string {
  return typeof raw === "number" ? raw * binding.scale + binding.offset : raw;
}

export function previewEngineeringValue(binding: EngineeringBinding, sample: { value: number | boolean | string; atMs: number; quality: "GOOD" | "STALE" } | undefined, nowMs: number): LiveEngineeringValue | null {
  if (!sample) return null;
  const normalized = normalizeEngineeringValue(sample.value, binding);
  const ageMs = Math.max(0, nowMs - sample.atMs);
  const outside = typeof normalized === "number" && (normalized < binding.range.min || normalized > binding.range.max);
  return { raw: sample.value, normalized, atMs: sample.atMs, ageMs, quality: sample.quality === "STALE" || ageMs > binding.cadenceMs * 2 ? "STALE" : outside ? "OUT_OF_RANGE" : "GOOD" };
}

export function validateEngineeringBinding(binding: EngineeringBinding, context: BindingValidationContext): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const channel = context.advertisedChannels.find((item) => item.id === binding.channelId);
  if (!context.deviceUuid || binding.deviceUuid !== context.deviceUuid) errors.push("Binding device identity does not match the connected device.");
  if (!context.schemaHash || binding.schemaHash !== context.schemaHash) errors.push("Binding schema hash does not match the connected descriptor.");
  if (!channel) errors.push("The selected channel is not advertised by the connected device descriptor.");
  if (!binding.assetId.trim() || !binding.signal.trim()) errors.push("Asset and signal are required.");
  if (!binding.sourceUnit.trim() || !binding.canonicalUnit.trim()) errors.push("Source and canonical units are required; unitless values must be explicitly labelled.");
  if (channel && binding.dataType !== channel.dataType) errors.push("Data type must match the advertised channel descriptor.");
  if (channel && binding.sourceUnit !== channel.rawUnit) errors.push("Source unit must match the advertised channel descriptor.");
  if (!Number.isFinite(binding.scale) || binding.scale === 0) errors.push("Scale must be finite and non-zero.");
  if (!Number.isFinite(binding.offset)) errors.push("Offset must be finite.");
  const unitError = validateUnitConversion(binding);
  if (unitError) errors.push(unitError);
  if (!Number.isFinite(binding.range.min) || !Number.isFinite(binding.range.max) || binding.range.min >= binding.range.max) errors.push("Range minimum must be lower than its finite maximum.");
  if (!Number.isInteger(binding.cadenceMs) || binding.cadenceMs < 50 || binding.cadenceMs > 86_400_000) errors.push("Cadence must be an integer between 50 ms and 24 hours.");
  if (binding.modbus) {
    if (channel?.sourceKind !== "MODBUS_RTU") errors.push("A register may only be bound to an advertised Modbus channel.");
    if (!Number.isInteger(binding.modbus.address) || binding.modbus.address < 0 || binding.modbus.address > 65_535) errors.push("Register address must be an integer from 0 to 65535.");
    if (channel?.registerAddress === undefined) errors.push("The descriptor does not advertise a register address; arbitrary reads are blocked.");
    else if (binding.modbus.address !== channel.registerAddress) errors.push("Register address must exactly match the advertised channel descriptor.");
    if (binding.modbus.functionCode !== 3 && binding.modbus.functionCode !== 4) errors.push("Only read-only Modbus function 3 or 4 is allowed.");
    if (!binding.modbus.deviceModel.trim() || /^(unknown|generic|vfd)$/i.test(binding.modbus.deviceModel.trim())) errors.push("An exact device model is required for register activation.");
    if (!binding.modbus.evidence.official || !binding.modbus.evidence.id.trim() || !binding.modbus.evidence.title.trim() || !/^https:\/\//i.test(binding.modbus.evidence.url)) errors.push("A cited official HTTPS manufacturer source is required for register activation.");
  } else if (channel?.sourceKind === "MODBUS_RTU") errors.push("This advertised Modbus channel requires its descriptor-backed register details and official evidence.");
  return { errors, warnings };
}

export function approveEngineeringProposal(state: EngineeringState, proposalId: string, actor: string, nowMs: number, context: BindingValidationContext): EngineeringState {
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "IN_REVIEW") throw new Error("Only an in-review proposal can be approved.");
  if (proposal.baseRevision !== state.revision) throw new Error(`Version conflict: proposal targets revision ${proposal.baseRevision}, active revision is ${state.revision}.`);
  const validation = validateEngineeringBinding(proposal.binding, context);
  if (validation.errors.length) throw new Error(validation.errors.join(" "));
  const approved: EngineeringBinding = { ...proposal.binding, state: "APPROVED", approvedAtMs: nowMs, approvedBy: actor };
  return {
    ...state,
    revision: state.revision + 1,
    bindings: [...state.bindings.filter((item) => !(item.assetId === approved.assetId && item.channelId === approved.channelId)), approved],
    proposals: state.proposals.map((item) => item.id === proposalId ? { ...item, status: "APPROVED", binding: approved, validation } : item),
  };
}
