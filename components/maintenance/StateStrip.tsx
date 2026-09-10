"use client";

import { ArrowRight } from "lucide-react";
import type { WorkOrderState } from "@/lib/domain/types";
import { canTransition } from "@/lib/workflow";
import { cn } from "@/lib/util";
import { Badge, Tip } from "@/components/ui";
import { WO_BRANCHES, WO_MAIN_PATH, WO_STATE_HINT } from "./helpers";

function Chip({ state, current, reachable }: { state: WorkOrderState; current: boolean; reachable: boolean }) {
  return (
    <Tip content={WO_STATE_HINT[state]}>
      <span
        aria-current={current ? "step" : undefined}
        className={cn(
          "inline-flex items-center rounded-md border px-2 py-1 text-[12px] font-medium whitespace-nowrap",
          current ? "border-accent bg-accent-soft text-accent" : reachable ? "border-border-strong bg-surface text-text" : "border-border bg-surface-2 text-muted",
        )}
      >
        {state.replace(/_/g, " ")}
      </span>
    </Tip>
  );
}

/** Visual state machine for a work order: the main path, then the two branch states. */
export function StateStrip({ state }: { state: WorkOrderState }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {WO_MAIN_PATH.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            {i > 0 ? <ArrowRight size={12} className="text-muted" aria-hidden /> : null}
            <Chip state={s} current={s === state} reachable={canTransition(state, s)} />
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
        <Badge tone="grey">branches</Badge>
        {WO_BRANCHES.map((s) => (
          <Chip key={s} state={s} current={s === state} reachable={canTransition(state, s)} />
        ))}
        <span>Highlighted chip is the current state; outlined chips are the transitions allowed from it.</span>
      </div>
    </div>
  );
}
