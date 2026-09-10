/**
 * A small, deliberately data-only digital-twin configuration domain.
 *
 * It is separate from the PlantLens operational model: a twin describes what
 * has been configured, while observations are projected into snapshots.  No
 * operation in this module deletes configuration; histories remain auditable.
 */
import { createHash } from "node:crypto";

export const TWIN_SCHEMA_VERSION = 1 as const;

export type TwinValueType = "NUMBER" | "BOOLEAN" | "TEXT" | "ENUM";
export type SignalQuality = "GOOD" | "STALE" | "BAD" | "MISSING";
export type ProposalState = "QUEUED" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EDITED";

export interface SignalDefinition {
  key: string;
  label: string;
  valueType: TwinValueType;
  unit?: string;
  required?: boolean;
  enumValues?: readonly string[];
}

/** A template version is immutable once referenced by an asset instance. */
export interface AssetClassVersion {
  id: string;
  classId: string;
  version: number;
  name: string;
  description: string;
  signalDefinitions: readonly SignalDefinition[];
  attributes: Readonly<Record<string, string | number | boolean>>;
  retired?: boolean;
}

export interface AssetInstance {
  id: string;
  classVersionId: string;
  name: string;
  parentId?: string;
  attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface TwinSignal {
  id: string;
  assetId: string;
  definitionKey: string;
  label: string;
  valueType: TwinValueType;
  unit?: string;
  enumValues?: readonly string[];
}

/**
 * The only permitted mapping is y = multiplier * x + offset.  This is useful
 * for documented engineering-unit conversions and intentionally cannot run
 * expressions, scripts, or arbitrary functions.
 */
export interface AffineTransform {
  kind: "AFFINE";
  multiplier: number;
  offset: number;
}

export interface ChannelBinding {
  id: string;
  signalId: string;
  sourceId: string;
  channel: string;
  transform?: AffineTransform;
}

export type TopologyRelationKind = "FEEDS" | "DRIVES" | "FLOWS_TO" | "CONTROLS" | "CONTAINS" | "MEASURES";

export interface TopologyRelation {
  id: string;
  fromAssetId: string;
  toAssetId: string;
  kind: TopologyRelationKind;
  label?: string;
}

export interface TwinTopologyDraft {
  id: string;
  name: string;
  assetInstances: readonly AssetInstance[];
  signals: readonly TwinSignal[];
  channelBindings: readonly ChannelBinding[];
  relations: readonly TopologyRelation[];
}

export interface TwinTopologyVersion extends TwinTopologyDraft {
  version: number;
  createdAtMs: number;
  createdBy: string;
  parentTopologyId?: string;
  contentHash: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface SignalReading {
  sourceId: string;
  channel: string;
  value: number | boolean | string | null;
  observedAtMs: number;
  quality?: Exclude<SignalQuality, "MISSING">;
}

export interface ProjectedSignal {
  signalId: string;
  value: number | boolean | string | null;
  unit?: string;
  quality: SignalQuality;
  observedAtMs?: number;
  source?: Pick<ChannelBinding, "sourceId" | "channel">;
}

export interface TwinSnapshot {
  topologyId: string;
  topologyVersion: number;
  projectedAtMs: number;
  assets: ReadonlyArray<{ asset: AssetInstance; signals: readonly ProjectedSignal[] }>;
  relations: readonly TopologyRelation[];
}

export interface TwinConfiguration {
  id: string;
  activeTopology: TwinTopologyVersion;
  classVersions: readonly AssetClassVersion[];
  revision: number;
}

export interface TwinConfigProposal {
  id: string;
  configurationId: string;
  baseRevision: number;
  title: string;
  rationale: string;
  submittedBy: string;
  submittedAtMs: number;
  proposedTopology: TwinTopologyDraft;
  validation: ValidationResult;
  contentHash: string;
}

export interface ProposalRecord {
  proposal: TwinConfigProposal;
  state: ProposalState;
  reviewedBy?: string;
  reviewedAtMs?: number;
  reason?: string;
  replacementProposalId?: string;
}

export interface TwinAuditEvent {
  sequence: number;
  type: "PROPOSAL_SUBMITTED" | "REVIEW_STARTED" | "PROPOSAL_APPROVED" | "PROPOSAL_REJECTED" | "PROPOSAL_EDITED";
  actor: string;
  atMs: number;
  proposalId: string;
  payloadHash: string;
  previousHash: string;
  hash: string;
}

export interface InstantiateAssetInput {
  id: string;
  name: string;
  parentId?: string;
  attributes?: Record<string, string | number | boolean>;
}

const numeric = (key: string, label: string, unit: string, required = false): SignalDefinition => ({ key, label, valueType: "NUMBER", unit, required });
const bool = (key: string, label: string): SignalDefinition => ({ key, label, valueType: "BOOLEAN" });

function coreClass(id: string, name: string, description: string, signals: SignalDefinition[], attributes: Record<string, string | number | boolean> = {}): AssetClassVersion {
  return freeze({ id: `${id}@1`, classId: id, version: 1, name, description, signalDefinitions: signals, attributes });
}

/** Initial versioned templates. New versions are new records, never edits. */
export const CORE_ASSET_CLASS_TEMPLATES: readonly AssetClassVersion[] = freeze([
  coreClass("induction-motor", "Induction motor", "Three-phase squirrel-cage motor.", [numeric("speed_rpm", "Shaft speed", "rpm", true), numeric("current_a", "Phase current", "A"), numeric("winding_temp_c", "Winding temperature", "°C"), bool("running", "Running feedback")], { ratedPowerKw: 7.5, poles: 4 }),
  coreClass("variable-frequency-drive", "Variable-frequency drive", "Drive controlling AC motor speed.", [numeric("output_frequency_hz", "Output frequency", "Hz"), numeric("output_current_a", "Output current", "A"), bool("run_command", "Run command"), bool("faulted", "Faulted")]),
  coreClass("centrifugal-pump", "Centrifugal pump", "Rotodynamic liquid pump.", [numeric("flow_l_min", "Flow", "L/min", true), numeric("discharge_pressure_bar", "Discharge pressure", "bar"), bool("running", "Running feedback")]),
  coreClass("process-tank", "Process tank", "Liquid storage or process vessel.", [numeric("level_pct", "Level", "%", true), numeric("temperature_c", "Temperature", "°C")]),
  coreClass("pipe-segment", "Pipe segment", "Named pipe segment between process assets.", [numeric("pressure_bar", "Pressure", "bar"), numeric("flow_l_min", "Flow", "L/min")]),
  coreClass("control-valve", "Control valve", "Modulating final control element.", [numeric("position_pct", "Position", "%", true), bool("open_feedback", "Open feedback")]),
  coreClass("pressure-transmitter", "Pressure transmitter", "Pressure measurement device.", [numeric("pressure_bar", "Pressure", "bar", true), bool("healthy", "Device healthy")]),
  coreClass("flow-transmitter", "Flow transmitter", "Flow measurement device.", [numeric("flow_l_min", "Flow", "L/min", true), bool("healthy", "Device healthy")]),
  coreClass("plc", "Programmable controller", "Controller for commands and interlocks.", [bool("healthy", "Controller healthy"), bool("auto_mode", "Automatic mode")]),
  coreClass("conveyor", "Conveyor", "Material-transfer conveyor.", [numeric("speed_m_min", "Belt speed", "m/min"), bool("running", "Running feedback")]),
  coreClass("fan", "Fan", "Industrial air-moving fan.", [numeric("speed_rpm", "Fan speed", "rpm"), numeric("vibration_mm_s", "Vibration RMS", "mm/s"), bool("running", "Running feedback")]),
  coreClass("compressor", "Compressor", "Industrial gas compressor.", [numeric("discharge_pressure_bar", "Discharge pressure", "bar"), numeric("temperature_c", "Discharge temperature", "°C"), bool("running", "Running feedback")]),
  coreClass("spindle", "Spindle", "Machine-tool spindle.", [numeric("speed_rpm", "Spindle speed", "rpm", true), numeric("vibration_mm_s", "Vibration RMS", "mm/s"), numeric("temperature_c", "Bearing temperature", "°C")]),
  coreClass("sensor-instrument", "Sensor / instrument", "Generic isolated measurement instrument.", [numeric("value", "Measured value", "raw", true), bool("healthy", "Device healthy")]),
  coreClass("generic-machine", "Generic machine", "User-defined machine with conservative defaults.", [bool("running", "Running feedback"), numeric("load_pct", "Load", "%")]),
]);

export const CORE_ASSET_CLASS_BY_ID: Readonly<Record<string, AssetClassVersion>> = freeze(Object.fromEntries(CORE_ASSET_CLASS_TEMPLATES.map((template) => [template.id, template])));

export function newAssetClassVersion(previous: AssetClassVersion, patch: Omit<Partial<AssetClassVersion>, "id" | "classId" | "version">): AssetClassVersion {
  return freeze({ ...previous, ...patch, id: `${previous.classId}@${previous.version + 1}`, classId: previous.classId, version: previous.version + 1, signalDefinitions: patch.signalDefinitions ?? previous.signalDefinitions, attributes: patch.attributes ?? previous.attributes });
}

export function instantiateAsset(template: AssetClassVersion, input: InstantiateAssetInput): { asset: AssetInstance; signals: TwinSignal[] } {
  const asset = freeze({ id: input.id, classVersionId: template.id, name: input.name, ...(input.parentId ? { parentId: input.parentId } : {}), attributes: { ...input.attributes } });
  const signals = template.signalDefinitions.map((definition) => freeze({ id: `${input.id}.${definition.key}`, assetId: input.id, definitionKey: definition.key, label: definition.label, valueType: definition.valueType, ...(definition.unit ? { unit: definition.unit } : {}), ...(definition.enumValues ? { enumValues: [...definition.enumValues] } : {}) }));
  return { asset, signals };
}

export function validateAffineTransform(transform: AffineTransform | undefined): ValidationResult {
  const errors: string[] = [];
  if (!transform) return { ok: true, errors, warnings: [] };
  if (transform.kind !== "AFFINE") errors.push("Only AFFINE channel transforms are permitted.");
  if (!Number.isFinite(transform.multiplier) || transform.multiplier <= 0) errors.push("Affine multiplier must be a finite positive number.");
  if (!Number.isFinite(transform.offset)) errors.push("Affine offset must be finite.");
  return { ok: errors.length === 0, errors, warnings: [] };
}

export function validateTopology(draft: TwinTopologyDraft, classVersions: readonly AssetClassVersion[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const addUnique = (kind: string, values: readonly { id: string }[]) => values.forEach(({ id }) => { if (ids.has(id)) errors.push(`Duplicate ${kind} id: ${id}.`); ids.add(id); });
  const assetIds = new Set(draft.assetInstances.map((asset) => asset.id));
  const signalIds = new Set(draft.signals.map((signal) => signal.id));
  const classIds = new Set(classVersions.map((version) => version.id));
  addUnique("asset", draft.assetInstances);
  for (const asset of draft.assetInstances) {
    if (!classIds.has(asset.classVersionId)) errors.push(`Asset ${asset.id} references unknown class version ${asset.classVersionId}.`);
    if (asset.parentId && !assetIds.has(asset.parentId)) errors.push(`Asset ${asset.id} has unknown parent ${asset.parentId}.`);
  }
  const seenSignals = new Set<string>();
  for (const signal of draft.signals) {
    if (seenSignals.has(signal.id)) errors.push(`Duplicate signal id: ${signal.id}.`);
    seenSignals.add(signal.id);
    if (!assetIds.has(signal.assetId)) errors.push(`Signal ${signal.id} references unknown asset ${signal.assetId}.`);
    if (signal.valueType === "ENUM" && (!signal.enumValues || signal.enumValues.length === 0)) errors.push(`Enum signal ${signal.id} requires enumValues.`);
  }
  const seenBindings = new Set<string>();
  const boundSignals = new Set<string>();
  for (const binding of draft.channelBindings) {
    if (seenBindings.has(binding.id)) errors.push(`Duplicate channel binding id: ${binding.id}.`);
    seenBindings.add(binding.id);
    if (!signalIds.has(binding.signalId)) errors.push(`Binding ${binding.id} references unknown signal ${binding.signalId}.`);
    if (boundSignals.has(binding.signalId)) errors.push(`Signal ${binding.signalId} has more than one channel binding.`);
    boundSignals.add(binding.signalId);
    const signal = draft.signals.find((candidate) => candidate.id === binding.signalId);
    if (binding.transform && signal?.valueType !== "NUMBER") errors.push(`Only NUMBER signal ${binding.signalId} may use an affine transform.`);
    errors.push(...validateAffineTransform(binding.transform).errors.map((error) => `Binding ${binding.id}: ${error}`));
  }
  for (const relation of draft.relations) {
    if (!assetIds.has(relation.fromAssetId) || !assetIds.has(relation.toAssetId)) errors.push(`Relation ${relation.id} references an unknown asset.`);
    if (relation.fromAssetId === relation.toAssetId) errors.push(`Relation ${relation.id} cannot connect an asset to itself.`);
  }
  for (const asset of draft.assetInstances) {
    const template = classVersions.find((version) => version.id === asset.classVersionId);
    for (const definition of template?.signalDefinitions ?? []) {
      if (definition.required && !draft.signals.some((signal) => signal.assetId === asset.id && signal.definitionKey === definition.key)) errors.push(`Asset ${asset.id} is missing required signal ${definition.key}.`);
    }
  }
  if (!draft.name.trim()) errors.push("Topology name is required.");
  if (draft.assetInstances.length === 0) warnings.push("Topology contains no assets.");
  return { ok: errors.length === 0, errors, warnings };
}

export function createTopologyVersion(draft: TwinTopologyDraft, classVersions: readonly AssetClassVersion[], metadata: { version: number; createdAtMs: number; createdBy: string; parentTopologyId?: string }): TwinTopologyVersion {
  const validation = validateTopology(draft, classVersions);
  if (!validation.ok) throw new Error(`Invalid topology: ${validation.errors.join(" ")}`);
  const unsigned = { ...copyDraft(draft), version: metadata.version, createdAtMs: metadata.createdAtMs, createdBy: metadata.createdBy, ...(metadata.parentTopologyId ? { parentTopologyId: metadata.parentTopologyId } : {}) };
  return freeze({ ...unsigned, contentHash: hash(unsigned) });
}

export function createTwinConfiguration(id: string, initialTopology: TwinTopologyVersion, classVersions: readonly AssetClassVersion[] = CORE_ASSET_CLASS_TEMPLATES): TwinConfiguration {
  return freeze({ id, activeTopology: initialTopology, classVersions: [...classVersions], revision: 1 });
}

export function createConfigProposal(input: Omit<TwinConfigProposal, "validation" | "contentHash">, classVersions: readonly AssetClassVersion[]): TwinConfigProposal {
  const validation = validateTopology(input.proposedTopology, classVersions);
  const unsigned = { ...input, proposedTopology: copyDraft(input.proposedTopology), validation: copyValidation(validation) };
  return freeze({ ...unsigned, contentHash: hash(unsigned) });
}

/** Projects latest source readings into configured signals without mutating config or readings. */
export function projectTwinSnapshot(topology: TwinTopologyVersion, readings: readonly SignalReading[], projectedAtMs: number): TwinSnapshot {
  const byChannel = new Map<string, SignalReading>();
  for (const reading of readings) {
    const key = `${reading.sourceId}\u0000${reading.channel}`;
    const existing = byChannel.get(key);
    if (!existing || existing.observedAtMs <= reading.observedAtMs) byChannel.set(key, reading);
  }
  const bindingBySignal = new Map(topology.channelBindings.map((binding) => [binding.signalId, binding]));
  const signalsByAsset = new Map<string, ProjectedSignal[]>();
  for (const signal of topology.signals) {
    const binding = bindingBySignal.get(signal.id);
    const reading = binding ? byChannel.get(`${binding.sourceId}\u0000${binding.channel}`) : undefined;
    let value: ProjectedSignal["value"] = reading?.value ?? null;
    let quality: SignalQuality = reading?.quality ?? "MISSING";
    if (reading && !isValueForSignal(reading.value, signal)) { value = null; quality = "BAD"; }
    if (reading && binding?.transform && typeof value === "number") value = binding.transform.multiplier * value + binding.transform.offset;
    const projected: ProjectedSignal = { signalId: signal.id, value, ...(signal.unit ? { unit: signal.unit } : {}), quality, ...(reading ? { observedAtMs: reading.observedAtMs, source: { sourceId: reading.sourceId, channel: reading.channel } } : {}) };
    const list = signalsByAsset.get(signal.assetId) ?? [];
    list.push(freeze(projected));
    signalsByAsset.set(signal.assetId, list);
  }
  return freeze({ topologyId: topology.id, topologyVersion: topology.version, projectedAtMs, assets: topology.assetInstances.map((asset) => freeze({ asset, signals: signalsByAsset.get(asset.id) ?? [] })), relations: [...topology.relations] });
}

/** Serial review queue. Exactly one proposal can be IN_REVIEW at a time. */
export class TwinProposalQueue {
  private records: ProposalRecord[] = [];
  private events: TwinAuditEvent[] = [];
  private configuration: TwinConfiguration;

  constructor(configuration: TwinConfiguration) { this.configuration = configuration; }

  get currentConfiguration(): TwinConfiguration { return this.configuration; }
  get proposals(): readonly ProposalRecord[] { return this.records; }
  get auditEvents(): readonly TwinAuditEvent[] { return this.events; }
  get active(): ProposalRecord | undefined { return this.records.find((record) => record.state === "IN_REVIEW"); }

  submit(proposal: TwinConfigProposal): ProposalRecord {
    if (proposal.configurationId !== this.configuration.id) throw new Error("Proposal belongs to another configuration.");
    if (proposal.baseRevision !== this.configuration.revision) throw new Error("Proposal was based on a stale configuration revision.");
    if (!proposal.validation.ok) throw new Error(`Invalid proposal: ${proposal.validation.errors.join(" ")}`);
    if (this.records.some((record) => record.proposal.id === proposal.id)) throw new Error(`Proposal ${proposal.id} already exists.`);
    const record = freeze({ proposal, state: "QUEUED" as const });
    this.records = [...this.records, record];
    this.appendAudit("PROPOSAL_SUBMITTED", proposal.submittedBy, proposal.id, proposal.submittedAtMs, proposal.contentHash);
    return record;
  }

  beginNext(actor: string, atMs: number): ProposalRecord | undefined {
    if (this.active) throw new Error("A proposal is already in review.");
    const next = this.records.find((record) => record.state === "QUEUED");
    if (!next) return undefined;
    const updated = freeze({ ...next, state: "IN_REVIEW" as const, reviewedBy: actor, reviewedAtMs: atMs });
    this.replace(next.proposal.id, updated);
    this.appendAudit("REVIEW_STARTED", actor, next.proposal.id, atMs, next.proposal.contentHash);
    return updated;
  }

  approve(id: string, actor: string, atMs: number, reason = "Approved"): { record: ProposalRecord; configuration: TwinConfiguration } {
    const active = this.requireActive(id);
    if (active.proposal.baseRevision !== this.configuration.revision) throw new Error("Proposal became stale during review.");
    const topology = createTopologyVersion(active.proposal.proposedTopology, this.configuration.classVersions, { version: this.configuration.activeTopology.version + 1, createdAtMs: atMs, createdBy: actor, parentTopologyId: this.configuration.activeTopology.id });
    this.configuration = freeze({ ...this.configuration, activeTopology: topology, revision: this.configuration.revision + 1 });
    const updated = freeze({ ...active, state: "APPROVED" as const, reviewedBy: actor, reviewedAtMs: atMs, reason });
    this.replace(id, updated);
    this.appendAudit("PROPOSAL_APPROVED", actor, id, atMs, hash({ proposal: active.proposal.contentHash, reason, topology: topology.contentHash }));
    return { record: updated, configuration: this.configuration };
  }

  reject(id: string, actor: string, atMs: number, reason: string): ProposalRecord {
    if (!reason.trim()) throw new Error("A rejection reason is required.");
    const active = this.requireActive(id);
    const updated = freeze({ ...active, state: "REJECTED" as const, reviewedBy: actor, reviewedAtMs: atMs, reason });
    this.replace(id, updated);
    this.appendAudit("PROPOSAL_REJECTED", actor, id, atMs, hash({ proposal: active.proposal.contentHash, reason }));
    return updated;
  }

  /** Editing preserves the original proposal and queues an immutable replacement. */
  edit(id: string, replacement: TwinConfigProposal, actor: string, atMs: number, reason: string): ProposalRecord {
    const active = this.requireActive(id);
    if (replacement.configurationId !== this.configuration.id || replacement.baseRevision !== this.configuration.revision) throw new Error("Replacement proposal has the wrong configuration base.");
    if (!replacement.validation.ok) throw new Error(`Invalid replacement: ${replacement.validation.errors.join(" ")}`);
    if (this.records.some((record) => record.proposal.id === replacement.id)) throw new Error(`Proposal ${replacement.id} already exists.`);
    const revised = freeze({ ...active, state: "EDITED" as const, reviewedBy: actor, reviewedAtMs: atMs, reason, replacementProposalId: replacement.id });
    this.replace(id, revised);
    const replacementRecord = freeze({ proposal: replacement, state: "QUEUED" as const });
    this.records = [...this.records, replacementRecord];
    this.appendAudit("PROPOSAL_EDITED", actor, id, atMs, hash({ original: active.proposal.contentHash, replacement: replacement.contentHash, reason }));
    return replacementRecord;
  }

  verifyAuditChain(): boolean {
    let previousHash = "GENESIS";
    return this.events.every((event) => {
      const expected = hash({ sequence: event.sequence, type: event.type, actor: event.actor, atMs: event.atMs, proposalId: event.proposalId, payloadHash: event.payloadHash, previousHash });
      previousHash = event.hash;
      return event.previousHash === (event.sequence === 1 ? "GENESIS" : this.events[event.sequence - 2]?.hash) && event.hash === expected;
    });
  }

  private requireActive(id: string): ProposalRecord {
    const active = this.active;
    if (!active || active.proposal.id !== id) throw new Error("Only the active proposal may be reviewed.");
    return active;
  }
  private replace(id: string, next: ProposalRecord): void { this.records = this.records.map((record) => record.proposal.id === id ? next : record); }
  private appendAudit(type: TwinAuditEvent["type"], actor: string, proposalId: string, atMs: number, payloadHash: string): void {
    const previousHash = this.events.at(-1)?.hash ?? "GENESIS";
    const sequence = this.events.length + 1;
    const event = freeze({ sequence, type, actor, atMs, proposalId, payloadHash, previousHash, hash: hash({ sequence, type, actor, atMs, proposalId, payloadHash, previousHash }) });
    this.events = [...this.events, event];
  }
}

export interface InductionMotorDemoPlant {
  configuration: TwinConfiguration;
  topology: TwinTopologyVersion;
  readings: readonly SignalReading[];
}

/** A minimal but complete plant: PLC -> VFD -> induction motor -> pump -> tank. */
export function createInductionMotorDemoPlant(atMs = 1_700_000_000_000): InductionMotorDemoPlant {
  const classes = CORE_ASSET_CLASS_TEMPLATES;
  const byClass = (id: string) => classes.find((item) => item.classId === id)!;
  const plc = instantiateAsset(byClass("plc"), { id: "PLC-01", name: "Pump PLC" });
  const vfd = instantiateAsset(byClass("variable-frequency-drive"), { id: "VFD-01", name: "Pump drive" });
  const motor = instantiateAsset(byClass("induction-motor"), { id: "MTR-01", name: "Transfer-pump motor", attributes: { ratedPowerKw: 7.5 } });
  const pump = instantiateAsset(byClass("centrifugal-pump"), { id: "PMP-01", name: "Transfer pump" });
  const tank = instantiateAsset(byClass("process-tank"), { id: "TK-01", name: "Receiving tank" });
  const assets = [plc.asset, vfd.asset, motor.asset, pump.asset, tank.asset];
  const signals = [...plc.signals, ...vfd.signals, ...motor.signals, ...pump.signals, ...tank.signals];
  const binding = (signalId: string, channel: string, transform?: AffineTransform): ChannelBinding => ({ id: `BIND-${signalId}`, signalId, sourceId: "demo-plc", channel, ...(transform ? { transform } : {}) });
  const topology = createTopologyVersion({ id: "induction-motor-demo", name: "Induction-motor transfer plant", assetInstances: assets, signals, channelBindings: [binding("MTR-01.speed_rpm", "motor_speed_hz", { kind: "AFFINE", multiplier: 60, offset: 0 }), binding("MTR-01.current_a", "motor_current_a"), binding("MTR-01.running", "motor_running"), binding("PMP-01.flow_l_min", "pump_flow_l_min"), binding("PMP-01.discharge_pressure_bar", "pump_pressure_bar"), binding("TK-01.level_pct", "tank_level_pct"), binding("PLC-01.healthy", "plc_healthy"), binding("VFD-01.faulted", "vfd_faulted")], relations: [{ id: "REL-PLC-VFD", fromAssetId: "PLC-01", toAssetId: "VFD-01", kind: "CONTROLS" }, { id: "REL-VFD-MTR", fromAssetId: "VFD-01", toAssetId: "MTR-01", kind: "DRIVES" }, { id: "REL-MTR-PMP", fromAssetId: "MTR-01", toAssetId: "PMP-01", kind: "DRIVES" }, { id: "REL-PMP-TK", fromAssetId: "PMP-01", toAssetId: "TK-01", kind: "FLOWS_TO" }] }, classes, { version: 1, createdAtMs: atMs, createdBy: "demo-engineer" });
  const readings: SignalReading[] = [
    { sourceId: "demo-plc", channel: "motor_speed_hz", value: 24.5, observedAtMs: atMs, quality: "GOOD" },
    { sourceId: "demo-plc", channel: "motor_current_a", value: 8.1, observedAtMs: atMs, quality: "GOOD" },
    { sourceId: "demo-plc", channel: "motor_running", value: true, observedAtMs: atMs, quality: "GOOD" },
    { sourceId: "demo-plc", channel: "pump_flow_l_min", value: 85, observedAtMs: atMs, quality: "GOOD" },
    { sourceId: "demo-plc", channel: "pump_pressure_bar", value: 2.6, observedAtMs: atMs, quality: "GOOD" },
    { sourceId: "demo-plc", channel: "tank_level_pct", value: 63, observedAtMs: atMs, quality: "GOOD" },
    { sourceId: "demo-plc", channel: "plc_healthy", value: true, observedAtMs: atMs, quality: "GOOD" },
    { sourceId: "demo-plc", channel: "vfd_faulted", value: false, observedAtMs: atMs, quality: "GOOD" },
  ];
  return { topology, configuration: createTwinConfiguration("CFG-DEMO-INDUCTION-MOTOR", topology, classes), readings: freeze(readings) };
}

function isValueForSignal(value: SignalReading["value"], signal: TwinSignal): boolean {
  if (value === null) return true;
  if (signal.valueType === "NUMBER") return typeof value === "number" && Number.isFinite(value);
  if (signal.valueType === "BOOLEAN") return typeof value === "boolean";
  if (signal.valueType === "TEXT") return typeof value === "string";
  return typeof value === "string" && Boolean(signal.enumValues?.includes(value));
}

function copyDraft(draft: TwinTopologyDraft): TwinTopologyDraft {
  return { ...draft, assetInstances: draft.assetInstances.map((asset) => ({ ...asset, attributes: { ...asset.attributes } })), signals: draft.signals.map((signal) => ({ ...signal, ...(signal.enumValues ? { enumValues: [...signal.enumValues] } : {}) })), channelBindings: draft.channelBindings.map((binding) => ({ ...binding, ...(binding.transform ? { transform: { ...binding.transform } } : {}) })), relations: draft.relations.map((relation) => ({ ...relation })) };
}
function copyValidation(validation: ValidationResult): ValidationResult { return { ok: validation.ok, errors: [...validation.errors], warnings: [...validation.warnings] }; }
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}
function hash(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}
