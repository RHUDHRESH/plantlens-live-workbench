"use client";

import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Input, Label, LoadingState, PageHeader, StatusBadge, Switch, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/store/app";
import { SCENARIOS, INTERVENTION_BY_ID } from "@/lib/simulation/scenarios";
import { CASE_CLASS, EVALUATION_SEEDS, type CaseClass, type EvaluationReport } from "@/lib/simulation/evaluation";

const CASE_CLASS_LABEL: Record<CaseClass, string> = {
  NORMAL: "Normal (negative case)",
  KNOWN: "Known family",
  AMBIGUOUS: "Ambiguous (should abstain)",
  MISSING_DATA: "Missing data (should abstain)",
  COMPOUND: "Compound",
  UNSUPPORTED: "Unsupported (should abstain)",
};

const SHARED_INCIDENT_SCENARIOS = ["S01-SHARED-AIR", "S04-SUPPLY-SAG", "S10-CLOCK-SKEW"];

function ofN(x: number, n: number, noun: string): string {
  return `${x} of ${n} ${noun}`;
}

function parseSeeds(text: string): { seeds: number[]; invalid: string[] } {
  const seeds: number[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[,\s]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const n = Number(t);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      if (!seeds.includes(n)) seeds.push(n);
    } else invalid.push(t);
  }
  return { seeds, invalid };
}

export default function EvaluationPage() {
  const report = useApp((s) => s.evaluation);
  const evaluating = useApp((s) => s.evaluating);
  const runEvaluation = useApp((s) => s.runEvaluation);
  const toast = useApp((s) => s.toast);

  const catalogue = useMemo(() => SCENARIOS.filter((s) => CASE_CLASS[s.id]).sort((a, b) => a.number - b.number), []);
  const [seedsText, setSeedsText] = useState(EVALUATION_SEEDS.join(", "));
  const [selected, setSelected] = useState<string[]>(() => catalogue.map((s) => s.id));
  const [recovery, setRecovery] = useState(true);
  const [detectAtMin, setDetectAtMin] = useState("8");

  const parsed = useMemo(() => parseSeeds(seedsText), [seedsText]);
  const detectAt = Number(detectAtMin);
  const detectValid = Number.isFinite(detectAt) && detectAt > 0;
  const canRun = parsed.seeds.length > 0 && selected.length > 0 && detectValid && !evaluating;

  const devSeeds = useMemo(() => SCENARIOS.map((s) => s.seed).sort((a, b) => a - b), []);
  const overlapsDev = parsed.seeds.filter((s) => devSeeds.includes(s));

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const run = async () => {
    if (!canRun) return;
    await runEvaluation({ seeds: parsed.seeds, scenarioIds: catalogue.filter((s) => selected.includes(s.id)).map((s) => s.id), detectAtMs: Math.round(detectAt * 60_000), recovery });
    const r = useApp.getState().evaluation;
    if (r) toast("success", `Evaluation finished: ${r.episodes.length} detection episodes, ${r.recovery.length} recovery episodes.`);
  };

  return (
    <div>
      <PageHeader
        title="Frozen evaluation"
        description="The same held-out episodes are run through a naive baseline and the complete engine. Counts are always shown with their denominators; no bare percentages."
        badges={<Badge tone="grey">Instructor-side harness</Badge>}
        actions={
          <Button variant="primary" disabled={!canRun} onClick={() => void run()}>
            <Play size={14} /> {evaluating ? "Running…" : "Run evaluation"}
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardHeader title="Configuration" description="Evaluation seeds differ from the development seeds used while tuning the rules." />
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="eval-seeds">Seeds (comma-separated)</Label>
              <Input id="eval-seeds" value={seedsText} onChange={(e) => setSeedsText(e.target.value)} className="tnum" placeholder={EVALUATION_SEEDS.join(", ")} />
              <p className="mt-1 text-[12px] text-muted">
                Default held-out seeds: <span className="tnum">{EVALUATION_SEEDS.join(", ")}</span>. Development seeds are the scenario seeds <span className="tnum">{devSeeds[0]}–{devSeeds[devSeeds.length - 1]}</span>.
              </p>
              {parsed.invalid.length ? <p className="mt-1 text-[12px] text-red">Ignored non-integer entries: {parsed.invalid.join(", ")}</p> : null}
              {overlapsDev.length ? <p className="mt-1 text-[12px] text-amber">Seeds {overlapsDev.join(", ")} are development seeds; results on them are not held-out.</p> : null}
              {!parsed.seeds.length ? <p className="mt-1 text-[12px] text-red">At least one seed is required.</p> : null}
            </div>
            <div>
              <Label htmlFor="eval-detect">Detect at (simulated minutes after start)</Label>
              <Input id="eval-detect" type="number" min={1} step={1} value={detectAtMin} onChange={(e) => setDetectAtMin(e.target.value)} className="tnum w-32" />
              {!detectValid ? <p className="mt-1 text-[12px] text-red">Enter a positive number of minutes.</p> : null}
            </div>
            <Switch id="eval-recovery" checked={recovery} onCheckedChange={setRecovery} label="Include recovery false-accept episodes" />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label className="mb-0">Cases</Label>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setSelected(catalogue.map((s) => s.id))}>
                    All
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                    None
                  </Button>
                </div>
              </div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {catalogue.map((s) => {
                  const cls = CASE_CLASS[s.id];
                  return (
                    <li key={s.id} className="flex items-start gap-2 px-2.5 py-1.5 text-[13px]">
                      <input id={`case-${s.id}`} type="checkbox" className="mt-1" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                      <label htmlFor={`case-${s.id}`} className="min-w-0 flex-1 cursor-pointer">
                        <span className="tnum text-muted">{s.number}.</span> {s.title}
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                          <span className="mono">{s.id}</span>
                          <Badge tone={cls === "NORMAL" ? "green" : cls === "KNOWN" ? "accent" : cls === "COMPOUND" ? "amber" : "grey"}>{CASE_CLASS_LABEL[cls]}</Badge>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {!selected.length ? <p className="mt-1 text-[12px] text-red">Select at least one case.</p> : null}
            </div>
          </CardBody>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader title="How the baseline works" description="A deliberately naive comparison, run on exactly the same episodes." />
            <CardBody className="space-y-1.5 text-[13px]">
              <p>
                <strong>Detection:</strong> any non-INFO alarm counts as a detection.
              </p>
              <p>
                <strong>Grouping:</strong> one incident per alarming asset; the earliest alarm is taken as the cause. A shared-incident case counts as correctly grouped only if this produces at most one incident.
              </p>
              <p>
                <strong>Recovery:</strong> &quot;alarms cleared 60 s after the intervention&quot; counts as recovered (PASS). The engine instead runs the approved recovery plan&apos;s checks under the frozen operating context.
              </p>
              <p className="text-muted">Family matching and abstention are engine-only measures: the baseline has no fault families and never abstains.</p>
            </CardBody>
          </Card>

          {evaluating ? <LoadingState label="Running held-out episodes in the engine worker… this replays each scenario per seed and may take a while." /> : null}

          {!report && !evaluating ? <EmptyState title="Not run" description="No result is claimed before the frozen multi-seed evaluation executes. Configure seeds and cases, then run the evaluation." /> : null}

          {report ? <Report report={report} /> : null}
        </div>
      </div>
    </div>
  );
}

function Report({ report: r }: { report: EvaluationReport }) {
  const s = r.summary;
  const positives = s.engine.truePositives + s.engine.falseNegatives;
  const negatives = s.engine.falsePositives + s.engine.trueNegatives;
  const posB = s.baseline.truePositives + s.baseline.falseNegatives;
  const negB = s.baseline.falsePositives + s.baseline.trueNegatives;
  const usedDevSeeds = r.config.seeds.filter((seed) => SCENARIOS.some((sc) => sc.seed === seed));

  return (
    <>
      <Callout tone="amber" title="Caveats (verbatim from the harness)">
        <ul className="list-disc space-y-0.5 pl-5">
          {r.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        <p className="mt-1.5 text-muted">
          This run used seeds <span className="tnum">{r.config.seeds.join(", ")}</span>
          {usedDevSeeds.length ? <span className="text-amber"> — {usedDevSeeds.join(", ")} are development seeds, so those episodes are not held-out</span> : <span>; none of them is a development seed</span>}. Detection evaluated at <span className="tnum">{Math.round((r.config.detectAtMs ?? 8 * 60_000) / 60_000)}</span> simulated minutes.
        </p>
      </Callout>

      <Card>
        <CardHeader title="Summary" description={`${s.n} detection episodes · ${r.recovery.length} recovery episodes · ran ${r.ranAt}`} />
        <CardBody className="space-y-4">
          <div>
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted">Detection confusion</p>
            <Table>
              <thead>
                <tr>
                  <Th>Measure</Th>
                  <Th>Engine</Th>
                  <Th>Baseline</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>True positives (deviation present, detected)</Td>
                  <Td className="tnum">{ofN(s.engine.truePositives, positives, "positive cases")}</Td>
                  <Td className="tnum">{ofN(s.baseline.truePositives, posB, "positive cases")}</Td>
                </tr>
                <tr>
                  <Td>False negatives (deviation present, missed)</Td>
                  <Td className="tnum">{ofN(s.engine.falseNegatives, positives, "positive cases")}</Td>
                  <Td className="tnum">{ofN(s.baseline.falseNegatives, posB, "positive cases")}</Td>
                </tr>
                <tr>
                  <Td>False positives (normal, flagged)</Td>
                  <Td className="tnum">{ofN(s.engine.falsePositives, negatives, "negative cases")}</Td>
                  <Td className="tnum">{ofN(s.baseline.falsePositives, negB, "negative cases")}</Td>
                </tr>
                <tr>
                  <Td>True negatives (normal, not flagged)</Td>
                  <Td className="tnum">{ofN(s.engine.trueNegatives, negatives, "negative cases")}</Td>
                  <Td className="tnum">{ofN(s.baseline.trueNegatives, negB, "negative cases")}</Td>
                </tr>
              </tbody>
            </Table>
          </div>

          <div>
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted">Explanation quality</p>
            <Table>
              <thead>
                <tr>
                  <Th>Measure</Th>
                  <Th>Engine</Th>
                  <Th>Baseline</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>Top fault family matches the answer key</Td>
                  <Td className="tnum">{ofN(s.engine.familyMatches, s.engine.knownCases, "known cases")}</Td>
                  <Td className="text-muted">not applicable (no families)</Td>
                </tr>
                <tr>
                  <Td>Abstained (UNKNOWN / AMBIGUOUS / SENSOR CHECK) where it should</Td>
                  <Td className="tnum">{ofN(s.engine.abstainedOnUnsupported, s.engine.unsupportedCases, "unsupported/ambiguous/missing-data cases")}</Td>
                  <Td className="text-muted">not applicable (never abstains)</Td>
                </tr>
                <tr>
                  <Td>Shared-cause alarms grouped into one incident</Td>
                  <Td className="tnum">{ofN(s.engine.groupingCorrect, s.engine.groupingCases, "shared-incident cases")}</Td>
                  <Td className="tnum">{ofN(s.baseline.groupingCorrect, s.baseline.groupingCases, "shared-incident cases")}</Td>
                </tr>
              </tbody>
            </Table>
          </div>

          <div>
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted">Recovery acceptance</p>
            {r.config.recovery ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Measure</Th>
                    <Th>Engine</Th>
                    <Th>Baseline</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td>False accepts (misleading intervention judged PASS)</Td>
                    <Td className="tnum">{s.recovery.engineFalseAccepts} out of {s.recovery.negatives} tested negative cases</Td>
                    <Td className="tnum">{s.recovery.baselineFalseAccepts} out of {s.recovery.negatives} tested negative cases</Td>
                  </tr>
                  <tr>
                    <Td>True accepts (correct intervention judged PASS within the wait)</Td>
                    <Td className="tnum">{s.recovery.engineTrueAccepts} out of {s.recovery.positives} tested positive cases</Td>
                    <Td className="tnum">{s.recovery.baselineTrueAccepts} out of {s.recovery.positives} tested positive cases</Td>
                  </tr>
                </tbody>
              </Table>
            ) : (
              <p className="text-[13px] text-muted">Recovery episodes were not included in this run.</p>
            )}
            <p className="mt-1 text-[12px] text-muted">Zero false accepts means 0 out of {s.recovery.negatives} tested negative cases, not zero risk. A correct intervention that stays RUNNING (settling) or INCONCLUSIVE within the wait is not counted as a true accept.</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Detection episodes" description={`${r.episodes.length} episodes (scenario × seed).`} />
        <CardBody>
          {r.episodes.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Scenario</Th>
                  <Th>Seed</Th>
                  <Th>Class</Th>
                  <Th>Expected</Th>
                  <Th>Engine</Th>
                  <Th>Baseline</Th>
                  <Th>Detected</Th>
                  <Th>Family</Th>
                  <Th>State</Th>
                  <Th>Abstained</Th>
                  <Th>Grouping</Th>
                  <Th>Evidence S/P/U</Th>
                </tr>
              </thead>
              <tbody>
                {r.episodes.map((e) => {
                  const shared = SHARED_INCIDENT_SCENARIOS.includes(e.scenarioId);
                  return (
                    <tr key={`${e.scenarioId}-${e.seed}`}>
                      <Td className="mono whitespace-nowrap">{e.scenarioId}</Td>
                      <Td className="tnum">{e.seed}</Td>
                      <Td>
                        <Badge tone="grey">{e.caseClass.replace(/_/g, " ")}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-[12px]">
                        <span className="mono">{e.expectedFamily ?? "no family"}</span>
                        <span className="block text-muted">{e.expectedState}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-[12px]">
                        <span className="mono">{e.engine.topFamily ?? "—"}</span>
                        <span className="block">
                          <StatusBadge value={e.engine.state ?? "NONE"} /> <span className="tnum text-muted">{e.engine.incidents} inc · {e.engine.groupedAssets} assets</span>
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-[12px]">
                        <span className="tnum">{e.baseline.incidents} inc · {e.baseline.alarms} alarms</span>
                        <span className="block text-muted">first: {e.baseline.firstAlarmAsset ?? "—"}</span>
                      </Td>
                      <Td>{e.detected ? "yes" : "no"}</Td>
                      <Td>{e.expectedFamily === null ? <span className="text-muted">n/a</span> : e.familyMatch ? <Badge tone="green">match</Badge> : <Badge tone="red">miss</Badge>}</Td>
                      <Td>{e.stateMatch ? <Badge tone="green">match</Badge> : <Badge tone="amber">differs</Badge>}</Td>
                      <Td>{e.abstained ? "yes" : "no"}</Td>
                      <Td>{shared ? e.groupingCorrect ? <Badge tone="green">grouped</Badge> : <Badge tone="red">split</Badge> : <span className="text-muted">n/a</span>}</Td>
                      <Td className="tnum whitespace-nowrap">
                        {e.evidenceCoverage.supported}/{e.evidenceCoverage.pending}/{e.evidenceCoverage.unavailable}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No detection episodes" description="No selected case had an answer key." />
          )}
          <p className="mt-1 text-[12px] text-muted">Evidence S/P/U = supporting / pending / unavailable evidence items for the engine&apos;s top candidate. Grouping applies to shared-incident scenarios (S01, S04, S10) only.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recovery episodes" description="Each episode applies one intervention after fault onset, runs the approved plan, and waits a fixed simulated interval." />
        <CardBody>
          {r.recovery.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Scenario</Th>
                  <Th>Seed</Th>
                  <Th>Intervention</Th>
                  <Th>Kind</Th>
                  <Th>Engine outcome</Th>
                  <Th>Baseline outcome</Th>
                  <Th>False accept</Th>
                  <Th>True accept</Th>
                </tr>
              </thead>
              <tbody>
                {r.recovery.map((e, i) => (
                  <tr key={`${e.scenarioId}-${e.seed}-${e.intervention}-${i}`}>
                    <Td className="mono whitespace-nowrap">{e.scenarioId}</Td>
                    <Td className="tnum">{e.seed}</Td>
                    <Td>
                      {INTERVENTION_BY_ID[e.intervention]?.title ?? e.intervention}
                      <span className="mono block text-[11px] text-muted">{e.intervention}</span>
                    </Td>
                    <Td>{e.misleading ? <Badge tone="amber">misleading</Badge> : <Badge tone="accent">correct</Badge>}</Td>
                    <Td>
                      <StatusBadge value={e.engineOutcome} />
                    </Td>
                    <Td>
                      <StatusBadge value={e.baselineOutcome} />
                    </Td>
                    <Td className="text-[12px]">
                      {e.misleading ? (
                        <>
                          engine {e.falseAccept.engine ? <Badge tone="red">yes</Badge> : <Badge tone="green">no</Badge>} · baseline {e.falseAccept.baseline ? <Badge tone="red">yes</Badge> : <Badge tone="green">no</Badge>}
                        </>
                      ) : (
                        <span className="text-muted">n/a</span>
                      )}
                    </Td>
                    <Td className="text-[12px]">
                      {!e.misleading ? (
                        <>
                          engine {e.trueAccept.engine ? <Badge tone="green">yes</Badge> : <Badge tone="grey">no</Badge>} · baseline {e.trueAccept.baseline ? <Badge tone="green">yes</Badge> : <Badge tone="grey">no</Badge>}
                        </>
                      ) : (
                        <span className="text-muted">n/a</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No recovery episodes" description={r.config.recovery ? "None of the selected cases has a recovery episode defined." : "Recovery episodes were switched off for this run."} />
          )}
        </CardBody>
      </Card>
    </>
  );
}
