"use client";

import { useMemo } from "react";
import { ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { SeriesPoint } from "@/lib/simulation/observation";
import { TAG_BY_ID } from "@/lib/domain/plant";
import { formatIst, fmt } from "@/lib/util";
import { Badge } from "@/components/ui";
import { LABEL_WIDTH, LANE_HEIGHT, PLOT_LEFT, PLOT_RIGHT, type TimeMarker } from "./geometry";

/**
 * One numeric lane. MISSING samples are rendered as gaps (null values, no connecting line);
 * SUSPECT samples are drawn as separate amber dots so a doubtful value is never mistaken
 * for a good one. The x domain is shared with sibling lanes and the event strip.
 */

interface Row {
  ms: number;
  v: number | null;
  suspect: number | null;
  q: SeriesPoint["q"];
}

interface TooltipPayload {
  payload?: Row;
}

function LaneTooltip({ active, payload, unit }: { active?: boolean; payload?: TooltipPayload[]; unit?: string }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] shadow-md">
      <div className="mono">{formatIst(row.ms, { seconds: true })}</div>
      <div className="tnum">
        {row.v === null && row.suspect === null ? "MISSING (gap)" : `${fmt(row.v ?? row.suspect, 2)}${unit ? ` ${unit}` : ""}`} · {row.q}
      </div>
    </div>
  );
}

export function TrendLane({ tagId, points, domain, markers, cursorMs, highlighted }: { tagId: string; points: SeriesPoint[]; domain: [number, number]; markers: TimeMarker[]; cursorMs: number; highlighted?: boolean }) {
  const def = TAG_BY_ID[tagId];
  const rows = useMemo<Row[]>(
    () =>
      points.map((p) => ({
        ms: p.ms,
        v: p.q === "MISSING" || p.q === "INVALID" || p.q === "NOT_INSTRUMENTED" ? null : p.q === "SUSPECT" ? null : p.v,
        suspect: p.q === "SUSPECT" ? p.v : null,
        q: p.q,
      })),
    [points],
  );
  const stats = useMemo(() => {
    const total = points.length;
    const missing = points.filter((p) => p.q === "MISSING" || p.q === "INVALID" || p.q === "NOT_INSTRUMENTED").length;
    const suspect = points.filter((p) => p.q === "SUSPECT").length;
    const stale = points.filter((p) => p.q === "STALE").length;
    return { total, missing, suspect, stale };
  }, [points]);

  return (
    <div className={highlighted ? "grid border-b border-border bg-accent-soft/30" : "grid border-b border-border"} style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr`, height: LANE_HEIGHT }}>
      <div className="min-w-0 border-r border-border px-2 py-1.5 text-[12px]">
        <div className="mono truncate" title={tagId}>
          {def ? def.assetId : tagId.split(".")[0]}
        </div>
        <div className="truncate text-muted" title={def?.description}>
          {def?.name ?? tagId}
          {def?.unit ? <span className="tnum"> ({def.unit})</span> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {stats.total === 0 ? <Badge tone="grey">no samples</Badge> : null}
          {stats.missing ? <Badge tone="grey">{stats.missing} missing</Badge> : null}
          {stats.suspect ? <Badge tone="amber">{stats.suspect} suspect</Badge> : null}
          {stats.stale ? <Badge tone="amber">{stats.stale} stale</Badge> : null}
        </div>
      </div>
      <div className="min-w-0">
        <ResponsiveContainer width="100%" height={LANE_HEIGHT}>
          <ComposedChart data={rows} margin={{ top: 8, right: PLOT_RIGHT, bottom: 4, left: 0 }}>
            <XAxis type="number" dataKey="ms" domain={domain} allowDataOverflow tickFormatter={(v: number) => formatIst(v, { seconds: true })} tick={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }} stroke="var(--border-strong)" tickCount={6} />
            <YAxis width={PLOT_LEFT} tick={{ fontSize: 10 }} stroke="var(--border-strong)" domain={["auto", "auto"]} tickFormatter={(v: number) => fmt(v, 1)} />
            <Tooltip content={<LaneTooltip unit={def?.unit} />} isAnimationActive={false} />
            <Line type="linear" dataKey="v" stroke="var(--accent)" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
            <Scatter dataKey="suspect" fill="var(--amber)" shape="circle" isAnimationActive={false} />
            {markers.map((m) => (
              <ReferenceLine key={`${m.kind}-${m.ms}-${m.label}`} x={m.ms} stroke={m.kind === "deviation" ? "var(--red)" : "var(--amber)"} strokeDasharray={m.kind === "deviation" ? undefined : "3 3"} ifOverflow="hidden" />
            ))}
            <ReferenceLine x={cursorMs} stroke="var(--text)" strokeWidth={1} ifOverflow="hidden" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
