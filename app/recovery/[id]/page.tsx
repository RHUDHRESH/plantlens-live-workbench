"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { CheckCircle2, Play } from "lucide-react";
import type { RecoveryRun } from "@/lib/domain/types";
import { coverageMatrix } from "@/lib/recovery/coverage";
import { formatIst } from "@/lib/util";
import { useApp } from "@/store/app";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, KeyValue, LoadingState, PageHeader, Select, StatusBadge, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from "@/components/ui";
import { ChecksTable } from "@/components/recovery/ChecksTable";
import { CoverageGrid } from "@/components/recovery/CoverageGrid";
import { ReasonDialog } from "@/components/recovery/ReasonDialog";
import { RunView } from "@/components/recovery/RunView";
import { useQuery } from "@/components/recovery/useQuery";
import { findIncidentAnywhere, planForRun, planStatusHint, recoveryTabFromParam, runsForPlanId, versionsOf } from "@/components/recovery/helpers";

function RunRow({ run, active, onSelect }: { run: RecoveryRun; active: boolean; onSelect?: () => void }) {
  return (
    <tr className={active ? "bg-accent-soft" : undefined} aria-current={active ? "true" : undefined}>
      <Td>
        {onSelect ? (
          <button type="button" className="mono text-accent hover:underline" onClick={onSelect}>
            {run.id}
          </button>
        ) : (
          <span className="mono">{run.id}</span>
        )}
        {run.fixture ? <Badge tone="grey" className="ml-1">fictional fixture</Badge> : null}
      </Td>
      <Td>
        <StatusBadge value={run.outcome} />
      </Td>
      <Td className="tnum">v{run.planVersion}</Td>
      <Td className="tnum whitespace-nowrap">{formatIst(run.startedAt.ms, { date: true })}</Td>
      <Td className="tnum">{run.completeCyclesObserved}</Td>
      <Td>{run.workOrderId ? <Link className="text-accent hover:underline mono" href={`/maintenance/work-orders/${run.workOrderId}`}>{run.workOrderId}</Link> : <span className="text-muted">—</span>}</Td>
      <Td>{run.reviewedBy ? `${run.reviewedBy.decision} by ${run.reviewedBy.reviewer}` : <span className="text-muted">not reviewed</span>}</Td>
      <Td className="max-w-md text-[12px] text-muted">{run.summary}</Td>
    </tr>
  );
}

function RecoveryPlanPage({ id }: { id: string }) {
  const snapshot = useApp((s) => s.snapshot);
  const plans = useApp((s) => s.plans);
  const workOrders = useApp((s) => s.workOrders);
  const historicalIncidents = useApp((s) => s.historicalIncidents);
  const historicalRuns = useApp((s) => s.historicalRuns);
  const activeKnowledge = useApp((s) => s.activeKnowledge);
  const editPlan = useApp((s) => s.editPlan);
  const approvePlanAction = useApp((s) => s.approvePlanAction);
  const startRun = useApp((s) => s.startRun);
  const toast = useApp((s) => s.toast);
  const { get, patch } = useQuery();
  const tab = recoveryTabFromParam(get("tab"));
  const runParam = get("run");
  const checkParam = get("check");
  const [approveOpen, setApproveOpen] = useState(false);
  const [woForRun, setWoForRun] = useState("");
  const [starting, setStarting] = useState(false);

  const versions = useMemo(() => versionsOf(plans, id), [plans, id]);
  const latest = versions[0];
  const knowledge = activeKnowledge();
  const incident = findIncidentAnywhere(snapshot, historicalIncidents, latest?.incidentId);
  const liveRuns = useMemo(() => runsForPlanId(snapshot?.runs ?? [], id), [snapshot?.runs, id]);
  const historyRuns = useMemo(() => runsForPlanId([...(snapshot?.runs ?? []), ...historicalRuns], id), [snapshot?.runs, historicalRuns, id]);
  const selectedRun = liveRuns.find((r) => r.id === runParam) ?? historyRuns.find((r) => r.id === runParam) ?? liveRuns[0];
  const topCandidate = incident?.diagnosis?.candidates[0];
  const affectedEdgeIds = useMemo(() => topCandidate?.edgeIds ?? [], [topCandidate]);
  const matrix = useMemo(() => (latest ? coverageMatrix(latest, knowledge, affectedEdgeIds) : null), [latest, knowledge, affectedEdgeIds]);
  const linkedWorkOrders = workOrders.filter((w) => !w.fixture && !w.locked && latest && w.incidentId === latest.incidentId);

  if (!snapshot) return <LoadingState label="Starting simulation engine…" />;
  if (!latest) return <ErrorState title="Record not available in this browser" description={`No recovery plan with id ${id} is stored here. Plans live in this browser only; import an evidence bundle from Settings to view a plan created elsewhere.`} action={<Link className="text-accent hover:underline" href="/recovery">Back to plans</Link>} />;

  const onStartRun = async () => {
    setStarting(true);
    try {
      const run = await startRun(latest.id, woForRun || undefined);
      if (run) {
        toast("success", `Run ${run.id} started against ${latest.id} v${latest.version}.`);
        patch({ tab: "runs", run: run.id });
      }
    } finally {
      setStarting(false);
    }
  };

  const canEdit = latest.status === "DRAFT" || latest.status === "APPROVED" || latest.status === "INVALIDATED";
  const editLabel = latest.status === "DRAFT" ? "Edit checks" : "Revise";

  return (
    <div>
      <PageHeader
        title={
          <span className="mono">
            {latest.id} <span className="text-muted">v{latest.version}</span>
          </span>
        }
        description={latest.warning}
        badges={
          <>
            <StatusBadge value={latest.status} />
            {latest.status === "INVALIDATED" ? <Badge tone="amber">migration review</Badge> : null}
          </>
        }
        actions={
          <>
            {latest.status === "DRAFT" ? (
              <Button variant="primary" onClick={() => setApproveOpen(true)}>
                <CheckCircle2 size={15} /> Approve plan
              </Button>
            ) : null}
            <Link href="/recovery" className="text-[13px] text-accent hover:underline">
              All plans
            </Link>
          </>
        }
      />

      <Card className="mb-4">
        <CardBody className="grid gap-4 lg:grid-cols-2">
          <KeyValue
            items={[
              { k: "Incident", v: <Link className="text-accent hover:underline mono" href={`/incidents/${latest.incidentId}`}>{latest.incidentId}</Link> },
              { k: "Knowledge version", v: <span className="mono">{latest.knowledgeVersion}{latest.knowledgeVersion !== knowledge.id ? <Badge tone="amber" className="ml-1">active is {knowledge.id}</Badge> : null}</span> },
              { k: "Baseline version", v: <span className="mono">{latest.baselineVersion}</span> },
              { k: "Scope", v: `${latest.scope.cellId} · ${latest.scope.recipe} · ${latest.scope.mode}${latest.scope.commandedSpeedRpm ? ` · ${latest.scope.commandedSpeedRpm} rpm` : ""} · ${latest.scope.requiredCompleteCycles} complete cycles` },
              { k: "Templates", v: <span className="mono">{latest.templateIds.join(", ")}</span> },
              { k: "Created", v: <span className="tnum">{formatIst(latest.createdAt.ms, { date: true })}</span> },
            ]}
          />
          <KeyValue
            items={[
              { k: "Approval", v: latest.approval ? `${latest.approval.decision} by ${latest.approval.reviewer} (simulated) at ${formatIst(latest.approval.at.ms, { date: true })}: ${latest.approval.reason}` : <span className="text-muted">none on this version</span> },
              ...(latest.invalidationReason ? [{ k: "Invalidation", v: <span className="text-amber">{latest.invalidationReason}</span> }] : []),
              { k: "Status", v: planStatusHint(latest) },
              { k: "Required evidence", v: <span className="mono text-[12px]">{latest.requiredEvidence.join(", ")}</span> },
              { k: "Validity limits", v: latest.validityLimits.join("; ") },
              { k: "Evidence snapshot", v: <span className="text-[12px] text-muted">{latest.incidentEvidenceSnapshot.length} evidence items frozen at creation</span> },
            ]}
          />
        </CardBody>
      </Card>

      <Tabs value={tab} onValueChange={(v) => patch({ tab: v === "checks" ? null : v })}>
        <TabsList>
          <TabsTrigger value="checks" count={latest.checks.length}>
            Checks
          </TabsTrigger>
          <TabsTrigger value="coverage" count={matrix?.uncovered.length || undefined}>
            Coverage
          </TabsTrigger>
          <TabsTrigger value="runs" count={liveRuns.length}>
            Runs
          </TabsTrigger>
          <TabsTrigger value="history" count={historyRuns.length}>
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checks">
          <div className="space-y-4">
            <ChecksTable
              key={`${latest.id}-${latest.version}`}
              plan={latest}
              knowledge={knowledge}
              highlightCheckId={checkParam}
              canEdit={canEdit}
              editLabel={editLabel}
              onSave={(checks, reason) => {
                editPlan(latest.id, { checks }, reason);
                toast("success", `${latest.id} v${latest.version + 1} saved as DRAFT; approval required before running.`);
              }}
            />
            <Card>
              <CardHeader title="Versions" description="All versions of this plan id kept in this browser. Runs record the version they evaluated." />
              <CardBody className="p-0">
                <Table className="rounded-none border-0">
                  <thead>
                    <tr>
                      <Th>Version</Th>
                      <Th>Status</Th>
                      <Th>Created</Th>
                      <Th>Approval</Th>
                      <Th>Note</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.version} aria-current={v.version === latest.version ? "true" : undefined} className={v.version === latest.version ? "bg-surface-2/50" : undefined}>
                        <Td className="tnum">v{v.version}</Td>
                        <Td>
                          <StatusBadge value={v.status} />
                        </Td>
                        <Td className="tnum whitespace-nowrap">{formatIst(v.createdAt.ms, { date: true })}</Td>
                        <Td className="text-[12px]">{v.approval ? `${v.approval.reviewer}: ${v.approval.reason}` : <span className="text-muted">—</span>}</Td>
                        <Td className="text-[12px] text-muted">{v.invalidationReason ?? "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="coverage">
          {matrix ? (
            <div className="space-y-2">
              <p className="text-[13px] text-muted">
                Rows are the requirements this plan references and the dependency edges implicated by the incident&apos;s top candidate ({affectedEdgeIds.length ? affectedEdgeIds.join(", ") : "none recorded"}), evaluated against <span className="mono">{knowledge.id}</span>. Columns are the plan&apos;s checks.
              </p>
              <CoverageGrid matrix={matrix} highlightCheckId={checkParam} />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="runs">
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Start a run"
                description={latest.status === "APPROVED" ? "Runs evaluate the approved version against observations from the moment they start." : `Only APPROVED plans can run. This version is ${latest.status}.`}
                actions={
                  <Button variant="primary" disabled={latest.status !== "APPROVED" || starting} title={latest.status !== "APPROVED" ? `Plan is ${latest.status}; approve it first` : undefined} onClick={() => void onStartRun()}>
                    <Play size={15} /> Start run
                  </Button>
                }
              />
              <CardBody>
                <Field label="Link to a work order (optional)" hint={linkedWorkOrders.length ? "Linking moves the work order towards verification and records the run on it." : "No open work order is linked to this incident. Create one under Maintenance to record work against."}>
                  <Select value={woForRun} onChange={(e) => setWoForRun(e.target.value)} className="w-full max-w-md" aria-label="Work order" disabled={!linkedWorkOrders.length}>
                    <option value="">No work order</option>
                    {linkedWorkOrders.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.id} — {w.title} ({w.state.replace(/_/g, " ")})
                      </option>
                    ))}
                  </Select>
                </Field>
              </CardBody>
            </Card>

            {liveRuns.length ? (
              <Card>
                <CardHeader title="Runs on this plan id" description="Select a run to inspect it. Runs against earlier versions are kept but cannot authorise closure of the current version." />
                <CardBody className="p-0">
                  <Table className="rounded-none border-0">
                    <thead>
                      <tr>
                        <Th>Run</Th>
                        <Th>Outcome</Th>
                        <Th>Plan</Th>
                        <Th>Started</Th>
                        <Th>Cycles</Th>
                        <Th>Work order</Th>
                        <Th>Review</Th>
                        <Th>Summary</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveRuns.map((r) => (
                        <RunRow key={r.id} run={r} active={selectedRun?.id === r.id} onSelect={() => patch({ run: r.id })} />
                      ))}
                    </tbody>
                  </Table>
                </CardBody>
              </Card>
            ) : (
              <EmptyState title="No runs yet" description={latest.status === "APPROVED" ? "Start a run to begin collecting evidence." : "Approve the plan, then start a run."} />
            )}

            {selectedRun ? <RunView run={selectedRun} plan={planForRun(plans, selectedRun)} highlightCheckId={checkParam} /> : null}
          </div>
        </TabsContent>

        <TabsContent value="history">
          {historyRuns.length ? (
            <div className="space-y-3">
              <Callout tone="neutral">
                Every attempt on <span className="mono">{latest.id}</span> is retained, including NOT_COMPARABLE, FAIL, and INCONCLUSIVE runs and runs against superseded versions. A later PASS never rewrites an earlier outcome.
              </Callout>
              <Table>
                <thead>
                  <tr>
                    <Th>Run</Th>
                    <Th>Outcome</Th>
                    <Th>Plan</Th>
                    <Th>Started</Th>
                    <Th>Cycles</Th>
                    <Th>Work order</Th>
                    <Th>Review</Th>
                    <Th>Summary</Th>
                  </tr>
                </thead>
                <tbody>
                  {historyRuns.map((r) => (
                    <RunRow key={r.id} run={r} active={runParam === r.id} onSelect={() => patch({ tab: "runs", run: r.id })} />
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <EmptyState title="No run history" description="Attempts on this plan id, from any version, will appear here." />
          )}
        </TabsContent>
      </Tabs>

      <ReasonDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`Approve ${latest.id} v${latest.version}`}
        description="Approval is recorded under the current simulated identity. A later edit or knowledge change that touches a referenced requirement or edge invalidates it."
        confirmLabel="Approve plan"
        onConfirm={(reason) => approvePlanAction(latest.id, reason)}
      >
        {matrix?.uncovered.length ? (
          <Callout tone="amber" title="Coverage gaps remain">
            {matrix.uncovered.length} row{matrix.uncovered.length === 1 ? "" : "s"} uncovered. Approving records that you accept these gaps for this scope.
          </Callout>
        ) : null}
      </ReasonDialog>
    </div>
  );
}

export default function Page() {
  const p = useParams<{ id: string }>();
  return (
    <Suspense fallback={<LoadingState />}>
      <RecoveryPlanPage id={decodeURIComponent(p.id)} />
    </Suspense>
  );
}
