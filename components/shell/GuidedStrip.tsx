"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, Pause, Play, RotateCcw, X } from "lucide-react";
import { Badge, Button, Dialog, Progress } from "@/components/ui";
import { useApp } from "@/store/app";
import { BRANCHES, type GuidedBranch } from "@/lib/demo/guided";
import { Playback } from "./Playback";

type Phase = "idle" | "running" | "waiting" | "done" | "error";

export function GuidedStrip() {
  const router = useRouter();
  const guided = useApp((s) => s.guided);
  const setGuided = useApp((s) => s.setGuided);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string>("");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [branchMenu, setBranchMenu] = useState(false);
  const stepRef = useRef<string>("");

  const steps = BRANCHES[guided.branch];
  const step = steps[guided.stepIndex];

  // Reset phase when the step changes.
  useEffect(() => {
    if (!guided.active || !step) return;
    if (stepRef.current !== `${guided.branch}:${step.id}`) {
      stepRef.current = `${guided.branch}:${step.id}`;
      setPhase("idle");
      setStatus("");
      setResult("");
      setError("");
      try {
        router.push(step.route(useApp.getState()));
      } catch {
        /* route optional */
      }
    }
  }, [guided.active, guided.branch, guided.stepIndex, step, router]);

  // Poll the waitFor condition against live state.
  useEffect(() => {
    if (!guided.active || !step || phase !== "waiting") return;
    const id = setInterval(() => {
      const st = useApp.getState();
      const w = step.waitFor ? step.waitFor(st) : null;
      if (w === null) {
        setPhase("done");
        setStatus("");
        setResult(step.result ? step.result(st) : "Done.");
      } else setStatus(w);
    }, 500);
    return () => clearInterval(id);
  }, [guided.active, step, phase]);

  if (!guided.active || !step) return null;

  const run = async () => {
    setPhase("running");
    setError("");
    try {
      const st = useApp.getState();
      router.push(step.route(st));
      if (step.action) await step.action(st);
      const after = useApp.getState();
      if (step.waitFor && step.waitFor(after) !== null) {
        setPhase("waiting");
        setStatus(step.waitFor(after) ?? "");
      } else {
        setPhase("done");
        setResult(step.result ? step.result(after) : "Done.");
      }
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const next = () => {
    if (guided.stepIndex + 1 < steps.length) setGuided({ stepIndex: guided.stepIndex + 1, log: [...guided.log, `${step.title}: ${result}`] });
    else setBranchMenu(true);
  };

  const startBranch = (b: GuidedBranch) => {
    setBranchMenu(false);
    setGuided({ branch: b, stepIndex: 0, log: [] });
  };

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface shadow-[0_-4px_16px_rgba(0,0,0,0.08)] md:bottom-0" role="region" aria-label="Guided demonstration">
      <div className="mx-auto max-w-[1600px] px-3 py-2 md:px-5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Badge tone="accent">Guided demo · {guided.branch === "main" ? "main path" : `branch: ${guided.branch}`}</Badge>
          <div className="min-w-[160px] flex-1">
            <Progress value={guided.stepIndex + (phase === "done" ? 1 : 0)} max={steps.length} label={`Step ${guided.stepIndex + 1} of ${steps.length}`} />
          </div>
          <Playback compact />
          <Button size="sm" variant="ghost" onClick={() => setGuided({ presentation: !guided.presentation })} aria-pressed={guided.presentation} title="Presentation mode">
            {guided.presentation ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span className="hidden sm:inline">{guided.presentation ? "Exit presentation" : "Presentation"}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRestart(true)} title="Restart the guided demo">
            <RotateCcw size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setGuided({ active: false, presentation: false })} aria-label="Close guided demo">
            <X size={14} />
          </Button>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{step.title}</p>
            <p className="text-[13px] text-muted">{step.explanation}</p>
            {phase === "waiting" ? (
              <p className="mt-1 flex items-center gap-1.5 text-[13px]" aria-live="polite">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" /> {status}
              </p>
            ) : null}
            {phase === "done" && result ? <p className="mt-1 text-[13px] font-medium">{result}</p> : null}
            {phase === "error" ? <p className="mt-1 text-[13px] text-red">Step failed: {error}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {phase === "idle" || phase === "error" ? (
              <Button variant="primary" onClick={run}>
                <Play size={14} /> {step.action || step.waitFor ? "Run this step" : "Continue"}
              </Button>
            ) : null}
            {phase === "waiting" ? (
              <Button variant="secondary" onClick={() => useApp.getState().pause()}>
                <Pause size={14} /> Pause simulation
              </Button>
            ) : null}
            {phase === "done" ? (
              <Button variant="primary" onClick={next}>
                {guided.stepIndex + 1 < steps.length ? "Continue" : "Finish / branches"}
              </Button>
            ) : null}
            {phase === "idle" && !step.action && !step.waitFor ? (
              <Button variant="ghost" onClick={next}>
                Skip
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart} title="Restart the guided demo?" description="This resets the demo workspace to scenario 1 and clears review decisions, work orders, and runs made in this browser.">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmRestart(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirmRestart(false);
              await useApp.getState().resetWorkspace();
              setGuided({ branch: "main", stepIndex: 0, log: [] });
              stepRef.current = "";
            }}
          >
            Restart
          </Button>
        </div>
      </Dialog>
      <Dialog open={branchMenu} onOpenChange={setBranchMenu} title="Main path complete" description="Optional branches each start a fresh workspace on another seeded scenario and run the same real workflow.">
        <ul className="flex flex-col gap-2">
          <li>
            <Button className="w-full justify-start" onClick={() => startBranch("speed")}>
              Speed reduction — NOT_COMPARABLE, not PASS
            </Button>
          </li>
          <li>
            <Button className="w-full justify-start" onClick={() => startBranch("missing")}>
              Missing evidence — INCONCLUSIVE until channels return
            </Button>
          </li>
          <li>
            <Button className="w-full justify-start" onClick={() => startBranch("partial")}>
              Incomplete repair — FAIL despite improved temperature
            </Button>
          </li>
          <li>
            <Button variant="ghost" className="w-full justify-start" onClick={() => setGuided({ active: false, presentation: false })}>
              Finish
            </Button>
          </li>
        </ul>
      </Dialog>
    </div>
  );
}
