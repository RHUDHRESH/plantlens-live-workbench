"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Diagnosis, Incident } from "@/lib/domain/types";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import type { SeriesPoint } from "@/lib/simulation/observation";
import { TAG_BY_ID } from "@/lib/domain/plant";
import { useApp } from "@/store/app";
import { formatIst } from "@/lib/util";
import { Badge, Button, Callout, Card, CardBody, CardHeader, LoadingState } from "@/components/ui";
import { TrendLane } from "@/components/timeline/TrendLane";
import { EventLanes, type EventLane, type EventTick } from "@/components/timeline/EventLanes";
import type { TimeMarker } from "@/components/timeline/geometry";
import { formatUncertainty } from "./helpers";

/**
 * Timeline tab: numeric lanes and event lanes on one time axis. Data is re-queried from the
 * engine at most every 2 s while the clock runs, and once per cursor move while paused.
 */

const CONTEXT_TAGS = ["AIR-HDR-01.header_pressure", "FIX-01.clamp_delay_s", "CNC-02.clamp_delay_s", "PUMP-01.coolant_flow", "SPN-01.bearing_temp", "SPN-01.motor_current", "SPN-01.vibration_rms", "FDR-01.supply_voltage"];
const EVENT_TAGS = ["CNC-01.part_present", "ROB-01.robot_clear", "FIX-01.clamp_cmd", "FIX-01.clamp_proof", "CNC-01.cycle_ready", "CNC-01.cycle_complete", "ROB-01.move_complete", "ROB-01.unload_complete", "ASM-01.downstream_accept", "CNC-02.clamp_proof", "CNC-02.cycle_complete"];
const CELL_A_HANDSHAKE = EVENT_TAGS.filter((t) => !t.startsWith("CNC-02."));
const RANGES = [5, 10, 15] as const;
const LEAD_MS = 120_000;
const REFRESH_MS = 2000;
const MAX_POINTS = 400;
const MAX_EVIDENCE_LANES = 6;

type EventsResult = Record<string, EventTick[]>;

export function TimelineTab({ inc, d, snapshot }: { inc: Incident; d: Diagnosis | undefined; snapshot: RuntimeSnapshot }) {
  const series = useApp((s) => s.series);
  const events = useApp((s) => s.events);
  const [rangeMin, setRangeMin] = useState<(typeof RANGES)[number]>(15);
  const [data, setData] = useState<{ series: Record<string, SeriesPoint[]>; events: EventsResult; at: number } | null>(null);

  const involvedAssets = useMemo(() => new Set([...inc.observedAssetIds, ...inc.potentiallyAffectedAssetIds, ...(inc.sharedCauseAssetId ? [inc.sharedCauseAssetId] : [])]), [inc]);

  const numericTags = useMemo(() => {
    const out: string[] = [];
    for (const e of d?.evidence ?? []) {
      if (TAG_BY_ID[e.tagId]?.valueType === "NUMERIC" && !out.includes(e.tagId)) out.push(e.tagId);
      if (out.length >= MAX_EVIDENCE_LANES) break;
    }
    for (const t of CONTEXT_TAGS) {
      const asset = TAG_BY_ID[t]?.assetId;
      if (asset && involvedAssets.has(asset) && !out.includes(t)) out.push(t);
    }
    return out;
  }, [d, involvedAssets]);

  const eventTags = useMemo(() => {
    const set = new Set<string>();
    if (inc.affectedCellIds.includes("CELL-A")) for (const t of CELL_A_HANDSHAKE) set.add(t);
    for (const t of EVENT_TAGS) {
      const asset = TAG_BY_ID[t]?.assetId;
      if (asset && involvedAssets.has(asset)) set.add(t);
    }
    return EVENT_TAGS.filter((t) => set.has(t));
  }, [inc.affectedCellIds, involvedAssets]);

  const cursorMs = snapshot.clock.cursorMs;
  const running = snapshot.clock.running;
  const anchorMs = d?.firstReliableDeviation?.ms ?? inc.openedAt.ms;
  const domain = useMemo<[number, number]>(() => {
    const to = cursorMs;
    const from = Math.max(anchorMs - LEAD_MS, to - rangeMin * 60_000);
    return [Math.min(from, to - 1000), to];
  }, [anchorMs, cursorMs, rangeMin]);

  const domainRef = useRef(domain);
  useEffect(() => {
    domainRef.current = domain;
  }, [domain]);
  const numericKey = numericTags.join("|");
  const eventKey = eventTags.join("|");
  // While paused, a cursor move triggers one re-query; while running, the interval handles it.
  const pausedCursor = running ? 0 : cursorMs;

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const [from, to] = domainRef.current;
      const nTags = numericKey ? numericKey.split("|") : [];
      const eTags = eventKey ? eventKey.split("|") : [];
      try {
        const [s, ev] = await Promise.all([nTags.length ? series(nTags, from, to, MAX_POINTS) : Promise.resolve({}), eTags.length ? events(eTags, from, to) : Promise.resolve({})]);
        if (!cancelled) setData({ series: s, events: ev, at: to });
      } finally {
        inFlight = false;
      }
    };
    void load();
    if (!running) {
      return () => {
        cancelled = true;
      };
    }
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [series, events, numericKey, eventKey, running, rangeMin, pausedCursor]);

  const markers = useMemo<TimeMarker[]>(() => {
    const out: TimeMarker[] = [];
    if (d?.firstReliableDeviation) out.push({ ms: d.firstReliableDeviation.ms, label: `First reliable deviation ${formatUncertainty(d.firstReliableDeviation.uncertaintyMs)}`, kind: "deviation" });
    for (const e of d?.evidence ?? []) if (e.onsetMs !== undefined && e.id !== d?.firstReliableDeviation?.evidenceId) out.push({ ms: e.onsetMs, label: `Onset: ${e.title} ${formatUncertainty(e.onsetUncertaintyMs)}`, kind: "onset" });
    return out;
  }, [d]);

  const alarms = useMemo(() => snapshot.alarms.filter((a) => a.incidentId === inc.id || inc.alarmIds.includes(a.id)), [snapshot.alarms, inc.id, inc.alarmIds]);
  const lanes = useMemo<EventLane[]>(() => eventTags.map((t) => ({ tagId: t, ticks: data?.events[t] ?? [] })), [eventTags, data]);
  const evidenceTagSet = useMemo(() => new Set((d?.evidence ?? []).map((e) => e.tagId)), [d]);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title="Synchronized timeline"
          description="Numeric lanes and event lanes share one time axis. Gaps are MISSING samples; amber dots are SUSPECT; wide bars are the source's own uncertainty."
          actions={
            <div className="flex items-center gap-1" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <Button key={r} size="sm" variant={rangeMin === r ? "primary" : "outline"} aria-pressed={rangeMin === r} onClick={() => setRangeMin(r)}>
                  {r} min
                </Button>
              ))}
            </div>
          }
        />
        <CardBody className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
            <span className="text-muted">Cursor</span>
            <span className="mono">{formatIst(cursorMs, { date: true, seconds: true })}</span>
            {snapshot.clock.viewingPast ? <Badge tone="amber">viewing past</Badge> : <Badge tone={running ? "accent" : "grey"}>{running ? "running" : "paused"}</Badge>}
            <span className="text-muted">Window</span>
            <span className="mono">
              {formatIst(domain[0], { seconds: true })} – {formatIst(domain[1], { seconds: true })}
            </span>
            {data ? (
              <span className="text-muted">
                queried at <span className="mono">{formatIst(data.at, { seconds: true })}</span>
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-2 text-muted">
              <span className="inline-block h-3 w-0.5 bg-red" /> first reliable deviation
              <span className="inline-block h-3 w-0.5 border-l border-dashed border-amber" /> evidence onset
              <span className="inline-block h-3 w-px bg-text" /> cursor
            </span>
          </div>
          {!data ? <LoadingState label="Querying the observation store…" /> : null}
          {numericTags.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted">No numeric channels are referenced by this diagnosis or its context.</p> : null}
          {numericTags.map((t) => (
            <TrendLane key={t} tagId={t} points={data?.series[t] ?? []} domain={domain} markers={markers} cursorMs={cursorMs} highlighted={evidenceTagSet.has(t)} />
          ))}
          <div className="border-t border-border bg-surface-2/40">
            <EventLanes lanes={lanes} alarms={alarms} domain={domain} markers={markers} cursorMs={cursorMs} />
          </div>
        </CardBody>
      </Card>
      {snapshot.mode === "IMPORTED_REPLAY" ? <Callout tone="grey">IMPORTED REPLAY: observations come from the imported file and are never modified by annotations or maintenance records.</Callout> : null}
    </div>
  );
}
