"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import type { Incident } from "@/lib/domain/types";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import { formatIst } from "@/lib/util";
import { useApp } from "@/store/app";
import { openIncidents, sortByAttention } from "./plantMeta";

function words(n: number, noun: string): string {
  const w = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
  return `${w} ${noun}${n === 1 ? "" : "s"}`;
}

function uncertaintyWords(ms: number): string {
  if (!ms) return "source claimed exactness";
  return ms >= 1000 ? `± ${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s` : `± ${ms} ms`;
}

/**
 * One-sentence situation summary for the highest-priority open incident, followed by the
 * records that support it. Wording comes from the diagnosis record; nothing is scored here.
 */
export function SituationPanel({ snapshot, incident: forced }: { snapshot: RuntimeSnapshot; incident?: Incident }) {
  const costs = useApp((s) => s.costAssumptions);
  const top = useMemo(() => forced ?? sortByAttention(openIncidents(snapshot.incidents), costs, snapshot.clock.cursorMs)[0], [forced, snapshot.incidents, costs, snapshot.clock.cursorMs]);

  if (!top) {
    return (
      <Card>
        <CardHeader title="Situation" description="Highest-priority open incident." />
        <CardBody>
          <EmptyState title="No open incident" description="No grouped deviation is open at the current cursor. Assets with unavailable evidence are still shown as unavailable, not healthy." />
        </CardBody>
      </Card>
    );
  }

  const d = top.diagnosis;
  const evidenceById = new Map((d?.evidence ?? []).map((e) => [e.id, e]));
  const first = d?.firstReliableDeviation;
  const firstEvidence = first ? evidenceById.get(first.evidenceId) : undefined;
  const alternatives = (d?.candidates ?? []).filter((c) => c.rank >= 2 && c.rank <= 3);
  const next = d?.nextChecks[0];
  const supportingIds = new Set((d?.candidates[0]?.links ?? []).filter((l) => l.relation === "SUPPORT").map((l) => l.evidenceId));
  const supporting = (d?.evidence ?? []).filter((e) => supportingIds.has(e.id));
  const records = supporting.length ? supporting : (d?.evidence ?? []).slice(0, 4);

  return (
    <Card>
      <CardHeader
        title="Situation"
        description={
          <>
            <Link href={`/incidents/${top.id}`} className="mono hover:underline">
              {top.id}
            </Link>{" "}
            · {top.title}
          </>
        }
        actions={
          <>
            <StatusBadge value={d?.state} />
            <StatusBadge value={top.status} />
          </>
        }
      />
      <CardBody className="space-y-3">
        <p className="text-[15px] leading-snug">{d?.summary ?? top.groupingRationale}</p>
        {d?.orderingUnresolved ? (
          <div className="flex flex-wrap items-start gap-2 text-[13px]">
            <Badge tone="amber">Unresolved ordering</Badge>
            <span className="text-muted">{d.orderingNote ?? "The order of the observed deviations cannot be established from the available clocks."}</span>
          </div>
        ) : null}

        <div>
          <SectionTitle>Supporting records</SectionTitle>
          {records.length ? (
            <ul className="mt-1 space-y-0.5 text-[13px]">
              {records.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/incidents/${top.id}?tab=evidence&evidence=${encodeURIComponent(e.id)}`} className="hover:underline">
                    {e.title}
                  </Link>
                  <span className="mono text-[12px] text-muted">{e.assetId}</span>
                  <StatusBadge value={e.quality} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-muted">No evidence records are attached yet.</p>
          )}
        </div>

        <div>
          <SectionTitle>Earliest reliable deviation</SectionTitle>
          {first ? (
            <p className="mt-1 text-[13px]">
              <span className="tnum">{formatIst(first.ms, { date: true, seconds: true })}</span> <span className="text-muted">({uncertaintyWords(first.uncertaintyMs)})</span>
              {firstEvidence ? (
                <>
                  {" — "}
                  <Link href={`/incidents/${top.id}?tab=evidence&evidence=${encodeURIComponent(first.evidenceId)}`} className="hover:underline">
                    {firstEvidence.title}
                  </Link>
                </>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted">Not established — no deviation with reliable ordering has been recorded.</p>
          )}
        </div>

        <div>
          <SectionTitle>Alternatives</SectionTitle>
          {alternatives.length ? (
            <ul className="mt-1 space-y-0.5 text-[13px]">
              {alternatives.map((c) => (
                <li key={c.family}>
                  <span className="font-medium">#{c.rank} {c.title}</span>
                  <span className="text-muted">
                    {" — "}
                    {words(c.supportCount, "supporting record")}, {words(c.contradictionCount, "contradicting record")}
                    {c.pendingCount ? `, ${words(c.pendingCount, "pending check")}` : ""}
                    {c.unavailableCount ? `, ${words(c.unavailableCount, "unavailable input")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] text-muted">No ranked alternative is recorded for this incident.</p>
          )}
        </div>

        <div>
          <SectionTitle>Next action</SectionTitle>
          {next ? (
            <p className="mt-1 text-[13px]">
              {next.title}
              {next.target ? (
                <>
                  {" "}
                  <Link href={next.target.route} className="inline-flex items-center gap-1 text-accent hover:underline">
                    {next.target.label} <ArrowRight size={13} aria-hidden />
                  </Link>
                </>
              ) : null}
              {next.safety ? <span className="mt-0.5 block text-[12px] text-muted">{next.safety}</span> : null}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted">
              No next check is listed.{" "}
              <Link href={`/incidents/${top.id}`} className="hover:underline">
                Open the incident
              </Link>
              .
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
