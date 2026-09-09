"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useApp } from "@/store/app";
import { search, type SearchHit } from "@/lib/search";
import { Badge } from "@/components/ui";

const KIND_LABEL: Record<SearchHit["kind"], string> = { ASSET: "Asset", TAG: "Tag", DOCUMENT: "Source line", EVIDENCE: "Evidence", INCIDENT: "Incident", EDGE: "Dependency", REQUIREMENT: "Requirement", CHECK: "Check", WORK_ORDER: "Work order", RUN: "Run", PROPOSAL: "Proposal", PAGE: "Page" };

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const restoreRef = useRef<HTMLElement | null>(null);
  const sources = useApp((s) => s.sources);
  const snapshot = useApp((s) => s.snapshot);
  const plans = useApp((s) => s.plans);
  const workOrders = useApp((s) => s.workOrders);
  const proposals = useApp((s) => s.proposals);
  const historicalIncidents = useApp((s) => s.historicalIncidents);
  const activeKnowledge = useApp((s) => s.activeKnowledge);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement;
    } else restoreRef.current?.focus?.();
  }, [open]);

  const hits = useMemo(
    () => search(q, { sources, incidents: [...(snapshot?.incidents ?? []), ...historicalIncidents], knowledge: activeKnowledge(), plans, workOrders, runs: snapshot?.runs ?? [], proposals }),
    [q, sources, snapshot, plans, workOrders, proposals, historicalIncidents, activeKnowledge],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (next) setQ(""); onOpenChange(next); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-xl focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Global search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search assets, tags, documents, evidence, incidents, checks, and work orders.</DialogPrimitive.Description>
          <Command shouldFilter={false} label="Global search">
            <Command.Input value={q} onValueChange={setQ} placeholder="Search assets, tags, documents, evidence, incidents, checks, work orders…" className="h-11 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted" autoFocus />
            <Command.List className="scroll-thin max-h-[60vh] overflow-y-auto p-1">
              {q.trim().length < 2 ? <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">Type at least two characters. Try “coolant”.</Command.Empty> : hits.length === 0 ? <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">No records match “{q}”.</Command.Empty> : null}
              {hits.map((h, i) => (
                <Command.Item
                  key={`${h.kind}-${h.route}-${i}`}
                  value={`${h.kind}-${h.route}-${i}`}
                  onSelect={() => {
                    onOpenChange(false);
                    router.push(h.route);
                  }}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 text-[13px] data-[selected=true]:bg-accent-soft"
                >
                  <Badge tone="grey" className="mt-0.5 shrink-0">
                    {KIND_LABEL[h.kind]}
                  </Badge>
                  <span className="min-w-0">
                    <span className="block truncate">{h.title}</span>
                    {h.subtitle ? <span className="block truncate text-[12px] text-muted">{h.subtitle}</span> : null}
                  </span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
