import type { Incident, KnowledgeVersion, RecoveryPlan, RecoveryRun, WorkOrder, KnowledgeProposal } from "@/lib/domain/types";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import { ASSET_BY_ID } from "@/lib/domain/plant";
import { formatIst } from "@/lib/util";

/**
 * Ask PlantLens — deterministic evidence templates over the current records at the
 * selected observation cutoff and knowledge version. This is not a language model. It
 * cannot read hidden scenario truth or future outcomes. Every reference resolves to a
 * real in-app record.
 */

export interface CopilotContext {
  snapshot: RuntimeSnapshot | null;
  knowledge: KnowledgeVersion;
  plans: RecoveryPlan[];
  workOrders: WorkOrder[];
  proposals: KnowledgeProposal[];
  historicalIncidents: Incident[];
  historicalRuns: RecoveryRun[];
  focusIncidentId?: string;
}

export interface CopilotAnswer {
  mode: "LOCAL_TEMPLATES";
  question: string;
  conclusion: string;
  references: Array<{ label: string; route: string }>;
  uncertainty: string;
  nextAction: { label: string; route: string } | null;
}

export const SEED_QUESTIONS = [
  "Why are both machining cells waiting?",
  "What changed before the first reliable delay?",
  "Why does a running pump not prove coolant delivery?",
  "Why didn't this recovery test pass?",
  "Which dependency remains untested?",
  "Have we seen a similar evidence pattern before?",
  "What changes if this proposed relationship is approved?",
];

function openIncidents(ctx: CopilotContext): Incident[] {
  return (ctx.snapshot?.incidents ?? []).filter((i) => !i.fixture && i.status !== "CLOSED");
}

function focus(ctx: CopilotContext): Incident | undefined {
  const open = openIncidents(ctx);
  return open.find((i) => i.id === ctx.focusIncidentId) ?? open.slice().sort((a, b) => (b.diagnosis?.candidates[0]?.supportCount ?? 0) - (a.diagnosis?.candidates[0]?.supportCount ?? 0))[0];
}

function name(id: string): string {
  return `${ASSET_BY_ID[id]?.name ?? id} (${id})`;
}

export function answer(question: string, ctx: CopilotContext): CopilotAnswer {
  const q = question.toLowerCase();
  const cutoff = ctx.snapshot?.clock.cursorMs;
  const base = { mode: "LOCAL_TEMPLATES" as const, question };
  const inc = focus(ctx);
  const d = inc?.diagnosis;

  if (/both .*cells? waiting|why .*waiting|clamp/.test(q)) {
    const air = openIncidents(ctx).find((i) => i.sharedCauseAssetId === "AIR-HDR-01");
    if (air?.diagnosis) {
      const top = air.diagnosis.candidates[0];
      const cells = air.affectedCellIds.join(" and ");
      const grouped = air.observedAssetIds.filter((a) => a !== "AIR-HDR-01");
      return {
        ...base,
        conclusion: `The shared air-pressure deviation is a ${air.diagnosis.state === "SUPPORTED" ? "supported" : air.diagnosis.state.toLowerCase()} explanation for the clamp delay${grouped.length > 1 ? "s" : ""} in ${cells || "cell A"}. ${top ? top.supportCount : 0} independent evidence group(s) support it${air.diagnosis.orderingUnresolved ? ", but event ordering is unresolved within clock uncertainty" : " and the pressure deviation precedes the delays within the accepted clock alignment"}. Fixtures fed from the header have approved pneumatic dependencies in ${ctx.knowledge.id}${grouped.includes("CNC-02") ? "" : "; CNC-02 is not grouped because DEP-AIR-CNC-02 is not published"}. A specific leak location is not established.`,
        references: [
          { label: `${air.id} evidence`, route: `/incidents/${air.id}?tab=evidence` },
          { label: "AIR-HDR-01.header_pressure timeline", route: `/incidents/${air.id}?tab=timeline` },
          ...air.diagnosis.candidates[0].edgeIds.slice(0, 3).map((e) => ({ label: e, route: `/knowledge/matrix?edge=${e}` })),
        ],
        uncertainty: air.diagnosis.missingInputs.length ? `Missing: ${air.diagnosis.missingInputs.join("; ")}` : "Compressor running status does not establish adequate air delivery; leak localisation is not modelled.",
        nextAction: { label: "Open the pressure timeline and fixture acknowledgements", route: `/incidents/${air.id}?tab=timeline` },
      };
    }
    return { ...base, conclusion: "No shared-cause incident involving both cells is open at the current observation cutoff.", references: [{ label: "Incidents", route: "/incidents" }], uncertainty: "If cell B alarms exist separately, check whether the AIR-HDR-01 → CNC-02 dependency is published.", nextAction: { label: "Open knowledge review", route: "/knowledge/review" } };
  }

  if (/what changed|first reliable|before the first/.test(q)) {
    if (d?.firstReliableDeviation) {
      const ev = d.evidence.find((e) => e.id === d.firstReliableDeviation!.evidenceId);
      return {
        ...base,
        conclusion: `The first reliable deviation in ${inc!.id} is "${ev?.title ?? d.firstReliableDeviation.evidenceId}" at ${formatIst(d.firstReliableDeviation.ms, { seconds: true })} (±${Math.round(d.firstReliableDeviation.uncertaintyMs / 1000)} s). ${d.orderingUnresolved ? d.orderingNote : "Later deviations follow along published dependencies."}`,
        references: [{ label: ev?.title ?? "First deviation", route: `/incidents/${inc!.id}?tab=evidence&evidence=${d.firstReliableDeviation.evidenceId}` }],
        uncertainty: d.orderingUnresolved ? "Ordering is unresolved; do not treat the first displayed row as the cause." : `Evaluated at cutoff ${cutoff ? formatIst(cutoff) : "—"}; earlier deviations outside the window are not considered.`,
        nextAction: { label: "Open the timeline", route: `/incidents/${inc!.id}?tab=timeline` },
      };
    }
    return { ...base, conclusion: "No incident with a reliable first deviation is open at the current cutoff.", references: [{ label: "Plant", route: "/plant" }], uncertainty: "Advance or replay the simulation to the deviation.", nextAction: null };
  }

  if (/running pump|coolant delivery|pump .*prove/.test(q)) {
    const flow = ctx.snapshot?.assets["PUMP-01"]?.headline.find((h) => h.tag === "coolant_flow");
    const run = ctx.snapshot?.assets["PUMP-01"]?.headline.find((h) => h.tag === "run_feedback");
    return {
      ...base,
      conclusion: `Run feedback (CP01_RUN) only proves the pump contactor closed; delivery is the measured flow FT-301. Right now run feedback is ${run?.value ?? "—"} and measured flow is ${flow?.value ?? "—"} ${flow?.unit ?? ""}${flow?.quality !== "GOOD" ? ` (quality ${flow?.quality})` : ""}. The engineer note states this distinction explicitly, and the cooling edge DEP-PUMP-SPN-01 uses measured flow as its predicate.`,
      references: [
        { label: "engineer_notes.txt — coolant delivery", route: "/knowledge/sources?doc=SRC-NOTE-01&line=15" },
        { label: "DEP-PUMP-SPN-01", route: "/knowledge/matrix?edge=DEP-PUMP-SPN-01" },
        { label: "PUMP-01 asset", route: "/plant/PUMP-01" },
      ],
      uncertainty: flow?.quality === "MISSING" ? "The flow channel is MISSING: delivery cannot be asserted either way." : "Filter restriction, valve state, or measurement error are not distinguished by the available channels.",
      nextAction: { label: "Compare flow with run feedback during CUTTING", route: inc ? `/incidents/${inc.id}?tab=timeline` : "/plant/PUMP-01" },
    };
  }

  if (/recovery test|didn.t .*pass|why .*fail|not pass/.test(q)) {
    const runs = (ctx.snapshot?.runs ?? []).filter((r) => r.outcome !== "RUNNING").sort((a, b) => b.startedAt.ms - a.startedAt.ms);
    const r = runs[0];
    if (!r) return { ...base, conclusion: "No completed recovery run exists yet.", references: [{ label: "Recovery", route: "/recovery" }], uncertainty: "Start a run from an approved plan.", nextAction: { label: "Open Recovery", route: "/recovery" } };
    const failing = r.results.filter((x) => x.status === "FAIL" || x.status === "INCONCLUSIVE" || x.status === "NOT_COMPARABLE");
    return {
      ...base,
      conclusion: `Run ${r.id} ended ${r.outcome}: ${r.summary} ${failing.map((f) => `${f.checkId} — ${f.reason}`).join(" ")}`,
      references: [{ label: `Run ${r.id}`, route: `/recovery/${r.planId}?run=${r.id}` }, ...failing.slice(0, 3).map((f) => ({ label: f.checkId, route: `/recovery/${r.planId}?run=${r.id}&check=${f.checkId}` }))],
      uncertainty: r.reasonNotEstablished.join(" ") || "None recorded.",
      nextAction: { label: "Open the run", route: `/recovery/${r.planId}?run=${r.id}` },
    };
  }

  if (/untested|uncovered|dependency remains|coverage/.test(q)) {
    const plan = ctx.plans.slice().sort((a, b) => b.createdAt.ms - a.createdAt.ms)[0];
    if (!plan) return { ...base, conclusion: "No recovery plan exists yet, so no dependency coverage has been assessed.", references: [{ label: "Recovery", route: "/recovery" }], uncertainty: "Build a plan from an approved template.", nextAction: { label: "Open Recovery", route: "/recovery" } };
    const incident = (ctx.snapshot?.incidents ?? []).find((i) => i.id === plan.incidentId);
    const affected = incident?.diagnosis?.candidates[0]?.edgeIds ?? [];
    const covered = new Set(plan.checks.flatMap((c) => (c.kind === "DEPENDENCY_COVERAGE" ? c.edgeIds : [])));
    const uncovered = affected.filter((e) => !covered.has(e));
    return {
      ...base,
      conclusion: uncovered.length ? `${uncovered.length} affected dependenc${uncovered.length === 1 ? "y is" : "ies are"} not covered by plan ${plan.id} v${plan.version}: ${uncovered.join(", ")}. Required coverage must remain explicit; it cannot be removed to obtain closure.` : `All ${affected.length} affected dependencies of ${plan.incidentId} are covered by checks in ${plan.id} v${plan.version}.`,
      references: [{ label: `Coverage matrix ${plan.id}`, route: `/recovery/${plan.id}?tab=coverage` }, ...uncovered.map((e) => ({ label: e, route: `/knowledge/matrix?edge=${e}` }))],
      uncertainty: "Coverage is against the published knowledge version frozen in the plan; a later publish invalidates it.",
      nextAction: { label: "Open coverage matrix", route: `/recovery/${plan.id}?tab=coverage` },
    };
  }

  if (/similar|seen .*before|pattern|recurr/.test(q)) {
    const fam = d?.candidates[0]?.family;
    const same = ctx.workOrders.filter((w) => w.fixture && (fam ? w.faultFamily === fam : inc?.observedAssetIds.includes(w.assetId)));
    return {
      ...base,
      conclusion: same.length
        ? `${same.length} fictional prior work order(s) addressed the same ${fam ? `fault family (${fam.replace(/_/g, " ").toLowerCase()})` : "asset"}: ${same.map((w) => `${w.id} tested "${w.testScope?.tested.join("; ")}" and did not test "${w.testScope?.notTested.join("; ")}"`).join(". ")}. Same-asset repetition and same-family hypothesis are shown separately from genuinely matching evidence patterns; a returned issue does not make the earlier work unjustified.`
        : "No prior work order matches the current incident's asset or fault family.",
      references: same.map((w) => ({ label: w.id, route: `/maintenance/work-orders/${w.id}` })),
      uncertainty: "Historical PASS results are scoped to their original test modes and are not converted into full-production proof.",
      nextAction: inc ? { label: "Open recurrence view", route: `/incidents/${inc.id}?tab=history` } : null,
    };
  }

  if (/proposed relationship|if .*approved|approve/.test(q)) {
    const p = ctx.proposals.find((x) => x.kind === "DEPENDENCY_EDGE" && x.state === "NEEDS_REVIEW") ?? ctx.proposals.find((x) => x.kind === "DEPENDENCY_EDGE" && x.state === "PROPOSAL_READY");
    if (!p || p.payload.kind !== "DEPENDENCY_EDGE") return { ...base, conclusion: "No dependency proposal is awaiting review.", references: [{ label: "Knowledge review", route: "/knowledge/review" }], uncertainty: "Load the sample pack to generate proposals.", nextAction: { label: "Open review", route: "/knowledge/review" } };
    const e = p.payload.edge;
    return {
      ...base,
      conclusion: `Approving and publishing ${e.id} (${e.from} → ${e.to}, ${e.relation.replace(/_/g, " ").toLowerCase()}) would let the diagnostic engine group ${e.to} deviations with ${e.from} causes when timing is compatible, and would let recovery plans require coverage of that edge. Until it is published, ${e.to} alarms stay separate and any plan referencing it reports INCONCLUSIVE coverage.`,
      references: [{ label: p.title, route: `/knowledge/review?proposal=${p.id}` }, ...e.evidenceRefs.map((s) => ({ label: `${s.sourceId}:${s.startLine}-${s.endLine}`, route: `/knowledge/sources?doc=${s.sourceId}&line=${s.startLine}` }))],
      uncertainty: e.limitations.join("; "),
      nextAction: { label: "Review the proposal", route: `/knowledge/review?proposal=${p.id}` },
    };
  }

  // Default: situation summary.
  if (inc?.diagnosis) {
    return {
      ...base,
      conclusion: `${inc.id}: ${inc.diagnosis.summary}`,
      references: [{ label: inc.id, route: `/incidents/${inc.id}` }],
      uncertainty: inc.diagnosis.unresolvedQuestions.join(" ") || "None recorded.",
      nextAction: inc.diagnosis.nextChecks[0] ? { label: inc.diagnosis.nextChecks[0].title, route: inc.diagnosis.nextChecks[0].target?.route ?? `/incidents/${inc.id}` } : null,
    };
  }
  return { ...base, conclusion: "No open incident at the current observation cutoff. The plant is operating within approved baselines as far as the available channels show.", references: [{ label: "Plant", route: "/plant" }], uncertainty: `${Object.values(ctx.snapshot?.assets ?? {}).filter((a) => a.coverage === "INSUFFICIENT_DATA" || a.coverage === "CONTEXTUAL_ONLY").length} assets have contextual-only or insufficient model coverage; their health is not asserted.`, nextAction: null };
}

export function assetSummaryName(id: string): string {
  return name(id);
}
