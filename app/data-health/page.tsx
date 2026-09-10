"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, KeyValue, LoadingState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/store/app";
import { ASSET_BY_ID, TAGS } from "@/lib/domain/plant";
import type { EvidenceQuality, TagDefinition } from "@/lib/domain/types";
import { LIVE_ADAPTER_STATUS } from "@/lib/ai/adapter";
import type { SeriesPoint } from "@/lib/simulation/observation";
import { formatValue } from "@/lib/simulation/runtime";
import { formatDuration, formatIst } from "@/lib/util";

const ALL_TAG_IDS = TAGS.map((t) => t.id);
const QUALITIES: EvidenceQuality[] = ["GOOD", "STALE", "SUSPECT", "MISSING", "INVALID", "NOT_INSTRUMENTED"];
const WINDOW_MS = 60_000;
const ROBOT_EVENT_TAG = "ROB-01.robot_clear";
const REFRESH_MS = 3000;

type Latest = Record<string, SeriesPoint | undefined>;

function valueText(tag: TagDefinition, p: SeriesPoint | undefined, headline: string | undefined): string {
  if (!p) return "—";
  if (tag.valueType === "BOOLEAN") return p.v === null ? "—" : p.v ? "TRUE" : "FALSE";
  if (tag.valueType === "ENUM" || tag.valueType === "TEXT") return headline ?? (p.v === null ? "(non-numeric; see asset page)" : formatValue(p.v));
  return p.v === null ? "null" : formatValue(p.v);
}

export default function DataHealthPage() {
  const snapshot = useApp((s) => s.snapshot);
  const storage = useApp((s) => s.storage);
  const workspace = useApp((s) => s.workspace);
  const series = useApp((s) => s.series);
  const events = useApp((s) => s.events);

  const [latest, setLatest] = useState<Latest>({});
  const [sampledAt, setSampledAt] = useState<number | null>(null);
  const [robotUncertainty, setRobotUncertainty] = useState<number | "unknown" | null>(null);

  const started = snapshot !== null;
  const running = snapshot?.clock.running ?? false;
  const cursorMs = snapshot?.clock.cursorMs ?? 0;
  // While running, refresh on an interval; while paused, refresh when the cursor moves (seek).
  const cursorKey = running ? 0 : cursorMs;

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const refresh = async () => {
      const cur = useApp.getState().snapshot?.clock.cursorMs;
      if (cur === undefined) return;
      const [s, ev] = await Promise.all([series(ALL_TAG_IDS, cur - WINDOW_MS, cur, 5), events([ROBOT_EVENT_TAG], cur - 600_000, cur)]);
      if (cancelled) return;
      const next: Latest = {};
      for (const id of ALL_TAG_IDS) {
        const pts = s[id];
        next[id] = pts && pts.length ? pts[pts.length - 1] : undefined;
      }
      setLatest(next);
      setSampledAt(cur);
      const edges = ev[ROBOT_EVENT_TAG] ?? [];
      setRobotUncertainty(edges.length ? edges[edges.length - 1].uncertaintyMs : "unknown");
    };
    void refresh();
    if (!running) return () => void (cancelled = true);
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [started, running, cursorKey, series, events]);

  const qualityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of QUALITIES) counts[q] = 0;
    let none = 0;
    for (const id of ALL_TAG_IDS) {
      const p = latest[id];
      if (!p) none += 1;
      else counts[p.q] = (counts[p.q] ?? 0) + 1;
    }
    return { counts, none };
  }, [latest]);

  if (!snapshot) return <LoadingState label="Starting the simulation engine…" />;

  const refMs = sampledAt ?? cursorMs;
  const headlineFor = (tag: TagDefinition) => snapshot.assets[tag.assetId]?.headline.find((h) => h.tag === tag.name || h.tag === tag.id)?.value;

  return (
    <div>
      <PageHeader
        title="Data health"
        description="Evidence quality states are explicit. Missing numeric data stays null (never zero) and is unavailable, not healthy."
        badges={
          <>
            <Badge tone={snapshot.mode === "DEMO_SIMULATION" ? "accent" : "amber"}>{snapshot.mode === "DEMO_SIMULATION" ? "SIMULATION" : snapshot.mode === "IMPORTED_REPLAY" ? "IMPORTED REPLAY" : "LIVE: Not configured"}</Badge>
            <Badge tone="grey">LIVE: Not configured</Badge>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title="Latest point per quality" description={`Last point per tag in the ${WINDOW_MS / 1000} s before the cursor (${formatIst(refMs, { seconds: true })}).`} />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Quality</Th>
                  <Th className="text-right">Tags</Th>
                </tr>
              </thead>
              <tbody>
                {QUALITIES.map((q) => (
                  <tr key={q}>
                    <Td>
                      <StatusBadge value={q} />
                    </Td>
                    <Td className="tnum text-right">{qualityCounts.counts[q] ?? 0} of {ALL_TAG_IDS.length}</Td>
                  </tr>
                ))}
                <tr>
                  <Td>
                    <Badge tone="grey">no point in window</Badge>
                  </Td>
                  <Td className="tnum text-right">{qualityCounts.none} of {ALL_TAG_IDS.length}</Td>
                </tr>
              </tbody>
            </Table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Engine statistics" />
          <CardBody>
            <KeyValue
              items={[
                { k: "Mode", v: snapshot.mode.replace(/_/g, " ") },
                { k: "Observations retained", v: <span className="tnum">{snapshot.stats.observations}</span> },
                { k: "Tags observed", v: <span className="tnum">{snapshot.stats.tags} ({ALL_TAG_IDS.length} registered)</span> },
                { k: "Earliest", v: <span className="tnum">{Number.isFinite(snapshot.stats.earliestMs) ? formatIst(snapshot.stats.earliestMs, { date: true }) : "—"}</span> },
                { k: "Latest", v: <span className="tnum">{Number.isFinite(snapshot.stats.latestMs) ? formatIst(snapshot.stats.latestMs, { date: true }) : "—"}</span> },
                { k: "Diagnosis runs", v: <span className="tnum">{snapshot.stats.diagnosisRuns}</span> },
                { k: "Checkpoints", v: <span className="tnum">{snapshot.checkpoints.length}</span> },
                { k: "Knowledge version", v: <span className="mono">{snapshot.knowledgeVersionId}</span> },
                { k: "Clock", v: <span className="tnum">{snapshot.clock.running ? `running ×${snapshot.clock.speed}` : "paused"} · step {snapshot.clock.stepMs} ms{snapshot.clock.viewingPast ? " · viewing past" : ""}</span> },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Storage" description="Stored in this browser — not cloud-synced; not a backup; not tamper-proof." />
          <CardBody>
            <KeyValue
              items={[
                { k: "Available", v: storage.available ? <Badge tone="green">yes (IndexedDB)</Badge> : <Badge tone="red">no</Badge> },
                ...(storage.reason ? [{ k: "Reason", v: storage.reason }] : []),
                { k: "Writer", v: storage.readOnly ? <Badge tone="amber">read-only tab (another tab owns the workspace)</Badge> : <Badge tone="accent">this tab</Badge> },
                { k: "Saving", v: storage.saving ? "in progress" : "idle" },
                { k: "Last saved", v: storage.lastSavedAt ? new Date(storage.lastSavedAt).toLocaleTimeString() : "not yet" },
                ...(storage.error ? [{ k: "Last error", v: <span className="text-red">{storage.error}</span> }] : []),
                { k: "Workspace", v: <span className="mono">{workspace.id}</span> },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Clock contracts" description="Timestamps from different clocks are never mixed silently." />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Clock source</Th>
                  <Th>Used by</Th>
                  <Th>Uncertainty</Th>
                  <Th>Basis</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="mono">PLC-MAIN</Td>
                  <Td className="text-[12px]">Sequence controller, utilities, cell instrumentation</Td>
                  <Td>
                    <Badge tone="green">exact (0 ms claimed)</Badge>
                  </Td>
                  <Td className="text-[12px]">Simulation clock; the source claims exactness.</Td>
                </tr>
                <tr>
                  <Td className="mono">ROBOT-CTRL</Td>
                  <Td className="text-[12px]">ROB-01 events (robot_clear, move_complete)</Td>
                  <Td>
                    {robotUncertainty === null ? <Badge tone="grey">loading…</Badge> : robotUncertainty === "unknown" ? <Badge tone="grey">unknown</Badge> : robotUncertainty === 0 ? <Badge tone="green">exact (0 ms claimed)</Badge> : <Badge tone={robotUncertainty > 1000 ? "amber" : "neutral"}>±{robotUncertainty >= 1000 ? `${robotUncertainty / 1000} s` : `${robotUncertainty} ms`}</Badge>}
                  </Td>
                  <Td className="text-[12px]">Derived from the latest <span className="mono">{ROBOT_EVENT_TAG}</span> rising edge in the last 10 min; &quot;unknown&quot; when none was observed.</Td>
                </tr>
                {snapshot.mode === "IMPORTED_REPLAY" ? (
                  <tr>
                    <Td className="mono">IMPORT</Td>
                    <Td className="text-[12px]">Imported trace rows</Td>
                    <Td>
                      <Badge tone="grey">as stated in file</Badge>
                    </Td>
                    <Td className="text-[12px]">Time-zone assumption: {snapshot.importInfo?.timeZoneAssumption ?? "—"}.</Td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Knowledge gaps" description="Contexts without an approved baseline. A missing baseline is a gap, not a pass." />
          <CardBody>
            {snapshot.missingBaselines.length ? (
              <ul className="space-y-1 text-[13px]">
                {snapshot.missingBaselines.map((m) => (
                  <li key={m} className="flex items-center gap-2">
                    <Badge tone="amber">no baseline</Badge> <span className="mono">{m}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No missing baselines detected" description="Every operating context observed so far has an approved baseline." />
            )}
            {snapshot.importInfo?.limitations.length ? (
              <div className="mt-3">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Import limitations</p>
                <ul className="mt-1 list-disc pl-5 text-[13px]">
                  {snapshot.importInfo.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader title="Live adapter" actions={<Badge tone="grey">Not configured</Badge>} />
        <CardBody className="space-y-2 text-[13px]">
          <p>{snapshot.liveAdapter.reason}</p>
          <p className="text-muted">{LIVE_ADAPTER_STATUS.reason}</p>
          <Callout tone="amber" title="A live website is not a live factory connection">
            This page can be served from anywhere, but the observations on it are generated by the in-browser simulator or replayed from an imported file. No PLC, historian, or controller is connected, and the adapter contract forbids writes by construction.
          </Callout>
        </CardBody>
      </Card>

      <Card className="mt-3">
        <CardHeader title="Tag registry — latest value at cursor" description={`${ALL_TAG_IDS.length} registered tags. Freshness = cursor − latest point; refreshed every ${REFRESH_MS / 1000} s while running.`} />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Tag</Th>
                <Th>Asset</Th>
                <Th>Type</Th>
                <Th>Unit</Th>
                <Th className="text-right">Latest value</Th>
                <Th>Quality</Th>
                <Th className="text-right">Freshness</Th>
                <Th>Asset coverage</Th>
              </tr>
            </thead>
            <tbody>
              {TAGS.map((t) => {
                const p = latest[t.id];
                const asset = ASSET_BY_ID[t.assetId];
                const age = p ? refMs - p.ms : null;
                return (
                  <tr key={t.id}>
                    <Td>
                      <span className="mono text-[12px]">{t.id}</span>
                      <span className="block text-[11px] text-muted">{t.description}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-[12px]">
                      <span className="mono">{t.assetId}</span>
                      <span className="block text-muted">{asset?.name}</span>
                    </Td>
                    <Td className="text-[12px]">
                      {t.valueType}
                      {t.eventLike ? <span className="block text-muted">event-like</span> : null}
                    </Td>
                    <Td className="text-[12px]">{t.unit ?? <span className="text-muted">—</span>}</Td>
                    <Td className="tnum text-right">{valueText(t, p, headlineFor(t))}</Td>
                    <Td>{p ? <StatusBadge value={p.q} /> : <Badge tone="grey">no point in window</Badge>}</Td>
                    <Td className="tnum whitespace-nowrap text-right">{age === null ? <span className="text-muted">&gt; {WINDOW_MS / 1000} s or never</span> : age < 1000 ? `${age} ms` : formatDuration(age)}</Td>
                    <Td>
                      <StatusBadge value={asset?.coverage} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
