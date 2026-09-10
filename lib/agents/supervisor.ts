import { DeterministicNoKeyAdapter } from "./adapter";
import { abstainForMissingEvidence } from "./evidence";
import { getAgentDefinition } from "./registry";
import { routeIntent } from "./router";
import { redactSensitiveText, validateToolInvocation } from "./security";
import type {
  AgentGraphAdapter,
  AgentOutput,
  AgentRequest,
  AgentRun,
  AgentToolExecutor,
  AgentToolInputMap,
  AgentToolInvocation,
  AgentToolName,
  AgentToolResult,
} from "./types";

function stableHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash, 33) ^ text.charCodeAt(index);
  return (hash >>> 0).toString(36).toUpperCase();
}

export interface SupervisorOptions {
  adapter?: AgentGraphAdapter;
  toolExecutor?: AgentToolExecutor;
  clock?: () => number;
}

/** Deterministic orchestration and policy boundary for all ten specialists. */
export class DeterministicAgentSupervisor {
  private readonly adapter: AgentGraphAdapter;
  private readonly toolExecutor?: AgentToolExecutor;
  private readonly clock: () => number;

  constructor(options: SupervisorOptions = {}) {
    this.adapter = options.adapter ?? new DeterministicNoKeyAdapter();
    this.toolExecutor = options.toolExecutor;
    this.clock = options.clock ?? (() => Date.now());
  }

  async run(request: AgentRequest): Promise<AgentRun> {
    const startedAtMs = request.nowMs ?? this.clock();
    const route = routeIntent(request.text);
    const definition = getAgentDefinition(route.agentId);
    const runId = `AGENT-RUN-${stableHash(`${startedAtMs}|${request.text}`)}`;
    const policyNotes: string[] = [];
    if (route.injectionDetected) policyNotes.push("Prompt-injection-like text was treated as untrusted content, not authority.");

    let output: AgentOutput;
    let status: AgentRun["status"];
    if (route.intent === "PROHIBITED_ACTION") {
      output = {
        kind: "ABSTENTION",
        reason: route.prohibitedAction ?? "The requested action is outside the read/propose-only agent boundary.",
        missingEvidence: [],
        suggestedReadTools: [],
      };
      status = "BLOCKED";
      policyNotes.push("The request was blocked before adapter execution.");
    } else {
      try {
        output = await this.adapter.execute({
          runId,
          request: request.text,
          route,
          definition,
          evidence: request.evidence ?? [],
          nowMs: startedAtMs,
        });
        status = output.kind === "ABSTENTION" ? "ABSTAINED" : "COMPLETED";
      } catch {
        output = abstainForMissingEvidence("complete the request because the configured adapter failed");
        status = "FAILED";
        policyNotes.push("Adapter failure was contained; no proposal or action was emitted.");
      }
    }

    return {
      id: runId,
      request: request.text,
      route,
      status,
      startedAtMs,
      completedAtMs: request.nowMs ?? this.clock(),
      adapterId: this.adapter.id,
      toolInvocations: [],
      toolResults: [],
      output,
      audit: {
        redactedRequest: redactSensitiveText(request.text),
        injectionDetected: route.injectionDetected,
        policyNotes,
      },
    };
  }

  /**
   * Execute one explicitly constructed tool call after checking both global and
   * specialist allowlists. Model text cannot add tools to either list.
   */
  async invokeTool<TName extends AgentToolName>(
    invocation: Omit<AgentToolInvocation<TName>, "mode">,
  ): Promise<{ invocation: AgentToolInvocation<TName>; result: AgentToolResult<TName> }> {
    const definition = getAgentDefinition(invocation.agentId);
    const mode = invocation.tool.startsWith("read_") ? "READ" : "PROPOSE";
    const checked = { ...invocation, mode } as AgentToolInvocation<TName>;
    const policy = validateToolInvocation(checked, definition);
    if (!policy.allowed) {
      return {
        invocation: checked,
        result: {
          invocationId: checked.id,
          tool: checked.tool,
          ok: false,
          error: policy.reason,
          completedAtMs: this.clock(),
        },
      };
    }
    if (!this.toolExecutor) {
      return {
        invocation: checked,
        result: {
          invocationId: checked.id,
          tool: checked.tool,
          ok: false,
          error: "No application tool executor is configured.",
          completedAtMs: this.clock(),
        },
      };
    }
    return { invocation: checked, result: await this.toolExecutor.execute(checked) };
  }
}

/** Helper that preserves the tool/input relationship for callers building invocations. */
export function toolInput<TName extends AgentToolName>(tool: TName, input: AgentToolInputMap[TName]): { tool: TName; input: AgentToolInputMap[TName] } {
  return { tool, input };
}
