"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { Cog } from "lucide-react";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { Badge, Label, Select, StatusBadge, Switch } from "@/components/ui";
import { ASSETS, ASSET_BY_ID, LAYOUT, ZONES, ZONE_BOXES } from "@/lib/domain/plant";
import type { DependencyEdge, RelationType } from "@/lib/domain/types";
import type { AssetView, RuntimeSnapshot } from "@/lib/simulation/runtime";
import { cn } from "@/lib/util";
import { useApp } from "@/store/app";
import { coverageLabel, freshnessLabel, openIncidents, RELATION_STYLE, relationTitle, statusVisual } from "./plantMeta";
import { focusEdgeIds, pendingEdgeProposals } from "./graphData";
import { ASSET_ICONS } from "./assetIcons";

/* ------------------------------------------------------------------ Layout */

/** LAYOUT/ZONE_BOXES are authored for ~110 px cards; the graph card carries more text, so the grid is stretched. */
const SCALE_X = 1.7;
const SCALE_Y = 1.5;
const NODE_W = 196;
const NODE_H = 124;

const pos = (id: string) => ({ x: (LAYOUT[id]?.x ?? 0) * SCALE_X, y: (LAYOUT[id]?.y ?? 0) * SCALE_Y });

type Side = "l" | "r" | "t" | "b";

function pickHandles(from: string, to: string): { source: Side; target: Side } {
  const a = pos(from);
  const b = pos(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { source: "r", target: "l" } : { source: "l", target: "r" };
  return dy >= 0 ? { source: "b", target: "t" } : { source: "t", target: "b" };
}

const SIDE_POSITION: Record<Side, Position> = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };

/* ------------------------------------------------------------------ Node types */

interface AssetNodeData extends Record<string, unknown> {
  assetId: string;
  view: AssetView | undefined;
  pulse: boolean;
  dimmed: boolean;
  mapColor: string;
}
type AssetNode = Node<AssetNodeData, "asset">;

interface ZoneNodeData extends Record<string, unknown> {
  name: string;
  purpose: string;
  w: number;
  h: number;
  mapColor: string;
}
type ZoneNode = Node<ZoneNodeData, "zone">;

type PlantNode = AssetNode | ZoneNode;

interface PlantEdgeData extends Record<string, unknown> {
  edgeId: string;
  relation: RelationType;
  proposed: boolean;
}
type PlantEdge = Edge<PlantEdgeData, "smoothstep">;

const HANDLE_STYLE = { opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0, pointerEvents: "none" as const };

function NodeHandles() {
  return (
    <>
      {(["l", "r", "t", "b"] as Side[]).map((s) => (
        <span key={s}>
          <Handle type="source" id={`src-${s}`} position={SIDE_POSITION[s]} style={HANDLE_STYLE} isConnectable={false} />
          <Handle type="target" id={`tgt-${s}`} position={SIDE_POSITION[s]} style={HANDLE_STYLE} isConnectable={false} />
        </span>
      ))}
    </>
  );
}

function AssetNodeView({ data }: NodeProps<AssetNode>) {
  const asset = ASSET_BY_ID[data.assetId];
  const v = data.view;
  const vis = statusVisual(v?.status);
  const Icon = ASSET_ICONS[data.assetId] ?? Cog;
  const fresh = freshnessLabel(v?.freshnessMs ?? null);
  const stop = (e: ReactMouseEvent) => e.stopPropagation();
  return (
    <div className={cn("relative rounded-md px-2.5 py-2 text-[11px] leading-tight shadow-sm transition-opacity", vis.frame, data.dimmed && "opacity-40")} style={{ width: NODE_W, minHeight: NODE_H }}>
      <NodeHandles />
      {data.pulse ? <span aria-hidden className="pointer-events-none absolute -inset-1 animate-pulse rounded-lg border-2 border-red/40" /> : null}
      <div className="flex items-center gap-1.5">
        <Icon size={14} className="shrink-0 text-muted" aria-hidden />
        <Link href={`/plant/${data.assetId}`} onClick={stop} className="min-w-0 truncate text-[12px] font-semibold hover:underline" title={`${data.assetId} ${asset?.name ?? ""}`}>
          <span className="mono font-normal text-muted">{data.assetId}</span> {asset?.name ?? data.assetId}
        </Link>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {v?.phase ? <Badge tone="grey">{v.phase}</Badge> : null}
        <StatusBadge value={v?.status} />
        {v && v.activeAlarmCount > 0 ? (
          <Badge tone="neutral" className="tnum">
            {v.activeAlarmCount} alarm{v.activeAlarmCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
      {vis.hint ? <p className={cn("mt-0.5 text-[10px]", vis.tone === "red" ? "text-red" : vis.tone === "amber" ? "text-amber" : "text-muted")}>{vis.hint}</p> : null}
      <ul className="mt-1 space-y-0.5">
        {(v?.headline ?? []).slice(0, 2).map((h) => (
          <li key={h.tag} className="flex items-baseline justify-between gap-1">
            <span className="mono truncate text-muted">{h.tag}</span>
            <span className="tnum shrink-0">
              {h.value}
              {h.unit ? ` ${h.unit}` : ""}
              {h.quality !== "GOOD" ? <span className="ml-1 text-[10px] text-grey">{h.quality}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted">
        <span className={cn("tnum", fresh.stale && "text-amber")}>{fresh.text}</span>
        <span className="truncate" title="Model coverage">
          {coverageLabel(v?.coverage ?? asset?.coverage ?? "")}
        </span>
      </div>
    </div>
  );
}

function ZoneNodeView({ data }: NodeProps<ZoneNode>) {
  return (
    <div style={{ width: data.w, height: data.h }} className="rounded-lg border border-dashed border-border-strong bg-surface-2/40 px-3 py-2">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">{data.name}</p>
      <p className="text-[11px] text-muted">{data.purpose}</p>
    </div>
  );
}

const NODE_TYPES: NodeTypes = { asset: AssetNodeView, zone: ZoneNodeView };

/* ------------------------------------------------------------------ Hooks */

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });
  return () => mo.disconnect();
}

/** True when the user preference or the document attribute asks for reduced motion. */
function useReducedMotionFlag(): boolean {
  const pref = useApp((s) => s.reducedMotion);
  const attr = useSyncExternalStore(
    subscribeReducedMotion,
    () => document.documentElement.dataset.reducedMotion === "1",
    () => false,
  );
  return pref || attr;
}

/* ------------------------------------------------------------------ Component */

export interface PlantTopologyProps {
  snapshot: RuntimeSnapshot;
  /** Controlled focus; when omitted the component keeps its own selection. */
  focusIncidentId?: string | null;
  onFocusIncidentChange?: (id: string | null) => void;
  className?: string;
}

export function PlantTopology({ snapshot, focusIncidentId, onFocusIncidentChange, className }: PlantTopologyProps) {
  const router = useRouter();
  const knowledge = useApp((s) => s.activeKnowledge());
  const proposals = useApp((s) => s.proposals);
  const theme = useApp((s) => s.theme);
  const reducedMotion = useReducedMotionFlag();
  const [showProposed, setShowProposed] = useState(false);
  const [internalFocus, setInternalFocus] = useState<string | null>(null);
  const focus = focusIncidentId === undefined ? internalFocus : focusIncidentId;
  const setFocus = useCallback(
    (id: string | null) => {
      setInternalFocus(id);
      onFocusIncidentChange?.(id);
    },
    [onFocusIncidentChange],
  );

  const open = useMemo(() => openIncidents(snapshot.incidents), [snapshot.incidents]);
  const focusIncident = useMemo(() => open.find((i) => i.id === focus), [open, focus]);
  const focusIds = useMemo(() => focusEdgeIds(focusIncident), [focusIncident]);
  const pending = useMemo(() => pendingEdgeProposals(proposals, knowledge), [proposals, knowledge]);
  const assetViews = snapshot.assets;

  const nodes = useMemo<PlantNode[]>(() => {
    const focusActive = !!focusIncident;
    const focusAssets = new Set<string>(focusIncident ? [...focusIncident.observedAssetIds, ...focusIncident.potentiallyAffectedAssetIds, ...(focusIncident.sharedCauseAssetId ? [focusIncident.sharedCauseAssetId] : [])] : []);
    for (const e of knowledge.edges) if (focusIds.has(e.id)) focusAssets.add(e.from).add(e.to);
    const zoneNodes: ZoneNode[] = ZONES.map((z) => {
      const b = ZONE_BOXES[z.id];
      return {
        id: `zone-${z.id}`,
        type: "zone",
        position: { x: b.x * SCALE_X, y: b.y * SCALE_Y },
        data: { name: z.name, purpose: z.purpose, w: b.w * SCALE_X, h: b.h * SCALE_Y, mapColor: "transparent" },
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
        zIndex: -1,
      };
    });
    const assetNodes: AssetNode[] = ASSETS.map((a) => {
      const view = assetViews[a.id];
      const status = view?.status;
      return {
        id: a.id,
        type: "asset",
        position: pos(a.id),
        data: { assetId: a.id, view, pulse: !reducedMotion && (status === "FAULT" || status === "SUSPECTED_CAUSE"), dimmed: focusActive && !focusAssets.has(a.id), mapColor: statusVisual(status).mapColor },
        draggable: false,
        connectable: false,
        ariaLabel: `${a.id} ${a.name}, ${(status ?? "unknown").replace(/_/g, " ").toLowerCase()}`,
      };
    });
    return [...zoneNodes, ...assetNodes];
  }, [assetViews, knowledge.edges, focusIds, focusIncident, reducedMotion]);

  const edges = useMemo<PlantEdge[]>(() => {
    const focusActive = !!focusIncident;
    const toEdge = (e: DependencyEdge, proposed: boolean, proposalId?: string): PlantEdge => {
      const style = RELATION_STYLE[e.relation];
      const focused = !proposed && focusIds.has(e.id);
      const dim = focusActive && !focused;
      const h = pickHandles(e.from, e.to);
      const label = proposed ? `proposed: ${relationTitle(e.relation)}` : `${relationTitle(e.relation)}${e.physicalFeedback ? " (feedback)" : ""}`;
      return {
        id: proposed ? `proposed-${proposalId ?? e.id}` : e.id,
        source: e.from,
        target: e.to,
        sourceHandle: `src-${h.source}`,
        targetHandle: `tgt-${h.target}`,
        type: "smoothstep",
        label,
        labelStyle: { fontSize: 10, fill: "var(--muted)", opacity: dim ? 0.35 : 1 },
        labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.9 },
        labelBgPadding: [3, 2],
        labelBgBorderRadius: 3,
        style: { stroke: proposed ? "var(--grey)" : style.stroke, strokeWidth: focused ? 3 : 1.5, strokeDasharray: proposed ? "2 4" : e.physicalFeedback ? "6 4" : style.dash, opacity: dim ? 0.2 : proposed ? 0.8 : 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: proposed ? "var(--grey)" : style.stroke, width: 14, height: 14 },
        animated: focused && !reducedMotion,
        zIndex: focused ? 10 : 1,
        interactionWidth: 12,
        ariaLabel: `${label}: ${e.from} to ${e.to}`,
        data: { edgeId: e.id, relation: e.relation, proposed },
      };
    };
    const out = knowledge.edges.map((e) => toEdge(e, false));
    if (showProposed) for (const p of pending) out.push(toEdge(p.edge, true, p.proposal.id));
    return out;
  }, [knowledge.edges, pending, showProposed, focusIds, focusIncident, reducedMotion]);

  const onNodeClick = useCallback(
    (event: ReactMouseEvent, node: PlantNode) => {
      if (node.type !== "asset") return;
      if ((event.target as HTMLElement | null)?.closest("a")) return;
      router.push(`/plant/${node.id}`);
    },
    [router],
  );
  const onEdgeClick = useCallback(
    (_event: ReactMouseEvent, edge: PlantEdge) => {
      if (!edge.data || edge.data.proposed) return;
      router.push(`/knowledge/matrix?edge=${encodeURIComponent(edge.data.edgeId)}`);
    },
    [router],
  );

  const relationsInUse = useMemo(() => Array.from(new Set(knowledge.edges.map((e) => e.relation))), [knowledge.edges]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <Label htmlFor="topology-focus">Focus selected path</Label>
          <Select id="topology-focus" value={focus ?? ""} onChange={(e) => setFocus(e.target.value || null)} className="w-full">
            <option value="">No focus — all edges</option>
            {open.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id} · {i.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="pb-1.5">
          <Switch id="topology-proposed" checked={showProposed} onCheckedChange={setShowProposed} label={`Show proposed (${pending.length} pending)`} />
        </div>
        <p className="pb-1.5 text-[12px] text-muted">
          Edges from <span className="mono">{knowledge.id}</span> · {knowledge.edges.length} published
          {focusIncident ? ` · highlighting ${focusIds.size} edge${focusIds.size === 1 ? "" : "s"} on the top candidate path` : ""}
        </p>
      </div>
      <div className="h-[520px] min-h-[360px] overflow-hidden rounded-lg border border-border bg-surface" role="region" aria-label="Plant topology graph">
        <ReactFlow<PlantNode, PlantEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.15}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          edgesFocusable
          colorMode={theme === "dark" ? "dark" : theme === "light" ? "light" : "system"}
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background gap={24} color="var(--border)" />
          <MiniMap pannable zoomable nodeColor={(n) => (typeof n.data.mapColor === "string" ? n.data.mapColor : "transparent")} nodeStrokeColor="var(--border-strong)" maskColor="rgba(0,0,0,0.08)" style={{ background: "var(--surface-2)" }} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted" aria-label="Edge legend">
        {relationsInUse.map((r) => {
          const s = RELATION_STYLE[r];
          return (
            <span key={r} className="inline-flex items-center gap-1.5">
              <svg width="26" height="8" aria-hidden>
                <line x1="0" y1="4" x2="26" y2="4" stroke={s.stroke} strokeWidth="2" strokeDasharray={s.dash} />
              </svg>
              {s.label}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden>
            <line x1="0" y1="4" x2="26" y2="4" stroke="var(--text)" strokeWidth="2" strokeDasharray="6 4" />
          </svg>
          physical feedback (dashed)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden>
            <line x1="0" y1="4" x2="26" y2="4" stroke="var(--grey)" strokeWidth="2" strokeDasharray="2 4" />
          </svg>
          proposed, not published (dotted)
        </span>
      </div>
    </div>
  );
}
