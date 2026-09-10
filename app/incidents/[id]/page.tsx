"use client";

import { Suspense, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, Search, Wrench } from "lucide-react";
import { useApp } from "@/store/app";
import { formatIst } from "@/lib/util";
import { Badge, Button, Callout, ErrorState, LoadingState, PageHeader, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { findIncident, plansForIncident, tabFromParam, type IncidentTab } from "@/components/incidents/helpers";
import { SummaryTab } from "@/components/incidents/SummaryTab";
import { TimelineTab } from "@/components/incidents/TimelineTab";
import { EvidenceTab } from "@/components/incidents/EvidenceTab";
import { PathTab } from "@/components/incidents/PathTab";
import { RecoveryTab } from "@/components/incidents/RecoveryTab";
import { HistoryTab } from "@/components/incidents/HistoryTab";

/** Incident room: one record, six views, all reading the same diagnosis at the same cutoff. */

function IncidentRoom({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = tabFromParam(params.get("tab"));
  const evidenceParam = params.get("evidence");

  const snapshot = useApp((s) => s.snapshot);
  const historical = useApp((s) => s.historicalIncidents);
  const historicalRuns = useApp((s) => s.historicalRuns);
  const plans = useApp((s) => s.plans);
  const workOrders = useApp((s) => s.workOrders);
  const audit = useApp((s) => s.audit);
  const knowledge = useApp((s) => s.activeKnowledge());
  const draftWorkOrderFromIncident = useApp((s) => s.draftWorkOrderFromIncident);
  const setIncidentStatus = useApp((s) => s.setIncidentStatus);
  const setAskOpen = useApp((s) => s.setAskOpen);

  const inc = findIncident(snapshot, historical, id);
  const incidentPlans = useMemo(() => plansForIncident(plans, id), [plans, id]);
  const runs = useMemo(() => (snapshot?.runs ?? []).filter((r) => r.incidentId === id).slice().sort((a, b) => b.startedAt.ms - a.startedAt.ms), [snapshot, id]);

  const go = useCallback(
    (next: IncidentTab, extra?: Record<string, string>) => {
      const q = new URLSearchParams();
      q.set("tab", next);
      for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [router, pathname],
  );
  const selectEvidence = useCallback((evidenceId: string | null) => go("evidence", evidenceId ? { evidence: evidenceId } : undefined), [go]);

  if (!snapshot) return <LoadingState label="Starting diagnosis engine…" />;
  if (!inc) {
    return (
      <ErrorState
        title="Record not available in this browser"
        description={`Incident ${id} is not in this browser-local workspace. Records are stored in this browser and are not cloud-synced; import the evidence bundle that contains it to restore it.`}
        action={
          <div className="flex gap-2">
            <Link href="/reports" className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 px-3 text-sm font-medium hover:bg-border/60">
              Open reports (import a bundle)
            </Link>
            <Link href="/incidents" className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2">
              Back to incidents
            </Link>
          </div>
        }
      />
    );
  }

  const d = inc.diagnosis;
  const isFixture = !!inc.fixture;
  const statusRank = ["OPEN", "INVESTIGATING", "AWAITING_VERIFICATION", "RESOLVED", "CLOSED"].indexOf(inc.status);
  const canInvestigate = !isFixture && statusRank === 0;

  const draft = () => {
    const wo = draftWorkOrderFromIncident(inc.id);
    if (wo) router.push(`/maintenance/work-orders/${wo.id}`);
  };

  return (
    <div>
      <PageHeader
        title={inc.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="mono">{inc.id}</span>
            <span>opened {formatIst(inc.openedAt.ms, { date: true, seconds: true })}</span>
            {d ? (
              <>
                <span>
                  knowledge <span className="mono">{d.knowledgeVersion}</span>
                </span>
                <span>
                  cutoff <span className="mono">{formatIst(d.cutoffMs, { date: true, seconds: true })}</span>
                </span>
              </>
            ) : (
              <span>no diagnosis recorded</span>
            )}
          </span>
        }
        badges={
          <>
            <StatusBadge value={inc.status} />
            {d ? <StatusBadge value={d.state} /> : <Badge tone="grey">no diagnosis</Badge>}
            {d?.disposition === "HUMAN_REVIEW" ? <Badge tone="amber">HUMAN REVIEW</Badge> : null}
            {inc.safetyRelevant ? <Badge tone="red">safety relevant</Badge> : null}
            {isFixture ? <Badge tone="grey">fictional fixture</Badge> : null}
            {snapshot.clock.viewingPast ? <Badge tone="amber">viewing past</Badge> : null}
          </>
        }
        actions={
          <>
            <Button variant="primary" onClick={draft} disabled={isFixture || !d} title={isFixture ? "Fixtures have no live diagnosis to draft from" : !d ? "No diagnosis yet" : undefined}>
              <Wrench size={15} /> Draft work order
            </Button>
            <Button onClick={() => setIncidentStatus(inc.id, "INVESTIGATING")} disabled={!canInvestigate} title={isFixture ? "Historical fixture; status is fixed" : !canInvestigate ? `Already ${inc.status.replace(/_/g, " ").toLowerCase()}` : undefined}>
              <Search size={15} /> Mark investigating
            </Button>
            <Button variant="outline" onClick={() => setAskOpen(true)}>
              <MessageSquare size={15} /> Ask PlantLens
            </Button>
          </>
        }
      />

      <details className="mb-3 rounded-md border border-border bg-surface px-3 py-2 text-[13px]">
        <summary className="cursor-pointer font-medium">Grouping rationale</summary>
        <p className="mt-1 text-muted">{inc.groupingRationale}</p>
        <p className="mt-1 text-[12px] text-muted">
          Observed: <span className="mono">{inc.observedAssetIds.join(", ") || "—"}</span> · Shared cause candidate: <span className="mono">{inc.sharedCauseAssetId ?? "none asserted"}</span> · Alarms grouped: <span className="tnum">{inc.alarmIds.length}</span>
          {inc.repeatOf.length ? (
            <>
              {" "}
              · Repeat of: <span className="mono">{inc.repeatOf.join(", ")}</span>
            </>
          ) : null}
        </p>
      </details>

      {isFixture ? <Callout tone="grey" className="mb-3">This is a fictional fixture shipped with the demo workspace. Its diagnosis is frozen; live actions are disabled.</Callout> : null}

      <Tabs value={tab} onValueChange={(v) => go(tabFromParam(v))}>
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="evidence" count={d?.evidence.length}>
            Evidence
          </TabsTrigger>
          <TabsTrigger value="path">Path</TabsTrigger>
          <TabsTrigger value="recovery" count={incidentPlans.length + runs.length}>
            Recovery
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">{d ? <SummaryTab inc={inc} d={d} onTab={(t) => go(t)} /> : <NoDiagnosis />}</TabsContent>
        <TabsContent value="timeline">
          <TimelineTab inc={inc} d={d} snapshot={snapshot} />
        </TabsContent>
        <TabsContent value="evidence">{d ? <EvidenceTab d={d} selectedId={evidenceParam} onSelect={selectEvidence} /> : <NoDiagnosis />}</TabsContent>
        <TabsContent value="path">{d ? <PathTab inc={inc} d={d} knowledge={knowledge} /> : <NoDiagnosis />}</TabsContent>
        <TabsContent value="recovery">
          <RecoveryTab inc={inc} d={d} plans={incidentPlans} runs={runs} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab inc={inc} d={d} workOrders={workOrders} historicalRuns={historicalRuns} plans={incidentPlans} knowledge={knowledge} audit={audit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NoDiagnosis() {
  return <Callout tone="grey" title="No diagnosis recorded for this incident">The engine has not computed a diagnosis at a cutoff yet, or the record was imported without one.</Callout>;
}

export default function Page() {
  const p = useParams<{ id: string }>();
  return (
    <Suspense fallback={<LoadingState label="Opening incident…" />}>
      <IncidentRoom id={p.id} />
    </Suspense>
  );
}
