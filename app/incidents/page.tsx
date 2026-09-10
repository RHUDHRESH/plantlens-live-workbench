"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DiagnosticState, Incident, IncidentStatus } from "@/lib/domain/types";
import { useApp } from "@/store/app";
import { formatIst } from "@/lib/util";
import { Badge, EmptyState, Field, LoadingState, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { assetName, latestPlans } from "@/components/incidents/helpers";

const STATUSES: IncidentStatus[] = ["OPEN", "INVESTIGATING", "AWAITING_VERIFICATION", "RESOLVED", "CLOSED"];
const STATES: DiagnosticState[] = ["NORMAL", "SUPPORTED", "AMBIGUOUS", "UNKNOWN", "SENSOR_CHECK"];

function IncidentRow({ inc, planCount }: { inc: Incident; planCount: number }) {
  const router = useRouter();
  const href = `/incidents/${inc.id}`;
  const d = inc.diagnosis;
  return (
    <tr
      className="cursor-pointer hover:bg-surface-2"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        router.push(href);
      }}
    >
      <Td className="mono whitespace-nowrap">
        <Link href={href} className="underline decoration-border-strong underline-offset-2 hover:text-accent">
          {inc.id}
        </Link>
      </Td>
      <Td>
        <span className="block">{inc.title}</span>
        {inc.fixture ? (
          <Badge tone="grey" className="mt-1">
            fictional fixture
          </Badge>
        ) : null}
      </Td>
      <Td>
        <span className="flex flex-wrap gap-1">
          {d ? <StatusBadge value={d.state} /> : <Badge tone="grey">no diagnosis</Badge>}
          {d?.disposition === "HUMAN_REVIEW" ? <Badge tone="amber">HUMAN REVIEW</Badge> : null}
        </span>
      </Td>
      <Td className="mono whitespace-nowrap">{formatIst(inc.openedAt.ms, { date: true, seconds: true })}</Td>
      <Td className="whitespace-nowrap">{inc.affectedCellIds.join(", ") || "—"}</Td>
      <Td>
        {inc.observedAssetIds.length ? (
          <span className="flex flex-wrap gap-1">
            {inc.observedAssetIds.map((a) => (
              <Badge key={a} tone="red" title={assetName(a)}>
                {a}
              </Badge>
            ))}
          </span>
        ) : (
          "—"
        )}
      </Td>
      <Td className="mono whitespace-nowrap">{inc.sharedCauseAssetId ?? <span className="text-muted">none asserted</span>}</Td>
      <Td className="tnum text-right">{inc.alarmIds.length}</Td>
      <Td className="tnum text-right">{inc.workOrderIds.length}</Td>
      <Td className="tnum text-right">{planCount}</Td>
      <Td>
        <StatusBadge value={inc.status} />
      </Td>
    </tr>
  );
}

export default function IncidentsPage() {
  const snapshot = useApp((s) => s.snapshot);
  const historical = useApp((s) => s.historicalIncidents);
  const plans = useApp((s) => s.plans);
  const [status, setStatus] = useState<"ALL" | IncidentStatus>("ALL");
  const [state, setState] = useState<"ALL" | DiagnosticState>("ALL");

  const planCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of latestPlans(plans)) counts[p.incidentId] = (counts[p.incidentId] ?? 0) + 1;
    return counts;
  }, [plans]);

  const live = useMemo(() => (snapshot?.incidents ?? []).filter((i) => !i.fixture).slice().sort((a, b) => b.openedAt.ms - a.openedAt.ms), [snapshot]);
  const matches = (i: Incident) => (status === "ALL" || i.status === status) && (state === "ALL" || i.diagnosis?.state === state);
  const liveFiltered = live.filter(matches);
  const historicalFiltered = historical.filter(matches);
  const openCount = live.filter((i) => i.status !== "CLOSED" && i.status !== "RESOLVED").length;

  if (!snapshot) return <LoadingState label="Starting diagnosis engine…" />;

  const header = (
    <tr>
      <Th>Id</Th>
      <Th>Title</Th>
      <Th>State</Th>
      <Th>Opened at (IST)</Th>
      <Th>Cells</Th>
      <Th>Observed assets</Th>
      <Th>Shared cause asset</Th>
      <Th className="text-right">Alarms grouped</Th>
      <Th className="text-right">Work orders</Th>
      <Th className="text-right">Plans</Th>
      <Th>Status</Th>
    </tr>
  );

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="Observed deviations grouped by approved dependencies and timing. Observed assets are separated from potentially affected assets and from unsupported hypotheses."
        badges={
          <>
            <Badge tone={openCount ? "red" : "grey"}>{openCount} open</Badge>
            <Badge tone="grey">{snapshot.mode === "IMPORTED_REPLAY" ? "IMPORTED REPLAY" : "SIMULATION"}</Badge>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Status">
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as "ALL" | IncidentStatus)}>
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Diagnostic state">
          <Select aria-label="Filter by diagnostic state" value={state} onChange={(e) => setState(e.target.value as "ALL" | DiagnosticState)}>
            <option value="ALL">All states</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
        <p className="pb-2 text-[12px] text-muted">
          Showing {liveFiltered.length} live and {historicalFiltered.length} historical record{historicalFiltered.length === 1 ? "" : "s"}.
        </p>
      </div>

      <section className="mb-5">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Live incidents</h2>
        {liveFiltered.length ? (
          <Table>
            <thead>{header}</thead>
            <tbody>
              {liveFiltered.map((i) => (
                <IncidentRow key={i.id} inc={i} planCount={planCounts[i.id] ?? 0} />
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={live.length ? "No live incidents match these filters" : "No live incidents yet"} description={live.length ? "Clear a filter to see the others." : "Incidents are created from observed deviations as the simulation advances; nothing is seeded for display."} />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
          Historical incidents <Badge tone="grey">fictional fixture</Badge>
        </h2>
        {historicalFiltered.length ? (
          <Table>
            <thead>{header}</thead>
            <tbody>
              {historicalFiltered.map((i) => (
                <IncidentRow key={i.id} inc={i} planCount={planCounts[i.id] ?? 0} />
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No historical incidents match" description="Historical fixtures are fictional records shipped with the demo workspace." />
        )}
      </section>
    </div>
  );
}
