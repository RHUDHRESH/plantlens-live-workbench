"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "@/store/app";
import { latestPlans } from "@/components/incidents/helpers";
import { formatIst } from "@/lib/util";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, LoadingState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { PlanBuilder } from "@/components/recovery/PlanBuilder";
import { useQuery } from "@/components/recovery/useQuery";
import { findIncidentAnywhere, planStatusHint, runsForPlanId } from "@/components/recovery/helpers";

function RecoveryListPage() {
  const snapshot = useApp((s) => s.snapshot);
  const plans = useApp((s) => s.plans);
  const historicalIncidents = useApp((s) => s.historicalIncidents);
  const historicalRuns = useApp((s) => s.historicalRuns);
  const { get, patch } = useQuery();
  const preselect = get("incident");
  const [builderOpen, setBuilderOpen] = useState(() => !!preselect);

  const latest = useMemo(() => latestPlans(plans), [plans]);
  const invalidated = latest.filter((p) => p.status === "INVALIDATED");
  const allRuns = useMemo(() => [...(snapshot?.runs ?? []), ...historicalRuns], [snapshot?.runs, historicalRuns]);

  if (!snapshot) return <LoadingState label="Starting simulation engine…" />;

  const closeBuilder = (v: boolean) => {
    setBuilderOpen(v);
    if (!v && preselect) patch({ incident: null });
  };

  return (
    <div>
      <PageHeader
        title="Recovery plans"
        description="Plans are constrained JSON compiled from approved templates and published requirements, interpreted by the recovery engine against observations. Nothing here generates code, and a plan never passes without observed evidence."
        badges={<Badge tone="grey">Stored in this browser — not cloud-synced</Badge>}
        actions={
          <Button variant="primary" onClick={() => setBuilderOpen(true)}>
            <Plus size={15} /> Build plan
          </Button>
        }
      />

      {invalidated.length ? (
        <Callout tone="amber" title={`${invalidated.length} plan${invalidated.length === 1 ? "" : "s"} need migration review after a knowledge change`} className="mb-4">
          <ul className="list-disc space-y-0.5 pl-5">
            {invalidated.map((p) => (
              <li key={p.id}>
                <Link className="text-accent hover:underline mono" href={`/recovery/${p.id}`}>
                  {p.id} v{p.version}
                </Link>{" "}
                — {p.invalidationReason ?? "Approval invalidated."} Revise and re-approve before any rerun counts.
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <Card>
        <CardHeader title="Plans" description="Latest version per plan id. Earlier versions and every earlier run attempt are retained on the plan's history tab." />
        <CardBody className="p-0">
          {latest.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No recovery plans yet" description="Build one from an open incident. The template list is filtered by the incident's top fault candidate and affected cell." action={<Button variant="primary" onClick={() => setBuilderOpen(true)}>Build plan</Button>} />
            </div>
          ) : (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th>Incident</Th>
                  <Th>Scope</Th>
                  <Th>Knowledge / baseline</Th>
                  <Th>Checks</Th>
                  <Th>Last run</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {latest.map((p) => {
                  const inc = findIncidentAnywhere(snapshot, historicalIncidents, p.incidentId);
                  const lastRun = runsForPlanId(allRuns, p.id)[0];
                  return (
                    <tr key={p.id}>
                      <Td>
                        <Link className="text-accent hover:underline mono" href={`/recovery/${p.id}`}>
                          {p.id}
                        </Link>
                        <span className="ml-1 text-[12px] text-muted tnum">v{p.version}</span>
                      </Td>
                      <Td>
                        <StatusBadge value={p.status} />
                        <span className="mt-0.5 block max-w-xs text-[12px] text-muted">{planStatusHint(p)}</span>
                      </Td>
                      <Td>
                        <Link className="text-accent hover:underline mono" href={`/incidents/${p.incidentId}`}>
                          {p.incidentId}
                        </Link>
                        {inc ? <span className="block max-w-xs truncate text-[12px] text-muted">{inc.title}</span> : <span className="block text-[12px] text-muted">not in this browser</span>}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {p.scope.cellId} · {p.scope.recipe} · {p.scope.mode}
                        {p.scope.commandedSpeedRpm ? ` · ${p.scope.commandedSpeedRpm} rpm` : ""}
                      </Td>
                      <Td className="mono text-[12px]">
                        {p.knowledgeVersion}
                        <span className="block text-muted">{p.baselineVersion}</span>
                      </Td>
                      <Td className="tnum">{p.checks.length}</Td>
                      <Td>
                        {lastRun ? (
                          <Link className="inline-flex items-center gap-1.5" href={`/recovery/${p.id}?tab=runs&run=${lastRun.id}`}>
                            <StatusBadge value={lastRun.outcome} />
                            <span className="mono text-[12px] text-accent hover:underline">{lastRun.id}</span>
                          </Link>
                        ) : (
                          <span className="text-muted">no run yet</span>
                        )}
                      </Td>
                      <Td className="tnum whitespace-nowrap">{formatIst(p.createdAt.ms, { date: true, seconds: false })}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <PlanBuilder key={preselect ?? "none"} open={builderOpen} onOpenChange={closeBuilder} preselectIncidentId={preselect} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RecoveryListPage />
    </Suspense>
  );
}
