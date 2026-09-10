"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Lock, Play, ShieldCheck } from "lucide-react";
import type { InventoryPart, ReviewRecord, WorkOrderState } from "@/lib/domain/types";
import { INTERVENTIONS, INTERVENTION_BY_ID, RECIPES, type InterventionId } from "@/lib/simulation/scenarios";
import { canTransition, checkVerifiedClosure, workOrderCost } from "@/lib/workflow";
import { formatInr, formatIst, laborCostPaise, wallTs } from "@/lib/util";
import { useApp } from "@/store/app";
import { latestPlans } from "@/components/incidents/helpers";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, KeyValue, LoadingState, PageHeader, Select, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { ReasonDialog } from "@/components/recovery/ReasonDialog";
import { StateStrip } from "@/components/maintenance/StateStrip";
import { WO_STATES, WORK_RECORDABLE_STATES, assetName, isLocked, mergedEvents } from "@/components/maintenance/helpers";
import { actionKey, latestPlanVersion } from "@/components/recovery/helpers";

type Pending = { kind: "transition"; to: WorkOrderState } | { kind: "approve" } | { kind: "close" } | null;

export default function WorkOrderPage() {
  const p = useParams<{ id: string }>();
  const id = decodeURIComponent(p.id);
  const snapshot = useApp((s) => s.snapshot);
  const workOrders = useApp((s) => s.workOrders);
  const plans = useApp((s) => s.plans);
  const inventory = useApp((s) => s.inventory);
  const costAssumptions = useApp((s) => s.costAssumptions);
  const audit = useApp((s) => s.audit);
  const historicalRuns = useApp((s) => s.historicalRuns);
  const identity = useApp((s) => s.identity);
  const transitionWO = useApp((s) => s.transitionWO);
  const approveIntervention = useApp((s) => s.approveIntervention);
  const recordWork = useApp((s) => s.recordWork);
  const addLabor = useApp((s) => s.addLabor);
  const reservePart = useApp((s) => s.reservePart);
  const consumePart = useApp((s) => s.consumePart);
  const returnPart = useApp((s) => s.returnPart);
  const prepareSpareRequest = useApp((s) => s.prepareSpareRequest);
  const startRun = useApp((s) => s.startRun);
  const closeWO = useApp((s) => s.closeWO);
  const toast = useApp((s) => s.toast);

  const [pending, setPending] = useState<Pending>(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [workDesc, setWorkDesc] = useState("");
  const [workIntervention, setWorkIntervention] = useState<InterventionId | "">("");
  const [rpm, setRpm] = useState("1500");
  const [recipe, setRecipe] = useState("PART-A");
  const [workBusy, setWorkBusy] = useState(false);
  const [laborMinutes, setLaborMinutes] = useState("30");
  const [laborNote, setLaborNote] = useState("");
  const [partId, setPartId] = useState(inventory[0]?.id ?? "");
  const [partQty, setPartQty] = useState("1");
  const [spareIntervention, setSpareIntervention] = useState<InterventionId>(INTERVENTIONS[0].id);
  const [runPlanId, setRunPlanId] = useState("");
  const [starting, setStarting] = useState(false);

  const wo = workOrders.find((w) => w.id === id);
  const locked = wo ? isLocked(wo) : false;
  const runs = useMemo(() => (wo ? [...(snapshot?.runs ?? []), ...historicalRuns].filter((r) => wo.runIds.includes(r.id)).sort((a, b) => b.startedAt.ms - a.startedAt.ms) : []), [wo, snapshot?.runs, historicalRuns]);
  const candidatePlans = useMemo(() => (wo?.incidentId ? latestPlans(plans.filter((pl) => pl.incidentId === wo.incidentId)) : []), [plans, wo]);
  const linkedPlan = latestPlanVersion(plans, wo?.recoveryPlanId);
  const runPlan = latestPlanVersion(plans, runPlanId || wo?.recoveryPlanId || candidatePlans[0]?.id);
  const provisionalReview: ReviewRecord = useMemo(() => ({ reviewer: identity, simulatedIdentity: true, decision: "APPROVED", reason: "(provisional — entered at closure)", at: wallTs() }), [identity]);
  const closure = wo ? checkVerifiedClosure(wo, linkedPlan, snapshot?.runs ?? [], provisionalReview) : null;
  const events = useMemo(() => (wo ? mergedEvents(wo, audit) : []), [wo, audit]);
  const part: InventoryPart | undefined = inventory.find((x) => x.id === partId);
  const laborRate = costAssumptions.find((c) => c.cellId === wo?.cellId)?.laborPaisePerHour ?? 60000;

  if (!snapshot) return <LoadingState label="Starting simulation engine…" />;
  if (!wo) return <ErrorState title="Record not available in this browser" description={`No work order with id ${id} is stored here. Work orders live in this browser only; import an evidence bundle from Settings to view one created elsewhere.`} action={<Link className="text-accent hover:underline" href="/maintenance">Back to work orders</Link>} />;

  const cost = workOrderCost(wo);
  const lockedReason = wo.fixture ? "Historical fixture: read-only." : "Closed with verified closure: record is locked. Open a follow-up work order instead.";
  const canRecordWork = !locked && WORK_RECORDABLE_STATES.includes(wo.state);
  const recordWorkReason = locked ? lockedReason : canRecordWork ? undefined : `Work cannot be recorded while ${wo.state.replace(/_/g, " ")}; approve the intervention first.`;
  const canApprove = !locked && (wo.state === "OPEN" || wo.state === "INVESTIGATING");
  const approveReason = locked ? lockedReason : canApprove ? undefined : `Intervention approval applies from OPEN or INVESTIGATING; the work order is ${wo.state.replace(/_/g, " ")}.`;
  const allowedTransitions = WO_STATES.filter((to) => canTransition(wo.state, to));
  const chosenIntervention = workIntervention ? INTERVENTION_BY_ID[workIntervention] : undefined;
  const qty = Number(partQty);
  const qtyValid = Number.isFinite(qty) && qty > 0 && (!part?.indivisible || Number.isInteger(qty));

  const submitWork = async () => {
    if (!workDesc.trim()) return;
    setWorkBusy(true);
    try {
      const params: Record<string, string | number> | undefined = chosenIntervention?.needsParam === "rpm" ? { rpm: Number(rpm) } : chosenIntervention?.needsParam === "recipe" ? { recipe } : undefined;
      await recordWork(wo.id, workDesc.trim(), workIntervention || undefined, params);
      setWorkOpen(false);
      setWorkDesc("");
      setWorkIntervention("");
    } finally {
      setWorkBusy(false);
    }
  };

  const onStartRun = async () => {
    if (!runPlan) return;
    setStarting(true);
    try {
      const run = await startRun(runPlan.id, wo.id);
      if (run) toast("success", `Run ${run.id} started for ${wo.id}.`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={
          <span>
            <span className="mono">{wo.id}</span> <span className="text-muted">·</span> {wo.title}
          </span>
        }
        description={`${wo.suspectedMechanism} — planned: ${wo.plannedAction}`}
        badges={
          <>
            <StatusBadge value={wo.state} />
            <Badge tone={wo.priority === "P1" ? "red" : wo.priority === "P2" ? "amber" : "neutral"}>{wo.priority}</Badge>
            {wo.fixture ? <Badge tone="grey">fictional fixture</Badge> : null}
            {locked ? (
              <Badge tone="grey">
                <Lock size={11} /> locked
              </Badge>
            ) : null}
          </>
        }
        actions={
          <Link href="/maintenance" className="text-[13px] text-accent hover:underline">
            All work orders
          </Link>
        }
      />

      {locked ? (
        <Callout tone="grey" className="mb-4" title="Closed record">
          {lockedReason} {wo.closure ? `Closed ${formatIst(wo.closure.at.ms, { date: true })} on run ${wo.closure.runId}, reviewed by ${wo.closure.reviewer}: "${wo.closure.wording}".` : null}
        </Callout>
      ) : null}

      <Card className="mb-4">
        <CardBody className="grid gap-4 lg:grid-cols-2">
          <KeyValue
            items={[
              { k: "Asset", v: <span><Link className="text-accent hover:underline mono" href={`/plant/${wo.assetId}`}>{wo.assetId}</Link> <span className="text-muted">{assetName(wo.assetId)}</span></span> },
              { k: "Cell", v: wo.cellId ?? "—" },
              { k: "Assignee", v: wo.assignee },
              { k: "Fault family", v: wo.faultFamily ? wo.faultFamily.replace(/_/g, " ") : "—" },
              { k: "Created", v: <span className="tnum">{formatIst(wo.createdAt.ms, { date: true })}</span> },
              { k: "Recorded cost", v: <span className="tnum">{formatInr(cost.totalPaise)} <span className="text-muted">(labour {formatInr(cost.laborPaise)} · parts {formatInr(cost.partsPaise)})</span></span> },
            ]}
          />
          <KeyValue
            items={[
              { k: "Incident", v: wo.incidentId ? <Link className="text-accent hover:underline mono" href={`/incidents/${wo.incidentId}`}>{wo.incidentId}</Link> : <span className="text-muted">none linked</span> },
              { k: "Recovery plan", v: wo.recoveryPlanId ? <Link className="text-accent hover:underline mono" href={`/recovery/${wo.recoveryPlanId}`}>{wo.recoveryPlanId}{linkedPlan ? ` v${linkedPlan.version} (${linkedPlan.status})` : ""}</Link> : <span className="text-muted">none linked</span> },
              { k: "Runs", v: <span className="tnum">{wo.runIds.length}</span> },
              ...(wo.fixture ? [{ k: "Fixture", v: wo.fixture.note }] : []),
              ...(wo.testScope
                ? [
                    { k: "Tested", v: wo.testScope.tested.join("; ") || "—" },
                    { k: "Not tested", v: <span className="text-amber">{wo.testScope.notTested.join("; ") || "—"}</span> },
                    { k: "Modes", v: wo.testScope.modes.join(", ") || "—" },
                  ]
                : []),
            ]}
          />
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title="State" description="Transitions require a reason. Most moves happen through the actions below; direct moves are offered only where the state machine allows them." />
        <CardBody className="space-y-3">
          <StateStrip state={wo.state} />
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.length === 0 ? <span className="text-[13px] text-muted">No direct transitions from {wo.state.replace(/_/g, " ")}.</span> : null}
            {allowedTransitions.map((to) => (
              <Button key={to} size="sm" variant="outline" disabled={locked} title={locked ? lockedReason : undefined} onClick={() => setPending({ kind: "transition", to })}>
                Move to {to.replace(/_/g, " ")}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Evidence references" description="Diagnosis evidence frozen onto the work order at creation." />
          <CardBody>
            {wo.evidenceRefs.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {wo.evidenceRefs.map((e) => (
                  <li key={e}>
                    {wo.incidentId ? (
                      <Link className="mono text-[12px] text-accent hover:underline" href={`/incidents/${wo.incidentId}?tab=evidence`}>
                        {e}
                      </Link>
                    ) : (
                      <span className="mono text-[12px]">{e}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No evidence references recorded.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Approvals"
            actions={
              <Button size="sm" variant="primary" disabled={!canApprove} title={approveReason} onClick={() => setPending({ kind: "approve" })}>
                <ShieldCheck size={14} /> Approve intervention
              </Button>
            }
          />
          <CardBody>
            {wo.approvals.length ? (
              <ul className="space-y-1 text-[13px]">
                {wo.approvals.map((a, i) => (
                  <li key={i}>
                    <StatusBadge value={a.decision} /> {a.reviewer} (simulated) at <span className="tnum">{formatIst(a.at.ms, { date: true })}</span>: {a.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No approval recorded. {approveReason ?? "Approve the planned intervention to allow work to be recorded."}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Work performed"
          description="Recording work is a statement of action. It never changes an outcome; a recovery run does that."
          actions={
            <Button size="sm" variant="primary" disabled={!canRecordWork} title={recordWorkReason} onClick={() => setWorkOpen(true)}>
              Record work
            </Button>
          }
        />
        <CardBody>
          {recordWorkReason && !locked ? <p className="mb-2 text-[12px] text-muted">{recordWorkReason}</p> : null}
          {wo.workPerformed.length ? (
            <Table>
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
                    <Td className="tnum whitespace-nowrap">{formatIst(w.at.ms, { date: true })}</Td>
                    <Td className="text-[12px]">{w.by}</Td>
                    <Td>{w.description}</Td>
                    <Td className="mono text-[12px]">{w.interventionId ?? <span className="text-muted">none (record only)</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No work recorded" />
          )}
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Labour" description={`Rate for ${wo.cellId ?? "this cell"}: ${formatInr(laborRate)}/h, frozen onto each entry when recorded.`} />
          <CardBody className="space-y-3">
            {wo.labor.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Who</Th>
                    <Th className="text-right">Minutes</Th>
                    <Th className="text-right">Rate</Th>
                    <Th className="text-right">Cost</Th>
                    <Th>Note</Th>
                  </tr>
                </thead>
                <tbody>
                  {wo.labor.map((l) => (
                    <tr key={l.id}>
                      <Td className="text-[12px]">{l.who}</Td>
                      <Td className="tnum text-right">{l.minutes}</Td>
                      <Td className="tnum text-right">{formatInr(l.ratePaisePerHour)}/h</Td>
                      <Td className="tnum text-right">{formatInr(laborCostPaise(l.minutes, l.ratePaisePerHour))}</Td>
                      <Td className="text-[12px]">{l.note}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-[13px] text-muted">No labour recorded.</p>
            )}
            <form
              className="grid gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                const m = Number(laborMinutes);
                if (!Number.isFinite(m) || m <= 0) return;
                addLabor(wo.id, m, laborNote.trim() || "Labour entry");
                setLaborNote("");
              }}
            >
              <Field label="Minutes">
                <Input type="number" min={1} step={1} value={laborMinutes} onChange={(e) => setLaborMinutes(e.target.value)} className="tnum" disabled={locked} aria-label="Labour minutes" />
              </Field>
              <Field label="Note">
                <Input value={laborNote} onChange={(e) => setLaborNote(e.target.value)} disabled={locked} aria-label="Labour note" placeholder="What the time was spent on" />
              </Field>
              <Button type="submit" disabled={locked || !(Number(laborMinutes) > 0)} title={locked ? lockedReason : undefined}>
                Add {Number(laborMinutes) > 0 ? `(${formatInr(laborCostPaise(Number(laborMinutes), laborRate))})` : ""}
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Parts" description="Unit price is frozen at consumption. Every click carries a fresh idempotency key." />
          <CardBody className="space-y-3">
            {wo.parts.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Part</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Unit price (frozen)</Th>
                    <Th className="text-right">Line</Th>
                  </tr>
                </thead>
                <tbody>
                  {wo.parts.map((u) => (
                    <tr key={u.transactionId}>
                      <Td>
                        <span className="mono">{u.partId}</span>
                        <span className="block text-[12px] text-muted">{inventory.find((x) => x.id === u.partId)?.name ?? ""}</span>
                      </Td>
                      <Td className="tnum text-right">{u.quantity}</Td>
                      <Td className="tnum text-right">{formatInr(u.unitPricePaise)}</Td>
                      <Td className="tnum text-right">{formatInr(u.quantity * u.unitPricePaise)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-[13px] text-muted">No parts consumed.</p>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
              <Field label="Part" hint={part ? `available ${part.onHand - part.reserved} of ${part.onHand} on hand (${part.reserved} reserved) · ${formatInr(part.catalogPricePaise)}/${part.unit}` : undefined}>
                <Select value={partId} onChange={(e) => setPartId(e.target.value)} className="w-full" disabled={locked} aria-label="Part">
                  {inventory.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.id} — {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" hint={part?.indivisible ? "whole units" : undefined}>
                <Input type="number" min={part?.indivisible ? 1 : 0.1} step={part?.indivisible ? 1 : "any"} value={partQty} onChange={(e) => setPartQty(e.target.value)} className="tnum" disabled={locked} aria-label="Part quantity" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={locked || !part || !qtyValid} title={locked ? lockedReason : qtyValid ? undefined : "Enter a positive quantity; whole numbers for indivisible parts"} onClick={() => part && reservePart(wo.id, part.id, qty, actionKey())}>
                Reserve
              </Button>
              <Button size="sm" variant="primary" disabled={locked || !part || !qtyValid} title={locked ? lockedReason : qtyValid ? undefined : "Enter a valid quantity"} onClick={() => part && consumePart(wo.id, part.id, qty, actionKey())}>
                Consume
              </Button>
              <Button size="sm" variant="outline" disabled={locked || !part || !qtyValid} title={locked ? lockedReason : qtyValid ? undefined : "Enter a valid quantity"} onClick={() => part && returnPart(wo.id, part.id, qty, actionKey())}>
                Return
              </Button>
            </div>
            <div className="border-t border-border pt-3">
              <Field label="Prepare spare request (reserves the parts an intervention lists)" hint={`${INTERVENTION_BY_ID[spareIntervention]?.title}: ${INTERVENTION_BY_ID[spareIntervention]?.partIds.join(", ") || "no parts"}`}>
                <div className="flex gap-2">
                  <Select value={spareIntervention} onChange={(e) => setSpareIntervention(e.target.value as InterventionId)} className="min-w-0 flex-1" disabled={locked} aria-label="Intervention for spare request">
                    {INTERVENTIONS.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title}
                      </option>
                    ))}
                  </Select>
                  <Button size="md" disabled={locked} title={locked ? lockedReason : "Idempotent per work order and intervention"} onClick={() => prepareSpareRequest(wo.id, spareIntervention)}>
                    Prepare
                  </Button>
                </div>
              </Field>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recovery"
            description="A run against an approved plan is the only path to verified closure."
            actions={
              wo.incidentId && !locked ? (
                <Link href={`/recovery?incident=${wo.incidentId}`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-[13px] hover:bg-surface-2">
                  Build recovery plan
                </Link>
              ) : null
            }
          />
          <CardBody className="space-y-3">
            {!wo.incidentId ? <p className="text-[13px] text-muted">No incident is linked, so no plan can be built for this work order.</p> : null}
            {candidatePlans.length ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="Plan" hint={runPlan ? `v${runPlan.version} · ${runPlan.status} · ${runPlan.checks.length} checks` : undefined}>
                  <Select value={runPlan?.id ?? ""} onChange={(e) => setRunPlanId(e.target.value)} className="w-full" disabled={locked} aria-label="Recovery plan">
                    {candidatePlans.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.id} v{pl.version} ({pl.status})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button variant="primary" disabled={locked || !runPlan || runPlan.status !== "APPROVED" || starting} title={locked ? lockedReason : runPlan && runPlan.status !== "APPROVED" ? `Plan is ${runPlan.status}; approve it first` : undefined} onClick={() => void onStartRun()}>
                  <Play size={14} /> Start run
                </Button>
              </div>
            ) : wo.incidentId ? (
              <p className="text-[13px] text-muted">No recovery plan exists for {wo.incidentId} yet.</p>
            ) : null}
            {runs.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Run</Th>
                    <Th>Outcome</Th>
                    <Th>Plan</Th>
                    <Th>Started</Th>
                    <Th>Review</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        {r.fixture ? (
                          <span className="mono">{r.id}</span>
                        ) : (
                          <Link className="text-accent hover:underline mono" href={`/recovery/${r.planId}?tab=runs&run=${r.id}`}>
                            {r.id}
                          </Link>
                        )}
                        {r.fixture ? <Badge tone="grey" className="ml-1">fictional fixture</Badge> : null}
                        {r.staleReason ? <Badge tone="amber" className="ml-1">stale</Badge> : null}
                        {r.fixture ? <span className="block text-[12px] text-muted">{r.summary}</span> : null}
                      </Td>
                      <Td>
                        <StatusBadge value={r.outcome} />
                      </Td>
                      <Td className="mono text-[12px]">
                        {r.planId} v{r.planVersion}
                      </Td>
                      <Td className="tnum whitespace-nowrap">{formatIst(r.startedAt.ms, { date: true })}</Td>
                      <Td className="text-[12px]">{r.reviewedBy ? `${r.reviewedBy.decision} by ${r.reviewedBy.reviewer}` : <span className="text-muted">not reviewed</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-[13px] text-muted">No runs recorded against this work order.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Verification and closure"
            description={`Evaluated live against the current identity (${identity}) as the prospective reviewer.`}
            actions={
              <Button variant="primary" disabled={locked || !closure?.ok} title={locked ? lockedReason : closure?.ok ? undefined : "Closure conditions are not met; see the reasons listed"} onClick={() => setPending({ kind: "close" })}>
                Close with verified closure
              </Button>
            }
          />
          <CardBody>
            {locked ? (
              wo.closure ? (
                <KeyValue
                  items={[
                    { k: "Closed", v: <span className="tnum">{formatIst(wo.closure.at.ms, { date: true })}</span> },
                    { k: "Run", v: <span className="mono">{wo.closure.runId}</span> },
                    { k: "Reviewer", v: `${wo.closure.reviewer} (simulated)` },
                    { k: "Wording", v: wo.closure.wording },
                    ...(wo.review ? [{ k: "Review reason", v: wo.review.reason }] : []),
                  ]}
                />
              ) : (
                <p className="text-[13px] text-muted">Locked without a closure record.</p>
              )
            ) : closure?.ok ? (
              <Callout tone="green" title="Closure conditions are met">
                An APPROVED plan at the run&apos;s version, a current PASS run started after the last recorded work, no later intervention, and a reviewer distinct from the repairer.
              </Callout>
            ) : (
              <Callout tone="amber" title="Closure is blocked">
                <ul className="list-disc space-y-0.5 pl-5">
                  {closure?.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Callout>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Events" description="Work-order events and audit entries about this record, newest first. Corrections are new events, never silent edits." />
        <CardBody className="p-0">
          {events.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>At</Th>
                  <Th>Kind</Th>
                  <Th>Actor</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <Td className="tnum whitespace-nowrap">{formatIst(e.at.ms, { date: true })}</Td>
                    <Td>
                      <Badge tone="neutral">{e.kind.replace(/_/g, " ")}</Badge>
                    </Td>
                    <Td className="text-[12px]">{e.actor}</Td>
                    <Td className="text-[13px]">{e.detail}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState title="No events yet" />
            </div>
          )}
        </CardBody>
      </Card>

      <ReasonDialog
        open={pending?.kind === "transition"}
        onOpenChange={(v) => !v && setPending(null)}
        title={pending?.kind === "transition" ? `Move ${wo.id} to ${pending.to.replace(/_/g, " ")}` : ""}
        description="Direct state change recorded as a work-order event."
        confirmLabel="Move"
        onConfirm={(reason) => {
          if (pending?.kind === "transition") transitionWO(wo.id, pending.to, reason);
        }}
      />
      <ReasonDialog
        open={pending?.kind === "approve"}
        onOpenChange={(v) => !v && setPending(null)}
        title={`Approve intervention on ${wo.id}`}
        description={`Planned action: ${wo.plannedAction}. Recorded under ${identity} (simulated). Moves the work order to INTERVENTION APPROVED.`}
        confirmLabel="Approve"
        onConfirm={(reason) => approveIntervention(wo.id, reason)}
      />
      <ReasonDialog
        open={pending?.kind === "close"}
        onOpenChange={(v) => !v && setPending(null)}
        title={`Close ${wo.id} with verified closure`}
        description={`Reviewer: ${identity} (simulated). The closure wording is fixed: "Recovery checks passed within the tested operating conditions". The record locks afterwards.`}
        confirmLabel="Close work order"
        onConfirm={(reason) => closeWO(wo.id, reason)}
      />

      <Dialog open={workOpen} onOpenChange={setWorkOpen} title={`Record work on ${wo.id}`} description="Describe what was done. Optionally apply a simulated intervention; its effect is stated honestly and is what the simulation will change.">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitWork();
          }}
        >
          <Field label="Description">
            <Textarea rows={3} value={workDesc} onChange={(e) => setWorkDesc(e.target.value)} required aria-label="Work description" placeholder="What was physically done, by whom, and what was observed" />
          </Field>
          <Field label="Simulated intervention (optional)" hint={snapshot.mode !== "DEMO_SIMULATION" ? "Interventions are only available in the demo simulation; imported traces are never mutated." : undefined}>
            <Select value={workIntervention} onChange={(e) => setWorkIntervention(e.target.value as InterventionId | "")} className="w-full" disabled={snapshot.mode !== "DEMO_SIMULATION"} aria-label="Intervention">
              <option value="">None — record only</option>
              {INTERVENTIONS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} ({i.assetId})
                </option>
              ))}
            </Select>
          </Field>
          {chosenIntervention ? (
            <Callout tone="neutral" title={chosenIntervention.title}>
              <p>{chosenIntervention.description}</p>
              <p className="mt-1">
                <span className="font-medium">Effect in the simulation:</span> {chosenIntervention.effect}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                Typical labour {chosenIntervention.laborMinutes} min · parts {chosenIntervention.partIds.join(", ") || "none"}
              </p>
            </Callout>
          ) : null}
          {chosenIntervention?.needsParam === "rpm" ? (
            <Field label="Commanded speed (rpm)">
              <Input type="number" min={100} step={10} value={rpm} onChange={(e) => setRpm(e.target.value)} className="tnum" aria-label="Commanded speed rpm" />
            </Field>
          ) : null}
          {chosenIntervention?.needsParam === "recipe" ? (
            <Field label="Recipe">
              <Select value={recipe} onChange={(e) => setRecipe(e.target.value)} className="w-full" aria-label="Recipe">
                {Object.values(RECIPES).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} — {r.commandedSpeedRpm} rpm{r.approvedBaseline ? "" : " (no approved baseline)"}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWorkOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!workDesc.trim() || workBusy || (chosenIntervention?.needsParam === "rpm" && !(Number(rpm) > 0))}>
              Record work
            </Button>
          </div>
        </form>
      </Dialog>
      <p className="mt-4 text-[12px] text-muted">Stored in this browser — not cloud-synced.</p>
    </div>
  );
}
