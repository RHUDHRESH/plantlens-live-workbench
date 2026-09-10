"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { Bot, ClipboardCopy, Plus } from "lucide-react";
import type { WorkOrderState } from "@/lib/domain/types";
import { coverageMatrix } from "@/lib/recovery/coverage";
import { workOrderCost } from "@/lib/workflow";
import { formatInr, formatIst } from "@/lib/util";
import { useApp } from "@/store/app";
import { latestPlans } from "@/components/incidents/helpers";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, Field, LoadingState, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { NewWorkOrderDialog } from "@/components/maintenance/NewWorkOrderDialog";
import { WO_STATES, assetName } from "@/components/maintenance/helpers";
import { useQuery } from "@/components/recovery/useQuery";

function MaintenancePage() {
  const snapshot = useApp((s) => s.snapshot);
  const workOrders = useApp((s) => s.workOrders);
  const plans = useApp((s) => s.plans);
  const historicalRuns = useApp((s) => s.historicalRuns);
  const activeKnowledge = useApp((s) => s.activeKnowledge);
  const draftHandover = useApp((s) => s.draftHandover);
  const toast = useApp((s) => s.toast);
  const { get } = useQuery();
  const [filter, setFilter] = useState<WorkOrderState | "ALL" | "LIVE">("ALL");
  const [newOpen, setNewOpen] = useState(() => get("new") === "1");
  const [handover, setHandover] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showRerun, setShowRerun] = useState(false);

  const knowledge = activeKnowledge();
  const allRuns = useMemo(() => [...(snapshot?.runs ?? []), ...historicalRuns], [snapshot?.runs, historicalRuns]);
  const rows = useMemo(() => {
    const sorted = workOrders.slice().sort((a, b) => Number(!!a.fixture) - Number(!!b.fixture) || b.createdAt.ms - a.createdAt.ms);
    if (filter === "ALL") return sorted;
    if (filter === "LIVE") return sorted.filter((w) => !w.fixture);
    return sorted.filter((w) => w.state === filter);
  }, [workOrders, filter]);

  const latest = useMemo(() => latestPlans(plans), [plans]);
  const invalidated = latest.filter((p) => p.status === "INVALIDATED");
  const coverageGaps = useMemo(() => {
    const open = (snapshot?.incidents ?? []).filter((i) => !i.fixture && i.status !== "CLOSED" && i.status !== "RESOLVED");
    return open.map((inc) => {
      const incPlans = latest.filter((p) => p.incidentId === inc.id);
      const edges = inc.diagnosis?.candidates[0]?.edgeIds ?? [];
      const gaps = incPlans.map((p) => ({ plan: p, uncovered: coverageMatrix(p, knowledge, edges).uncovered }));
      return { incident: inc, plans: incPlans, gaps: gaps.filter((g) => g.uncovered.length) };
    });
  }, [snapshot?.incidents, latest, knowledge]);
  const flagged = coverageGaps.filter((g) => g.gaps.length || g.plans.length === 0);

  if (!snapshot) return <LoadingState label="Starting simulation engine…" />;

  const copyHandover = async () => {
    if (!handover) return;
    try {
      await navigator.clipboard.writeText(handover);
      toast("success", "Handover text copied.");
    } catch {
      toast("error", "Clipboard not available; select the text and copy manually.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Work orders"
        description="Records of intended and performed work. A repair is an action; recovery is an observed result from a run against an approved plan. Closed records are locked."
        badges={<Badge tone="grey">Stored in this browser — not cloud-synced</Badge>}
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <Plus size={15} /> New work order
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="min-w-0">
          <CardHeader
            title="All work orders"
            description={`${workOrders.filter((w) => !w.fixture).length} live · ${workOrders.filter((w) => w.fixture).length} fictional fixtures`}
            actions={
              <Field label="Filter by state">
                <Select value={filter} onChange={(e) => setFilter(e.target.value as WorkOrderState | "ALL" | "LIVE")} aria-label="Filter by state">
                  <option value="ALL">All</option>
                  <option value="LIVE">Live only</option>
                  {WO_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
            }
          />
          <CardBody className="p-0">
            {rows.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No work orders match" description={filter === "ALL" ? "Create one, or draft one from an incident room." : "Change the filter to see other states."} />
              </div>
            ) : (
              <Table className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Work order</Th>
                    <Th>State</Th>
                    <Th>Priority</Th>
                    <Th>Asset / cell</Th>
                    <Th>Assignee</Th>
                    <Th>Incident</Th>
                    <Th>Plan</Th>
                    <Th>Runs</Th>
                    <Th>Recorded cost</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => {
                    const cost = workOrderCost(w);
                    const runs = allRuns.filter((r) => w.runIds.includes(r.id));
                    const lastRun = runs.sort((a, b) => b.startedAt.ms - a.startedAt.ms)[0];
                    return (
                      <tr key={w.id}>
                        <Td>
                          <Link className="text-accent hover:underline mono" href={`/maintenance/work-orders/${w.id}`}>
                            {w.id}
                          </Link>
                          <span className="block max-w-xs truncate text-[12px] text-muted">{w.title}</span>
                          {w.fixture ? <Badge tone="grey">fictional fixture</Badge> : null}
                        </Td>
                        <Td>
                          <StatusBadge value={w.state} />
                          {w.locked ? <span className="block text-[11px] text-muted">locked</span> : null}
                        </Td>
                        <Td>
                          <Badge tone={w.priority === "P1" ? "red" : w.priority === "P2" ? "amber" : "neutral"}>{w.priority}</Badge>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <Link className="text-accent hover:underline mono" href={`/plant/${w.assetId}`}>
                            {w.assetId}
                          </Link>
                          <span className="block text-[12px] text-muted">
                            {assetName(w.assetId)} · {w.cellId ?? "no cell"}
                          </span>
                        </Td>
                        <Td className="text-[12px]">{w.assignee}</Td>
                        <Td>{w.incidentId ? <Link className="text-accent hover:underline mono" href={`/incidents/${w.incidentId}`}>{w.incidentId}</Link> : <span className="text-muted">—</span>}</Td>
                        <Td>{w.recoveryPlanId ? <Link className="text-accent hover:underline mono" href={`/recovery/${w.recoveryPlanId}`}>{w.recoveryPlanId}</Link> : <span className="text-muted">none</span>}</Td>
                        <Td>
                          <span className="tnum">{w.runIds.length}</span>
                          {lastRun ? <StatusBadge value={lastRun.outcome} className="ml-1" /> : null}
                        </Td>
                        <Td className="tnum whitespace-nowrap">
                          {formatInr(cost.totalPaise)}
                          <span className="block text-[11px] text-muted">
                            labour {formatInr(cost.laborPaise)} · parts {formatInr(cost.partsPaise)}
                          </span>
                        </Td>
                        <Td className="tnum whitespace-nowrap">{formatIst(w.createdAt.ms, { date: true, seconds: false })}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title={<span className="inline-flex items-center gap-1.5"><Bot size={15} /> Approval-based automation</span>} description="Prepares records for a person to review. Never actuates machinery, never changes a measurement, never closes a work order on its own." />
          <CardBody className="space-y-3 text-[13px]">
            <div>
              <Button className="w-full" onClick={() => setHandover(draftHandover())}>
                Draft shift handover
              </Button>
              <p className="mt-1 text-[12px] text-muted">Text assembled from open incidents, work orders, and runs at the current simulation time.</p>
            </div>
            <div>
              <Button className="w-full" variant={flagged.length ? "outline" : "secondary"} onClick={() => setShowCoverage((v) => !v)} aria-expanded={showCoverage}>
                Flag missing recovery coverage
                <Badge tone={flagged.length ? "amber" : "green"}>{flagged.length}</Badge>
              </Button>
              {showCoverage ? (
                <ul className="mt-2 space-y-1.5">
                  {flagged.length === 0 ? <li className="text-muted">Every open incident has a plan whose coverage rows are all covered.</li> : null}
                  {flagged.map((f) => (
                    <li key={f.incident.id} className="rounded-md border border-border px-2 py-1.5">
                      <Link className="text-accent hover:underline mono" href={`/incidents/${f.incident.id}?tab=recovery`}>
                        {f.incident.id}
                      </Link>
                      <span className="block text-[12px] text-muted">{f.incident.title}</span>
                      {f.plans.length === 0 ? (
                        <span className="block text-[12px]">
                          No recovery plan yet.{" "}
                          <Link className="text-accent hover:underline" href={`/recovery?incident=${f.incident.id}`}>
                            Build one
                          </Link>
                        </span>
                      ) : (
                        f.gaps.map((g) => (
                          <span key={g.plan.id} className="block text-[12px]">
                            <Link className="text-accent hover:underline mono" href={`/recovery/${g.plan.id}?tab=coverage`}>
                              {g.plan.id} v{g.plan.version}
                            </Link>
                            : {g.uncovered.length} uncovered — {g.uncovered.map((u) => u.id).join(", ")}
                          </span>
                        ))
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div>
              <Button className="w-full" variant={invalidated.length ? "outline" : "secondary"} onClick={() => setShowRerun((v) => !v)} aria-expanded={showRerun}>
                Suites needing rerun after knowledge change
                <Badge tone={invalidated.length ? "amber" : "green"}>{invalidated.length}</Badge>
              </Button>
              {showRerun ? (
                <ul className="mt-2 space-y-1.5">
                  {invalidated.length === 0 ? <li className="text-muted">No plan approval has been invalidated by a knowledge publish.</li> : null}
                  {invalidated.map((p) => {
                    const wo = workOrders.find((w) => w.recoveryPlanId === p.id);
                    return (
                      <li key={p.id} className="rounded-md border border-border px-2 py-1.5">
                        <Link className="text-accent hover:underline mono" href={`/recovery/${p.id}`}>
                          {p.id} v{p.version}
                        </Link>
                        {wo ? (
                          <>
                            {" "}
                            · <Link className="text-accent hover:underline mono" href={`/maintenance/work-orders/${wo.id}`}>{wo.id}</Link>
                          </>
                        ) : null}
                        <span className="block text-[12px] text-muted">{p.invalidationReason}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            <Callout tone="grey">All three produce or read records only. Any physical action is recorded by a person on the work order, then verified by a run.</Callout>
          </CardBody>
        </Card>
      </div>

      <NewWorkOrderDialog open={newOpen} onOpenChange={setNewOpen} defaultIncidentId={get("incident") ?? undefined} />

      <Dialog open={handover !== null} onOpenChange={(v) => !v && setHandover(null)} title="Shift handover draft" description="Generated from application records; review before sending. Simulation time, not wall-clock." wide>
        <div className="space-y-3">
          <pre className="scroll-thin max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-[12px]">{handover}</pre>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setHandover(null)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void copyHandover()}>
              <ClipboardCopy size={14} /> Copy text
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MaintenancePage />
    </Suspense>
  );
}
