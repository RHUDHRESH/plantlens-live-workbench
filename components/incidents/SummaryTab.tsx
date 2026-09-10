"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Diagnosis, FaultCandidate, Incident, NextCheck } from "@/lib/domain/types";
import { formatIst } from "@/lib/util";
import { Badge, Button, Callout, Card, CardBody, CardHeader, KeyValue, Table, Td, Th } from "@/components/ui";
import { formatUncertainty, type IncidentTab } from "./helpers";

/** Summary tab: conclusion first, then ranked candidates, gaps, questions, and the next checks. */

function countWords(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function CandidateCard({ c }: { c: FaultCandidate }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            #{c.rank} {c.title}
          </p>
          <p className="mono text-[11px] text-muted">{c.family}</p>
        </div>
        <Badge tone={c.rank === 1 ? "accent" : "grey"}>{c.rank === 1 ? "leading" : "alternative"}</Badge>
      </div>
      <p className="mt-1 text-[13px] text-muted">{c.mechanism}</p>
      <p className="mt-2 text-[12px]">
        {countWords(c.supportCount, "supporting group")}, {countWords(c.contradictionCount, "contradicting group")}, {countWords(c.pendingCount, "pending group")}, {countWords(c.unavailableCount, "unavailable group")}.
      </p>
      {c.notEstablished.length ? (
        <div className="mt-2 text-[12px]">
          <p className="font-medium text-muted">Not established</p>
          <ul className="list-disc pl-4">
            {c.notEstablished.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.edgeIds.length ? (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-[12px]">
          <span className="text-muted">Approved edges:</span>
          {c.edgeIds.map((e) => (
            <Link key={e} href={`/knowledge/matrix?edge=${encodeURIComponent(e)}`} className="mono underline decoration-border-strong underline-offset-2 hover:text-accent">
              {e}
            </Link>
          ))}
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-muted">No approved dependency path backs this candidate.</p>
      )}
    </div>
  );
}

function NextCheckCard({ check, onTab }: { check: NextCheck; onTab: (tab: IncidentTab) => void }) {
  const target = check.target;
  const inRoom = target?.route.startsWith("/incidents");
  const tabFor = (label: string): IncidentTab => (label.toLowerCase().includes("evidence") ? "evidence" : "timeline");
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{check.title}</p>
        <Badge tone={check.kind === "SIMULATED_CHECK" ? "accent" : "grey"}>{check.kind.replace(/_/g, " ")}</Badge>
      </div>
      <KeyValue
        className="mt-2"
        items={[
          { k: "Prerequisites", v: check.prerequisites.length ? check.prerequisites.join("; ") : "none stated" },
          { k: "Distinguishes", v: check.distinguishes.length ? <span className="mono text-[12px]">{check.distinguishes.join(", ")}</span> : "—" },
          { k: "Safety", v: check.safety },
        ]}
      />
      {check.interpretation.length ? (
        <Table className="mt-2">
          <thead>
            <tr>
              <Th>Result</Th>
              <Th>Meaning</Th>
            </tr>
          </thead>
          <tbody>
            {check.interpretation.map((i) => (
              <tr key={i.result}>
                <Td className="whitespace-nowrap">{i.result}</Td>
                <Td>{i.meaning}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {target ? (
        inRoom ? (
          <Button size="sm" className="mt-2" onClick={() => onTab(tabFor(target.label))}>
            {target.label} <ArrowRight size={14} />
          </Button>
        ) : (
          <Link href={target.route} className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] font-medium hover:bg-border/60">
            {target.label} <ArrowRight size={14} />
          </Link>
        )
      ) : null}
    </div>
  );
}

export function SummaryTab({ inc, d, onTab }: { inc: Incident; d: Diagnosis; onTab: (tab: IncidentTab) => void }) {
  const frd = d.firstReliableDeviation;
  const frdEvidence = frd ? d.evidence.find((e) => e.id === frd.evidenceId) : undefined;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Situation" description="Conclusion first; evidence and limits remain inspectable in the other tabs." />
        <CardBody>
          <p className="text-[15px]">{d.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">First reliable deviation:</span>
            {frd ? (
              <>
                <span className="mono">
                  {formatIst(frd.ms, { seconds: true })} {formatUncertainty(frd.uncertaintyMs)}
                </span>
                <Link href={`/incidents/${inc.id}?tab=evidence&evidence=${encodeURIComponent(frd.evidenceId)}`} className="underline decoration-border-strong underline-offset-2 hover:text-accent">
                  {frdEvidence?.title ?? frd.evidenceId}
                </Link>
              </>
            ) : (
              <span className="text-muted">none established with reliable ordering</span>
            )}
            {d.orderingUnresolved ? <Badge tone="amber">Unresolved ordering</Badge> : null}
          </div>
          {d.orderingNote ? <p className="mt-1 text-[12px] text-muted">{d.orderingNote}</p> : null}
          {inc.potentiallyAffectedAssetIds.length ? (
            <p className="mt-2 text-[12px] text-muted">
              Modelled impact (conditional, not observed): <span className="mono">{inc.potentiallyAffectedAssetIds.join(", ")}</span>
            </p>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ranked candidates" description="Counts are independent evidence groups, shown as-is; there are no probabilities." />
          <CardBody className="space-y-2">
            {d.candidates.length ? d.candidates.map((c) => <CandidateCard key={c.family} c={c} />) : <p className="text-[13px] text-muted">No covered fault family matches this evidence. This is an uncovered fault, not a healthy state.</p>}
          </CardBody>
        </Card>
        <div className="space-y-3">
          <Card>
            <CardHeader title="Missing inputs" description="Unavailable, not contradictory." />
            <CardBody>
              {d.missingInputs.length ? (
                <ul className="list-disc pl-4 text-[13px]">
                  {d.missingInputs.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">No missing inputs recorded.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Unresolved questions" />
            <CardBody>
              {d.unresolvedQuestions.length ? (
                <ul className="list-disc pl-4 text-[13px]">
                  {d.unresolvedQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">None recorded.</p>
              )}
            </CardBody>
          </Card>
          {d.residualDeviations.length ? (
            <Callout tone="amber" title="Residual deviations not explained by the leading candidate">
              <ul className="list-disc pl-4">
                {d.residualDeviations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader title="Next checks" description="Each check states what it distinguishes and how to read its result. Simulated checks act on the demo simulation only." />
        <CardBody className="grid gap-2 lg:grid-cols-2">{d.nextChecks.length ? d.nextChecks.map((c) => <NextCheckCard key={c.id} check={c} onTab={onTab} />) : <p className="text-[13px] text-muted">No further checks proposed.</p>}</CardBody>
      </Card>
    </div>
  );
}
