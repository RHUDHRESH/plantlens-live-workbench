import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { DeterministicNoKeyAdapter } from "./adapter";
import type { AgentExecutionContext, AgentOutput } from "./types";

const GraphState = Annotation.Root({
  context: Annotation<AgentExecutionContext>(),
  output: Annotation<AgentOutput | undefined>(),
});

/** A real LangGraph.js workflow whose no-key specialist remains deterministic. */
export class PlantLensLangGraphRuntime {
  readonly implementation = "LANGGRAPH_JS" as const;
  private readonly graph;

  constructor() {
    const specialist = new DeterministicNoKeyAdapter();
    this.graph = new StateGraph(GraphState)
      .addNode("policy_boundary", async (state) => {
        if (state.context.route.intent !== "PROHIBITED_ACTION") return {};
        return {
          output: {
            kind: "ABSTENTION" as const,
            reason: "Device writes, control, terminal access, flashing, and destructive operations are outside PlantLens agent authority.",
            missingEvidence: [],
            suggestedReadTools: [],
          },
        };
      })
      .addNode("bounded_specialist", async (state) => ({
        output: state.output ?? await specialist.execute(state.context),
      }))
      .addEdge(START, "policy_boundary")
      .addEdge("policy_boundary", "bounded_specialist")
      .addEdge("bounded_specialist", END)
      .compile();
  }

  async invoke(context: AgentExecutionContext): Promise<AgentOutput> {
    const result = await this.graph.invoke({ context });
    if (!result.output) throw new Error("LangGraph completed without a bounded output.");
    return result.output;
  }
}
