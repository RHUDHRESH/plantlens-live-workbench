"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Alarm } from "@/lib/domain/types";
import { TAG_BY_ID } from "@/lib/domain/plant";
import { formatIst } from "@/lib/util";
import { formatUncertainty } from "@/components/incidents/helpers";
import { LABEL_WIDTH, PLOT_LEFT, PLOT_RIGHT, xScale, type TimeMarker } from "./geometry";

/**
 * Event strip: rising edges per boolean tag plus an alarm lane, drawn in one SVG that shares
 * the numeric lanes' x domain. The plot width comes from a ResizeObserver so the strip stays
 * aligned with the Recharts lanes above it. Each tick carries its own uncertainty; when the
 * source's uncertainty exceeds 500 ms a bar shows the interval so ordering claims stay honest.
 */

export interface EventTick {
  ms: number;
  uncertaintyMs: number;
  cycleId?: string;
  clockSourceId?: string;
  rawMs?: number;
}

export interface EventLane {
  tagId: string;
  ticks: EventTick[];
}

const LANE_H = 28;
const ALARM_H = 32;
const AXIS_H = 18;
const UNCERTAINTY_BAR_MS = 500;

type Hover = { x: number; y: number; lines: string[] } | null;

function laneClock(lane: EventLane): string {
  const sources = new Set(lane.ticks.map((t) => t.clockSourceId).filter((s): s is string => !!s));
  if (sources.size === 0) return "clock: not stated";
  return `clock: ${Array.from(sources).join(", ")}`;
}

function severityColor(s: Alarm["severity"]): string {
  return s === "FAULT" ? "var(--red)" : s === "WARNING" ? "var(--amber)" : "var(--grey)";
}

export function EventLanes({ lanes, alarms, domain, markers, cursorMs }: { lanes: EventLane[]; alarms: Alarm[]; domain: [number, number]; markers: TimeMarker[]; cursorMs: number }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(600);
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setPlotWidth(w);
    });
    ro.observe(el);
    setPlotWidth(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => xScale(domain, plotWidth), [domain, plotWidth]);
  const height = lanes.length * LANE_H + ALARM_H + AXIS_H;
  const inView = (ms: number) => ms >= domain[0] && ms <= domain[1];

  const ticks = useMemo(() => {
    const span = domain[1] - domain[0];
    const step = span > 10 * 60_000 ? 180_000 : span > 5 * 60_000 ? 120_000 : 60_000;
    const first = Math.ceil(domain[0] / step) * step;
    const out: number[] = [];
    for (let t = first; t <= domain[1]; t += step) out.push(t);
    return out;
  }, [domain]);

  const visibleAlarms = alarms.filter((a) => inView(a.raisedAt.ms) || (a.clearedAt ? a.clearedAt.ms >= domain[0] && a.raisedAt.ms <= domain[1] : a.raisedAt.ms <= domain[1]));

  return (
    <div className="relative">
      <div className="grid" style={{ gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
        <div className="border-r border-border text-[11px]">
          {lanes.map((l) => {
            const def = TAG_BY_ID[l.tagId];
            return (
              <div key={l.tagId} className="flex flex-col justify-center border-b border-border px-2" style={{ height: LANE_H }}>
                <span className="mono truncate" title={l.tagId}>
                  {def ? `${def.assetId}.${def.name}` : l.tagId}
                </span>
                <span className="truncate text-muted">{laneClock(l)}</span>
              </div>
            );
          })}
          <div className="flex flex-col justify-center border-b border-border px-2" style={{ height: ALARM_H }}>
            <span className="font-medium">Alarms</span>
            <span className="text-muted">FAULT / WARNING / INFO</span>
          </div>
          <div style={{ height: AXIS_H }} />
        </div>
        <div ref={plotRef} className="min-w-0">
          <svg width="100%" height={height} viewBox={`0 0 ${plotWidth} ${height}`} preserveAspectRatio="none" role="img" aria-label="Event lanes aligned to the trend time axis" style={{ display: "block" }}>
            {/* lane backgrounds */}
            {lanes.map((l, i) => (
              <line key={`bg-${l.tagId}`} x1={PLOT_LEFT} x2={plotWidth - PLOT_RIGHT} y1={(i + 1) * LANE_H} y2={(i + 1) * LANE_H} stroke="var(--border)" />
            ))}
            <line x1={PLOT_LEFT} x2={plotWidth - PLOT_RIGHT} y1={lanes.length * LANE_H + ALARM_H} y2={lanes.length * LANE_H + ALARM_H} stroke="var(--border)" />
            {/* markers */}
            {markers
              .filter((m) => inView(m.ms))
              .map((m) => (
                <line key={`${m.kind}-${m.ms}-${m.label}`} x1={scale(m.ms)} x2={scale(m.ms)} y1={0} y2={lanes.length * LANE_H + ALARM_H} stroke={m.kind === "deviation" ? "var(--red)" : "var(--amber)"} strokeDasharray={m.kind === "deviation" ? undefined : "3 3"}>
                  <title>{m.label}</title>
                </line>
              ))}
            {/* event ticks */}
            {lanes.map((l, i) => {
              const yMid = i * LANE_H + LANE_H / 2;
              return l.ticks
                .filter((t) => inView(t.ms))
                .map((t) => {
                  const x = scale(t.ms);
                  const lines = [formatIst(t.ms, { seconds: true, millis: true }), `cycle: ${t.cycleId ?? "not stated"}`, `clock source: ${t.clockSourceId ?? "not stated"}`, formatUncertainty(t.uncertaintyMs)];
                  const show = () => setHover({ x, y: yMid, lines });
                  return (
                    <g key={`${l.tagId}-${t.ms}`} tabIndex={0} onMouseEnter={show} onFocus={show} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)} style={{ outline: "none" }}>
                      <title>{lines.join(" · ")}</title>
                      {t.uncertaintyMs > UNCERTAINTY_BAR_MS ? <rect x={scale(t.ms - t.uncertaintyMs)} y={yMid - 4} width={Math.max(1, scale(t.ms + t.uncertaintyMs) - scale(t.ms - t.uncertaintyMs))} height={8} fill="var(--amber)" opacity={0.35} /> : null}
                      <line x1={x} x2={x} y1={yMid - 8} y2={yMid + 8} stroke="var(--accent)" strokeWidth={2} />
                      <rect x={x - 4} y={yMid - 10} width={8} height={20} fill="transparent" />
                    </g>
                  );
                });
            })}
            {/* alarm lane */}
            {visibleAlarms.map((a) => {
              const y0 = lanes.length * LANE_H;
              const x1 = scale(Math.max(a.raisedAt.ms, domain[0]));
              const x2 = scale(Math.min(a.clearedAt?.ms ?? domain[1], domain[1]));
              const lines = [`${a.severity}: ${a.message}`, `${a.assetId}${a.tagId ? ` · ${a.tagId}` : ""}`, `raised ${formatIst(a.raisedAt.ms, { seconds: true })}${a.clearedAt ? `, cleared ${formatIst(a.clearedAt.ms, { seconds: true })}` : ", active"}`];
              const show = () => setHover({ x: x1, y: y0 + ALARM_H / 2, lines });
              return (
                <g key={a.id} tabIndex={0} onMouseEnter={show} onFocus={show} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)} style={{ outline: "none" }}>
                  <title>{lines.join(" · ")}</title>
                  <rect x={x1} y={y0 + ALARM_H / 2 - 5} width={Math.max(2, x2 - x1)} height={10} fill={severityColor(a.severity)} opacity={0.35} />
                  <polygon points={`${x1 - 5},${y0 + ALARM_H / 2 + 5} ${x1 + 5},${y0 + ALARM_H / 2 + 5} ${x1},${y0 + ALARM_H / 2 - 5}`} fill={severityColor(a.severity)} />
                </g>
              );
            })}
            {/* cursor */}
            {inView(cursorMs) ? <line x1={scale(cursorMs)} x2={scale(cursorMs)} y1={0} y2={lanes.length * LANE_H + ALARM_H} stroke="var(--text)" /> : null}
            {/* axis */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={scale(t)} x2={scale(t)} y1={lanes.length * LANE_H + ALARM_H} y2={lanes.length * LANE_H + ALARM_H + 4} stroke="var(--border-strong)" />
                <text x={scale(t)} y={height - 3} fontSize={10} textAnchor="middle" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                  {formatIst(t, { seconds: true })}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
      {hover ? (
        <div role="tooltip" className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface px-2 py-1 text-[11px] shadow-md" style={{ left: Math.min(LABEL_WIDTH + hover.x + 8, LABEL_WIDTH + plotWidth - 200), top: hover.y + 12 }}>
          {hover.lines.map((l, i) => (
            <div key={i} className={i === 0 ? "mono" : ""}>
              {l}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
