/**
 * PlantLens domain types.
 *
 * Everything in the runtime core is typed against these records. The simulator's
 * hidden truth (injected faults, scenario identifiers) is deliberately NOT part of
 * this module; see lib/simulation/truth.ts, which diagnosis and recovery must never
 * import (enforced by tests/unit/boundary.test.ts).
 */

export const SCHEMA_VERSION = 3 as const;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Milliseconds since the Unix epoch, UTC. */
export type EpochMs = number;

/** Which clock a timestamp came from. Never mix them silently. */
export type ClockKind = "SIMULATION" | "EVENT" | "INGESTION" | "WALL";

export interface TimeStamp {
  ms: EpochMs;
  clock: ClockKind;
  /** Half-width of the uncertainty interval in ms; 0 means the source claimed exactness. */
  uncertaintyMs: number;
  /** Original string when the value came from a file; preserved verbatim. */
  raw?: string;
  /** Identifier of the clock/source the timestamp was taken from, for skew contracts. */
  clockSourceId?: string;
}

// ---------------------------------------------------------------------------
// Execution mode
// ---------------------------------------------------------------------------

export type ExecutionMode = "DEMO_SIMULATION" | "IMPORTED_REPLAY" | "LIVE_ADAPTER";

// ---------------------------------------------------------------------------
// Plant model
// ---------------------------------------------------------------------------

export type ZoneId = "UTIL" | "CELL-A" | "CELL-B" | "HANDLING" | "QUALITY";

export type CellId = "CELL-A" | "CELL-B";

export type AssetKind = "PHYSICAL" | "LOGICAL_STATION" | "SUBSYSTEM";

export type ModelCoverage =
  | "CONTEXTUAL_ONLY"
  | "RULE_COVERED"
  | "SEQUENCE_COVERED"
  | "RECOVERY_COVERED"
  | "INSUFFICIENT_DATA";

export type MachinePhase =
  | "OFF"
  | "STARTING"
  | "IDLE"
  | "LOADING"
  | "CLAMPING"
  | "CUTTING"
  | "UNLOADING"
  | "BLOCKED"
  | "STARVED"
  | "STOPPING"
  | "UNCLASSIFIED";

export type OperatingMode = "AUTO" | "MANUAL" | "MAINTENANCE" | "OFF" | "UNKNOWN";

export interface Asset {
  id: string;
  name: string;
  zone: ZoneId;
  kind: AssetKind;
  /** Parent asset for subsystems (SPN-01 -> CNC-01). */
  parentId?: string;
  /** Production cell this asset belongs to, if any. */
  cellId?: CellId;
  coverage: ModelCoverage;
  coverageReason: string;
  /** Which phases this asset's phase model uses (subset). */
  phases: MachinePhase[];
  /** Two measurements worth showing on the plant card (tag names). */
  headlineTags: string[];
  /** Nameplate data, explicitly NOT a recovery setpoint. */
  nameplate?: Record<string, string>;
  description: string;
}

export type TagValueType = "NUMERIC" | "BOOLEAN" | "ENUM" | "TEXT";

export interface TagDefinition {
  id: string; // canonical, e.g. "AIR-HDR-01.header_pressure"
  assetId: string;
  name: string; // "header_pressure"
  valueType: TagValueType;
  unit?: string;
  enumValues?: string[];
  description: string;
  /** Whether this tag is an event-like boolean (rising edges matter) or a level. */
  eventLike?: boolean;
  /** Source system aliases known from the registry. */
  aliases: string[];
}

export type EvidenceQuality =
  | "GOOD"
  | "MISSING"
  | "STALE"
  | "SUSPECT"
  | "INVALID"
  | "NOT_INSTRUMENTED";

export type ObservationValue =
  | { kind: "NUMERIC"; value: number | null }
  | { kind: "BOOLEAN"; value: boolean | null }
  | { kind: "ENUM"; value: string | null }
  | { kind: "TEXT"; value: string | null };

export interface OperatingContext {
  recipe?: string;
  batch?: string;
  mode?: OperatingMode;
  phase?: MachinePhase;
  commandedSpeed?: number;
  actualSpeed?: number;
  load?: number;
  materialState?: string;
  cycleId?: string;
}

export interface Observation {
  id: string;
  assetId: string;
  tagId: string;
  rawTag: string;
  eventTime: TimeStamp;
  ingestionTime?: TimeStamp;
  value: ObservationValue;
  unit?: string;
  quality: EvidenceQuality;
  sourceId: string;
  /** Row/line number in the source, when the observation came from a file. */
  sourceRow?: number;
  context?: OperatingContext;
}

// ---------------------------------------------------------------------------
// Knowledge: sources, spans, mappings, edges, proposals, versions
// ---------------------------------------------------------------------------

export type SourceType =
  | "ASSET_REGISTRY"
  | "TAG_LIST"
  | "PLC_SEQUENCE_EXCERPT"
  | "OPERATING_TRACE"
  | "ALARM_HISTORY"
  | "MAINTENANCE_HISTORY"
  | "ENGINEER_NOTES"
  | "RECOVERY_TEMPLATES"
  | "HEALTHY_BASELINES"
  | "MANIFEST"
  | "MANUAL_TEXT"
  | "UNSUPPORTED";

export type SourceCategory = "EXPLANATORY" | "HISTORICAL" | "CONFIGURATION" | "OBSERVATION";

export interface SourceDocument {
  id: string;
  fileName: string;
  sourceType: SourceType;
  category: SourceCategory;
  mimeType: string;
  sizeBytes: number;
  /** Full text, split by lines, rendered as text never HTML. */
  lines: string[];
  sha256: string;
  importedAt: TimeStamp;
  /** Document revision/date claimed inside the document, when present. */
  revision?: string;
  parseStatus: "PARSED" | "PARTIAL" | "UNSUPPORTED" | "FAILED";
  parseMessages: string[];
  /** For binary/unsupported: what export is required instead. */
  requiredExport?: string;
  fictional: true;
  /** Number of data rows parsed (for tabular sources). */
  rowCount?: number;
}

export interface SourceSpan {
  sourceId: string;
  startLine: number;
  endLine: number;
  /** Optional column-level detail for CSV rows. */
  column?: string;
}

export type MappingStatus = "PROPOSED" | "APPROVED" | "REJECTED";

export interface TagMapping {
  id: string;
  /** Raw alias from the source, e.g. "CoolantPump_A". */
  alias: string;
  /** Resolved canonical asset (and optionally tag). */
  assetId?: string;
  tagId?: string;
  status: MappingStatus;
  /** Alternatives the resolver considered and why. */
  alternatives: Array<{ assetId: string; reason: string }>;
  evidence: SourceSpan[];
  rationale: string;
  reviewer?: ReviewRecord;
  /** True when the alias could plausibly mean two separate assets. */
  ambiguous: boolean;
}

export type RelationType =
  | "ELECTRICAL_SUPPLY"
  | "PNEUMATIC_PREREQUISITE"
  | "COOLING"
  | "THERMAL_SUPPLY"
  | "MATERIAL_FLOW"
  | "HANDSHAKE"
  | "COMPONENT_OF"
  | "REVIEWED_NO_DEPENDENCY";

export type ProvenanceClass =
  | "EXPLICIT_SOURCE_RULE"
  | "DEMO_ENGINEER_AUTHORED_RULE"
  | "TEMPORAL_ASSOCIATION"
  | "UNRESOLVED_INFERENCE";

export type ReviewStatus =
  | "DRAFT"
  | "VALIDATED"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "REJECTED"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "PROPOSED";

export interface Predicate {
  tag: string;
  operator: ">=" | "<=" | ">" | "<" | "==" | "!=";
  value: number | boolean | string;
  unit?: string;
}

export interface DependencyEdge {
  id: string;
  from: string;
  to: string;
  relation: RelationType;
  applicableModes: OperatingMode[];
  applicablePhases: MachinePhase[];
  predicate?: Predicate;
  expectedObservation?: string;
  /** Expected time relationship: effect appears within this many ms after cause. */
  expectedLagMs?: { min: number; max: number };
  evidenceRefs: SourceSpan[];
  basis: ProvenanceClass;
  reviewStatus: ReviewStatus;
  knowledgeVersion: string;
  limitations: string[];
  /** Human-readable summary used in graph/table/matrix. */
  summary: string;
  /** For physical feedback loops: allowed in the physical graph, excluded from same-time diagnostic DAG. */
  physicalFeedback?: boolean;
}

export interface RecoveryRequirement {
  id: string;
  title: string;
  /** Predicate the requirement asserts, if numeric/boolean. */
  predicate?: Predicate;
  /** Band the requirement asserts, if numeric. */
  band?: { min: number; max: number; unit: string; phase?: MachinePhase };
  /** Sequence expectation, if any. */
  sequence?: { events: string[]; maximumElapsedSeconds: number };
  applicableRecipes: string[];
  applicableModes: OperatingMode[];
  applicablePhases: MachinePhase[];
  evidenceRefs: SourceSpan[];
  basis: ProvenanceClass;
  reviewStatus: ReviewStatus;
  knowledgeVersion: string;
  limitations: string[];
  /** Which dependency edge(s) this requirement protects. */
  coversEdgeIds: string[];
}

export type ProposalKind =
  | "ALIAS_MERGE"
  | "DEPENDENCY_EDGE"
  | "REQUIREMENT"
  | "SOURCE_CONFLICT"
  | "UNCITED_DRAFT"
  | "UNTRUSTED_INSTRUCTION"
  | "MISSING_CHANNEL"
  | "UNMATCHED_TAG";

export type ProposalState =
  | "QUEUED"
  | "PARSING"
  | "NEEDS_MAPPING"
  | "PROPOSAL_READY"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "DEFERRED"
  | "EVIDENCE_REQUESTED"
  | "FAILED";

export interface ProposalValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export type PipelineStage =
  | "SOURCE_PARSER"
  | "ASSET_TAG_RESOLVER"
  | "DEPENDENCY_PROPOSER"
  | "CONSISTENCY_REVIEWER"
  | "RECOVERY_CHECK_DRAFTER"
  | "HUMAN";

export type PipelineKind = "LOCAL_DEMO" | "CONNECTED_AI" | "HUMAN";

export type ProposalPayload =
  | { kind: "ALIAS_MERGE"; mapping: TagMapping }
  | { kind: "DEPENDENCY_EDGE"; edge: DependencyEdge }
  | { kind: "REQUIREMENT"; requirement: RecoveryRequirement }
  | {
      kind: "SOURCE_CONFLICT";
      subject: string;
      options: Array<{ label: string; value: string; evidence: SourceSpan[]; revision?: string; scope: string }>;
      affectedEdgeIds: string[];
      affectedRequirementIds: string[];
      resolution?: { chosen: number; reason: string };
    }
  | { kind: "UNCITED_DRAFT"; edge: DependencyEdge }
  | { kind: "UNTRUSTED_INSTRUCTION"; text: string }
  | { kind: "MISSING_CHANNEL"; assetId: string; tagName: string; requiredBy: string[] }
  | { kind: "UNMATCHED_TAG"; rawTag: string; occurrences: number };

export interface KnowledgeProposal {
  id: string;
  kind: ProposalKind;
  title: string;
  state: ProposalState;
  producedBy: PipelineStage;
  pipeline: PipelineKind;
  createdAt: TimeStamp;
  evidence: SourceSpan[];
  rationale: string;
  validation: ProposalValidation;
  payload: ProposalPayload;
  review?: ReviewRecord;
  changeSummary: string[];
}

export interface ReviewRecord {
  /** Simulated identity in the demo; NOT an authenticated user. */
  reviewer: string;
  simulatedIdentity: true;
  decision: "APPROVED" | "REJECTED" | "DEFERRED" | "EVIDENCE_REQUESTED" | "EDITED";
  reason: string;
  at: TimeStamp;
}

export interface KnowledgeVersion {
  id: string; // "plant-knowledge-3"
  number: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  createdAt: TimeStamp;
  publishedAt?: TimeStamp;
  parentId?: string;
  edges: DependencyEdge[];
  requirements: RecoveryRequirement[];
  mappings: TagMapping[];
  /** Explicitly reviewed non-dependencies (asset pair) keyed "A->B". */
  reviewedNoDependency: string[];
  changeLog: Array<{ proposalId: string; summary: string; reviewer: string; reason: string }>;
  reviewer?: string;
  publishReason?: string;
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

export interface BaselineBand {
  tagId: string;
  min: number;
  max: number;
  unit: string;
  phase?: MachinePhase;
}

export interface HealthyBaseline {
  id: string; // "PART-A-approved-demo-1"
  recipe: string;
  mode: OperatingMode;
  cellId: CellId;
  commandedSpeedRpm: number;
  bands: BaselineBand[];
  cycleDurationSeconds: { min: number; max: number };
  evidenceRefs: SourceSpan[];
  reviewStatus: ReviewStatus;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export type DiagnosticState = "NORMAL" | "SUPPORTED" | "AMBIGUOUS" | "UNKNOWN" | "SENSOR_CHECK";
export type Disposition = "NONE" | "HUMAN_REVIEW";

export type FaultFamilyId =
  | "SHARED_PNEUMATIC_LOSS"
  | "LOCAL_FIXTURE_SENSOR"
  | "COOLANT_DELIVERY_INADEQUATE"
  | "SPINDLE_BEARING"
  | "HANDSHAKE_ACK_UNRESOLVED"
  | "ROBOT_MECHANICAL"
  | "SUPPLY_SAG"
  | "MECHANICAL_LOAD_INCREASE"
  | "COOLING_DEGRADATION"
  | "SENSOR_SUSPECT"
  | "RECIPE_CHANGE_NORMAL"
  | "UNSUPPORTED_ANOMALY";

export type EvidenceRelation = "SUPPORT" | "CONTRADICT" | "PENDING" | "UNAVAILABLE";

export interface EvidenceItem {
  id: string;
  /** Group key so correlated channels are not counted as independent witnesses. */
  group: string;
  assetId: string;
  tagId: string;
  title: string;
  description: string;
  quality: EvidenceQuality;
  window: { startMs: EpochMs; endMs: EpochMs };
  observedValue?: string;
  referenceValue?: string;
  /** Observation ids that back this item (bounded). */
  observationIds: string[];
  /** Whether the ordering of this item relative to others is reliable. */
  orderingReliable: boolean;
  /** Reference to the baseline or requirement used as comparison. */
  referenceId?: string;
  onsetMs?: EpochMs;
  onsetUncertaintyMs?: number;
}

export interface CandidateEvidenceLink {
  evidenceId: string;
  relation: EvidenceRelation;
  reason: string;
}

export interface FaultCandidate {
  family: FaultFamilyId;
  title: string;
  mechanism: string;
  /** Approved edges that make this path plausible. */
  edgeIds: string[];
  links: CandidateEvidenceLink[];
  supportCount: number;
  contradictionCount: number;
  pendingCount: number;
  unavailableCount: number;
  /** What would distinguish it from the runner-up. */
  distinguishingCheckId?: string;
  notEstablished: string[];
  /** Whether this candidate is currently ranked as supported. */
  rank: number;
}

export interface NextCheck {
  id: string;
  title: string;
  kind: "EVIDENCE_INSPECTION" | "SIMULATED_CHECK";
  prerequisites: string[];
  distinguishes: FaultFamilyId[];
  interpretation: Array<{ result: string; meaning: string }>;
  safety: string;
  /** In-app target for the check. */
  target?: { route: string; label: string };
}

export interface DiagnosticGraph {
  nodes: Array<{ id: string; type: "HYPOTHESIS" | "MECHANISM" | "OBSERVATION" | "REQUIREMENT"; label: string; state?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export interface Diagnosis {
  incidentId: string;
  computedAtMs: EpochMs;
  cutoffMs: EpochMs;
  knowledgeVersion: string;
  baselineIds: string[];
  state: DiagnosticState;
  disposition: Disposition;
  summary: string;
  firstReliableDeviation?: { evidenceId: string; ms: EpochMs; uncertaintyMs: number };
  orderingUnresolved: boolean;
  orderingNote?: string;
  candidates: FaultCandidate[];
  evidence: EvidenceItem[];
  missingInputs: string[];
  unresolvedQuestions: string[];
  nextChecks: NextCheck[];
  graph: DiagnosticGraph;
  /** Alarms this diagnosis groups; residual alarms not explained by the top candidate. */
  residualDeviations: string[];
}

// ---------------------------------------------------------------------------
// Alarms and incidents
// ---------------------------------------------------------------------------

export interface Alarm {
  id: string;
  assetId: string;
  tagId?: string;
  severity: "FAULT" | "WARNING" | "INFO";
  message: string;
  raisedAt: TimeStamp;
  clearedAt?: TimeStamp;
  incidentId?: string;
}

export type IncidentStatus = "OPEN" | "INVESTIGATING" | "AWAITING_VERIFICATION" | "RESOLVED" | "CLOSED";

export interface Incident {
  id: string;
  title: string;
  status: IncidentStatus;
  openedAt: TimeStamp;
  closedAt?: TimeStamp;
  /** Assets with observed faults. */
  observedAssetIds: string[];
  /** Assets that could be affected via approved edges (conditional, not observed). */
  potentiallyAffectedAssetIds: string[];
  affectedCellIds: CellId[];
  alarmIds: string[];
  /** Alarms grouped into this incident because approved dependencies + timing supported it. */
  groupingRationale: string;
  diagnosis?: Diagnosis;
  workOrderIds: string[];
  recoveryPlanIds: string[];
  fixture?: { fictional: true; note: string };
  interruptions: Array<{ cellId: CellId; startMs: EpochMs; endMs?: EpochMs }>;
  safetyRelevant: boolean;
  repeatOf: string[];
  /** Candidate common-cause asset if grouped. */
  sharedCauseAssetId?: string;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export type QualityPolicy = "REQUIRE_GOOD" | "ALLOW_STALE";

export type RecoveryCheck =
  | { id: string; kind: "SOURCE_QUALITY"; tags: string[]; qualityPolicy: QualityPolicy; requirementRef: string }
  | { id: string; kind: "MODE_REQUIRED"; assetId: string; recipe?: string; mode?: OperatingMode; commandedSpeedRpm?: number; requirementRef: string }
  | {
      id: string;
      kind: "NUMERIC_BAND";
      tag: string;
      minimum: number;
      maximum: number;
      unit: string;
      phase?: MachinePhase;
      qualityPolicy: QualityPolicy;
      minimumSamples: number;
      requirementRef: string;
    }
  | { id: string; kind: "STATE_TRANSITION"; assetId: string; from: MachinePhase; to: MachinePhase; minimumOccurrences: number; requirementRef: string }
  | {
      id: string;
      kind: "EVENT_SEQUENCE";
      events: string[];
      maximumElapsedSeconds: number;
      minimumValidOccurrences: number;
      requirementRef: string;
    }
  | {
      id: string;
      kind: "DOWNSTREAM_ACK";
      trigger: string;
      acknowledgement: string;
      maximumElapsedSeconds: number;
      minimumValidOccurrences: number;
      requirementRef: string;
    }
  | { id: string; kind: "ALARM_ABSENCE"; assetIds: string[]; severities: Alarm["severity"][]; requirementRef: string }
  | { id: string; kind: "COMPLETE_CYCLES"; assetId: string; count: number; requirementRef: string }
  | {
      id: string;
      kind: "STABLE_WINDOW";
      tag: string;
      minimum: number;
      maximum: number;
      unit: string;
      settlingSeconds: number;
      windowSeconds: number;
      qualityPolicy: QualityPolicy;
      requirementRef: string;
    }
  | { id: string; kind: "DEPENDENCY_COVERAGE"; edgeIds: string[]; coveredByCheckIds: string[]; requirementRef: string };

export type RecoveryCheckKind = RecoveryCheck["kind"];

export type RecoveryPlanStatus = "DRAFT" | "APPROVED" | "SUPERSEDED" | "INVALIDATED";

export interface RecoveryPlan {
  id: string;
  version: number;
  status: RecoveryPlanStatus;
  incidentId: string;
  knowledgeVersion: string;
  baselineVersion: string;
  scope: {
    cellId: CellId | "PLANT";
    recipe: string;
    mode: OperatingMode;
    requiredCompleteCycles: number;
    commandedSpeedRpm?: number;
  };
  requiredEvidence: string[];
  checks: RecoveryCheck[];
  /** Frozen evidence snapshot of the incident when the plan was created. */
  incidentEvidenceSnapshot: string[];
  healthyReferenceId: string;
  validityLimits: string[];
  approval: ReviewRecord | null;
  invalidationReason?: string;
  warning: string;
  createdAt: TimeStamp;
  templateIds: string[];
  /** Explanation of which requirement justifies each check. */
  checkJustifications: Record<string, string>;
}

export type RunOutcome = "NOT_STARTED" | "RUNNING" | "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_COMPARABLE";

export type CheckStatus = "PENDING" | "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_COMPARABLE";

export interface CheckResult {
  checkId: string;
  status: CheckStatus;
  reason: string;
  /** Observed evidence summary (counts, values, occurrences). */
  detail: Record<string, string | number | boolean | null>;
  evidenceObservationIds: string[];
  missingChannels: string[];
  /** Whether a decisive valid violation was observed. */
  decisiveViolation: boolean;
}

export interface RecoveryRun {
  id: string;
  planId: string;
  planVersion: number;
  incidentId: string;
  knowledgeVersion: string;
  baselineVersion: string;
  outcome: RunOutcome;
  startedAt: TimeStamp;
  finishedAt?: TimeStamp;
  /** Last simulation time evaluated. */
  evaluatedUntilMs: EpochMs;
  results: CheckResult[];
  summary: string;
  contextObserved: { recipe?: string; mode?: OperatingMode; commandedSpeedRpm?: number; actualSpeedRpm?: number };
  completeCyclesObserved: number;
  settlingRemainingSeconds: number;
  reasonNotEstablished: string[];
  /** Interventions recorded after the run started make it stale for closure. */
  staleReason?: string;
  workOrderId?: string;
  reviewedBy?: ReviewRecord;
  fixture?: { fictional: true; note: string; testScope: string };
  /** Observation ids retained as evidence for this run (bounded). */
  retainedObservationIds: string[];
}

// ---------------------------------------------------------------------------
// Maintenance, inventory, costs
// ---------------------------------------------------------------------------

export type WorkOrderState =
  | "OPEN"
  | "INVESTIGATING"
  | "INTERVENTION_APPROVED"
  | "WORK_RECORDED"
  | "AWAITING_VERIFICATION"
  | "VERIFICATION_IN_PROGRESS"
  | "VERIFIED"
  | "CLOSED"
  | "VERIFICATION_FAILED"
  | "REVIEW_REQUIRED";

/** Money in paise (integer) to stay decimal-safe. */
export type Paise = number;

export interface LaborRecord {
  id: string;
  who: string;
  minutes: number;
  ratePaisePerHour: Paise;
  at: TimeStamp;
  note: string;
}

export interface PartUsage {
  transactionId: string;
  partId: string;
  quantity: number;
  unitPricePaise: Paise;
}

export interface WorkPerformed {
  id: string;
  at: TimeStamp;
  by: string;
  description: string;
  /** Simulation intervention applied, if any. */
  interventionId?: string;
}

export interface WorkOrder {
  id: string;
  incidentId?: string;
  assetId: string;
  cellId?: CellId;
  title: string;
  state: WorkOrderState;
  priority: "P1" | "P2" | "P3";
  assignee: string;
  evidenceRefs: string[];
  suspectedMechanism: string;
  plannedAction: string;
  approvals: ReviewRecord[];
  workPerformed: WorkPerformed[];
  labor: LaborRecord[];
  parts: PartUsage[];
  recoveryPlanId?: string;
  runIds: string[];
  review?: ReviewRecord;
  closure?: { at: TimeStamp; runId: string; reviewer: string; wording: string };
  events: AuditEvent[];
  createdAt: TimeStamp;
  fixture?: { fictional: true; note: string };
  /** Historical fixtures: what was tested vs not tested. */
  testScope?: { tested: string[]; notTested: string[]; modes: string[] };
  faultFamily?: FaultFamilyId;
  /** Set when the record is closed; closed records are not editable. */
  locked?: boolean;
}

export interface InventoryPart {
  id: string;
  name: string;
  unit: "ea" | "L" | "m";
  indivisible: boolean;
  onHand: number;
  reserved: number;
  minimumStock: number;
  catalogPricePaise: Paise;
}

export type InventoryTransactionKind = "RESERVE" | "CONSUME" | "RETURN" | "RELEASE" | "RECEIVE";

export interface InventoryTransaction {
  id: string;
  idempotencyKey: string;
  kind: InventoryTransactionKind;
  partId: string;
  quantity: number;
  unitPricePaise: Paise;
  workOrderId?: string;
  at: TimeStamp;
}

export interface CostAssumption {
  id: string;
  cellId: CellId;
  interruptionPaisePerMinute: Paise;
  laborPaisePerHour: Paise;
  /** What the downtime total represents. */
  downtimeBasis: "CELL_MINUTES";
  budgetPaise: Paise;
  note: string;
}

export interface AuditEvent {
  id: string;
  at: TimeStamp;
  actor: string;
  simulatedIdentity: true;
  kind: string;
  subjectId: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Workspace / session bundle
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  mode: ExecutionMode;
  createdAt: TimeStamp;
  /** For imported replay: filenames, date range, quality notes. */
  importInfo?: {
    fileNames: string[];
    observedRange?: { startMs: EpochMs; endMs: EpochMs };
    timeZoneAssumption?: string;
    limitations: string[];
  };
  isWhatIf?: boolean;
  seed?: number;
  scenarioId?: string;
}

export interface SessionBundle {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: TimeStamp;
  workspace: Workspace;
  sources: SourceDocument[];
  proposals: KnowledgeProposal[];
  knowledgeVersions: KnowledgeVersion[];
  activeKnowledgeVersionId: string;
  baselines: HealthyBaseline[];
  incidents: Incident[];
  alarms: Alarm[];
  plans: RecoveryPlan[];
  runs: RecoveryRun[];
  workOrders: WorkOrder[];
  inventory: InventoryPart[];
  inventoryTransactions: InventoryTransaction[];
  costAssumptions: CostAssumption[];
  audit: AuditEvent[];
  /** Observations relevant to open incidents/runs; bounded. */
  observations: Observation[];
  /** Never includes hidden scenario truth. */
  containsGroundTruth: false;
}
