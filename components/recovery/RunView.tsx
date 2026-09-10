"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Eye, Square } from "lucide-react";
import type { CheckResult, Observation, RecoveryPlan, RecoveryRun, ReviewRecord } from "@/lib/domain/types";
import { AGGREGATE_PRECEDENCE, MAX_RUN_MS } from "@/lib/recovery/interpreter";
import { formatDuration, formatIst } from "@/lib/util";
import { useApp } from "@/store/app";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, Field, KeyValue, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { CHECK_KIND_LABEL, PASS_WORDING } from "./helpers";
import { ReasonDialog } from "./ReasonDialog";

function obsValue(o: Observation): string {
  const v = o.value.value;
  if (v === null || v === undefined) return "null (MISSING)";
  return `${String(v)}${o.unit ? ` ${o.unit}` : ""}`;
}

function DetailChips({ detail }: { detail: CheckResult["detail"] }) {
  const entries = Object.entries(detail);
  if (!entries.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <Badge key={k} tone="neutral" className="tnum">
          {k}: {v === null ? "null" : String(v)}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Live view of one recovery run. Everything shown is read from the engine snapshot;
 * the outcome wording for PASS is fixed and never embellished.
 */
export function RunView({ run, plan, highlightCheckId, compact }: { run: RecoveryRun; plan: RecoveryPlan | undefined; highlightCheckId?: string | null; compact?: boolean }) {
  const abortRun = useApp((s) => s.abortRun);
  const reviewRun = useApp((s) => s.reviewRun);
  const observations = useApp((s) => s.observations);
  const identity = useApp((s) => s.identity);
  const toast = useApp((s) => s.toast);
  const [obsOpen, setObsOpen] = useState<{ checkId: string; items: Observation[]; loading: boolean } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [decision, setDecision] = useState<ReviewRecord["decision"]>("APPROVED");

  const checkKind = (id: string) => plan?.checks.find((c) => c.id === id)?.kind;
  const required = plan?.scope.requiredCompleteCycles ?? "—";
  const isRunning = run.outcome === "RUNNING";
  const finished = run.outcome !== "RUNNING" && run.outcome !== "NOT_STARTED";

  const viewObservations = async (r: CheckResult) => {
    setObsOpen({ checkId: r.checkId, items: [], loading: true });
    const items = await observations(r.evidenceObservationIds);
    setObsOpen({ checkId: r.checkId, items, loading: false });
  };

  const scopeVsObserved = plan
    ? [
        { k: "Recipe", v: `${run.contextObserved.recipe ?? "—"} observed · scope ${plan.scope.recipe}` },
        { k: "Mode", v: `${run.contextObserved.mode ?? "—"} observed · scope ${plan.scope.mode}` },
        { k: "Commanded speed", v: `${run.contextObserved.commandedSpeedRpm ?? "—"} rpm observed · scope ${plan.scope.commandedSpeedRpm ?? "any"}${plan.scope.commandedSpeedRpm ? " rpm" : ""}` },
        { k: "Actual speed", v: `${run.contextObserved.actualSpeedRpm !== undefined ? `${Math.round(run.contextObserved.actualSpeedRpm)} rpm` : "—"}` },
      ]
    : [];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="mono">{run.id}</span>
              <StatusBadge value={run.outcome} />
              {run.fixture ? <Badge tone="grey">fictional fixture</Badge> : null}
              {run.staleReason ? <Badge tone="amber">stale</Badge> : null}
            </span>
          }
          description={run.outcome === "PASS" ? PASS_WORDING : run.summary}
          actions={
            <>
              {isRunning ? (
                <Button variant="danger" size="sm" onClick={() => abortRun(run.id)}>
                  <Square size={14} /> Abort run
                </Button>
              ) : null}
              {finished && !run.fixture ? (
                <Button size="sm" variant={run.reviewedBy ? "outline" : "primary"} onClick={() => setReviewOpen(true)}>
                  {run.reviewedBy ? "Record another review" : "Record review"}
                </Button>
              ) : null}
            </>
          }
        />
        <CardBody className="grid gap-4 md:grid-cols-2">
          <KeyValue
            items={[
              { k: "Plan", v: <Link className="text-accent hover:underline mono" href={`/recovery/${run.planId}`}>{run.planId} v{run.planVersion}</Link> },
              { k: "Incident", v: <Link className="text-accent hover:underline mono" href={`/incidents/${run.incidentId}`}>{run.incidentId}</Link> },
              { k: "Knowledge / baseline", v: <span className="mono">{run.knowledgeVersion} · {run.baselineVersion}</span> },
              { k: "Started", v: <span className="tnum">{formatIst(run.startedAt.ms, { date: true })}</span> },
              { k: "Evaluated until", v: <span className="tnum">{formatIst(run.evaluatedUntilMs, { date: true })} ({formatDuration(run.evaluatedUntilMs - run.startedAt.ms)} elapsed)</span> },
              ...(run.finishedAt ? [{ k: "Finished", v: <span className="tnum">{formatIst(run.finishedAt.ms, { date: true })}</span> }] : []),
              ...(run.workOrderId ? [{ k: "Work order", v: <Link className="text-accent hover:underline mono" href={`/maintenance/work-orders/${run.workOrderId}`}>{run.workOrderId}</Link> }] : []),
            ]}
          />
          <KeyValue
            items={[
              ...scopeVsObserved,
              { k: "Complete cycles", v: <span className="tnum">{run.completeCyclesObserved} observed / {required} required</span> },
              { k: "Settling remaining", v: <span className="tnum">{run.settlingRemainingSeconds} s</span> },
              { k: "Reviewer", v: run.reviewedBy ? `${run.reviewedBy.reviewer} — ${run.reviewedBy.decision}: ${run.reviewedBy.reason}` : "Not yet reviewed" },
            ]}
          />
        </CardBody>
        {run.staleReason ? (
          <CardBody className="border-t border-border">
            <Callout tone="amber" title="Run is stale for closure">
              {run.staleReason}
            </Callout>
          </CardBody>
        ) : null}
        {run.fixture ? (
          <CardBody className="border-t border-border">
            <Callout tone="grey" title="Historical fixture">
              {run.fixture.note} Test scope at the time: {run.fixture.testScope}.
            </Callout>
          </CardBody>
        ) : null}
      </Card>

      {run.results.length ? (
        <Card>
          <CardHeader title="Check results" description="Per-check status as evaluated by the interpreter. Missing channels are listed, never assumed healthy." />
          <CardBody className="p-0">
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Check</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th>Reason</Th>
                  {compact ? null : <Th>Detail</Th>}
                  <Th>Missing channels</Th>
                  <Th>Decisive</Th>
                  <Th>Evidence</Th>
                </tr>
              </thead>
              <tbody>
                {run.results.map((r) => {
                  const kind = checkKind(r.checkId);
                  return (
                    <tr key={r.checkId} className={highlightCheckId === r.checkId ? "bg-accent-soft" : undefined}>
                      <Td className="mono whitespace-nowrap">{r.checkId}</Td>
                      <Td className="whitespace-nowrap">{kind ? CHECK_KIND_LABEL[kind] : "—"}</Td>
                      <Td>
                        <StatusBadge value={r.status} />
                      </Td>
                      <Td className="min-w-64 max-w-md">{r.reason}</Td>
                      {compact ? null : (
                        <Td className="min-w-48">
                          <DetailChips detail={r.detail} />
                        </Td>
                      )}
                      <Td>{r.missingChannels.length ? r.missingChannels.map((m) => <Badge key={m} tone="grey" className="mr-1 mb-1 mono">{m}</Badge>) : <span className="text-muted">none</span>}</Td>
                      <Td>{r.decisiveViolation ? <Badge tone="red">decisive violation</Badge> : <span className="text-muted">no</span>}</Td>
                      <Td>
                        <Button size="sm" variant="ghost" disabled={!r.evidenceObservationIds.length} title={r.evidenceObservationIds.length ? undefined : "No retained observations for this check"} onClick={() => void viewObservations(r)}>
                          <Eye size={14} /> View observations
                          <span className="tnum text-muted">({r.evidenceObservationIds.length})</span>
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : (
        <Callout tone="grey" title="No per-check results stored">
          {run.fixture ? "Historical fixtures retain only the scope and summary of the test performed at the time." : "The interpreter has not evaluated this run yet."}
        </Callout>
      )}

      {run.reasonNotEstablished.length ? (
        <Card>
          <CardHeader title="Why the result is what it is" description="Reasons the interpreter recorded; a missing channel or an unmatched context appears here even when other checks pass." />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-[13px]">
              {run.reasonNotEstablished.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <details className="rounded-lg border border-border bg-surface">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
          <ChevronDown size={14} className="text-muted" /> How the outcome is aggregated
        </summary>
        <div className="border-t border-border px-4 py-3 text-[13px]">
          <ol className="list-decimal space-y-1 pl-5">
            {AGGREGATE_PRECEDENCE.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="mt-2 text-muted">
            A run that is still collecting opportunities after {MAX_RUN_MS / 60_000} minutes of simulation time becomes INCONCLUSIVE. Coverage checks inherit the worst status of the checks that cover them. The interpreter reads
            observations only up to the current cursor; it never sees future samples.
          </p>
        </div>
      </details>

      <Dialog open={obsOpen !== null} onOpenChange={(v) => !v && setObsOpen(null)} title={`Observations — ${obsOpen?.checkId ?? ""}`} description="Retained evidence for this check, read back from the engine's observation store." wide>
        {obsOpen?.loading ? (
          <p className="text-[13px] text-muted">Loading observations…</p>
        ) : obsOpen && obsOpen.items.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Observation</Th>
                <Th>Tag</Th>
                <Th>Event time</Th>
                <Th>Value</Th>
                <Th>Quality</Th>
                <Th>Context</Th>
              </tr>
            </thead>
            <tbody>
              {obsOpen.items.map((o) => (
                <tr key={o.id}>
                  <Td className="mono text-[12px]">{o.id}</Td>
                  <Td className="mono">{o.tagId}</Td>
                  <Td className="tnum whitespace-nowrap">
                    {formatIst(o.eventTime.ms, { date: true, millis: true })}
                    {o.eventTime.uncertaintyMs ? <span className="text-muted"> ±{o.eventTime.uncertaintyMs} ms</span> : null}
                  </Td>
                  <Td className="tnum">{obsValue(o)}</Td>
                  <Td>
                    <StatusBadge value={o.quality} />
                  </Td>
                  <Td className="text-[12px] text-muted">{[o.context?.recipe, o.context?.mode, o.context?.phase, o.context?.cycleId ? `cycle ${o.context.cycleId}` : null].filter(Boolean).join(" · ") || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-[13px] text-muted">No observations were returned for these ids. Retained evidence is bounded; older samples may have left the window.</p>
        )}
      </Dialog>

      <ReasonDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={`Record review — ${run.id}`}
        description={`Reviewing as ${identity}. A verified closure requires a reviewer distinct from whoever recorded the work.`}
        confirmLabel={decision === "APPROVED" ? "Approve run" : "Reject run"}
        danger={decision === "REJECTED"}
        onConfirm={(reason) => {
          reviewRun(run.id, decision, reason);
          toast("success", `Review recorded on ${run.id}: ${decision}.`);
        }}
      >
        <Field label="Decision">
          <Select value={decision} onChange={(e) => setDecision(e.target.value as ReviewRecord["decision"])} aria-label="Review decision">
            <option value="APPROVED">Approve — the outcome and its scope are accepted</option>
            <option value="REJECTED">Reject — the outcome must not be used for closure</option>
          </Select>
        </Field>
      </ReasonDialog>
    </div>
  );
}
