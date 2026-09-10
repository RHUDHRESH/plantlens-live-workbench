"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Play, Presentation, Wrench } from "lucide-react";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, Input, Label, PageHeader, SectionTitle, Select, Switch, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/store/app";
import { INTERVENTIONS, INTERVENTION_BY_ID, RECIPES, SCENARIOS, SCENARIO_BY_ID, type InterventionDef, type InterventionId } from "@/lib/simulation/scenarios";
import { ASSET_BY_ID } from "@/lib/domain/plant";
import { BRANCHES, type GuidedBranch } from "@/lib/demo/guided";
import { formatDuration } from "@/lib/util";

const BRANCH_LABELS: Record<GuidedBranch, string> = {
  main: "Main path (scenario 1, shared air)",
  speed: "Branch: speed reduction (scenario 5)",
  missing: "Branch: missing evidence (scenario 7)",
  partial: "Branch: partial repair (scenario 9)",
};

type PendingStart = { scenarioId: string; seed: number; fromLink: boolean } | null;

export default function LabPage() {
  return (
    <Suspense fallback={null}>
      <LabInner />
    </Suspense>
  );
}

function LabInner() {
  const router = useRouter();
  const params = useSearchParams();
  const workspace = useApp((s) => s.workspace);
  const snapshot = useApp((s) => s.snapshot);
  const guided = useApp((s) => s.guided);
  const setGuided = useApp((s) => s.setGuided);
  const newDemoWorkspace = useApp((s) => s.newDemoWorkspace);
  const intervene = useApp((s) => s.intervene);
  const toast = useApp((s) => s.toast);

  const [pending, setPending] = useState<PendingStart>(null);
  const [starting, setStarting] = useState(false);
  const [rpm, setRpm] = useState("900");
  const [recipe, setRecipe] = useState("PART-B");
  const [applying, setApplying] = useState<InterventionId | null>(null);

  const linkScenarioId = params.get("scenario");
  const linkSeedRaw = params.get("seed");
  const linkScenario = linkScenarioId ? SCENARIO_BY_ID[linkScenarioId] : undefined;
  const linkSeed = useMemo(() => {
    if (!linkScenario) return undefined;
    const n = linkSeedRaw ? Number(linkSeedRaw) : NaN;
    return Number.isFinite(n) && Number.isInteger(n) ? n : linkScenario.seed;
  }, [linkScenario, linkSeedRaw]);

  const scenarios = useMemo(() => SCENARIOS.slice().sort((a, b) => a.number - b.number), []);
  const demoMode = workspace.mode === "DEMO_SIMULATION";

  const confirmStart = async () => {
    if (!pending) return;
    setStarting(true);
    try {
      await newDemoWorkspace(pending.scenarioId, pending.seed);
      toast("success", `Started ${SCENARIO_BY_ID[pending.scenarioId]?.title ?? pending.scenarioId} (seed ${pending.seed}).`);
      if (pending.fromLink) router.replace("/lab");
    } finally {
      setStarting(false);
      setPending(null);
    }
  };

  const startGuided = (branch: GuidedBranch) => {
    setGuided({ active: true, branch, stepIndex: 0, log: [] });
    toast("info", `Guided demonstration started: ${BRANCH_LABELS[branch]}.`);
  };

  const applyIntervention = async (def: InterventionDef) => {
    let p: Record<string, number | string> | undefined;
    if (def.needsParam === "rpm") {
      const n = Number(rpm);
      if (!Number.isFinite(n) || n <= 0) {
        toast("error", "Enter a positive rpm value before applying the speed override.");
        return;
      }
      p = { rpm: n };
    } else if (def.needsParam === "recipe") {
      p = { recipe };
    }
    setApplying(def.id);
    try {
      const rec = await intervene(def.id, p);
      if (rec) toast("success", `${def.title} recorded at the live edge (simulated). Effect: ${def.effect}`);
    } finally {
      setApplying(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Scenario lab"
        description="Deterministic, seeded scenarios run through the same engine used by diagnosis and recovery. Starting a scenario creates a new demo workspace in this browser."
        badges={
          <>
            <Badge tone="accent">SIMULATION</Badge>
            {workspace.scenarioId ? (
              <Badge tone="grey">
                Active: {workspace.scenarioId} · seed <span className="tnum">{workspace.seed ?? SCENARIO_BY_ID[workspace.scenarioId]?.seed ?? "—"}</span>
              </Badge>
            ) : null}
          </>
        }
      />

      {linkScenarioId ? (
        linkScenario && linkSeed !== undefined ? (
          <Callout tone="accent" title="Scenario link" className="mb-4">
            <p>
              This link reproduces scenario <strong>{linkScenario.number}</strong> ({linkScenario.title}) with seed <span className="tnum">{linkSeed}</span>. It reproduces the seed and configuration only, not private imported files or local records.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={() => setPending({ scenarioId: linkScenario.id, seed: linkSeed, fromLink: true })}>
                <Play size={14} /> Start scenario {linkScenario.number} with seed {linkSeed}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => router.replace("/lab")}>
                Dismiss
              </Button>
            </div>
          </Callout>
        ) : (
          <Callout tone="amber" title="Unknown scenario in link" className="mb-4">
            The scenario id <span className="mono">{linkScenarioId}</span> is not in this build&apos;s catalogue. Choose a scenario below.
          </Callout>
        )
      ) : null}

      <SectionTitle className="mb-2">Scenarios</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {scenarios.map((s) => {
          const active = workspace.scenarioId === s.id;
          return (
            <Card key={s.id} aria-current={active ? "true" : undefined} className={active ? "border-accent" : undefined}>
              <CardHeader
                title={
                  <span>
                    <span className="tnum text-muted">{s.number}.</span> {s.title}
                  </span>
                }
                actions={active ? <Badge tone="accent">ACTIVE</Badge> : undefined}
              />
              <CardBody className="flex h-full flex-col">
                <p className="text-[13px] text-muted">{s.story}</p>
                <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                  <dt className="text-muted">Scenario id</dt>
                  <dd className="mono">{s.id}</dd>
                  <dt className="text-muted">Seed</dt>
                  <dd className="tnum">{s.seed}</dd>
                  <dt className="text-muted">Duration</dt>
                  <dd className="tnum">{formatDuration(s.durationMs)} of simulated time</dd>
                  <dt className="text-muted">Recipes</dt>
                  <dd className="mono">
                    A {s.recipes["CELL-A"]} · B {s.recipes["CELL-B"]}
                  </dd>
                </dl>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.tags.map((t) => (
                    <Badge tone="grey" key={t}>
                      {t}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 space-y-2 text-[12px]">
                  <div>
                    <p className="font-semibold">Suggested interventions</p>
                    {s.suggestedInterventions.length ? (
                      <ul className="mt-0.5 space-y-0.5">
                        {s.suggestedInterventions.map((id) => (
                          <li key={id}>
                            <span className="font-medium">{INTERVENTION_BY_ID[id]?.title ?? id}</span> <span className="text-muted">— {INTERVENTION_BY_ID[id]?.effect}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted">None. This scenario needs human review or no action.</p>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold">Misleading interventions</p>
                    {s.misleadingInterventions.length ? (
                      <ul className="mt-0.5 space-y-0.5">
                        {s.misleadingInterventions.map((id) => (
                          <li key={id}>
                            <Badge tone="amber">looks like a repair</Badge> <span className="font-medium">{INTERVENTION_BY_ID[id]?.title ?? id}</span> <span className="text-muted">— {INTERVENTION_BY_ID[id]?.effect}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted">None listed.</p>
                    )}
                  </div>
                </div>
                <div className="mt-auto pt-4">
                  <Button variant={active ? "secondary" : "primary"} size="sm" onClick={() => setPending({ scenarioId: s.id, seed: s.seed, fromLink: false })}>
                    <Play size={14} /> Start this scenario (new demo workspace)
                  </Button>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Presenter notes — not available to diagnosis" description="What the audience may know that the engine never sees." />
          <CardBody className="space-y-2 text-[13px]">
            <p>
              Each scenario injects faults on a schedule. That schedule lives in the simulator&apos;s hidden truth module (<span className="mono">lib/simulation/truth.ts</span>) and never enters the diagnosis input contract: diagnosis and recovery see only observations, alarms, the published knowledge version, and approved baselines.
            </p>
            <p>The boundary is enforced by a unit test (<span className="mono">tests/unit/boundary.test.ts</span>) that fails if diagnosis or recovery modules import the truth module. Evidence bundles are exported with <span className="mono">containsGroundTruth: false</span>.</p>
            <p>The story text on each card is presenter material. The engine is not told which scenario is running when it diagnoses; the scenario id only selects the fault schedule inside the simulator.</p>
            <Callout tone="grey">Evaluation results in the Lab compare engine output with the answer key on held-out seeds. That is instructor-side use of the truth module and is labelled as such on the evaluation page.</Callout>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Guided demonstration"
            description="Every step executes the same store actions a user would trigger manually and waits for the engine's real result."
            actions={guided.active ? <Badge tone="accent">Running: {BRANCH_LABELS[guided.branch]}</Badge> : undefined}
          />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => startGuided("main")}>
                <Presentation size={14} /> Start main path
              </Button>
              {(["speed", "missing", "partial"] as GuidedBranch[]).map((b) => (
                <Button key={b} size="sm" onClick={() => startGuided(b)}>
                  {BRANCH_LABELS[b]}
                </Button>
              ))}
              {guided.active ? (
                <Button variant="ghost" size="sm" onClick={() => setGuided({ active: false, stepIndex: 0, log: [] })}>
                  Stop guided demo
                </Button>
              ) : null}
            </div>
            <p className="text-[12px] text-muted">Branches start a fresh demo workspace on another seeded scenario; the main path continues in the current workspace.</p>
            <Switch checked={guided.presentation} onCheckedChange={(v) => setGuided({ presentation: v })} label="Presentation mode (larger type, hides navigation)" id="presentation-mode" />
            <div className="space-y-2">
              {(Object.keys(BRANCHES) as GuidedBranch[]).map((b) => (
                <details key={b} className="rounded-md border border-border" open={b === guided.branch && guided.active}>
                  <summary className="cursor-pointer px-3 py-1.5 text-[13px] font-medium">
                    {BRANCH_LABELS[b]} <span className="tnum text-muted">({BRANCHES[b].length} steps)</span>
                  </summary>
                  <ol className="list-decimal space-y-0.5 px-3 pb-2 pl-8 text-[12px]">
                    {BRANCHES[b].map((step, i) => (
                      <li key={step.id} className={guided.active && guided.branch === b && guided.stepIndex === i ? "font-semibold text-accent" : undefined} aria-current={guided.active && guided.branch === b && guided.stepIndex === i ? "step" : undefined}>
                        {step.title}
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Interventions library"
          description="Applying an intervention records an action at the live edge of the simulation. A repair is an action; recovery is a separately observed result."
          actions={
            demoMode ? (
              <Badge tone="grey">
                Live edge: {snapshot ? new Date(snapshot.clock.liveMs).toISOString().slice(11, 19) : "—"} UTC
              </Badge>
            ) : (
              <Badge tone="amber">Not available in {workspace.mode.replace(/_/g, " ")}</Badge>
            )
          }
        />
        <CardBody className="space-y-3">
          {!demoMode ? <Callout tone="amber">Interventions are only available in the demo simulation. Imported traces are never mutated.</Callout> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
            <div>
              <Label htmlFor="int-rpm">Operator speed override (rpm) — used by SET_SPEED</Label>
              <Input id="int-rpm" type="number" inputMode="numeric" min={1} step={50} value={rpm} onChange={(e) => setRpm(e.target.value)} className="tnum" />
            </div>
            <div>
              <Label htmlFor="int-recipe">Recipe — used by SET_RECIPE</Label>
              <Select id="int-recipe" value={recipe} onChange={(e) => setRecipe(e.target.value)} className="w-full">
                {Object.values(RECIPES).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} · {r.commandedSpeedRpm} rpm{r.approvedBaseline ? "" : " · no approved baseline"}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {INTERVENTIONS.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Intervention</Th>
                  <Th>Asset</Th>
                  <Th>Description</Th>
                  <Th>Effect (honest label)</Th>
                  <Th className="text-right">Labor</Th>
                  <Th>Parts</Th>
                  <Th>Apply</Th>
                </tr>
              </thead>
              <tbody>
                {INTERVENTIONS.map((def) => (
                  <tr key={def.id}>
                    <Td>
                      <span className="font-medium">{def.title}</span>
                      <span className="mono block text-[11px] text-muted">{def.id}</span>
                    </Td>
                    <Td>
                      <span className="mono">{def.assetId}</span>
                      <span className="block text-[11px] text-muted">{ASSET_BY_ID[def.assetId]?.name}</span>
                    </Td>
                    <Td className="max-w-[16rem]">{def.description}</Td>
                    <Td className="max-w-[16rem]">
                      {def.effect}
                      {def.needsParam ? (
                        <span className="block text-[11px] text-muted">Uses the {def.needsParam === "rpm" ? `rpm input (${rpm || "—"})` : `recipe input (${recipe})`} above.</span>
                      ) : null}
                    </Td>
                    <Td className="tnum text-right">{def.laborMinutes} min</Td>
                    <Td>{def.partIds.length ? def.partIds.map((p) => <span key={p} className="mono block text-[12px]">{p}</span>) : <span className="text-muted">none</span>}</Td>
                    <Td>
                      <Button size="sm" variant="outline" disabled={!demoMode || !snapshot || applying !== null} onClick={() => void applyIntervention(def)} title={demoMode ? "Records an intervention at the live edge; simulated" : "Only available in the demo simulation"}>
                        <Wrench size={13} /> {applying === def.id ? "Applying…" : "Apply now"}
                      </Button>
                      <span className="block max-w-[10rem] text-[11px] leading-tight text-muted">Records an intervention at the live edge; simulated.</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No interventions defined" />
          )}
        </CardBody>
      </Card>

      <Dialog
        open={pending !== null}
        onOpenChange={(v) => {
          if (!v && !starting) setPending(null);
        }}
        title={pending ? `Start scenario ${SCENARIO_BY_ID[pending.scenarioId]?.number ?? ""} with seed ${pending.seed}?` : "Start scenario"}
        description="This creates a new demo workspace in this browser."
      >
        {pending ? (
          <div className="space-y-3 text-[13px]">
            <p>
              <strong>{SCENARIO_BY_ID[pending.scenarioId]?.title}</strong> — <span className="mono">{pending.scenarioId}</span>, seed <span className="tnum">{pending.seed}</span>.
            </p>
            <Callout tone="amber" title="Live records are reset">
              Current incidents, alarms, recovery plans and runs, non-fixture work orders, inventory transactions, imported sources, proposals, and the audit trail in this browser are replaced by the seeded demo records. Export an evidence bundle first if you want to keep them.
            </Callout>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPending(null)} disabled={starting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void confirmStart()} disabled={starting}>
                <FlaskConical size={14} /> {starting ? "Starting…" : "Start scenario"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
