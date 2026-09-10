"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge, Card, CardBody, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import { formatInr } from "@/lib/util";
import { useApp } from "@/store/app";
import { ATTENTION_ORDER, groupedAlarmCount, hasUnresolvedDependency, interruptionMinutes, interruptionOngoing, lossEstimatePaise, openIncidents, sortByAttention } from "./plantMeta";

/**
 * Open incidents ordered by stated operational priority. The ordering is explained in
 * words; no risk score or percentage is ever computed.
 */
export function AttentionQueue({ snapshot, selectedId, onSelect }: { snapshot: RuntimeSnapshot; selectedId?: string | null; onSelect?: (id: string | null) => void }) {
  const costs = useApp((s) => s.costAssumptions);
  const nowMs = snapshot.clock.cursorMs;
  const sorted = useMemo(() => sortByAttention(openIncidents(snapshot.incidents), costs, nowMs), [snapshot.incidents, costs, nowMs]);

  return (
    <Card>
      <CardHeader title="Attention queue" description={<span>Sorted by: {ATTENTION_ORDER.join(" → ")}.</span>} actions={<Badge tone={sorted.length ? "accent" : "grey"}>{sorted.length} open</Badge>} />
      <CardBody className="p-0">
        {sorted.length ? (
          <ol className="divide-y divide-border">
            {sorted.map((i, idx) => {
              const grouped = groupedAlarmCount(i);
              const loss = lossEstimatePaise(i, costs, nowMs);
              const mins = interruptionMinutes(i, nowMs);
              const missing = i.diagnosis?.missingInputs.length;
              const selected = selectedId === i.id;
              return (
                <li key={i.id} className={selected ? "bg-accent-soft/40" : undefined}>
                  <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tnum text-[12px] text-muted">{idx + 1}.</span>
                        <Link href={`/incidents/${i.id}`} className="mono text-[12px] text-muted hover:underline">
                          {i.id}
                        </Link>
                        <StatusBadge value={i.status} />
                        {i.diagnosis ? <StatusBadge value={i.diagnosis.state} /> : null}
                      </div>
                      <Link href={`/incidents/${i.id}`} className="mt-0.5 block text-[13px] font-medium hover:underline">
                        {i.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                        <span>Cells: {i.affectedCellIds.length ? i.affectedCellIds.join(", ") : "none"}</span>
                        <span aria-hidden>·</span>
                        <span className="tnum">
                          {grouped.alarms} alarm{grouped.alarms === 1 ? "" : "s"} grouped{grouped.groups > 1 ? ` (${grouped.groups} stoppages)` : ""}
                        </span>
                        {typeof missing === "number" ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="tnum">
                              {missing} missing input{missing === 1 ? "" : "s"}
                            </span>
                          </>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {interruptionOngoing(i) ? <Badge tone="red">interruption ongoing</Badge> : null}
                        {i.safetyRelevant ? <Badge tone="red">safety-relevant</Badge> : null}
                        {i.repeatOf.length ? <Badge tone="amber">repeated incident ({i.repeatOf.length} prior)</Badge> : null}
                        {mins > 0 ? (
                          <Badge tone="neutral" className="tnum" title="Interruption minutes × the cell's stated rate; an illustrative assumption, not an invoice">
                            loss estimate {formatInr(loss)} ({mins.toFixed(1)} cell-min)
                          </Badge>
                        ) : null}
                        {hasUnresolvedDependency(i) ? <Badge tone="grey">unresolved dependency</Badge> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {onSelect ? (
                        <button type="button" onClick={() => onSelect(selected ? null : i.id)} aria-pressed={selected} className="rounded-md border border-border px-2 py-1 text-[12px] hover:bg-surface-2">
                          {selected ? "Clear focus" : "Focus path"}
                        </button>
                      ) : null}
                      <Link href={`/incidents/${i.id}`} className="text-[12px] text-accent hover:underline">
                        Open incident
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="p-3">
            <EmptyState title="Queue is empty" description="No open incident at the current cursor. Let the simulation advance or load a scenario in the Lab." />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
