import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

export const LIVE_SPECIALISTS = [
  "Device Identification",
  "Official Manual Research",
  "Transport and Protocol",
  "Sensor Onboarding",
  "VFD Register",
  "Asset-Class Curator",
  "Channel-Mapping",
  "Digital-Twin Composer",
  "Diagnostic-Rule",
  "Evidence and Maintenance",
] as const;

const LiveState = Annotation.Root({
  request: Annotation<string>(),
  hasVerifiedDevice: Annotation<boolean>(),
  hasExactHardwareModels: Annotation<boolean>(),
  completed: Annotation<string[]>(),
});

export interface LiveTeamResult {
  completed: string[];
  activationBlocked: boolean;
  warnings: string[];
}

/** Sequential ten-specialist graph; nodes receive no shell, serial, write, or delete tools. */
export async function runLiveConfigurationGraph(input: {
  request: string;
  hasVerifiedDevice: boolean;
  hasExactHardwareModels: boolean;
}): Promise<LiveTeamResult> {
  const complete = (specialist: string) => async (state: typeof LiveState.State) => ({ completed: [...(state.completed ?? []), specialist] });
  const graph = new StateGraph(LiveState)
    .addNode("device", complete(LIVE_SPECIALISTS[0]))
    .addNode("manual", complete(LIVE_SPECIALISTS[1]))
    .addNode("transport", complete(LIVE_SPECIALISTS[2]))
    .addNode("sensor", complete(LIVE_SPECIALISTS[3]))
    .addNode("vfd", complete(LIVE_SPECIALISTS[4]))
    .addNode("asset", complete(LIVE_SPECIALISTS[5]))
    .addNode("mapping", complete(LIVE_SPECIALISTS[6]))
    .addNode("twin", complete(LIVE_SPECIALISTS[7]))
    .addNode("diagnostic", complete(LIVE_SPECIALISTS[8]))
    .addNode("evidence", complete(LIVE_SPECIALISTS[9]))
    .addEdge(START, "device")
    .addEdge("device", "manual")
    .addEdge("manual", "transport")
    .addEdge("transport", "sensor")
    .addEdge("sensor", "vfd")
    .addEdge("vfd", "asset")
    .addEdge("asset", "mapping")
    .addEdge("mapping", "twin")
    .addEdge("twin", "diagnostic")
    .addEdge("diagnostic", "evidence")
    .addEdge("evidence", END)
    .compile();
  const result = await graph.invoke({ ...input, completed: [] });
  const activationBlocked = !result.hasVerifiedDevice || !result.hasExactHardwareModels;
  return {
    completed: result.completed,
    activationBlocked,
    warnings: activationBlocked
      ? ["Real hardware activation is blocked until the verified device, exact VFD model, three sensor models, and official manuals are attached."]
      : [],
  };
}
