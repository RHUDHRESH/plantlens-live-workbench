"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, Check, CircleHelp, Clock3, Database, GitBranch, Layers3, Scale, ShieldAlert, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/store/app";
import { formatIst } from "@/lib/util";

function Flow({ title, nodes, tone }: { title: string; nodes: string[]; tone: "accent" | "amber" | "red" }) {
  const colors = tone === "accent" ? "border-accent/30 bg-accent-soft text-accent" : tone === "amber" ? "border-amber/30 bg-amber-soft text-amber" : "border-red/30 bg-red-soft text-red";
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[.14em] text-muted">{title}</p>
      <div className="flex flex-col items-stretch">
        {nodes.map((n, i) => (
          <div key={n} className="contents">
            <div className={`rounded-md border px-3 py-2 text-center text-sm font-medium ${colors}`}>{n}</div>
            {i < nodes.length - 1 ? <ArrowDown className="mx-auto my-1 text-muted" size={16} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ExplainPage() {
  const snapshot = useApp((s) => s.snapshot);
  const open = (snapshot?.incidents ?? []).filter((i) => !i.fixture && i.status !== "CLOSED" && i.diagnosis);
  const inc = open.slice().sort((a, b) => (b.diagnosis?.candidates[0]?.supportCount ?? 0) - (a.diagnosis?.candidates[0]?.supportCount ?? 0))[0];
  const d = inc?.diagnosis;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 rounded-lg border border-border bg-surface p-6 md:p-8">
        <Badge tone="accent">HOW IT DECIDES · 3 MINUTES</Badge>
        <h1 className="mt-3 max-w-4xl text-2xl font-semibold leading-tight tracking-tight md:text-4xl">How does PlantLens decide what caused a stoppage?</h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted">
          The dependency graph does not choose by magic. It defines which evidence each fault family should produce. The runtime compares quality-gated observations with the approved paths, counts independent supporting evidence groups, penalises valid contradictions, and abstains when the leaders cannot be separated.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/lab">
            <Button variant="primary">
              Open live scenarios <ArrowRight size={15} />
            </Button>
          </Link>
          <Link href="/knowledge/matrix">
            <Button>Inspect approved dependencies</Button>
          </Link>
        </div>
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Database size={18} className="text-accent" />
          <h2 className="text-xl font-semibold">1. Signals become comparable evidence</h2>
        </div>
        <p className="mb-4 max-w-4xl text-sm text-muted">
          PlantLens never asks whether a current value is universally “high”. It asks whether the value is outside the approved band for this asset, recipe, phase, and speed. Missing data stays missing; it never becomes a zero or a normal reading.
        </p>
        <Card>
          <CardHeader title={d ? `Live evidence for ${inc!.id}` : "Live evidence"} description={d ? `Computed at ${formatIst(d.cutoffMs, { date: true })} against ${d.knowledgeVersion}` : "No open incident at the current cutoff. Start a scenario in the Lab to see live evidence here."} />
          <CardBody>
            {d ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Observation</Th>
                    <Th>Observed</Th>
                    <Th>Reference</Th>
                    <Th>Quality</Th>
                    <Th>Ordering reliable</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.evidence.map((e) => (
                    <tr key={e.id}>
                      <Td>
                        <Link href={`/incidents/${inc!.id}?tab=evidence&evidence=${e.id}`} className="text-accent hover:underline">
                          {e.title}
                        </Link>
                      </Td>
                      <Td className="tnum">{e.observedValue ?? "—"}</Td>
                      <Td className="tnum">{e.referenceValue ?? "—"}</Td>
                      <Td>
                        <StatusBadge value={e.quality} />
                      </Td>
                      <Td>{e.orderingReliable ? "yes" : "no"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">Nothing to show yet.</p>
            )}
          </CardBody>
        </Card>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <GitBranch size={18} className="text-accent" />
          <h2 className="text-xl font-semibold">2. Each hypothesis predicts a different fingerprint</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Flow title="Mechanical load increase" tone="accent" nodes={["Added resistance", "Torque demand rises", "Current and vibration rise at matched speed", "Temperature rises later"]} />
          <Flow title="Shared supply sag" tone="red" nodes={["Feeder voltage falls", "Cabinet voltage follows the electrical edge", "Current rises for constant power", "Vibration unaffected"]} />
          <Flow title="Inadequate coolant delivery" tone="amber" nodes={["Measured flow falls while the pump runs", "Cooling edge active during cutting", "Bearing temperature rises after a delay", "Current and vibration unchanged"]} />
        </div>
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
        <Card>
          <CardHeader title="The implemented rule" description="What the demo actually executes (lib/diagnosis/config.ts)" />
          <CardBody>
            <div className="rounded-md bg-surface-2 p-4 font-mono text-sm">
              <p>candidate rank =</p>
              <p className="mt-2 text-green">independent supporting evidence groups</p>
              <p className="text-red">− 2 × contradicting evidence groups</p>
            </div>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex gap-2">
                <Check className="shrink-0 text-green" size={17} />
                Correlated channels share a group so twenty features from one signal are not twenty witnesses.
              </li>
              <li className="flex gap-2">
                <X className="shrink-0 text-red" size={17} />A valid contradiction outweighs a weak association.
              </li>
              <li className="flex gap-2">
                <CircleHelp className="shrink-0 text-grey" size={17} />
                Unavailable evidence counts as unavailable, never as evidence against.
              </li>
              <li className="flex gap-2">
                <ShieldAlert className="shrink-0 text-amber" size={17} />
                Equal leaders produce AMBIGUOUS and a next check, not a forced winner. No family produces UNKNOWN with human review.
              </li>
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={d ? `Live ranking for ${inc!.id}` : "Ranking"} description="Counts of evidence groups, shown as counts. PlantLens does not produce probabilities or calibrated confidence." />
          <CardBody className="space-y-3">
            {d ? (
              d.candidates.map((c) => (
                <div key={c.family} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      #{c.rank} {c.title}
                    </span>
                    <span className="flex gap-1">
                      <Badge tone="green">{c.supportCount} support</Badge>
                      <Badge tone="red">{c.contradictionCount} contradict</Badge>
                      <Badge tone="grey">{c.pendingCount} pending</Badge>
                      <Badge tone="grey">{c.unavailableCount} unavailable</Badge>
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{c.mechanism}</p>
                  {c.notEstablished.length ? <p className="mt-1 text-[12px] text-muted">Not established: {c.notEstablished.join(" ")}</p> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No open incident. The ranking appears here once the engine has produced one.</p>
            )}
            {d ? (
              <p className="text-[13px]">
                Result: <StatusBadge value={d.state} /> {d.disposition === "HUMAN_REVIEW" ? <StatusBadge value="HUMAN_REVIEW" /> : null} — {d.summary}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Clock3 size={18} className="text-accent" />
          <h2 className="text-xl font-semibold">3. Timing, topology, and context stop shallow guesses</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardBody>
              <Clock3 className="text-accent" />
              <h3 className="mt-3 font-semibold">Temporal order</h3>
              <p className="mt-2 text-sm text-muted">Current changes immediately while temperature rises later. When clock uncertainty overlaps the gap between two onsets, ordering is marked unresolved and no first cause is manufactured.</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <Layers3 className="text-accent" />
              <h3 className="mt-3 font-semibold">Plant topology</h3>
              <p className="mt-2 text-sm text-muted">Deviations are grouped under a shared cause only when a published dependency path connects them and the timing is compatible. An unpublished proposal never groups anything.</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <Scale className="text-accent" />
              <h3 className="mt-3 font-semibold">Operating context</h3>
              <p className="mt-2 text-sm text-muted">A recipe or speed change can explain a higher current. Evidence is compared only with the approved baseline for matching conditions; a missing baseline is a knowledge gap, not a fault.</p>
            </CardBody>
          </Card>
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-border bg-surface-2 p-5 md:p-7">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Three things stay separate</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {[
            ["Graph structure", "What can cause what. Versioned, cited, engineer-approved, published."],
            ["Diagnosis configuration", "Which evidence supports or contradicts each family, and what is deliberately not established."],
            ["Runtime evidence", "What actually happened in this incident, with quality, provenance, and clock uncertainty."],
          ].map(([a, b], i) => (
            <div className="flex gap-3 rounded-md border border-border bg-surface p-3" key={a}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">{i + 1}</span>
              <div>
                <strong>{a}</strong>
                <p className="text-sm text-muted">{b}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted">Calibrated weights, learned fault classifiers, and remaining-useful-life estimates are not part of this build. Anything shown as a count is a count.</p>
      </section>
    </div>
  );
}
