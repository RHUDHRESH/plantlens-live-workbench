"use client";

import Link from "next/link";
import { Cable, MessageSquare, Moon, Play, Search, Sun, Monitor, PlayCircle, Presentation } from "lucide-react";
import { Badge, Button, Kbd, Select, Tip } from "@/components/ui";
import { IDENTITIES, useApp } from "@/store/app";
import { formatIst } from "@/lib/util";
import { Playback } from "./Playback";

export function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const snapshot = useApp((s) => s.snapshot);
  const workspace = useApp((s) => s.workspace);
  const kv = useApp((s) => s.activeKnowledgeVersionId);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const askOpen = useApp((s) => s.askOpen);
  const setAskOpen = useApp((s) => s.setAskOpen);
  const storage = useApp((s) => s.storage);
  const guided = useApp((s) => s.guided);
  const setGuided = useApp((s) => s.setGuided);
  const engineError = useApp((s) => s.engineError);

  const mode = snapshot?.mode ?? workspace.mode;
  const modeBadge =
    mode === "DEMO_SIMULATION" ? (
      <Badge tone="accent" title="Seeded fictional plant generated in this browser. Not factory telemetry.">
        SIMULATION
      </Badge>
    ) : mode === "IMPORTED_REPLAY" ? (
      <Badge tone="amber" title={workspace.importInfo?.fileNames.join(", ")}>
        IMPORTED REPLAY
      </Badge>
    ) : (
      <Badge tone="grey">LIVE: Not configured</Badge>
    );

  return (
    <header className="no-print sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 md:px-4">
        <Link href="/plant" className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold tracking-tight">PlantLens</span>
          <span className="hidden text-[11px] text-muted sm:inline">by VoltMind</span>
        </Link>
        <span className="hidden max-w-[220px] truncate text-[13px] text-muted lg:inline" title={workspace.name}>
          {workspace.name}
        </span>
        {modeBadge}
        <Tip content="Active published knowledge version used by diagnosis and recovery.">
          <Link href="/knowledge/matrix" className="mono text-[12px] text-muted hover:text-text">
            {kv}
          </Link>
        </Tip>
        <div className="flex items-center gap-2">
          <Tip content={snapshot ? `Observation cursor (simulation clock). Live edge ${formatIst(snapshot.clock.liveMs, { date: true })}` : "Engine starting"}>
            <span className="mono text-[13px]">
              {snapshot ? formatIst(snapshot.clock.cursorMs, { date: true }) : "—"}
              <span className="ml-1 text-[11px] text-muted">IST</span>
            </span>
          </Tip>
          {snapshot?.clock.viewingPast ? <Badge tone="amber">viewing past</Badge> : null}
          {snapshot ? <Badge tone={snapshot.clock.running && !snapshot.hiddenTab ? "green" : "grey"}>{snapshot.hiddenTab ? "paused (tab hidden)" : snapshot.clock.running ? "running" : "paused"}</Badge> : null}
        </div>
        <Playback />
        <div className="ml-auto flex items-center gap-1.5">
          {engineError ? <Badge tone="red" title={engineError}>engine error</Badge> : null}
          {storage.readOnly ? <Badge tone="amber">read-only (other tab)</Badge> : null}
          {!storage.available ? <Badge tone="grey" title={storage.reason}>storage unavailable</Badge> : null}
          <Button size="sm" variant="ghost" onClick={onOpenSearch} aria-label="Search (Ctrl+K)">
            <Search size={14} />
            <span className="hidden sm:inline">Search</span>
            <Kbd>Ctrl K</Kbd>
          </Button>
          <Link href="/explain" className="hidden items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2.5 py-1 text-[13px] font-medium text-accent xl:inline-flex">
            <Presentation size={14} /> Judge view
          </Link>
          <Link href="/live" className="hidden items-center gap-1.5 rounded-md border border-green/30 bg-green-soft px-2.5 py-1 text-[13px] font-medium text-green sm:inline-flex">
            <Cable size={14} /> Live hardware
          </Link>
          <Select aria-label="Simulated identity" value={identity} onChange={(e) => setIdentity(e.target.value as typeof identity)} className="hidden h-7 max-w-[190px] text-[12px] lg:block">
            {IDENTITIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="ghost" aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")} title={`Theme: ${theme}`}>
            {theme === "dark" ? <Moon size={14} /> : theme === "light" ? <Sun size={14} /> : <Monitor size={14} />}
          </Button>
          <Button size="sm" aria-label="Ask PlantLens" variant={askOpen ? "primary" : "ghost"} onClick={() => setAskOpen(!askOpen)} aria-pressed={askOpen}>
            <MessageSquare size={14} />
            <span className="hidden sm:inline">Ask PlantLens</span>
          </Button>
          <Button size="sm" aria-label="Run guided demo" variant="primary" onClick={() => setGuided({ active: true, stepIndex: 0, branch: "main", log: [] })} disabled={guided.active}>
            {guided.active ? <Play size={14} /> : <PlayCircle size={14} />}
            <span className="hidden sm:inline">Run guided demo</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
