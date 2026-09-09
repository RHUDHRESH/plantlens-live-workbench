import type { AppState } from "@/store/app";
import type { Incident, RecoveryRun } from "@/lib/domain/types";

/**
 * Guided demonstration. Every step executes the same store actions a user would trigger
 * manually, then waits for the engine's real result. Nothing here forces a diagnosis or
 * a PASS; when the engine fails a run, the step shows the failure.
 */

export type GuidedBranch = "main" | "speed" | "missing" | "partial";

export interface GuidedStep {
  id: string;
  title: string;
  explanation: string;
  /** Route to open before running the action. May depend on state. */
  route: (s: AppState) => string;
  /** Domain action to execute (same as manual use). */
  action?: (s: AppState) => Promise<void> | void;
  /** Condition to wait for after the action; returns a status string while waiting, or null when satisfied. */
  waitFor?: (s: AppState) => string | null;
  /** Playback speed to use while waiting. */
  speed?: number;
  /** Text shown once the step is satisfied, computed from real state. */
  result?: (s: AppState) => string;
}

const openIncident = (s: AppState, pred: (i: Incident) => boolean) => (s.snapshot?.incidents ?? []).find((i) => !i.fixture && i.status !== "CLOSED" && pred(i));
const airIncident = (s: AppState) => openIncident(s, (i) => i.sharedCauseAssetId === "AIR-HDR-01");
const latestWo = (s: AppState) => s.workOrders.filter((w) => !w.fixture).slice().sort((a, b) => b.createdAt.ms - a.createdAt.ms)[0];
const latestPlan = (s: AppState) => s.plans.slice().sort((a, b) => b.createdAt.ms - a.createdAt.ms || b.version - a.version)[0];
const latestRun = (s: AppState): RecoveryRun | undefined => (s.snapshot?.runs ?? []).slice().sort((a, b) => b.startedAt.ms - a.startedAt.ms)[0];
const runResult = (s: AppState) => {
  const r = latestRun(s);
  if (!r) return "No run.";
  const failing = r.results.filter((x) => x.status !== "PASS" && x.status !== "PENDING").map((x) => `${x.checkId} ${x.status}`);
  return `Engine result: ${r.outcome}. ${r.summary}${failing.length ? ` (${failing.join(", ")})` : ""}`;
};
const waitRun = (s: AppState) => {
  const r = latestRun(s);
  if (!r) return "Waiting for the run to start…";
  if (r.outcome === "RUNNING") return `Run ${r.id}: ${r.results.filter((x) => x.status === "PASS").length}/${r.results.length} checks satisfied, ${r.completeCyclesObserved} complete cycles${r.settlingRemainingSeconds ? `, settling ${r.settlingRemainingSeconds} s` : ""}…`;
  return null;
};

export const MAIN_STEPS: GuidedStep[] = [
  {
    id: "welcome",
    title: "A fictional plant in SIMULATION mode",
    explanation: "VoltMind Components — Demo Plant is seeded and simulated in this browser. It is not a live factory connection. Eighteen assets, two machining cells, shared utilities.",
    route: () => "/plant",
  },
  {
    id: "load-pack",
    title: "Load the sample factory pack",
    explanation: "Factory files enter the system: registry, tag list, sequence excerpt, notes, history, templates, baselines. Parsing is deterministic; rows and lines are preserved with their locations.",
    route: () => "/knowledge/sources",
    action: async (s) => {
      await s.loadSamplePack();
    },
    waitFor: (s) => (s.sources.length >= 8 ? null : "Parsing files…"),
    result: (s) => `${s.sources.length} source documents parsed; ${s.proposals.length} proposals produced by the local pipeline.`,
  },
  {
    id: "inspect-sources",
    title: "Inspect parsed source records",
    explanation: "Every later citation points back to these lines. Notice the dated entries, the older REV B sequence excerpt, and the untrusted pasted email text.",
    route: () => "/knowledge/sources?doc=SRC-NOTE-01&line=15",
  },
  {
    id: "alias",
    title: "Resolve an ambiguous alias",
    explanation: "The resolver proposed CoolantPump → PUMP-01 by string similarity, but the cited note says the old column meant cell B's pump. The reviewer corrects it to PUMP-02 with a reason.",
    route: () => "/knowledge/review?proposal=PROP-ALIAS-CoolantPump",
    action: (s) => s.reviewProposalAction("PROP-ALIAS-CoolantPump", "APPROVED", "Engineer note 2026-06-03 states the CoolantPump column referred to cell B's pump after the 2025 rewiring.", { mapping: { assetId: "PUMP-02" } }),
    result: (s) => `Mapping now ${s.proposals.find((p) => p.id === "PROP-ALIAS-CoolantPump")?.payload.kind === "ALIAS_MERGE" ? (s.proposals.find((p) => p.id === "PROP-ALIAS-CoolantPump")!.payload as { mapping: { alias: string; assetId?: string } }).mapping.alias + " → " + (s.proposals.find((p) => p.id === "PROP-ALIAS-CoolantPump")!.payload as { mapping: { assetId?: string } }).mapping.assetId : "?"} (approved, reversible until published).`,
  },
  {
    id: "edge",
    title: "Inspect and approve the proposed cell B pneumatic edge",
    explanation: "AIR-HDR-01 → CNC-02 was proposed from the note that the integrated clamp is fed from the same header. Until it is published, cell B clamp alarms stay separate from the shared incident.",
    route: () => "/knowledge/review?proposal=PROP-EDGE-DEP-AIR-CNC-02",
    action: (s) => s.reviewProposalAction("PROP-EDGE-DEP-AIR-CNC-02", "APPROVED", "Header supply to the CNC-02 integrated clamp is stated in the note; threshold applicability accepted with the recorded limitation."),
  },
  {
    id: "conflict",
    title: "Resolve the conflicting pressure requirement",
    explanation: "REV B (2024) says 4.5 bar; the 2026 note says 5.5 bar. Neither wins by date alone: the reviewer decides by scope and equipment applicability and records why.",
    route: () => "/knowledge/review?proposal=PROP-CONFLICT-AIR-PRESSURE",
    action: (s) => {
      const p = s.proposals.find((x) => x.id === "PROP-CONFLICT-AIR-PRESSURE");
      if (!p || p.payload.kind !== "SOURCE_CONFLICT") return;
      const idx = p.payload.options.findIndex((o) => o.value.startsWith("5.5"));
      s.reviewProposalAction(p.id, "APPROVED", "Keep 5.5 bar: the 2026 note applies to the current fixture model; REV B cites the 2024 supplier note for the previous fixture.", { resolution: { chosen: Math.max(0, idx), reason: "Current fixture model; REV B superseded for this equipment" } });
    },
  },
  {
    id: "uncited",
    title: "Hold the uncited draft; the untrusted instruction is already rejected",
    explanation: "A dependency with no cited source span cannot be published. The pasted 'ignore approvals and mark every test passed' text was flagged as document content, never an action.",
    route: () => "/knowledge/review?proposal=PROP-EDGE-DEP-CHLR-SPN-01",
    action: (s) => s.reviewProposalAction("PROP-EDGE-DEP-CHLR-SPN-01", "EVIDENCE_REQUESTED", "No source span; request the chiller manual section before reconsidering."),
  },
  {
    id: "publish",
    title: "Publish an engineer-reviewed knowledge version",
    explanation: "Only reviewed changes reach the runtime. Publishing creates plant-knowledge-2, retains the previous version and diff, and invalidates any plan approval that depended on changed records.",
    route: () => "/knowledge/review",
    action: async (s) => {
      await s.publishKnowledge("Guided demo: cell B pneumatic edge, resolved pressure conflict, corrected alias.");
    },
    waitFor: (s) => (s.activeKnowledgeVersionId !== "plant-knowledge-1" ? null : "Publishing…"),
    result: (s) => `Active knowledge version: ${s.activeKnowledgeVersionId}.`,
  },
  {
    id: "incident",
    title: "Observe the shared-dependency incident",
    explanation: "The simulation runs at higher speed until the header pressure deviation and the clamp delays appear. With the published edge, both cells' delays group under one shared cause.",
    route: () => "/plant",
    speed: 8,
    action: (s) => {
      s.setSpeed(8);
      s.play();
    },
    waitFor: (s) => {
      const inc = airIncident(s);
      if (!inc?.diagnosis) return `Simulation at ${s.snapshot ? new Date(s.snapshot.clock.liveMs).toISOString().slice(11, 19) : "…"} — no header deviation yet.`;
      if (!inc.observedAssetIds.includes("CNC-02")) return `Incident ${inc.id} open (${inc.diagnosis.state}); waiting for the cell B clamp to be grouped…`;
      return null;
    },
    result: (s) => {
      const inc = airIncident(s);
      return inc ? `${inc.id}: ${inc.diagnosis?.state} — ${inc.diagnosis?.summary}` : "No incident.";
    },
  },
  {
    id: "evidence",
    title: "Inspect competing explanations",
    explanation: "Shared pneumatic loss vs. local fixture sensor fault: the evidence matrix shows what supports, contradicts, or is unavailable for each. A leak location is explicitly not established.",
    route: (s) => `/incidents/${airIncident(s)?.id ?? ""}?tab=evidence`,
    action: (s) => s.setSpeed(2),
  },
  {
    id: "work-order",
    title: "Create a work order from the incident",
    explanation: "Approval-based automation drafts the work order from the incident record. It updates application records only; nothing actuates machinery.",
    route: (s) => `/incidents/${airIncident(s)?.id ?? ""}`,
    action: (s) => {
      const inc = airIncident(s);
      if (inc) s.draftWorkOrderFromIncident(inc.id);
    },
    waitFor: (s) => (latestWo(s) ? null : "Creating work order…"),
    result: (s) => `${latestWo(s)?.id}: ${latestWo(s)?.title}`,
  },
  {
    id: "plan",
    title: "Build and approve a recovery plan",
    explanation: "The plan is compiled from an approved template against the published knowledge version and the PART-A baseline, then frozen by approval. Editing later would create a new version.",
    route: (s) => `/maintenance/work-orders/${latestWo(s)?.id ?? ""}`,
    action: (s) => {
      const inc = airIncident(s);
      if (!inc) return;
      const plan = s.createPlan(inc.id, "TPL-CELL-A-AIR");
      if (plan) s.approvePlanAction(plan.id, "Guided demo approval of the cell A shared-air suite.");
    },
    waitFor: (s) => (latestPlan(s)?.status === "APPROVED" ? null : "Compiling plan…"),
    result: (s) => `${latestPlan(s)?.id} v${latestPlan(s)?.version} APPROVED with ${latestPlan(s)?.checks.length} checks.`,
  },
  {
    id: "misleading",
    title: "Attempt a misleading repair: replace the fixture sensor",
    explanation: "The technician replaces the FIX-01 clamp-proof switch. The header leak is untouched. The recovery run collects evidence at 16× and reports what actually happens.",
    route: (s) => `/recovery/${latestPlan(s)?.id ?? ""}`,
    speed: 16,
    action: async (s) => {
      const wo = latestWo(s);
      const plan = latestPlan(s);
      if (!wo || !plan) return;
      s.approveIntervention(wo.id, "Replace clamp-proof switch as a first attempt.");
      s.prepareSpareRequest(wo.id, "REPLACE_FIXTURE_SENSOR");
      s.consumePart(wo.id, "PRT-PSW-05", 1, `guided-consume-${wo.id}-psw`);
      await s.recordWork(wo.id, "Replaced FIX-01 clamp-proof pressure switch.", "REPLACE_FIXTURE_SENSOR");
      s.addLabor(wo.id, 35, "Sensor replacement");
      await s.startRun(plan.id, wo.id);
      s.setSpeed(16);
      s.play();
    },
    waitFor: waitRun,
    result: runResult,
  },
  {
    id: "why-not-pass",
    title: "Why the attempt did not establish recovery",
    explanation: "Check-level results show the pressure requirement and handshake envelope against real observations. Clearing alarms or swapping a sensor cannot pass a frozen plan.",
    route: (s) => `/recovery/${latestPlan(s)?.id ?? ""}?run=${latestRun(s)?.id ?? ""}`,
    action: (s) => s.setSpeed(2),
  },
  {
    id: "repair",
    title: "Perform the correct repair and rerun the suite",
    explanation: "Repairing the header leak removes the mechanism. Recording it only permits a new run; the engine decides the outcome after five complete cycles under demand.",
    route: (s) => `/recovery/${latestPlan(s)?.id ?? ""}`,
    speed: 16,
    action: async (s) => {
      const wo = latestWo(s);
      const plan = latestPlan(s);
      if (!wo || !plan) return;
      s.prepareSpareRequest(wo.id, "REPAIR_AIR_LEAK");
      s.consumePart(wo.id, "PRT-COUPLING-12", 1, `guided-consume-${wo.id}-coupling`);
      await s.recordWork(wo.id, "Replaced leaking header coupling; leak test passed.", "REPAIR_AIR_LEAK");
      s.addLabor(wo.id, 45, "Header coupling replacement");
      await s.startRun(plan.id, wo.id);
      s.setSpeed(16);
      s.play();
    },
    waitFor: waitRun,
    result: runResult,
  },
  {
    id: "review",
    title: "Record a separate review and close only if the run passed",
    explanation: "A supervisor (simulated identity) reviews the run. Verified closure needs a current PASS, an approved plan at the run's version, and a reviewer different from the repairer.",
    route: (s) => `/maintenance/work-orders/${latestWo(s)?.id ?? ""}`,
    action: (s) => {
      const wo = latestWo(s);
      const run = latestRun(s);
      if (!wo || !run) return;
      s.setIdentity("Supervisor M. (simulated)");
      s.setSpeed(2);
      if (run.outcome === "PASS") {
        s.reviewRun(run.id, "APPROVED", "Run reviewed against the frozen plan; context matched PART-A AUTO.");
        s.closeWO(wo.id, "Verified closure after passing run and separate review.");
      } else {
        s.reviewRun(run.id, "REJECTED", `Run ended ${run.outcome}; closure not authorised.`);
        s.transitionWO(wo.id, "VERIFICATION_FAILED", `Run ${run.id} ended ${run.outcome}.`);
      }
    },
    result: (s) => {
      const wo = latestWo(s);
      return wo ? `${wo.id} is ${wo.state}${wo.closure ? ` — ${wo.closure.wording}` : ""}.` : "";
    },
  },
  {
    id: "export",
    title: "Export the evidence bundle",
    explanation: "The bundle carries provenance, approved knowledge, observations, reasoning records, plan versions, check-level results, transactions, costs, and audit events. It never contains the scenario answer key.",
    route: () => "/reports",
    action: async (s) => {
      await s.exportBundle();
    },
    result: () => "Evidence bundle downloaded (JSON). A printable report is available on the Reports page.",
  },
];

function branchSteps(scenarioId: string, label: string, intro: string, misleading: { title: string; explanation: string; action: (s: AppState) => Promise<void> | void }, correct: { title: string; explanation: string; action: (s: AppState) => Promise<void> | void }, incidentPred: (i: Incident) => boolean, templateId: string): GuidedStep[] {
  return [
    {
      id: `${scenarioId}-start`,
      title: `Branch: ${label}`,
      explanation: intro,
      route: () => "/plant",
      speed: 8,
      action: async (s) => {
        await s.newDemoWorkspace(scenarioId);
        s.setSpeed(8);
        s.play();
      },
      waitFor: (s) => (openIncident(s, incidentPred)?.diagnosis ? null : `Simulation running (${s.snapshot ? new Date(s.snapshot.clock.liveMs).toISOString().slice(11, 19) : "…"}); waiting for the deviation…`),
      result: (s) => {
        const inc = openIncident(s, incidentPred);
        return inc ? `${inc.id}: ${inc.diagnosis?.state} — ${inc.diagnosis?.summary}` : "";
      },
    },
    {
      id: `${scenarioId}-plan`,
      title: "Create a work order and an approved plan",
      explanation: "Same workflow as the main path: draft from the incident, compile from the approved template, approve to freeze.",
      route: (s) => `/incidents/${openIncident(s, incidentPred)?.id ?? ""}`,
      action: (s) => {
        const inc = openIncident(s, incidentPred);
        if (!inc) return;
        const wo = s.draftWorkOrderFromIncident(inc.id);
        const plan = s.createPlan(inc.id, templateId);
        if (plan) s.approvePlanAction(plan.id, "Guided branch approval.");
        if (wo) s.approveIntervention(wo.id, "Guided branch intervention approval.");
      },
      waitFor: (s) => (latestPlan(s)?.status === "APPROVED" && latestWo(s) ? null : "Preparing…"),
      result: (s) => `${latestWo(s)?.id} and ${latestPlan(s)?.id} v${latestPlan(s)?.version} ready.`,
    },
    {
      id: `${scenarioId}-misleading`,
      title: misleading.title,
      explanation: misleading.explanation,
      route: (s) => `/recovery/${latestPlan(s)?.id ?? ""}`,
      speed: 16,
      action: async (s) => {
        await misleading.action(s);
        const plan = latestPlan(s);
        const wo = latestWo(s);
        if (plan) await s.startRun(plan.id, wo?.id);
        s.setSpeed(16);
        s.play();
      },
      waitFor: waitRun,
      result: runResult,
    },
    {
      id: `${scenarioId}-correct`,
      title: correct.title,
      explanation: correct.explanation,
      route: (s) => `/recovery/${latestPlan(s)?.id ?? ""}`,
      speed: 16,
      action: async (s) => {
        await correct.action(s);
        const plan = latestPlan(s);
        const wo = latestWo(s);
        if (plan) await s.startRun(plan.id, wo?.id);
        s.setSpeed(16);
        s.play();
      },
      waitFor: waitRun,
      result: runResult,
    },
    {
      id: `${scenarioId}-history`,
      title: "Retained history",
      explanation: "Both attempts remain in the run history with their outcomes and reasons. Nothing was relabelled.",
      route: (s) => `/recovery/${latestPlan(s)?.id ?? ""}?tab=history`,
      action: (s) => s.setSpeed(2),
    },
  ];
}

export const BRANCHES: Record<GuidedBranch, GuidedStep[]> = {
  main: MAIN_STEPS,
  speed: branchSteps(
    "S05-SPEED-REDUCTION",
    "Slowing the machine makes the chart look better",
    "SPN-01 shows elevated matched-load current and vibration at the approved 1500 rpm. This branch starts a fresh workspace on scenario 5.",
    {
      title: "Operator lowers the command to 900 rpm and a run is attempted",
      explanation: "Symptoms improve at 900 rpm, but the plan is frozen at the approved 1500 rpm context. The engine reports NOT_COMPARABLE, not PASS.",
      action: async (s) => {
        await s.intervene("SET_SPEED", { rpm: 900 }, latestWo(s)?.id);
      },
    },
    {
      title: "Restore recipe speed, service the spindle, and rerun",
      explanation: "Restoring speed only permits a new test; the corrective intervention removes the resistance; the engine decides.",
      action: async (s) => {
        const wo = latestWo(s);
        if (!wo) return;
        await s.intervene("RESTORE_RECIPE_SPEED", undefined, wo.id);
        await s.recordWork(wo.id, "Corrective spindle service performed at approved speed.", "REMOVE_SPN1_RESISTANCE");
      },
    },
    (i) => i.observedAssetIds.includes("SPN-01"),
    "TPL-CELL-A-MECH",
  ),
  missing: branchSteps(
    "S07-MISSING-EVIDENCE",
    "Missing or suspect evidence is not health",
    "Coolant delivery degrades; later the flow channel goes MISSING and the temperature channel freezes. Scenario 7 in a fresh workspace.",
    {
      title: "Replace the filter while the channels are unavailable",
      explanation: "The repair may be correct, but the required flow channel is missing and temperature is constant. The engine reports INCONCLUSIVE with the exact missing requirement.",
      action: async (s) => {
        const wo = latestWo(s);
        if (!wo) return;
        await s.recordWork(wo.id, "Replaced coolant suction filter.", "REPLACE_COOLANT_FILTER");
      },
    },
    {
      title: "Restore valid evidence and run a new complete attempt",
      explanation: "The flow transmitter and temperature sensor are restored. A new complete run is required; the previous inconclusive run stays in history.",
      action: async (s) => {
        const wo = latestWo(s);
        if (!wo) return;
        await s.recordWork(wo.id, "Reconnected FT-301 flow transmitter.", "RESTORE_FLOW_SENSOR");
        await s.recordWork(wo.id, "Replaced TT-201 bearing temperature sensor.", "REPLACE_TEMP_SENSOR");
      },
    },
    (i) => i.observedAssetIds.includes("PUMP-01") || i.observedAssetIds.includes("SPN-01"),
    "TPL-CELL-A-COOLANT",
  ),
  partial: branchSteps(
    "S09-TWO-MECHANISMS",
    "Two mechanisms, one incomplete intervention",
    "Added mechanical resistance and cooling degradation coexist on cell A. Scenario 9 in a fresh workspace.",
    {
      title: "Restore cooling only",
      explanation: "Temperature improves, but matched-condition current and vibration still violate the approved requirements. A partial repair must not pass because the dominant symptom improved.",
      action: async (s) => {
        const wo = latestWo(s);
        if (!wo) return;
        await s.recordWork(wo.id, "Restored coolant delivery (filter replaced).", "RESTORE_COOLING");
      },
    },
    {
      title: "Remove the mechanical resistance and rerun",
      explanation: "The second intervention addresses the remaining mechanism; both attempts are preserved.",
      action: async (s) => {
        const wo = latestWo(s);
        if (!wo) return;
        await s.recordWork(wo.id, "Corrective spindle service; resistance removed.", "REMOVE_SPN1_RESISTANCE");
      },
    },
    (i) => i.observedAssetIds.includes("SPN-01") || i.observedAssetIds.includes("PUMP-01"),
    "TPL-CELL-A-MECH",
  ),
};
