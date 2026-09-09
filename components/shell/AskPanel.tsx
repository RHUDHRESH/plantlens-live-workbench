"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import { useApp } from "@/store/app";
import { answer, SEED_QUESTIONS, type CopilotAnswer } from "@/lib/ai/copilot";
import { formatIst } from "@/lib/util";

export function AskPanel() {
  const open = useApp((s) => s.askOpen);
  const setOpen = useApp((s) => s.setAskOpen);
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<CopilotAnswer[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement;
      inputRef.current?.focus();
    } else restoreRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const ask = (question: string) => {
    const st = useApp.getState();
    const a = answer(question, {
      snapshot: st.snapshot,
      knowledge: st.activeKnowledge(),
      plans: st.plans,
      workOrders: st.workOrders,
      proposals: st.proposals,
      historicalIncidents: st.historicalIncidents,
      historicalRuns: st.historicalRuns,
    });
    setHistory((h) => [a, ...h].slice(0, 8));
    setQ("");
  };

  const snap = useApp.getState().snapshot;

  return (
    <aside aria-label="Ask PlantLens" className="no-print fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-xl md:sticky md:top-[41px] md:h-[calc(100vh-41px)] md:max-w-sm md:shadow-none">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-semibold">Ask PlantLens</p>
          <p className="text-[11px] text-muted">
            Mode: <Badge tone="grey">Local evidence templates</Badge> — no language model
          </p>
        </div>
        <Button size="sm" variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
          <X size={14} />
        </Button>
      </div>
      <div className="border-b border-border px-3 py-2 text-[11px] text-muted">
        Cutoff {snap ? formatIst(snap.clock.cursorMs) : "—"} · knowledge {useApp.getState().activeKnowledgeVersionId}. Answers use current records only; hidden scenario truth and future outcomes are not readable.
      </div>
      <form
        className="flex gap-1.5 border-b border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q.trim());
        }}
      >
        <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about current records…" aria-label="Question" />
        <Button type="submit" variant="primary" size="md">
          Ask
        </Button>
      </form>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {history.length === 0 ? (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted">Seed questions</p>
            <ul className="flex flex-col gap-1">
              {SEED_QUESTIONS.map((s) => (
                <li key={s}>
                  <button type="button" className="w-full rounded-md border border-border px-2 py-1.5 text-left text-[13px] hover:bg-surface-2" onClick={() => ask(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {history.map((a, i) => (
              <li key={i} className="rounded-md border border-border p-2.5 text-[13px]">
                <p className="mb-1 text-[12px] font-medium text-muted">{a.question}</p>
                <p>{a.conclusion}</p>
                {a.references.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {a.references.map((r, j) => (
                      <Link key={j} href={r.route} className="rounded-sm border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent hover:underline">
                        {r.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
                <p className="mt-1.5 text-[12px] text-muted">
                  <span className="font-medium">Uncertainty:</span> {a.uncertainty}
                </p>
                {a.nextAction ? (
                  <Link href={a.nextAction.route} className="mt-1.5 inline-block text-[12px] text-accent hover:underline">
                    Next: {a.nextAction.label} →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
