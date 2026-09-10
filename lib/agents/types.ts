/**
 * Provider-neutral types for the PlantLens agent layer.
 *
 * Agent output is advisory. The only stateful-looking output an agent may produce is a
 * proposal draft, which still requires a separate human review and existing domain
 * workflow before it can affect plant knowledge or recovery records.
 */

export const AGENT_IDS = [
  "INCIDENT_TRIAGE",
  "EVIDENCE_RETRIEVER",
  "ASSET_TAG_RESOLVER",
  "DEPENDENCY_ANALYST",
  "DIAGNOSTIC_ANALYST",
  "RECOVERY_CHECK_DRAFTER",
  "MAINTENANCE_PLANNER",
  "KNOWLEDGE_PROPOSER",
  "CONSISTENCY_REVIEWER",
  "REPORTING_ANALYST",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_INTENTS = [
  "TRIAGE_INCIDENT",
  "FIND_EVIDENCE",
  "RESOLVE_ASSET_TAG",
  "ANALYSE_DEPENDENCY",
  "EXPLAIN_DIAGNOSIS",
  "DRAFT_RECOVERY_CHECKS",
  "DRAFT_MAINTENANCE_WORK",
  "DRAFT_KNOWLEDGE_CHANGE",
  "REVIEW_CONSISTENCY",
  "BUILD_REPORT",
  "GENERAL_QUESTION",
  "PROHIBITED_ACTION",
] as const;

export type AgentIntent = (typeof AGENT_INTENTS)[number];

export const READ_TOOL_NAMES = [
  "read_incidents",
  "read_assets",
  "read_observations",
  "read_knowledge",
  "read_source_excerpts",
  "read_recovery_runs",
  "read_work_orders",
] as const;

export const PROPOSE_TOOL_NAMES = [
  "propose_knowledge_change",
  "propose_recovery_plan",
  "propose_work_order",
] as const;

export const AGENT_TOOL_NAMES = [...READ_TOOL_NAMES, ...PROPOSE_TOOL_NAMES] as const;
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type ProposeToolName = (typeof PROPOSE_TOOL_NAMES)[number];
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
export type AgentToolMode = "READ" | "PROPOSE";

export interface AgentToolInputMap {
  read_incidents: { incidentId?: string; status?: "OPEN" | "CLOSED"; limit?: number };
  read_assets: { assetIds?: string[]; cellId?: string };
  read_observations: { assetIds: string[]; tagIds?: string[]; fromMs?: number; toMs?: number; limit?: number };
  read_knowledge: { versionId?: string; edgeIds?: string[]; requirementIds?: string[] };
  read_source_excerpts: { sourceIds?: string[]; query?: string; maxExcerpts?: number };
  read_recovery_runs: { runIds?: string[]; incidentId?: string; limit?: number };
  read_work_orders: { workOrderIds?: string[]; assetId?: string; limit?: number };
  propose_knowledge_change: { draftId: string; title: string; summary: string; evidenceIds: string[] };
  propose_recovery_plan: { draftId: string; incidentId: string; title: string; evidenceIds: string[] };
  propose_work_order: { draftId: string; assetId: string; title: string; evidenceIds: string[] };
}

export interface AgentToolOutputMap {
  read_incidents: unknown[];
  read_assets: unknown[];
  read_observations: unknown[];
  read_knowledge: unknown[];
  read_source_excerpts: unknown[];
  read_recovery_runs: unknown[];
  read_work_orders: unknown[];
  propose_knowledge_change: { proposalId: string; state: "AWAITING_REVIEW" };
  propose_recovery_plan: { proposalId: string; state: "AWAITING_REVIEW" };
  propose_work_order: { proposalId: string; state: "AWAITING_REVIEW" };
}

export interface AgentToolInvocation<TName extends AgentToolName = AgentToolName> {
  id: string;
  runId: string;
  agentId: AgentId;
  tool: TName;
  mode: AgentToolMode;
  input: AgentToolInputMap[TName];
  requestedAtMs: number;
}

export interface AgentToolResult<TName extends AgentToolName = AgentToolName> {
  invocationId: string;
  tool: TName;
  ok: boolean;
  output?: AgentToolOutputMap[TName];
  error?: string;
  completedAtMs: number;
}

export type OfficialEvidenceKind =
  | "SOURCE_DOCUMENT"
  | "PUBLISHED_KNOWLEDGE"
  | "OBSERVATION"
  | "INCIDENT_RECORD"
  | "RECOVERY_RUN"
  | "WORK_ORDER";

/** Evidence is official only when supplied by a trusted PlantLens record adapter. */
export interface OfficialEvidence {
  id: string;
  official: true;
  kind: OfficialEvidenceKind;
  title: string;
  excerpt: string;
  locator: string;
  observedAtMs?: number;
  sourceVersion?: string;
}

export interface ProposalClaim {
  text: string;
  evidenceIds: string[];
}

export type ProposalCategory = "KNOWLEDGE_CHANGE" | "RECOVERY_PLAN" | "WORK_ORDER";
export type ProposalReviewState = "AWAITING_REVIEW" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "DEFERRED";

export interface AgentProposalDraft {
  id: string;
  category: ProposalCategory;
  title: string;
  summary: string;
  claims: ProposalClaim[];
  evidence: OfficialEvidence[];
  proposedBy: AgentId;
  state: ProposalReviewState;
  createdAtMs: number;
  limitations: string[];
}

export interface AgentAbstention {
  kind: "ABSTENTION";
  reason: string;
  missingEvidence: string[];
  suggestedReadTools: ReadToolName[];
}

export interface AgentAnswer {
  kind: "ANSWER";
  text: string;
  evidenceIds: string[];
  uncertainty: string;
}

export interface AgentProposalOutput {
  kind: "PROPOSAL_DRAFT";
  proposal: AgentProposalDraft;
}

export type AgentOutput = AgentAnswer | AgentProposalOutput | AgentAbstention;

export interface AgentRequest {
  text: string;
  evidence?: readonly OfficialEvidence[];
  context?: Readonly<Record<string, string | number | boolean | null>>;
  nowMs?: number;
}

export interface AgentRoute {
  intent: AgentIntent;
  agentId: AgentId;
  confidence: number;
  reason: string;
  injectionDetected: boolean;
  prohibitedAction?: string;
}

export interface AgentRun<TOutput extends AgentOutput = AgentOutput> {
  id: string;
  request: string;
  route: AgentRoute;
  status: "COMPLETED" | "ABSTAINED" | "BLOCKED" | "FAILED";
  startedAtMs: number;
  completedAtMs: number;
  adapterId: string;
  toolInvocations: AgentToolInvocation[];
  toolResults: AgentToolResult[];
  output: TOutput;
  audit: {
    redactedRequest: string;
    injectionDetected: boolean;
    policyNotes: string[];
  };
}

export interface AgentDefinition {
  id: AgentId;
  label: string;
  purpose: string;
  intents: readonly AgentIntent[];
  allowedTools: readonly AgentToolName[];
  boundaries: readonly string[];
}

export interface AgentExecutionContext {
  runId: string;
  request: string;
  route: AgentRoute;
  definition: AgentDefinition;
  evidence: readonly OfficialEvidence[];
  nowMs: number;
}

/** Minimal graph boundary; no graph library or provider is required by this package. */
export interface AgentGraphAdapter {
  readonly id: string;
  readonly provider: string;
  readonly requiresApiKey: boolean;
  execute(context: AgentExecutionContext): Promise<AgentOutput>;
}

/** Optional tool executor supplied by an application boundary, never by model text. */
export interface AgentToolExecutor {
  execute<TName extends AgentToolName>(invocation: AgentToolInvocation<TName>): Promise<AgentToolResult<TName>>;
}
