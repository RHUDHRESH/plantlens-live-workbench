"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Cog } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, ErrorState, KeyValue, LoadingState, PageHeader, SectionTitle, StatusBadge, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from "@/components/ui";
import { COVERAGE_LEGEND, coverageLabel, freshnessLabel, incidentTouchesAsset, relationTitle, statusVisual } from "@/components/topology/plantMeta";
import { citedSpans, edgesForAsset, pendingEdgeProposals, templateChecksForAsset } from "@/components/topology/graphData";
import { ASSET_ICONS } from "@/components/topology/assetIcons";
import { ASSETS, ASSET_BY_ID, ZONES, tagsForAsset } from "@/lib/domain/plant";
import type { Asset, DependencyEdge, Incident, TagDefinition } from "@/lib/domain/types";
import { ANCHORED_DOCS } from "@/lib/fixtures/documents";
import { RECOVERY_TEMPLATES } from "@/lib/fixtures/templates";
import type { SeriesPoint } from "@/lib/simulation/observation";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import { RECIPES } from "@/lib/simulation/scenarios";
import { cn, formatDuration, formatIst } from "@/lib/util";
import { useApp } from "@/store/app";

const TABS = ["identity", "context", "tags", "trends", "dependencies", "sources", "coverage", "incidents", "maintenance", "recovery"] as const;
type Tab = (typeof TABS)[number];
const TREND_WINDOW_MS = 10 * 60_000;
const POLL_MS = 2000;

function isTab(v: string | null): v is Tab {
  return (TABS as readonly string[]).includes(v ?? "");
}

/* ------------------------------------------------------------------ Series polling */

/**
 * Query the engine for `tagIds` ending at the cursor. Re-queries every 2 s only while the
 * clock is running and the calling tab is mounted; when paused it re-queries on seek.
 */
function useAssetSeries(tagIds: string[], windowMs: number, maxPoints: number, snapshot: RuntimeSnapshot): { data: Record<string, SeriesPoint[]>; queriedAt: number | null } {
  const series = useApp((s) => s.series);
  const running = snapshot.clock.running;
  const cursorMs = snapshot.clock.cursorMs;
  const cursorRef = useRef(cursorMs);
  const [state, setState] = useState<{ data: Record<string, SeriesPoint[]>; queriedAt: number | null }>({ data: {}, queriedAt: null });
  const tagKey = tagIds.join(",");
  const pausedCursor = running ? null : cursorMs;

  useEffect(() => {
    cursorRef.current = cursorMs;
  }, [cursorMs]);

  useEffect(() => {
    let cancelled = false;
    const ids = tagKey ? tagKey.split(",") : [];
    const load = async () => {
      const to = pausedCursor ?? cursorRef.current;
      const r = ids.length ? await series(ids, to - windowMs, to, maxPoints) : {};
      if (!cancelled) setState({ data: r, queriedAt: to });
    };
    void load();
    if (pausedCursor !== null) return () => void (cancelled = true);
    const handle = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [tagKey, pausedCursor, series, windowMs, maxPoints]);

  return state;
}

/* ------------------------------------------------------------------ Page */

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading asset…" />}>
      <AssetPage />
    </Suspense>
  );
}

function AssetPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params?.id ?? "");
  const search = useSearchParams();
  const tagParam = search.get("tag");
  const tabParam = search.get("tab");
  const snapshot = useApp((s) => s.snapshot);
  const knowledge = useApp((s) => s.activeKnowledge());
  const workOrderCount = useApp((s) => s.workOrders.filter((w) => w.assetId === id).length);
  const urlTab: Tab = isTab(tabParam) ? tabParam : tagParam ? "trends" : "identity";
  const [tab, setTab] = useState<Tab>(urlTab);
  // A new deep link (?tab= / ?tag=) re-selects the tab; the user's own clicks are kept otherwise.
  const [seenUrlTab, setSeenUrlTab] = useState<Tab>(urlTab);
  if (seenUrlTab !== urlTab) {
    setSeenUrlTab(urlTab);
    setTab(urlTab);
  }

  const asset = ASSET_BY_ID[id];
  if (!asset) {
    return (
      <ErrorState
        title="Record not available in this browser"
        description={`No asset with id "${id}" exists in the plant registry. If this link came from another workspace, import its evidence bundle (Reports → Import bundle) and open the link again.`}
        action={
          <Link href="/plant" className="text-sm text-accent hover:underline">
            Back to the plant overview
          </Link>
        }
      />
    );
  }
  if (!snapshot) return <LoadingState label="Starting the simulation engine…" />;

  const view = snapshot.assets[id];
  const vis = statusVisual(view?.status);
  const Icon = ASSET_ICONS[id] ?? Cog;
  const fresh = freshnessLabel(view?.freshnessMs ?? null);
  const { inbound, outbound } = edgesForAsset(knowledge.edges, id);
  const assetEdges = [...inbound, ...outbound];
  const tags = tagsForAsset(id);
  const liveIncidents = snapshot.incidents.filter((i) => !i.fixture && incidentTouchesAsset(i, id));

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Icon size={18} className="text-muted" aria-hidden />
            <span className="mono font-normal text-muted">{id}</span> {asset.name}
          </span>
        }
        description={asset.description}
        badges={
          <>
            <StatusBadge value={view?.status} />
            {view?.phase ? <Badge tone="grey">{view.phase}</Badge> : null}
            <Badge tone="grey">{asset.kind.replace(/_/g, " ")}</Badge>
            <Badge tone={fresh.stale ? "amber" : "green"} className="tnum">
              {fresh.text}
            </Badge>
            {view && view.activeAlarmCount > 0 ? (
              <Badge tone="amber" className="tnum">
                {view.activeAlarmCount} active alarm{view.activeAlarmCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <Link href="/plant" className="text-sm text-accent hover:underline">
            ← Plant
          </Link>
        }
      />
      {vis.hint ? (
        <Callout tone={vis.tone} className="mb-3">
          {vis.hint.charAt(0).toUpperCase() + vis.hint.slice(1)}
          {view?.incidentIds.length ? (
            <>
              {" — "}
              {view.incidentIds.map((iid, i) => (
                <span key={iid}>
                  {i ? ", " : ""}
                  <Link href={`/incidents/${iid}`} className="mono hover:underline">
                    {iid}
                  </Link>
                </span>
              ))}
            </>
          ) : null}
        </Callout>
      ) : null}

      <Card>
        <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(view?.headline ?? []).map((h) => (
            <div key={h.tag} className="rounded-md bg-surface-2 px-3 py-2">
              <p className="mono text-[12px] text-muted">{h.tag}</p>
              <p className="tnum mt-0.5 text-lg leading-tight">
                {h.value}
                {h.unit ? <span className="ml-1 text-[13px] text-muted">{h.unit}</span> : null}
              </p>
              <StatusBadge value={h.quality} className="mt-1" />
            </div>
          ))}
          {!view?.headline.length ? <p className="text-[13px] text-muted">No headline measurement is defined for this asset.</p> : null}
        </CardBody>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(isTab(v) ? v : "identity")} className="mt-3">
        <TabsList>
          <TabsTrigger value="identity">Identity &amp; hierarchy</TabsTrigger>
          <TabsTrigger value="context">Operating context</TabsTrigger>
          <TabsTrigger value="tags" count={tags.length}>
            Tag registry
          </TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="dependencies" count={assetEdges.length}>
            Dependencies
          </TabsTrigger>
          <TabsTrigger value="sources">Source documents</TabsTrigger>
          <TabsTrigger value="coverage">Model coverage</TabsTrigger>
          <TabsTrigger value="incidents" count={liveIncidents.length}>
            Incidents
          </TabsTrigger>
          <TabsTrigger value="maintenance" count={workOrderCount}>
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="recovery">Recovery suites</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <IdentityTab asset={asset} />
        </TabsContent>
        <TabsContent value="context">
          <ContextTab asset={asset} snapshot={snapshot} />
        </TabsContent>
        <TabsContent value="tags">
          <TagRegistryTab asset={asset} tags={tags} snapshot={snapshot} />
        </TabsContent>
        <TabsContent value="trends">
          <TrendsTab asset={asset} tags={tags} snapshot={snapshot} emphasis={tagParam} />
        </TabsContent>
        <TabsContent value="dependencies">
          <DependenciesTab assetId={id} inbound={inbound} outbound={outbound} />
        </TabsContent>
        <TabsContent value="sources">
          <SourcesTab edges={assetEdges} />
        </TabsContent>
        <TabsContent value="coverage">
          <CoverageTab asset={asset} />
        </TabsContent>
        <TabsContent value="incidents">
          <IncidentsTab assetId={id} live={liveIncidents} />
        </TabsContent>
        <TabsContent value="maintenance">
          <MaintenanceTab assetId={id} />
        </TabsContent>
        <TabsContent value="recovery">
          <RecoveryTab assetId={id} edgeIds={new Set(assetEdges.map((e) => e.id))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ Identity */

function IdentityTab({ asset }: { asset: Asset }) {
  const zone = ZONES.find((z) => z.id === asset.zone);
  const parent = asset.parentId ? ASSET_BY_ID[asset.parentId] : undefined;
  const children = ASSETS.filter((a) => a.parentId === asset.id);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          <KeyValue
            items={[
              { k: "Asset id", v: <span className="mono">{asset.id}</span> },
              { k: "Name", v: asset.name },
              { k: "Kind", v: <Badge tone="grey">{asset.kind.replace(/_/g, " ")}</Badge> },
              { k: "Zone", v: zone ? `${zone.name} (${zone.id})` : asset.zone },
              { k: "Cell", v: asset.cellId ?? "none — shared or downstream asset" },
              { k: "Coverage", v: coverageLabel(asset.coverage) },
              { k: "Phases modelled", v: asset.phases.join(", ") },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Hierarchy" description="Subsystems belong to their parent; they are never counted as separate production lines." />
        <CardBody>
          <KeyValue
            items={[
              {
                k: "Parent",
                v: parent ? (
                  <Link href={`/plant/${parent.id}`} className="hover:underline">
                    <span className="mono">{parent.id}</span> {parent.name}
                  </Link>
                ) : (
                  <span className="text-muted">none (top-level asset)</span>
                ),
              },
              {
                k: "Children",
                v: children.length ? (
                  <ul>
                    {children.map((c) => (
                      <li key={c.id}>
                        <Link href={`/plant/${c.id}`} className="hover:underline">
                          <span className="mono">{c.id}</span> {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted">none</span>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Nameplate" description="Values as supplied with the equipment (fictional)." />
        <CardBody>
          {asset.nameplate ? <KeyValue items={Object.entries(asset.nameplate).map(([k, v]) => ({ k, v }))} /> : <p className="text-[13px] text-muted">No nameplate data is recorded for this asset.</p>}
          <Callout tone="neutral" className="mt-3">
            Nameplate values are not recovery setpoints. Recovery checks compare only against approved requirements and healthy baselines in the published knowledge version.
          </Callout>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Operating context */

function ContextTab({ asset, snapshot }: { asset: Asset; snapshot: RuntimeSnapshot }) {
  const view = snapshot.assets[asset.id];
  if (!asset.cellId) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Own state" />
          <CardBody>
            <KeyValue items={[{ k: "Phase", v: view?.phase ?? "not classified" }, { k: "Status", v: <StatusBadge value={view?.status} /> }, { k: "Active alarms", v: <span className="tnum">{view?.activeAlarmCount ?? 0}</span> }]} />
          </CardBody>
        </Card>
        <EmptyState title="Not part of a production cell" description="Recipe, commanded speed and cycle context are tracked per machining cell. This asset is a shared utility or downstream station, so only its own phase applies." />
      </div>
    );
  }
  const cell = snapshot.cells[asset.cellId];
  const recipe = cell ? RECIPES[cell.recipe] : undefined;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader title={`Cell context — ${asset.cellId}`} description="Context at the cursor from the cell's sequence controller. Commanded speed is a request, not a measurement." actions={cell?.interrupted ? <Badge tone="red">interrupted</Badge> : undefined} />
        <CardBody>
          <KeyValue
            items={[
              { k: "Cell phase", v: <Badge tone="grey">{cell?.phase ?? "UNCLASSIFIED"}</Badge> },
              { k: "Phase since", v: <span className="tnum">{cell ? `${formatIst(cell.phaseSinceMs, { seconds: true })} (${formatDuration(snapshot.clock.cursorMs - cell.phaseSinceMs)})` : "—"}</span> },
              { k: "Recipe", v: <span className="mono">{cell?.recipe ?? "UNKNOWN"}</span> },
              { k: "Mode", v: cell?.mode ?? "UNKNOWN" },
              {
                k: "Commanded speed",
                v: (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="tnum">{cell?.commandedSpeedRpm ?? 0} rpm</span>
                    {cell?.overrideActive ? <Badge tone="amber">override</Badge> : null}
                  </span>
                ),
              },
              { k: "Cycle count", v: <span className="tnum">{cell?.cycleCount ?? 0}</span> },
              { k: "Cycle id", v: <span className="mono">{cell?.cycleId || "—"}</span> },
              { k: "This asset's phase", v: view?.phase ?? "not classified" },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recipe definition" description="Fictional recipe parameters; a baseline must be approved separately before recovery can use them." />
        <CardBody>
          {recipe ? (
            <KeyValue
              items={[
                { k: "Recipe", v: <span className="mono">{recipe.id}</span> },
                { k: "Nominal speed", v: <span className="tnum">{recipe.commandedSpeedRpm} rpm</span> },
                { k: "Cut / load / unload", v: <span className="tnum">{recipe.cutSeconds} s / {recipe.loadSeconds} s / {recipe.unloadSeconds} s</span> },
                { k: "Approved baseline", v: recipe.approvedBaseline ? <Badge tone="green">available</Badge> : <Badge tone="grey">not approved — recovery cannot compare against this recipe</Badge> },
              ]}
            />
          ) : (
            <p className="text-[13px] text-muted">No recipe definition for {cell?.recipe ?? "the current recipe"}.</p>
          )}
          {snapshot.missingBaselines.length ? (
            <Callout tone="amber" title="Missing baselines" className="mt-3">
              {snapshot.missingBaselines.join("; ")}
            </Callout>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Tag registry */

function TagRegistryTab({ asset, tags, snapshot }: { asset: Asset; tags: TagDefinition[]; snapshot: RuntimeSnapshot }) {
  const sampled = useMemo(() => tags.filter((t) => t.valueType === "NUMERIC" || t.valueType === "BOOLEAN").map((t) => t.id), [tags]);
  const { data, queriedAt } = useAssetSeries(sampled, 60_000, 60, snapshot);
  const view = snapshot.assets[asset.id];
  const headline = new Map((view?.headline ?? []).map((h) => [h.tag, h]));

  const current = (t: TagDefinition): { value: string; quality: string | undefined; source: string } => {
    const pts = data[t.id];
    const last = pts && pts.length ? pts[pts.length - 1] : undefined;
    if (last) {
      const v = last.v === null ? "—" : t.valueType === "BOOLEAN" ? (last.v ? "TRUE" : "FALSE") : Number.isInteger(last.v) ? String(last.v) : last.v.toFixed(Math.abs(last.v) < 10 ? 2 : 1);
      return { value: v, quality: last.q, source: `series at ${formatIst(last.ms, { seconds: true })}` };
    }
    const h = headline.get(t.name);
    if (h) return { value: h.value, quality: h.quality, source: "snapshot headline" };
    if (t.valueType === "ENUM" && t.name === "phase" && view?.phase) return { value: view.phase, quality: "GOOD", source: "snapshot phase" };
    return { value: "—", quality: sampled.includes(t.id) ? "MISSING" : undefined, source: sampled.includes(t.id) ? "no sample in the last minute" : "text channel; not sampled in this view" };
  };

  return (
    <Card>
      <CardHeader title="Registered tags" description={`${tags.length} typed channels. Unavailable values are shown as unavailable, never as zero.`} actions={queriedAt ? <span className="tnum text-[12px] text-muted">at {formatIst(queriedAt, { seconds: true })}</span> : undefined} />
      <CardBody className="p-0">
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Tag</Th>
              <Th>Type</Th>
              <Th>Unit</Th>
              <Th>Aliases</Th>
              <Th>Current value</Th>
              <Th>Quality</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => {
              const c = current(t);
              return (
                <tr key={t.id}>
                  <Td>
                    {t.valueType === "NUMERIC" ? (
                      <Link href={`/plant/${asset.id}?tab=trends&tag=${encodeURIComponent(t.id)}`} className="mono hover:underline" title="Open in trends">
                        {t.name}
                      </Link>
                    ) : (
                      <span className="mono">{t.name}</span>
                    )}
                    {t.eventLike ? <span className="ml-1 text-[11px] text-muted">event</span> : null}
                  </Td>
                  <Td>{t.valueType}</Td>
                  <Td>{t.unit ?? "—"}</Td>
                  <Td className="mono text-[12px] text-muted">{t.aliases.length ? t.aliases.join(", ") : "—"}</Td>
                  <Td className="tnum">
                    <span title={c.source}>
                      {c.value}
                      {t.unit && c.value !== "—" ? ` ${t.unit}` : ""}
                    </span>
                  </Td>
                  <Td>{c.quality ? <StatusBadge value={c.quality} /> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-muted">{t.description}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ Trends */

function TrendsTab({ asset, tags, snapshot, emphasis }: { asset: Asset; tags: TagDefinition[]; snapshot: RuntimeSnapshot; emphasis: string | null }) {
  const numeric = useMemo(() => {
    const all = tags.filter((t) => t.valueType === "NUMERIC");
    const head = all.filter((t) => asset.headlineTags.includes(t.name));
    const rest = all.filter((t) => !asset.headlineTags.includes(t.name)).slice(0, 4);
    const list = [...head, ...rest];
    const em = emphasis ? all.find((t) => t.id === emphasis || t.name === emphasis) : undefined;
    if (em && !list.includes(em)) list.push(em);
    if (em) list.sort((a, b) => (a === em ? -1 : b === em ? 1 : 0));
    return list;
  }, [tags, asset.headlineTags, emphasis]);
  const ids = useMemo(() => numeric.map((t) => t.id), [numeric]);
  const { data, queriedAt } = useAssetSeries(ids, TREND_WINDOW_MS, 400, snapshot);
  const to = queriedAt ?? snapshot.clock.cursorMs;
  const from = to - TREND_WINDOW_MS;

  if (!numeric.length) return <EmptyState title="No numeric channel" description="This asset only reports boolean, enumerated or text channels; see the tag registry for their current values." />;

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">
        Last 10 minutes up to <span className="tnum">{formatIst(to, { date: true, seconds: true })}</span> IST. {snapshot.clock.running ? "Refreshing every 2 s while the clock runs." : "Clock paused; charts follow the cursor."} Points with MISSING or INVALID quality are drawn as gaps; decimation keeps per-bucket minima and maxima.
        {emphasis ? (
          <>
            {" "}
            Emphasising <span className="mono">{emphasis}</span>.
          </>
        ) : null}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {numeric.map((t) => (
          <TrendChart key={t.id} tag={t} points={data[t.id] ?? []} from={from} to={to} emphasised={emphasis === t.id || emphasis === t.name} />
        ))}
      </div>
    </div>
  );
}

function TrendChart({ tag, points, from, to, emphasised }: { tag: TagDefinition; points: SeriesPoint[]; from: number; to: number; emphasised: boolean }) {
  const rows = useMemo(() => points.map((p) => ({ ms: p.ms, v: p.q === "MISSING" || p.q === "INVALID" || p.q === "NOT_INSTRUMENTED" ? null : p.v, q: p.q })), [points]);
  const valid = rows.filter((r) => r.v !== null) as Array<{ ms: number; v: number; q: string }>;
  const gaps = rows.length - valid.length;
  const last = valid[valid.length - 1];
  const min = valid.length ? Math.min(...valid.map((r) => r.v)) : null;
  const max = valid.length ? Math.max(...valid.map((r) => r.v)) : null;
  const num = (v: number | null) => (v === null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1));
  return (
    <Card className={cn(emphasised && "border-accent")}>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="mono text-[13px]">{tag.name}</span>
            {tag.unit ? <span className="text-[12px] font-normal text-muted">{tag.unit}</span> : null}
            {emphasised ? <Badge tone="accent">selected</Badge> : null}
          </span>
        }
        description={tag.description}
        actions={
          <span className="tnum text-[12px] text-muted">
            last {num(last?.v ?? null)} · min {num(min)} · max {num(max)}
          </span>
        }
      />
      <CardBody>
        {rows.length ? (
          <div className="h-[150px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="ms" type="number" domain={[from, to]} tickFormatter={(v: number) => formatIst(v)} tick={{ fontSize: 10, fill: "var(--muted)" }} stroke="var(--border-strong)" tickCount={5} className="tnum" />
                <YAxis width={46} domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--muted)" }} stroke="var(--border-strong)" className="tnum" />
                <Tooltip
                  isAnimationActive={false}
                  labelFormatter={(l) => formatIst(Number(l), { seconds: true })}
                  formatter={(v) => [`${typeof v === "number" ? num(v) : String(v)}${tag.unit ? ` ${tag.unit}` : ""}`, tag.name]}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                />
                <Line type="monotone" dataKey="v" stroke={emphasised ? "var(--accent)" : "var(--text)"} strokeWidth={emphasised ? 2 : 1.25} dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-[13px] text-muted">No samples in this window.</p>
        )}
        <p className="tnum mt-1 text-[11px] text-muted">
          {rows.length} points{gaps ? ` · ${gaps} unavailable (gaps)` : ""}
        </p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ Dependencies */

function scopeText(e: DependencyEdge): string {
  const parts = [...e.applicableModes, ...e.applicablePhases];
  return parts.length ? parts.join(", ") : "all modes and phases";
}

function DependenciesTab({ assetId, inbound, outbound }: { assetId: string; inbound: DependencyEdge[]; outbound: DependencyEdge[] }) {
  const knowledge = useApp((s) => s.activeKnowledge());
  const proposals = useApp((s) => s.proposals);
  const pending = useMemo(() => pendingEdgeProposals(proposals, knowledge).filter((p) => p.edge.from === assetId || p.edge.to === assetId), [proposals, knowledge, assetId]);
  const rows = [...inbound.map((e) => ({ e, dir: "depends on" as const, other: e.from })), ...outbound.map((e) => ({ e, dir: "feeds" as const, other: e.to }))];
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title={`Published dependencies — ${knowledge.id}`} description="Only edges in the active published version influence diagnosis and recovery." />
        <CardBody className="p-0">
          {rows.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Direction</Th>
                  <Th>Asset</Th>
                  <Th>Relation</Th>
                  <Th>Applies to</Th>
                  <Th>Rule</Th>
                  <Th>Summary</Th>
                  <Th>Basis</Th>
                  <Th>Status</Th>
                  <Th>Edge</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ e, dir, other }) => (
                  <tr key={e.id}>
                    <Td>
                      {dir}
                      {e.physicalFeedback ? <span className="ml-1 text-[11px] text-muted">(feedback)</span> : null}
                    </Td>
                    <Td>
                      <Link href={`/plant/${other}`} className="hover:underline">
                        <span className="mono">{other}</span> {ASSET_BY_ID[other]?.name ?? ""}
                      </Link>
                    </Td>
                    <Td>{relationTitle(e.relation)}</Td>
                    <Td className="text-muted">{scopeText(e)}</Td>
                    <Td className="mono text-[12px]">{e.predicate ? `${e.predicate.tag} ${e.predicate.operator} ${String(e.predicate.value)}${e.predicate.unit ? ` ${e.predicate.unit}` : ""}` : "—"}</Td>
                    <Td>{e.summary}</Td>
                    <Td className="text-[12px] text-muted">{e.basis.replace(/_/g, " ").toLowerCase()}</Td>
                    <Td>
                      <StatusBadge value={e.reviewStatus} />
                    </Td>
                    <Td>
                      <Link href={`/knowledge/matrix?edge=${encodeURIComponent(e.id)}`} className="mono text-[12px] text-accent hover:underline">
                        {e.id}
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-3">
              <EmptyState title="No published dependency" description="No approved edge starts or ends at this asset. Absence of an edge is not evidence of independence unless it is listed under reviewed non-dependencies." />
            </div>
          )}
        </CardBody>
      </Card>
      {knowledge.reviewedNoDependency.filter((k) => k.includes(assetId)).length ? (
        <Card>
          <CardHeader title="Reviewed: no dependency" description="Pairs an engineer explicitly reviewed and recorded as independent." />
          <CardBody>
            <ul className="mono text-[13px]">
              {knowledge.reviewedNoDependency
                .filter((k) => k.includes(assetId))
                .map((k) => (
                  <li key={k}>{k.replace("->", " → ")}</li>
                ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      {pending.length ? (
        <Card>
          <CardHeader title="Proposed, not published" description="Pending proposals do not affect diagnosis until reviewed and published." />
          <CardBody>
            <ul className="space-y-1 text-[13px]">
              {pending.map(({ proposal, edge }) => (
                <li key={proposal.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone="grey">proposed</Badge>
                  <span className="mono">
                    {edge.from} → {edge.to}
                  </span>
                  <span>{relationTitle(edge.relation)}</span>
                  <StatusBadge value={proposal.state} />
                  <Link href="/knowledge/review" className="text-accent hover:underline">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Source documents */

function SourcesTab({ edges }: { edges: DependencyEdge[] }) {
  const sources = useApp((s) => s.sources);
  const spans = useMemo(() => citedSpans(edges), [edges]);
  if (!spans.length) return <EmptyState title="No cited source" description="No published edge at this asset cites a source span." />;
  return (
    <div className="space-y-3">
      {spans.map(({ span, edgeIds }) => {
        const fixture = ANCHORED_DOCS.find((d) => d.id === span.sourceId);
        const doc = sources.find((s) => s.id === span.sourceId) ?? (fixture ? sources.find((s) => s.fileName === fixture.fileName) : undefined);
        const lines = doc ? doc.lines.slice(span.startLine - 1, span.endLine) : fixture ? fixture.lines.slice(span.startLine - 1, span.endLine) : null;
        const key = `${span.sourceId}:${span.startLine}-${span.endLine}${span.column ? `:${span.column}` : ""}`;
        return (
          <Card key={key}>
            <CardHeader
              title={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="mono text-[13px]">{doc?.fileName ?? fixture?.fileName ?? span.sourceId}</span>
                  <span className="tnum text-[12px] font-normal text-muted">
                    lines {span.startLine}–{span.endLine}
                    {span.column ? ` · column ${span.column}` : ""}
                  </span>
                  {doc ? <Badge tone="green">loaded source</Badge> : fixture ? <Badge tone="grey">bundled fixture text</Badge> : <Badge tone="grey">not loaded</Badge>}
                  {(doc ?? fixture) ? <Badge tone="grey">fictional</Badge> : null}
                </span>
              }
              description={
                <>
                  Cited by{" "}
                  {edgeIds.map((e, i) => (
                    <span key={e}>
                      {i ? ", " : ""}
                      <Link href={`/knowledge/matrix?edge=${encodeURIComponent(e)}`} className="mono hover:underline">
                        {e}
                      </Link>
                    </span>
                  ))}
                </>
              }
              actions={
                <Link href={`/knowledge/sources?doc=${encodeURIComponent(doc?.id ?? span.sourceId)}&line=${span.startLine}`} className="text-[12px] text-accent hover:underline">
                  Open in Sources
                </Link>
              }
            />
            <CardBody>
              {lines ? (
                <pre className="scroll-thin max-h-56 overflow-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
                  {lines.map((l, i) => (
                    <span key={i} className="block">
                      <span className="tnum mr-3 inline-block w-8 select-none text-right text-muted">{span.startLine + i}</span>
                      {l}
                    </span>
                  ))}
                </pre>
              ) : (
                <p className="text-[13px] text-muted">The cited document is not loaded in this browser. Load the sample factory pack or import the file under Knowledge → Sources to review the cited text.</p>
              )}
              {!doc && fixture ? <p className="mt-2 text-[12px] text-muted">Shown from the bundled fixture text; the same file is not yet loaded as a source document. Load the sample factory pack to review it with provenance in Sources.</p> : null}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Coverage */

function CoverageTab({ asset }: { asset: Asset }) {
  const legend = COVERAGE_LEGEND.find((c) => c.value === asset.coverage);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader title="Model coverage for this asset" />
        <CardBody>
          <Badge tone={asset.coverage === "RECOVERY_COVERED" ? "green" : asset.coverage === "INSUFFICIENT_DATA" ? "grey" : "accent"}>{coverageLabel(asset.coverage)}</Badge>
          <p className="mt-2 text-[13px]">{asset.coverageReason}</p>
          {legend ? <p className="mt-2 text-[12px] text-muted">{legend.explanation}</p> : null}
          {asset.coverage === "INSUFFICIENT_DATA" || asset.coverage === "CONTEXTUAL_ONLY" ? (
            <Callout tone="amber" className="mt-3">
              Absence of alarms on this asset is not evidence of health: no approved rule would raise one.
            </Callout>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Coverage scale" />
        <CardBody>
          <ul className="space-y-2 text-[13px]">
            {COVERAGE_LEGEND.map((c) => (
              <li key={c.value} className={cn(c.value === asset.coverage && "font-medium")}>
                {c.label}
                <span className="block text-[12px] font-normal text-muted">{c.explanation}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Incidents */

function roleFor(i: Incident, assetId: string): string {
  if (i.sharedCauseAssetId === assetId) return "suspected cause";
  if (i.observedAssetIds.includes(assetId)) return "observed fault";
  if (i.potentiallyAffectedAssetIds.includes(assetId)) return "may be affected (conditional)";
  return "referenced";
}

function IncidentRows({ items, assetId }: { items: Incident[]; assetId: string }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/incidents/${i.id}`} className="mono text-[12px] text-muted hover:underline">
                {i.id}
              </Link>
              <StatusBadge value={i.status} />
              {i.diagnosis ? <StatusBadge value={i.diagnosis.state} /> : null}
              {i.fixture ? <Badge tone="grey">fictional fixture</Badge> : null}
            </div>
            <Link href={`/incidents/${i.id}`} className="mt-0.5 block text-[13px] font-medium hover:underline">
              {i.title}
            </Link>
            <p className="text-[12px] text-muted">
              Role: {roleFor(i, assetId)} · opened <span className="tnum">{formatIst(i.openedAt.ms, { date: true })}</span>
              {i.closedAt ? (
                <>
                  {" "}
                  · closed <span className="tnum">{formatIst(i.closedAt.ms, { date: true })}</span>
                </>
              ) : null}
            </p>
            {i.fixture ? <p className="text-[12px] text-muted">{i.fixture.note}</p> : null}
          </div>
          <Link href={`/incidents/${i.id}`} className="text-[12px] text-accent hover:underline">
            Open
          </Link>
        </li>
      ))}
    </ul>
  );
}

function IncidentsTab({ assetId, live }: { assetId: string; live: Incident[] }) {
  const historical = useApp((s) => s.historicalIncidents);
  const open = live.filter((i) => i.status !== "CLOSED" && i.status !== "RESOLVED");
  const past = live.filter((i) => i.status === "CLOSED" || i.status === "RESOLVED");
  const fixtures = historical.filter((i) => incidentTouchesAsset(i, assetId));
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Open incidents involving this asset" actions={<Badge tone={open.length ? "accent" : "grey"}>{open.length}</Badge>} />
        <CardBody className="p-0">{open.length ? <IncidentRows items={open} assetId={assetId} /> : <div className="p-3"><EmptyState title="No open incident" description="No open incident observes, suspects or conditionally affects this asset at the cursor." /></div>}</CardBody>
      </Card>
      {past.length ? (
        <Card>
          <CardHeader title="Resolved or closed in this session" />
          <CardBody className="p-0">
            <IncidentRows items={past} assetId={assetId} />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="Historical incidents" description="Fictional fixtures shipped with the demo; they are labelled and never mixed with live records." actions={<Badge tone="grey">{fixtures.length} fixture{fixtures.length === 1 ? "" : "s"}</Badge>} />
        <CardBody className="p-0">{fixtures.length ? <IncidentRows items={fixtures} assetId={assetId} /> : <div className="p-3"><EmptyState title="No historical fixture" description="No fictional historical incident references this asset." /></div>}</CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ Maintenance */

function MaintenanceTab({ assetId }: { assetId: string }) {
  const workOrders = useApp((s) => s.workOrders);
  const mine = workOrders.filter((w) => w.assetId === assetId).sort((a, b) => b.createdAt.ms - a.createdAt.ms);
  return (
    <Card>
      <CardHeader title="Work orders for this asset" description="A repair is an action; recovery is a separately observed result. Closure requires a passing recovery run." />
      <CardBody className="p-0">
        {mine.length ? (
          <Table className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Work order</Th>
                <Th>Title</Th>
                <Th>State</Th>
                <Th>Priority</Th>
                <Th>Assignee</Th>
                <Th>Created</Th>
                <Th>Runs</Th>
              </tr>
            </thead>
            <tbody>
              {mine.map((w) => (
                <tr key={w.id}>
                  <Td>
                    <Link href={`/maintenance/work-orders/${w.id}`} className="mono text-accent hover:underline">
                      {w.id}
                    </Link>
                    {w.fixture ? <Badge tone="grey" className="ml-1">fictional fixture</Badge> : null}
                  </Td>
                  <Td>
                    {w.title}
                    {w.incidentId ? (
                      <span className="block text-[12px] text-muted">
                        from{" "}
                        <Link href={`/incidents/${w.incidentId}`} className="mono hover:underline">
                          {w.incidentId}
                        </Link>
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge value={w.state} />
                  </Td>
                  <Td>{w.priority}</Td>
                  <Td>{w.assignee}</Td>
                  <Td className="tnum">{formatIst(w.createdAt.ms, { date: true, seconds: false })}</Td>
                  <Td className="tnum">{w.runIds.length}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-3">
            <EmptyState
              title="No work order"
              description="No current or fixture work order targets this asset."
              action={
                <Link href="/maintenance" className="text-sm text-accent hover:underline">
                  Go to maintenance
                </Link>
              }
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ Recovery suites */

function RecoveryTab({ assetId, edgeIds }: { assetId: string; edgeIds: Set<string> }) {
  const plans = useApp((s) => s.plans);
  const matches = RECOVERY_TEMPLATES.map((t) => ({ template: t, checkIds: templateChecksForAsset(t, assetId, edgeIds) })).filter((m) => m.checkIds.length > 0);
  if (!matches.length) return <EmptyState title="No recovery template references this asset" description="No template check reads this asset's tags, names the asset, or covers one of its published edges. Recovery cannot claim anything about it." />;
  return (
    <div className="space-y-3">
      {matches.map(({ template, checkIds }) => {
        const usedBy = plans.filter((p) => p.templateIds.includes(template.id));
        const planIds = Array.from(new Set(usedBy.map((p) => p.id)));
        return (
          <Card key={template.id}>
            <CardHeader
              title={template.title}
              description={
                <>
                  <span className="mono">{template.id}</span> · {template.cellId} · recipe {template.recipe} · {template.requiredCompleteCycles} complete cycles required · families: {template.faultFamilies.map((f) => f.replace(/_/g, " ").toLowerCase()).join(", ")}
                </>
              }
              actions={
                <Link href="/recovery" className="text-[12px] text-accent hover:underline">
                  Recovery
                </Link>
              }
            />
            <CardBody>
              <SectionTitle>Checks referencing this asset</SectionTitle>
              <ul className="mt-1 space-y-1 text-[13px]">
                {template.checks
                  .filter((c) => checkIds.includes(c.id))
                  .map((c) => (
                    <li key={c.id}>
                      <span className="mono text-[12px]">{c.id}</span> <Badge tone="neutral">{c.kind.replace(/_/g, " ")}</Badge>
                      <span className="block text-[12px] text-muted">{template.justifications[c.id] ?? c.requirementRef}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">Validity: {template.validityLimits.join("; ")}</p>
              {planIds.length ? (
                <p className="mt-2 text-[12px]">
                  Compiled into{" "}
                  {planIds.map((p, i) => (
                    <span key={p}>
                      {i ? ", " : ""}
                      <Link href={`/recovery/${p}`} className="mono text-accent hover:underline">
                        {p}
                      </Link>
                    </span>
                  ))}
                </p>
              ) : (
                <p className="mt-2 text-[12px] text-muted">Not compiled into a plan in this workspace.</p>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
