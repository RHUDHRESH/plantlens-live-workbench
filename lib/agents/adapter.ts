import { abstainForMissingEvidence, createProposalDraft } from "./evidence";
import { redactSensitiveText } from "./security";
import type { AgentExecutionContext, AgentGraphAdapter, AgentOutput, ProposalCategory } from "./types";

function stableHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

function proposalCategory(intent: AgentExecutionContext["route"]["intent"]): ProposalCategory | undefined {
  if (intent === "DRAFT_KNOWLEDGE_CHANGE" || intent === "RESOLVE_ASSET_TAG") return "KNOWLEDGE_CHANGE";
  if (intent === "DRAFT_RECOVERY_CHECKS") return "RECOVERY_PLAN";
  if (intent === "DRAFT_MAINTENANCE_WORK") return "WORK_ORDER";
  return undefined;
}

/**
 * Fully deterministic adapter used by the no-key build. It does not imitate an LLM:
 * it can only compose a cited summary/draft from records passed into its context.
 */
export class DeterministicNoKeyAdapter implements AgentGraphAdapter {
  readonly id = "deterministic-no-key-v1";
  readonly provider = "LOCAL_DETERMINISTIC";
  readonly requiresApiKey = false;

  async execute(context: AgentExecutionContext): Promise<AgentOutput> {
    const category = proposalCategory(context.route.intent);
    if (category) {
      const evidenceIds = context.evidence.map((item) => item.id);
      const result = createProposalDraft({
        id: `AGENT-PROP-${stableHash(`${context.runId}|${context.request}`)}`,
        category,
        title: `Draft for review: ${redactSensitiveText(context.request).slice(0, 120)}`,
        summary: "This is an evidence-bound draft. It has no operational effect until separately reviewed through the human workflow.",
        claims: context.evidence.length
          ? [{ text: "The supplied official records support placing this bounded change before a human reviewer.", evidenceIds }]
          : [],
        evidence: context.evidence,
        proposedBy: context.definition.id,
        createdAtMs: context.nowMs,
        limitations: ["Deterministic no-key composition; the requested technical change must be specified and checked by a human reviewer."],
      });
      return result.ok ? { kind: "PROPOSAL_DRAFT", proposal: result.proposal } : result.abstention;
    }

    if (!context.evidence.length) return abstainForMissingEvidence("answer this request");
    const evidenceIds = context.evidence.map((item) => item.id);
    const titles = context.evidence.slice(0, 5).map((item) => `${item.title} (${item.locator})`).join("; ");
    return {
      kind: "ANSWER",
      text: `Relevant official records: ${titles}.`,
      evidenceIds,
      uncertainty: "This deterministic adapter only identifies supplied records; it does not infer facts beyond their excerpts.",
    };
  }
}

/** Contract a future optional LangGraph.js package may implement at the app boundary. */
export interface LangGraphJsRuntime {
  readonly implementation: "LANGGRAPH_JS";
  invoke(context: AgentExecutionContext): Promise<AgentOutput>;
}

/**
 * Thin dependency-injection bridge. This file intentionally does not import LangGraph;
 * constructing it requires a real runtime supplied by an integration package.
 */
export class LangGraphJsAdapter implements AgentGraphAdapter {
  readonly id = "langgraph-js-injected-runtime";
  readonly provider = "INJECTED_LANGGRAPH_JS";
  readonly requiresApiKey: boolean;

  constructor(private readonly runtime: LangGraphJsRuntime, options: { requiresApiKey: boolean }) {
    this.requiresApiKey = options.requiresApiKey;
  }

  execute(context: AgentExecutionContext): Promise<AgentOutput> {
    return this.runtime.invoke(context);
  }
}

export const LANGGRAPH_BINDING_STATUS = {
  installed: true as const,
  active: true as const,
  detail: "LangGraph.js is installed. PlantLens ships a deterministic no-key graph and accepts an explicitly injected provider runtime.",
};
