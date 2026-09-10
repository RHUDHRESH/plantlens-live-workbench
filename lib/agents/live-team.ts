import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

export const LIVE_SPECIALISTS = ["Device Identification", "Official Manual Research", "Transport and Protocol", "Sensor Onboarding", "VFD Register", "Asset-Class Curator", "Channel-Mapping", "Digital-Twin Composer", "Diagnostic-Rule", "Evidence and Maintenance"] as const;
export type LiveSpecialist = (typeof LIVE_SPECIALISTS)[number];
export type LiveSpecialistStatus = "COMPLETED" | "BLOCKED" | "SKIPPED" | "FAILED";
export interface LiveSpecialistOutcome { specialist: LiveSpecialist; status: LiveSpecialistStatus; message: string; evidence: string[]; }
const LiveState = Annotation.Root({ request: Annotation<string>(), hasVerifiedDevice: Annotation<boolean>(), hasExactHardwareModels: Annotation<boolean>(), outcomes: Annotation<LiveSpecialistOutcome[]>() });
export interface LiveTeamResult { completed: string[]; activationBlocked: boolean; warnings: string[]; outcomes: LiveSpecialistOutcome[]; }

function outcome(specialist: LiveSpecialist, state: typeof LiveState.State): LiveSpecialistOutcome {
  const verified = state.hasVerifiedDevice, models = state.hasExactHardwareModels, none: string[] = [];
  if (specialist === "Device Identification") return verified ? { specialist, status: "COMPLETED", message: "Verified-device gate passed.", evidence: ["verified-device-gate"] } : { specialist, status: "BLOCKED", message: "No verified device identity was supplied.", evidence: none };
  if (specialist === "Official Manual Research") return models ? { specialist, status: "SKIPPED", message: "Exact-model availability was declared, but no manual excerpts or research tool were supplied to this graph.", evidence: ["exact-model-evidence-gate"] } : { specialist, status: "BLOCKED", message: "Exact models and official manuals are missing; no research was performed.", evidence: none };
  if (specialist === "Transport and Protocol") return verified ? { specialist, status: "COMPLETED", message: "Read-only transport eligibility checked; no connection opened.", evidence: ["verified-device-gate", "read-only-policy"] } : { specialist, status: "SKIPPED", message: "A verified descriptor is required.", evidence: none };
  if (["Sensor Onboarding", "VFD Register", "Channel-Mapping"].includes(specialist)) return models && verified ? { specialist, status: "SKIPPED", message: "Prerequisite flags passed, but no descriptor/manual evidence was supplied for validation.", evidence: ["verified-device-gate", "exact-model-evidence-gate"] } : { specialist, status: "BLOCKED", message: "Verified identity and exact manufacturer models are required.", evidence: none };
  if (specialist === "Asset-Class Curator") return state.request.trim() ? { specialist, status: "COMPLETED", message: "Bounded operator description inspected.", evidence: ["operator-request"] } : { specialist, status: "BLOCKED", message: "No operator description supplied.", evidence: none };
  if (specialist === "Digital-Twin Composer") return { specialist, status: "SKIPPED", message: verified ? "Eligibility passed, but no validated mapping document was supplied." : "An identified source device is required.", evidence: verified ? ["verified-device-gate"] : none };
  if (specialist === "Diagnostic-Rule") return { specialist, status: "SKIPPED", message: "No diagnostic rule was drafted because validated mappings and cited observations were not supplied.", evidence: none };
  return { specialist, status: "COMPLETED", message: "Evidence gaps and mandatory human review recorded.", evidence: ["human-review-policy"] };
}

/** Bounded assessment graph. Nodes receive no shell, hardware-control, write, approval, or delete tools. */
export async function runLiveConfigurationGraph(input: { request: string; hasVerifiedDevice: boolean; hasExactHardwareModels: boolean }): Promise<LiveTeamResult> {
  const check = (specialist: LiveSpecialist) => async (state: typeof LiveState.State) => ({ outcomes: [...(state.outcomes ?? []), outcome(specialist, state)] });
  const graph = new StateGraph(LiveState)
    .addNode("device", check(LIVE_SPECIALISTS[0])).addNode("manual", check(LIVE_SPECIALISTS[1])).addNode("transport", check(LIVE_SPECIALISTS[2])).addNode("sensor", check(LIVE_SPECIALISTS[3])).addNode("vfd", check(LIVE_SPECIALISTS[4]))
    .addNode("asset", check(LIVE_SPECIALISTS[5])).addNode("mapping", check(LIVE_SPECIALISTS[6])).addNode("twin", check(LIVE_SPECIALISTS[7])).addNode("diagnostic", check(LIVE_SPECIALISTS[8])).addNode("evidence", check(LIVE_SPECIALISTS[9]))
    .addEdge(START, "device").addEdge("device", "manual").addEdge("manual", "transport").addEdge("transport", "sensor").addEdge("sensor", "vfd").addEdge("vfd", "asset").addEdge("asset", "mapping").addEdge("mapping", "twin").addEdge("twin", "diagnostic").addEdge("diagnostic", "evidence").addEdge("evidence", END).compile();
  const result = await graph.invoke({ ...input, request: input.request.trim().slice(0, 4_000), outcomes: [] });
  const outcomes = result.outcomes ?? []; const activationBlocked = !input.hasVerifiedDevice || !input.hasExactHardwareModels;
  return { completed: outcomes.filter(item => item.status === "COMPLETED").map(item => item.specialist), outcomes, activationBlocked, warnings: activationBlocked ? ["Real hardware activation is blocked until the verified device, exact VFD model, sensor models, and official manuals are attached."] : [] };
}
