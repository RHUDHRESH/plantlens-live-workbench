"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Textarea } from "@/components/ui";
import { useApp } from "@/store/app";
import { isPublishedProposal, kindLabel, latestPlans, planReferenceIds, proposalChangeIds } from "./helpers";

/** Publish approved-but-unpublished proposals as a new immutable knowledge version. */
export function PublishPanel({ onSelectProposal }: { onSelectProposal: (id: string) => void }) {
  const proposals = useApp((s) => s.proposals);
  const plans = useApp((s) => s.plans);
  const workOrders = useApp((s) => s.workOrders);
  const activeId = useApp((s) => s.activeKnowledgeVersionId);
  const identity = useApp((s) => s.identity);
  const publishKnowledge = useApp((s) => s.publishKnowledge);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const approved = useMemo(() => proposals.filter((p) => p.state === "APPROVED" && !isPublishedProposal(p)), [proposals]);
  const changeIds = useMemo(() => new Set(approved.flatMap(proposalChangeIds)), [approved]);
  const atRisk = useMemo(
    () =>
      latestPlans(plans)
        .filter((pl) => pl.status === "APPROVED")
        .map((pl) => ({ plan: pl, hits: Array.from(planReferenceIds(pl)).filter((id) => changeIds.has(id)) }))
        .filter((x) => x.hits.length > 0),
    [plans, changeIds],
  );

  return (
    <Card>
      <CardHeader title="Publish" description={`Approved proposals become a new knowledge version derived from ${activeId}. Published versions are immutable; the parent is retained and marked superseded.`} />
      <CardBody className="space-y-3">
        {approved.length === 0 ? (
          <EmptyState title="Nothing approved and unpublished" description="Approve proposals in the queue; they appear here until published." />
        ) : (
          <ul className="space-y-1">
            {approved.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px]">
                <button type="button" className="min-w-0 text-left hover:underline" onClick={() => onSelectProposal(p.id)}>
                  {p.title}
                </button>
                <span className="flex items-center gap-1.5">
                  <Badge tone="neutral">{kindLabel(p.kind)}</Badge>
                  <span className="mono text-[12px] text-muted">{proposalChangeIds(p).join(", ") || "record only"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {atRisk.length ? (
          <Callout tone="amber" title="Publishing will invalidate approved recovery plans">
            <ul className="space-y-1">
              {atRisk.map(({ plan, hits }) => {
                const wo = workOrders.find((w) => w.recoveryPlanId === plan.id && !w.locked);
                return (
                  <li key={plan.id}>
                    <Link href={`/recovery/${plan.id}`} className="mono text-accent hover:underline">
                      {plan.id} v{plan.version}
                    </Link>{" "}
                    references <span className="mono">{hits.join(", ")}</span>; its approval will be invalidated and a migration task recorded.
                    {wo ? (
                      <>
                        {" "}
                        Work order <span className="mono">{wo.id}</span> will need re-approval and a rerun.
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Callout>
        ) : approved.length ? (
          <p className="text-[12px] text-muted">No approved recovery plan references the records that will change.</p>
        ) : null}
        <label htmlFor="publish-reason" className="sr-only">
          Publish reason
        </label>
        <Textarea id="publish-reason" rows={2} placeholder="Reason for publishing (required; recorded on the version)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!approved.length} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!approved.length || !reason.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await publishKnowledge(reason.trim());
                setReason("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Publishing…" : "Publish new knowledge version"}
          </Button>
          <span className="text-[12px] text-muted">
            Publisher: {identity} (simulated). {approved.length} change{approved.length === 1 ? "" : "s"}.
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
