"use client";

import type { StageReport, StageState } from "@/lib/knowledge/pipeline";
import { Badge, EmptyState, type Tone } from "@/components/ui";
import { cn } from "@/lib/util";

const STAGE_TITLES: Record<StageReport["stage"], string> = {
  SOURCE_PARSER: "Source parser",
  ASSET_TAG_RESOLVER: "Asset & tag resolver",
  DEPENDENCY_PROPOSER: "Dependency proposer",
  CONSISTENCY_REVIEWER: "Consistency reviewer",
  RECOVERY_CHECK_DRAFTER: "Recovery-check drafter",
  HUMAN: "Human",
};

function stageTone(s: StageState): Tone {
  switch (s) {
    case "FAILED":
    case "REJECTED":
      return "red";
    case "NEEDS_MAPPING":
    case "NEEDS_REVIEW":
      return "amber";
    case "PROPOSAL_READY":
    case "APPROVED":
      return "green";
    case "PARSING":
      return "accent";
    default:
      return "grey";
  }
}

/** Honest stepper: every stage shows its recorded state, typed inputs/outputs, and duration. */
export function PipelineStepper({ stages }: { stages: StageReport[] }) {
  if (!stages.length) return <EmptyState title="Pipeline has not run" description="Import files or load the sample factory pack; the local pipeline runs automatically after every import." />;
  return (
    <ol className="space-y-2">
      {stages.map((st, i) => (
        <li key={`${st.stage}-${i}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cn("tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold", st.state === "FAILED" ? "border-red text-red" : "border-border-strong text-text")}>{i + 1}</span>
            {i < stages.length - 1 ? <span className="w-px flex-1 bg-border" aria-hidden /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">{STAGE_TITLES[st.stage]}</span>
              <Badge tone={stageTone(st.state)}>{st.state.replace(/_/g, " ")}</Badge>
              <span className="tnum text-[12px] text-muted">{st.durationMs} ms</span>
            </div>
            <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted">Inputs</dt>
              <dd className="break-words">{st.inputs.length ? st.inputs.join(", ") : "none"}</dd>
              <dt className="text-muted">Outputs</dt>
              <dd className="break-words">{st.outputs.length ? st.outputs.join(" · ") : "none"}</dd>
            </dl>
            {st.messages.length ? (
              <details className="mt-1 text-[12px]">
                <summary className="cursor-pointer text-muted hover:text-text">
                  {st.messages.length} message{st.messages.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-1 space-y-0.5 rounded-md bg-surface-2 px-2.5 py-1.5">
                  {st.messages.map((m, j) => (
                    <li key={j} className="break-words">
                      {m}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
