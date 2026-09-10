"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { AuditEvent, Diagnosis, Incident, KnowledgeVersion, RecoveryPlan, RecoveryRun, WorkOrder } from "@/lib/domain/types";
import { formatIst } from "@/lib/util";
import { Badge, Callout, Card, CardBody, CardHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { assetName, edgeIdsCoveredByPlan, tagNamesMentioned } from "./helpers";

/**
 * History (recurrence) tab. Three separate questions are answered separately so that "the
 * same asset" is never silently upgraded to "the same fault" or "the same evidence".
 */

function WorkOrderRows({ items, showScope }: { items: WorkOrder[]; showScope: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Work order</Th>
          <Th>Asset</Th>
          <Th>Suspected mechanism</Th>
          <Th>Fault family</Th>
          <Th>State</Th>
          <Th>Created (IST)</Th>
          {showScope ? <Th>Tested / not tested / modes</Th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((w) => (
          <tr key={w.id}>
            <Td className="mono whitespace-nowrap">
              <Link href={`/maintenance/work-orders/${w.id}`} className="underline decoration-border-strong underline-offset-2 hover:text-accent">
                {w.id}
              </Link>
              {w.fixture ? (
                <Badge tone="grey" className="ml-1">
                  fictional fixture
                </Badge>
              ) : null}
            </Td>
            <Td className="whitespace-nowrap">
              {w.assetId} <span className="text-[11px] text-muted">{assetName(w.assetId)}</span>
            </Td>
            <Td className="text-[12px]">{w.suspectedMechanism}</Td>
            <Td className="mono text-[12px]">{w.faultFamily ?? <span className="text-muted">not recorded</span>}</Td>
            <Td>
              <StatusBadge value={w.state} />
            </Td>
            <Td className="mono whitespace-nowrap text-[12px]">{formatIst(w.createdAt.ms, { date: true, seconds: false })}</Td>
            {showScope ? (
              <Td className="text-[12px]">
                {w.testScope ? (
                  <>
                    <span className="block">
                      <span className="text-green">Tested:</span> {w.testScope.tested.join("; ") || "—"}
                    </span>
                    <span className="block">
                      <span className="text-amber">Not tested:</span> {w.testScope.notTested.join("; ") || "—"}
                    </span>
                    <span className="block text-muted">Modes: {w.testScope.modes.join(", ") || "—"}</span>
                  </>
                ) : (
                  <span className="text-muted">no test scope recorded</span>
                )}
              </Td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function HistoryTab({ inc, d, workOrders, historicalRuns, plans, knowledge, audit }: { inc: Incident; d: Diagnosis | undefined; workOrders: WorkOrder[]; historicalRuns: RecoveryRun[]; plans: RecoveryPlan[]; knowledge: KnowledgeVersion; audit: AuditEvent[] }) {
  const top = d?.candidates[0];
  const evidenceTags = useMemo(() => Array.from(new Set((d?.evidence ?? []).map((e) => e.tagId))), [d]);

  const sameAsset = useMemo(() => workOrders.filter((w) => w.fixture && inc.observedAssetIds.includes(w.assetId)), [workOrders, inc.observedAssetIds]);
  const sameFamily = useMemo(() => (top ? workOrders.filter((w) => w.faultFamily === top.family && w.incidentId !== inc.id) : []), [workOrders, top, inc.id]);

  const evidenceMatches = useMemo(() => {
    const out: Array<{ id: string; kind: "run" | "work order"; text: string; names: string[]; workOrderId?: string }> = [];
    if (!evidenceTags.length) return out;
    for (const r of historicalRuns) {
      const text = `${r.summary} ${r.fixture?.testScope ?? ""}`;
      const names = tagNamesMentioned(text, evidenceTags);
      if (names.length) out.push({ id: r.id, kind: "run", text: r.summary, names, workOrderId: r.workOrderId });
    }
    for (const w of workOrders) {
      if (!w.fixture || !w.testScope) continue;
      const text = [...w.testScope.tested, ...w.testScope.notTested].join(" ");
      const names = tagNamesMentioned(text, evidenceTags);
      if (names.length && !out.some((o) => o.workOrderId === w.id)) out.push({ id: w.id, kind: "work order", text: w.testScope.tested.join("; "), names, workOrderId: w.id });
    }
    return out;
  }, [historicalRuns, workOrders, evidenceTags]);

  const coverageGap = useMemo(() => {
    if (!top) return [];
    const covered = new Set<string>();
    for (const p of plans) for (const e of edgeIdsCoveredByPlan(p, knowledge.requirements)) covered.add(e);
    return top.edgeIds.filter((e) => !covered.has(e));
  }, [top, plans, knowledge.requirements]);

  const auditRows = useMemo(() => audit.filter((a) => a.subjectId === inc.id || a.detail.includes(inc.id)).slice().sort((a, b) => b.at.ms - a.at.ms), [audit, inc.id]);

  return (
    <div className="space-y-3">
      <Callout tone="grey" title="Recurrence is judged on three separate questions">
        Same asset, same fault-family hypothesis, and same evidence pattern are answered independently. Earlier work is not labelled unjustified because the issue returned: each closure was scoped to what was tested at the time.
      </Callout>

      <Card>
        <CardHeader title="1. Same-asset repetition" description={`Fixture work orders on observed assets (${inc.observedAssetIds.join(", ") || "none"}), with what each one tested and did not test.`} />
        <CardBody>{sameAsset.length ? <WorkOrderRows items={sameAsset} showScope /> : <p className="text-[13px] text-muted">No earlier work order on these assets is recorded.</p>}</CardBody>
      </Card>

      <Card>
        <CardHeader title="2. Same fault-family hypothesis" description={top ? `Work orders whose recorded fault family equals ${top.family}.` : "No leading candidate; no fault family to compare."} />
        <CardBody>{sameFamily.length ? <WorkOrderRows items={sameFamily} showScope={false} /> : <p className="text-[13px] text-muted">No work order recorded the same fault family.</p>}</CardBody>
      </Card>

      <Card>
        <CardHeader title="3. Matching evidence pattern" description="Only counted when a historical run summary or test scope names the same tags as the current evidence." />
        <CardBody>
          {evidenceMatches.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Record</Th>
                  <Th>Shared tag names</Th>
                  <Th>Historical text</Th>
                </tr>
              </thead>
              <tbody>
                {evidenceMatches.map((m) => (
                  <tr key={`${m.kind}-${m.id}`}>
                    <Td className="mono whitespace-nowrap">
                      {m.workOrderId ? (
                        <Link href={`/maintenance/work-orders/${m.workOrderId}`} className="underline decoration-border-strong underline-offset-2 hover:text-accent">
                          {m.id}
                        </Link>
                      ) : (
                        m.id
                      )}
                      <span className="block text-[11px] text-muted">{m.kind}</span>
                    </Td>
                    <Td className="mono text-[12px]">{m.names.join(", ")}</Td>
                    <Td className="text-[12px]">{m.text}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-[13px] text-muted">No genuinely matching evidence pattern recorded.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Additional approved coverage now required" description="Edges of the leading candidate without a check in this incident's existing plans." />
        <CardBody>
          {!top ? (
            <p className="text-[13px] text-muted">No leading candidate; coverage cannot be derived.</p>
          ) : coverageGap.length ? (
            <ul className="flex flex-wrap gap-1">
              {coverageGap.map((e) => (
                <li key={e}>
                  <Link href={`/knowledge/matrix?edge=${encodeURIComponent(e)}`}>
                    <Badge tone="amber" className="mono">
                      {e}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : top.edgeIds.length ? (
            <p className="text-[13px]">All {top.edgeIds.length} edge(s) of the leading candidate have a check in an existing plan for this incident.</p>
          ) : (
            <p className="text-[13px] text-muted">The leading candidate relies on no approved edge, so there is no edge coverage to require.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Audit events mentioning this incident" description="Stored in this browser — not cloud-synced. Identities are simulated." />
        <CardBody className="p-0">
          {auditRows.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>At (IST)</Th>
                  <Th>Kind</Th>
                  <Th>Subject</Th>
                  <Th>Actor</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((a) => (
                  <tr key={a.id}>
                    <Td className="mono whitespace-nowrap text-[12px]">{formatIst(a.at.ms, { date: true, seconds: true })}</Td>
                    <Td className="mono text-[12px]">{a.kind}</Td>
                    <Td className="mono text-[12px]">{a.subjectId}</Td>
                    <Td className="text-[12px]">{a.actor}</Td>
                    <Td className="text-[12px]">{a.detail}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted">No audit event mentions this incident yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
