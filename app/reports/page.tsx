"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { Copy, Download, FileUp, Printer } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, KeyValue, LoadingState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/store/app";
import { ASSETS, CELLS, PLANT_ID, PLANT_NAME } from "@/lib/domain/plant";
import type { RecoveryPlan, RecoveryRun, ReviewRecord } from "@/lib/domain/types";
import { SCENARIO_BY_ID } from "@/lib/simulation/scenarios";
import { cellCosts, workOrderCost } from "@/lib/workflow";
import { formatDuration, formatInr, formatIst, unionDurationMs } from "@/lib/util";

const MODE_LABEL: Record<string, string> = { DEMO_SIMULATION: "SIMULATION", IMPORTED_REPLAY: "IMPORTED REPLAY", LIVE_ADAPTER: "LIVE: Not configured" };

const subscribeNoop = () => () => {};

function summariseInterruptions(intervals: Array<{ cellId: string; startMs: number; endMs?: number }>, nowMs: number): string {
  const cells = Array.from(new Set(intervals.map((x) => x.cellId)));
  return cells
    .map((cell) => {
      const mine = intervals.filter((x) => x.cellId === cell);
      const total = unionDurationMs(mine.map((x) => ({ startMs: x.startMs, endMs: x.endMs ?? nowMs })));
      const ongoing = mine.filter((x) => x.endMs === undefined).length;
      return `${cell}: ${mine.length} interval${mine.length === 1 ? "" : "s"}, ${formatDuration(total)} total${ongoing ? ` (${ongoing} ongoing)` : ""}`;
    })
    .join("; ");
}

function when(ms: number): string {
  return formatIst(ms, { date: true, seconds: true });
}

interface ReviewRow {
  at: number;
  subject: string;
  kind: string;
  reviewer: string;
  decision: string;
  reason: string;
}

export default function ReportsPage() {
  const st = useApp();
  const snapshot = st.snapshot;
  const fileInput = useRef<HTMLInputElement>(null);
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "");
  const [importing, setImporting] = useState(false);

  const knowledge = st.knowledgeVersions.find((k) => k.id === st.activeKnowledgeVersionId) ?? st.knowledgeVersions[st.knowledgeVersions.length - 1];
  const liveMs = snapshot?.clock.liveMs ?? 0;
  const openIncidents = useMemo(() => (snapshot?.incidents ?? []).filter((i) => !i.fixture && i.status !== "CLOSED"), [snapshot]);
  const latestPlans = useMemo(() => {
    const m = new Map<string, RecoveryPlan>();
    for (const p of st.plans) if (!m.has(p.id) || m.get(p.id)!.version < p.version) m.set(p.id, p);
    return m;
  }, [st.plans]);
  const runs: RecoveryRun[] = useMemo(() => [...(snapshot?.runs ?? []), ...st.historicalRuns], [snapshot, st.historicalRuns]);
  const costs = useMemo(() => cellCosts([...(snapshot?.incidents ?? []), ...st.historicalIncidents], st.workOrders, st.costAssumptions, st.inventory, liveMs), [snapshot, st.historicalIncidents, st.workOrders, st.costAssumptions, st.inventory, liveMs]);

  const reviews: ReviewRow[] = useMemo(() => {
    const rows: ReviewRow[] = [];
    const push = (subject: string, kind: string, r: ReviewRecord | undefined | null) => {
      if (r) rows.push({ at: r.at.ms, subject, kind, reviewer: r.reviewer, decision: r.decision, reason: r.reason });
    };
    for (const wo of st.workOrders) {
      for (const a of wo.approvals) push(wo.id, "Intervention approval", a);
      push(wo.id, "Work order review", wo.review);
      if (wo.closure) rows.push({ at: wo.closure.at.ms, subject: wo.id, kind: "Verified closure", reviewer: wo.closure.reviewer, decision: "CLOSED", reason: `${wo.closure.wording} (run ${wo.closure.runId})` });
    }
    for (const p of latestPlans.values()) push(`${p.id} v${p.version}`, "Plan approval", p.approval);
    for (const r of runs) push(r.id, "Run review", r.reviewedBy);
    for (const p of st.proposals) push(p.id, "Proposal review", p.review);
    for (const k of st.knowledgeVersions) for (const c of k.changeLog) rows.push({ at: k.publishedAt?.ms ?? k.createdAt.ms, subject: k.id, kind: "Knowledge change", reviewer: c.reviewer, decision: "PUBLISHED", reason: `${c.summary} — ${c.reason}` });
    return rows.sort((a, b) => a.at - b.at);
  }, [st.workOrders, latestPlans, runs, st.proposals, st.knowledgeVersions]);

  const scenarioId = st.workspace.scenarioId;
  const seed = st.workspace.seed ?? (scenarioId ? SCENARIO_BY_ID[scenarioId]?.seed : undefined);
  const scenarioLink = scenarioId && seed !== undefined ? `${origin || ""}/lab?scenario=${encodeURIComponent(scenarioId)}&seed=${seed}` : null;

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImporting(true);
    try {
      await st.importBundle(await f.text());
    } finally {
      setImporting(false);
    }
  };

  const copyLink = async () => {
    if (!scenarioLink) return;
    try {
      await navigator.clipboard.writeText(scenarioLink);
      st.toast("success", "Scenario link copied.");
    } catch {
      st.toast("error", "Clipboard not available; select and copy the link manually.");
    }
  };

  if (!snapshot) return <LoadingState label="Starting the simulation engine…" />;

  const workOrders = st.workOrders.slice().sort((a, b) => Number(!!a.fixture) - Number(!!b.fixture) || a.createdAt.ms - b.createdAt.ms);

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Reports & evidence export"
          description="Exports retain ids, versions, provenance, observations, work, cost assumptions, and review history. Nothing here is a signed document."
          badges={<Badge tone={snapshot.mode === "DEMO_SIMULATION" ? "accent" : "amber"}>{MODE_LABEL[snapshot.mode] ?? snapshot.mode}</Badge>}
          actions={
            <>
              <Button variant="primary" onClick={() => void st.exportBundle()}>
                <Download size={14} /> Export evidence bundle (.json)
              </Button>
              <Button onClick={() => void st.exportTelemetryCsv()}>
                <Download size={14} /> Export telemetry CSV
              </Button>
              <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onImport(e)} aria-label="Import bundle file" />
              <Button onClick={() => fileInput.current?.click()} disabled={importing || st.storage.readOnly} title={st.storage.readOnly ? "This tab is read-only; another tab owns the workspace." : undefined}>
                <FileUp size={14} /> {importing ? "Importing…" : "Import bundle"}
              </Button>
              <Button onClick={() => window.print()}>
                <Printer size={14} /> Print report
              </Button>
            </>
          }
        />

        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader title="Scenario link" description="Reproduces the seed and configuration of this demo workspace." />
            <CardBody className="space-y-2 text-[13px]">
              {scenarioLink ? (
                <>
                  <div className="flex items-center gap-2">
                    <code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px]" title={scenarioLink}>
                      {scenarioLink}
                    </code>
                    <Button size="sm" onClick={() => void copyLink()}>
                      <Copy size={13} /> Copy
                    </Button>
                  </div>
                  <p className="text-muted">A link reproduces the seed and scenario configuration, not private imported files or local records. Local record URLs (incidents, work orders, plans) are not a shared database: they resolve only in a browser that holds the records. Importing this workspace&apos;s evidence bundle elsewhere restores them there.</p>
                </>
              ) : (
                <p className="text-muted">No scenario is associated with this workspace (imported replay). Export an evidence bundle to reproduce it elsewhere.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What the exports contain" />
            <CardBody className="space-y-1.5 text-[13px]">
              <p>
                <strong>Evidence bundle:</strong> workspace, source documents, proposals, knowledge versions, baselines, incidents, alarms, plans, runs, work orders, inventory ledger, cost assumptions, audit trail, and the last 30 simulated minutes of observations. <span className="mono">containsGroundTruth: false</span>.
              </p>
              <p>
                <strong>Telemetry CSV:</strong> every retained observation from the scenario start to the live edge, with quality flags; spreadsheet formulas are neutralised.
              </p>
              <p className="text-muted">Storage is this browser only — not cloud-synced, not a backup, not tamper-proof.</p>
            </CardBody>
          </Card>
        </div>
      </div>

      <article className="report rounded-lg border border-border bg-surface px-5 py-5 print:border-0 print:px-0 print:py-0" aria-label="Printable report">
        <header className="mb-4 border-b border-border pb-3">
          <p className="text-[12px] uppercase tracking-wider text-muted">PlantLens report</p>
          <h1 className="text-xl font-semibold">
            {st.workspace.name} <span className="text-muted">— {MODE_LABEL[snapshot.mode] ?? snapshot.mode}</span>
          </h1>
          <p className="mt-1 text-[12px] text-muted">
            Browser print-to-PDF; not a signed document. Ordinary reports never include instructor ground truth. Generated from the records in this browser at the simulated live edge {when(liveMs)} IST. Fictional plant; simulated identities.
          </p>
        </header>

        <section className="mb-5 break-inside-avoid">
          <h2 className="mb-2 text-[15px] font-semibold">1. Scope</h2>
          <KeyValue
            items={[
              { k: "Plant", v: <span>{PLANT_NAME} (<span className="mono">{PLANT_ID}</span>, fictional)</span> },
              { k: "Cells", v: CELLS.map((c) => `${c.id} (${c.name}, ${c.cncId})`).join("; ") },
              { k: "Assets", v: <span className="mono text-[12px]">{ASSETS.map((a) => a.id).join(", ")}</span> },
              { k: "Execution mode", v: <span>{MODE_LABEL[snapshot.mode] ?? snapshot.mode}{scenarioId ? <span className="text-muted"> · scenario {scenarioId} · seed <span className="tnum">{seed}</span></span> : null}</span> },
              { k: "Observation window", v: <span className="tnum">{when(snapshot.clock.startMs)} → {when(snapshot.clock.liveMs)} IST (live edge){snapshot.clock.viewingPast ? <span className="text-muted"> · cursor at {when(snapshot.clock.cursorMs)}</span> : null}</span> },
              { k: "Observations retained", v: <span className="tnum">{snapshot.stats.observations} on {snapshot.stats.tags} tags</span> },
              ...(snapshot.importInfo ? [{ k: "Import", v: <span>{snapshot.importInfo.fileNames.join(", ")} · tz {snapshot.importInfo.timeZoneAssumption ?? "—"} · {snapshot.importInfo.limitations.join("; ")}</span> }] : []),
            ]}
          />
        </section>

        <section className="mb-5 break-inside-avoid">
          <h2 className="mb-2 text-[15px] font-semibold">2. Knowledge version and source documents</h2>
          <KeyValue
            items={[
              { k: "Active version", v: <span><span className="mono">{knowledge.id}</span> · <StatusBadge value={knowledge.status} />{knowledge.publishedAt ? <span className="text-muted"> · published {when(knowledge.publishedAt.ms)}</span> : null}</span> },
              { k: "Contents", v: <span className="tnum">{knowledge.edges.length} edges · {knowledge.requirements.length} requirements · {knowledge.mappings.length} mappings · {knowledge.reviewedNoDependency.length} reviewed non-dependencies</span> },
              { k: "Baselines", v: st.baselines.map((b) => `${b.id} (${b.recipe}, ${b.cellId}, ${b.reviewStatus})`).join("; ") || "none" },
              { k: "Runtime version", v: <span className="mono">{snapshot.knowledgeVersionId}</span> },
            ]}
          />
          <div className="mt-2">
            {st.sources.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>File</Th>
                    <Th>Type</Th>
                    <Th>SHA-256</Th>
                    <Th>Revision</Th>
                    <Th>Imported</Th>
                    <Th>Parse</Th>
                  </tr>
                </thead>
                <tbody>
                  {st.sources.map((d) => (
                    <tr key={d.id}>
                      <Td>
                        {d.fileName} <Badge tone="grey">fictional fixture</Badge>
                      </Td>
                      <Td className="text-[12px]">{d.sourceType.replace(/_/g, " ")}</Td>
                      <Td className="mono break-all text-[11px]">{d.sha256}</Td>
                      <Td>{d.revision ?? <span className="text-muted">—</span>}</Td>
                      <Td className="tnum whitespace-nowrap">{when(d.importedAt.ms)}</Td>
                      <Td>
                        <StatusBadge value={d.parseStatus} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-[13px] text-muted">No source documents imported; the seed knowledge version cites the fictional sample pack.</p>
            )}
          </div>
        </section>

        <section className="mb-5">
          <h2 className="mb-2 text-[15px] font-semibold">3. Open incidents</h2>
          {openIncidents.length ? (
            <div className="space-y-3">
              {openIncidents.map((inc) => {
                const d = inc.diagnosis;
                return (
                  <div key={inc.id} className="break-inside-avoid rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        <span className="mono">{inc.id}</span> — {inc.title}
                      </p>
                      <span className="flex gap-1">
                        <StatusBadge value={inc.status} />
                        {d ? <StatusBadge value={d.state} /> : <Badge tone="grey">no diagnosis</Badge>}
                      </span>
                    </div>
                    <KeyValue
                      className="mt-2"
                      items={[
                        { k: "Opened", v: <span className="tnum">{when(inc.openedAt.ms)}{inc.openedAt.uncertaintyMs ? ` ±${inc.openedAt.uncertaintyMs} ms` : ""}</span> },
                        { k: "Observed assets", v: <span className="mono">{inc.observedAssetIds.join(", ") || "—"}</span> },
                        { k: "Potentially affected", v: <span className="mono">{inc.potentiallyAffectedAssetIds.join(", ") || "—"}</span> },
                        { k: "Grouping", v: inc.groupingRationale || "—" },
                        { k: "Interruptions", v: <span className="tnum">{inc.interruptions.length ? summariseInterruptions(inc.interruptions, liveMs) : "none"}</span> },
                        { k: "Linked records", v: <span className="mono">{[...inc.workOrderIds, ...inc.recoveryPlanIds].join(", ") || "—"}</span> },
                      ]}
                    />
                    {d ? (
                      <div className="mt-2 space-y-2 text-[13px]">
                        <p>
                          <strong>Diagnosis summary</strong> (knowledge {d.knowledgeVersion}, cutoff {formatIst(d.cutoffMs, { seconds: true })}): {d.summary}
                          {d.orderingUnresolved ? <span className="text-amber"> Event ordering unresolved{d.orderingNote ? `: ${d.orderingNote}` : "."}</span> : null}
                        </p>
                        <div>
                          <p className="font-semibold">Competing explanations</p>
                          {d.candidates.length ? (
                            <ol className="list-decimal pl-5">
                              {d.candidates.map((c) => (
                                <li key={c.family}>
                                  {c.title} <span className="mono text-[11px] text-muted">{c.family}</span> — supported {c.supportCount}, contradicted {c.contradictionCount}, pending {c.pendingCount}, unavailable {c.unavailableCount}
                                  {c.notEstablished.length ? <span className="text-muted"> · not established: {c.notEstablished.join("; ")}</span> : null}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="text-muted">No candidate ranked; human review.</p>
                          )}
                        </div>
                        <div>
                          <p className="font-semibold">Missing information</p>
                          {d.missingInputs.length || d.unresolvedQuestions.length ? (
                            <ul className="list-disc pl-5">
                              {d.missingInputs.map((m, i) => (
                                <li key={`m${i}`}>{m}</li>
                              ))}
                              {d.unresolvedQuestions.map((q, i) => (
                                <li key={`q${i}`}>{q}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-muted">None recorded.</p>
                          )}
                        </div>
                        {d.residualDeviations.length ? <p className="text-muted">Residual deviations not explained by the top candidate: {d.residualDeviations.join("; ")}</p> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted">No open incidents at the live edge.</p>
          )}
        </section>

        <section className="mb-5">
          <h2 className="mb-2 text-[15px] font-semibold">4. Work performed per work order</h2>
          {workOrders.length ? (
            <div className="space-y-3">
              {workOrders.map((wo) => {
                const cost = workOrderCost(wo);
                return (
                  <div key={wo.id} className="break-inside-avoid rounded-md border border-border p-3 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        <span className="mono">{wo.id}</span> — {wo.title} <span className="mono text-muted">({wo.assetId}{wo.cellId ? `, ${wo.cellId}` : ""})</span>
                      </p>
                      <span className="flex gap-1">
                        {wo.fixture ? <Badge tone="grey">fictional fixture</Badge> : null}
                        <StatusBadge value={wo.state} />
                      </span>
                    </div>
                    <p className="mt-1 text-muted">
                      Suspected: {wo.suspectedMechanism}. Planned: {wo.plannedAction}. Assignee: {wo.assignee}.{wo.incidentId ? ` Incident ${wo.incidentId}.` : ""}
                    </p>
                    {wo.workPerformed.length ? (
                      <Table className="mt-2">
                        <thead>
                          <tr>
                            <Th>At</Th>
                            <Th>By</Th>
                            <Th>Description</Th>
                            <Th>Intervention record</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {wo.workPerformed.map((w) => (
                            <tr key={w.id}>
                              <Td className="tnum whitespace-nowrap">{when(w.at.ms)}</Td>
                              <Td>{w.by}</Td>
                              <Td>{w.description}</Td>
                              <Td className="mono text-[11px]">{w.interventionId ?? "—"}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    ) : (
                      <p className="mt-1 text-muted">No work recorded.</p>
                    )}
                    <p className="mt-1 tnum text-muted">
                      Labor {wo.labor.reduce((s, l) => s + l.minutes, 0)} min ({formatInr(cost.laborPaise)}) · parts {formatInr(cost.partsPaise)} · runs {wo.runIds.join(", ") || "none"}
                      {wo.testScope ? ` · tested: ${wo.testScope.tested.join("; ")} · not tested: ${wo.testScope.notTested.join("; ")}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted">No work orders.</p>
          )}
        </section>

        <section className="mb-5">
          <h2 className="mb-2 text-[15px] font-semibold">5. Recovery runs — test scope and check-level results</h2>
          {runs.length ? (
            <div className="space-y-3">
              {runs.map((r) => {
                const plan = latestPlans.get(r.planId) ?? st.plans.find((p) => p.id === r.planId && p.version === r.planVersion);
                return (
                  <div key={r.id} className="break-inside-avoid rounded-md border border-border p-3 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        <span className="mono">{r.id}</span> — plan {r.planId} v{r.planVersion} · incident {r.incidentId}
                      </p>
                      <span className="flex gap-1">
                        {r.fixture ? <Badge tone="grey">fictional fixture</Badge> : null}
                        <StatusBadge value={r.outcome} />
                      </span>
                    </div>
                    <KeyValue
                      className="mt-2"
                      items={[
                        { k: "Started", v: <span className="tnum">{when(r.startedAt.ms)}{r.finishedAt ? ` → ${when(r.finishedAt.ms)}` : " (not finished)"}</span> },
                        { k: "Knowledge / baseline", v: <span className="mono">{r.knowledgeVersion} / {r.baselineVersion}</span> },
                        {
                          k: "Test scope",
                          v: r.fixture ? r.fixture.testScope : plan ? <span>{plan.scope.cellId} · recipe {plan.scope.recipe} · {plan.scope.mode}{plan.scope.commandedSpeedRpm ? ` · ${plan.scope.commandedSpeedRpm} rpm` : ""} · {plan.scope.requiredCompleteCycles} complete cycles required{plan.validityLimits.length ? ` · limits: ${plan.validityLimits.join("; ")}` : ""}</span> : <span className="text-muted">plan not available in this browser</span>,
                        },
                        { k: "Context observed", v: <span className="tnum">{[r.contextObserved.recipe, r.contextObserved.mode, r.contextObserved.commandedSpeedRpm ? `${r.contextObserved.commandedSpeedRpm} rpm commanded` : null, r.contextObserved.actualSpeedRpm ? `${Math.round(r.contextObserved.actualSpeedRpm)} rpm actual` : null].filter(Boolean).join(" · ") || "—"} · {r.completeCyclesObserved} complete cycles</span> },
                        { k: "Summary", v: r.summary },
                        ...(r.reasonNotEstablished.length ? [{ k: "Not established", v: r.reasonNotEstablished.join("; ") }] : []),
                        ...(r.staleReason ? [{ k: "Stale", v: r.staleReason }] : []),
                      ]}
                    />
                    {r.results.length ? (
                      <Table className="mt-2">
                        <thead>
                          <tr>
                            <Th>Check</Th>
                            <Th>Kind</Th>
                            <Th>Status</Th>
                            <Th>Reason</Th>
                            <Th>Missing channels</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.results.map((c) => {
                            const def = plan?.checks.find((x) => x.id === c.checkId);
                            return (
                              <tr key={c.checkId}>
                                <Td className="mono text-[11px]">{c.checkId}</Td>
                                <Td className="text-[12px]">{def?.kind.replace(/_/g, " ") ?? "—"}</Td>
                                <Td>
                                  <StatusBadge value={c.status} />
                                </Td>
                                <Td>{c.reason}</Td>
                                <Td className="mono text-[11px]">{c.missingChannels.join(", ") || "—"}</Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    ) : (
                      <p className="mt-1 text-muted">No check-level results recorded.</p>
                    )}
                    {r.outcome === "PASS" ? <p className="mt-1">Recovery checks passed within the tested operating conditions.</p> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted">Not run. No recovery result is claimed before execution.</p>
          )}
        </section>

        <section className="mb-5 break-inside-avoid">
          <h2 className="mb-2 text-[15px] font-semibold">6. Reviewer history</h2>
          {reviews.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>At</Th>
                  <Th>Subject</Th>
                  <Th>Kind</Th>
                  <Th>Reviewer</Th>
                  <Th>Decision</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r, i) => (
                  <tr key={`${r.subject}-${r.kind}-${i}`}>
                    <Td className="tnum whitespace-nowrap">{when(r.at)}</Td>
                    <Td className="mono">{r.subject}</Td>
                    <Td>{r.kind}</Td>
                    <Td>{r.reviewer}</Td>
                    <Td>
                      <StatusBadge value={r.decision} />
                    </Td>
                    <Td>{r.reason}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-[13px] text-muted">No approvals, reviews, or closures recorded.</p>
          )}
          <p className="mt-1 text-[12px] text-muted">All identities are simulated demo identities, not authenticated users.</p>
        </section>

        <section className="mb-5 break-inside-avoid">
          <h2 className="mb-2 text-[15px] font-semibold">7. Cost summary</h2>
          {costs.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Cell</Th>
                  <Th className="text-right">Downtime</Th>
                  <Th className="text-right">Interruption estimate</Th>
                  <Th className="text-right">Labor</Th>
                  <Th className="text-right">Parts</Th>
                  <Th className="text-right">Maintenance total</Th>
                  <Th className="text-right">Committed (reserved)</Th>
                  <Th className="text-right">Budget</Th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.cellId}>
                    <Td className="mono">{c.cellId}</Td>
                    <Td className="tnum text-right">{formatDuration(c.downtimeMs)}</Td>
                    <Td className="tnum text-right">{formatInr(c.interruptionEstimatePaise)}</Td>
                    <Td className="tnum text-right">{formatInr(c.laborPaise)}</Td>
                    <Td className="tnum text-right">{formatInr(c.partsPaise)}</Td>
                    <Td className="tnum text-right">{formatInr(c.maintenancePaise)}</Td>
                    <Td className="tnum text-right">{formatInr(c.committedPaise)}</Td>
                    <Td className="tnum text-right">{formatInr(c.budgetPaise)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No cost assumptions" />
          )}
          <p className="mt-1 text-[12px] text-muted">Basis: cell-minutes of interruption × the fictional per-cell rate ({st.costAssumptions.map((a) => `${a.cellId} ${formatInr(a.interruptionPaisePerMinute)}/min, labor ${formatInr(a.laborPaisePerHour)}/h`).join("; ")}). Overlapping intervals are counted once. Illustrative estimates, not verified ROI.</p>
        </section>

        <footer className="border-t border-border pt-3 text-[12px] text-muted">
          <p>Browser print-to-PDF; not a signed document. Ordinary reports never include instructor ground truth. Records are stored in this browser only — not cloud-synced, not a backup, not tamper-proof. PlantLens by VoltMind — fictional demo plant.</p>
        </footer>
      </article>
    </div>
  );
}
