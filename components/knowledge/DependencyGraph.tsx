"use client";

import { useMemo } from "react";
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DependencyEdge } from "@/lib/domain/types";
import { ASSETS, LAYOUT } from "@/lib/domain/plant";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { Callout } from "@/components/ui";
import { RELATION_INITIALS } from "./helpers";

export interface GraphEdge {
  edge: DependencyEdge;
  proposed: boolean;
}

/**
 * Asset dependency graph from the same records as the matrix and list. Published edges are
 * solid; proposed edges are dashed and amber; reviewed non-dependencies are grey dotted.
 */
export function DependencyGraph({ edges, onEdgeClick }: { edges: GraphEdge[]; onEdgeClick: (edgeId: string) => void }) {
  const small = useMediaQuery("(max-width: 767px)");

  const nodes = useMemo<Node[]>(
    () =>
      ASSETS.map((a) => ({
        id: a.id,
        position: LAYOUT[a.id] ?? { x: 0, y: 0 },
        data: { label: `${a.id}\n${a.name}` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        connectable: false,
        style: {
          background: "var(--surface)",
          color: "var(--text)",
          border: `1px solid ${a.kind === "SUBSYSTEM" ? "var(--border)" : "var(--border-strong)"}`,
          borderRadius: 6,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          whiteSpace: "pre-line",
          width: 150,
          padding: "6px 8px",
          textAlign: "left" as const,
        },
      })),
    [],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map(({ edge, proposed }) => {
        const noDep = edge.relation === "REVIEWED_NO_DEPENDENCY";
        const stroke = noDep ? "var(--grey)" : proposed ? "var(--amber)" : "var(--accent)";
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: "smoothstep",
          label: RELATION_INITIALS[edge.relation],
          labelStyle: { fill: stroke, fontSize: 10, fontFamily: "var(--font-mono)" },
          labelBgStyle: { fill: "var(--surface)" },
          labelBgPadding: [3, 2] as [number, number],
          style: { stroke, strokeWidth: proposed ? 1.5 : 1.75, strokeDasharray: noDep ? "2 3" : proposed ? "6 4" : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
          data: { proposed },
        };
      }),
    [edges],
  );

  if (small) {
    return (
      <Callout tone="grey" title="Graph hidden on small screens">
        Use the List view for the same edges; the graph needs a wider viewport to stay readable.
      </Callout>
    );
  }

  return (
    <div className="h-[560px] w-full overflow-hidden rounded-md border border-border bg-surface-2/40" role="figure" aria-label="Asset dependency graph">
      <ReactFlow nodes={nodes} edges={flowEdges} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.3} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} elementsSelectable edgesFocusable proOptions={{ hideAttribution: true }} onEdgeClick={(_, e) => onEdgeClick(e.id)} colorMode="light" style={{ background: "transparent" }}>
        <Background gap={24} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <p className="sr-only">
        {edges.length} edges shown. {edges.filter((e) => e.proposed).length} are proposed, not published.
      </p>
    </div>
  );
}
