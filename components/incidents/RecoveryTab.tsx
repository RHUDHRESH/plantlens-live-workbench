"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Diagnosis, Incident, RecoveryPlan, RecoveryRun } from "@/lib/domain/types";
import { formatIst } from "@/lib/util";
import { Badge, Callout, Card, CardBody, CardHeader, StatusBadge, Table, Td, Th } from "@/components/ui";

/** Recovery tab: plans (latest per id) and runs for this incident. A repair is an action; recovery is an observed result. */

export function RecoveryTab({ inc, d, plans, runs }: { inc: Incident; d: Diagnosis | undefined; plans: RecoveryPlan[]; runs: RecoveryRun[] }) {
  const uncovered = d?.state === "UNKNOWN";
  return (
    <div className="space-y-3">
      {uncovered ? (
        <Callout tone="amber" title="No plan can be drafted for an uncovered fault family">
          The diagnosis state is UNKNOWN: no approved fault family covers this evidence, so there is no approved requirement to compile checks from. Review the knowledge gap first.{" "}
          <Link href="/knowledge/review" className="underline underline-offset-2">
            Open knowledge review
          </Link>
          .
        </Callout>
      ) : null}
      <Card>
        <CardHeader
          title="Recovery plans"
          description="Latest version per plan id. Approval is tied to a knowledge version and is invalidated when it changes."
          actions={
            inc.fixture ? (
              <Badge tone="grey">fictional fixture — no live plan</Badge>
            ) : uncovered ? (
              <Badge tone="grey">plan drafting unavailable</Badge>
            ) : (
              <Link href={`/recovery?incident=${encodeURIComponent(inc.id)}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-accent bg-accent px-3 text-sm font-medium text-white hover:opacity-90">
                Build recovery plan <ArrowRight size={14} />
              </Link>
            )
          }
        />
        <CardBody className="p-0">
          {plans.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Plan</Th>
                  <Th>Version</Th>
                  <Th>Status</Th>
                  <Th>Scope</Th>
                  <Th>Checks</Th>
                  <Th>Knowledge</Th>
                  <Th>Created (IST)</Th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <Td className="mono">
                      <Link href={`/recovery/${p.id}`} className="underline decoration-border-strong underline-offset-2 hover:text-accent">
                        {p.id}
                      </Link>
                    </Td>
                    <Td className="tnum">v{p.version}</Td>
                    <Td>
                      <StatusBadge value={p.status} />
                      {p.invalidationReason ? <span className="block text-[11px] text-muted">{p.invalidationReason}</span> : null}
                    </Td>
                    <Td className="text-[12px]">
                      {p.scope.cellId} · {p.scope.recipe} · {p.scope.mode} · {p.scope.requiredCompleteCycles} cycles
                    </Td>
                    <Td className="tnum">{p.checks.length}</Td>
                    <Td className="mono text-[12px]">{p.knowledgeVersion}</Td>
                    <Td className="mono whitespace-nowrap text-[12px]">{formatIst(p.createdAt.ms, { date: true, seconds: false })}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted">No recovery plan exists for this incident yet.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recovery runs" description="Outcome is what was observed against the plan; PASS wording is limited to the tested operating conditions." />
        <CardBody className="p-0">
          {runs.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Plan</Th>
                  <Th>Outcome</Th>
                  <Th>Started (IST)</Th>
                  <Th>Cycles</Th>
                  <Th>Summary</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td className="mono">
                      <Link href={`/recovery/${r.planId}?run=${encodeURIComponent(r.id)}`} className="underline decoration-border-strong underline-offset-2 hover:text-accent">
                        {r.id}
                      </Link>
                    </Td>
                    <Td className="mono text-[12px]">
                      {r.planId} v{r.planVersion}
                    </Td>
                    <Td>
                      <StatusBadge value={r.outcome} />
                      {r.staleReason ? <Badge tone="amber">stale</Badge> : null}
                    </Td>
                    <Td className="mono whitespace-nowrap text-[12px]">{formatIst(r.startedAt.ms, { date: true, seconds: true })}</Td>
                    <Td className="tnum">{r.completeCyclesObserved}</Td>
                    <Td className="text-[12px]">
                      {r.summary}
                      {r.reasonNotEstablished.length ? <span className="block text-muted">Not established: {r.reasonNotEstablished.join("; ")}</span> : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted">No recovery run has been started for this incident.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
