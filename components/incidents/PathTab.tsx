"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ReactFlow, Background, MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Diagnosis, DiagnosticGraph, Incident, KnowledgeVersion } from "@/lib/domain/types";
import { Badge, Callout, Card, CardBody, CardHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { assetName } from "./helpers";

/**
 * Path tab: the diagnostic graph (hypothesis → mechanism ← observation, mechanism → requirement)
 * as a small read-only flow, then the physical edges the leading candidate relies on.
 */

type NodeType = DiagnosticGraph["nodes"][number]["type"];
const COLUMN: Record<NodeType, number> = { HYPOTHESIS: 0, MECHANISM: 1, OBSERVATION: 2, REQUIREMENT: 3 };
const COLUMN_WIDTH = 250;
const ROW_HEIGHT = 84;
const NODE_WIDTH = 210;

function nodeStyle(type: NodeType, state?: string): React.CSSProperties {
  const base: React.CSSProperties = { width: NODE_WIDTH, fontSize: 12, borderRadius: 6, padding: "6px 8px", borderWidth: 1, borderStyle: "solid", color: "var(--text)" };
  switch (type) {
    case "HYPOTHESIS":
      return { ...base, background: state === "leading" ? "var(--accent-soft)" : "var(--surface-2)", borderColor: state === "leading" ? "var(--accent)" : "var(--border-strong)", fontWeight: 600 };
    case "MECHANISM":
      return { ...base, background: "var(--surface)", borderColor: "var(--border-strong)", borderStyle: "dashed" };
    case "OBSERVATION":
      return { ...base, background: state === "GOOD" ? "var(--red-soft)" : "var(--grey-soft)", borderColor: state === "GOOD" ? "var(--red)" : "var(--grey)" };
    case "REQUIREMENT":
      return { ...base, background: "var(--green-soft)", borderColor: "var(--green)" };
  }
}

function layout(graph: DiagnosticGraph): { nodes: Node[]; edges: Edge[] } {
  const rows: Record<NodeType, number> = { HYPOTHESIS: 0, MECHANISM: 0, OBSERVATION: 0, REQUIREMENT: 0 };
  const nodes: Node[] = graph.nodes.map((n) => {
    const col = COLUMN[n.type];
    const row = rows[n.type]++;
    const prefix = n.type === "HYPOTHESIS" ? "Hypothesis" : n.type === "MECHANISM" ? "Mechanism" : n.type === "OBSERVATION" ? "Observation" : "Requirement";
    return {
      id: n.id,
      position: { x: col * COLUMN_WIDTH, y: row * ROW_HEIGHT },
      data: { label: `${prefix}${n.state ? ` · ${n.state}` : ""}: ${n.label}` },
      style: nodeStyle(n.type, n.state),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      connectable: false,
      selectable: false,
    };
  });
  const edges: Edge[] = graph.edges.map((e, i) => {
    return {
      id: `e${i}-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      label: e.label,
      type: "smoothstep",
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: e.label === "contradicts" ? "var(--red)" : "var(--border-strong)" },
      style: { stroke: e.label === "contradicts" ? "var(--red)" : e.label === "supports" ? "var(--green)" : "var(--border-strong)", strokeWidth: 1.2 },
      labelStyle: { fontSize: 10, fill: "var(--muted)" },
      labelBgStyle: { fill: "var(--surface)" },
    };
  });
  return { nodes, edges };
}

export function PathTab({ inc, d, knowledge }: { inc: Incident; d: Diagnosis; knowledge: KnowledgeVersion }) {
  const { nodes, edges } = useMemo(() => layout(d.graph), [d.graph]);
  const top = d.candidates[0];
  const edgeRows = useMemo(() => (top?.edgeIds ?? []).map((id) => ({ id, edge: knowledge.edges.find((e) => e.id === id) })), [top, knowledge.edges]);
  const height = Math.max(220, Math.max(...Object.values(d.graph.nodes.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.type]: (acc[n.type] ?? 0) + 1 }), {})), 1) * ROW_HEIGHT + 40);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Diagnostic path" description="Columns: hypothesis, mechanism, observation, requirement. Read-only; the graph is computed by the diagnosis engine at the cutoff." />
        <CardBody className="p-0">
          {d.graph.nodes.length ? (
            <div style={{ height }} className="hidden md:block">
              <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} panOnScroll proOptions={{ hideAttribution: true }} minZoom={0.3} maxZoom={1.5}>
                <Background gap={16} color="var(--border)" />
              </ReactFlow>
            </div>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted">No diagnostic path: no candidate reached the graph.</p>
          )}
          <div className="md:hidden">
            <ul className="divide-y divide-border text-[13px]">
              {d.graph.nodes.map((n) => (
                <li key={n.id} className="px-3 py-2">
                  <Badge tone="grey">{n.type}</Badge> {n.label}
                  {n.state ? <span className="text-muted"> · {n.state}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Physical edges used by the leading candidate" description={top ? `${top.title} (${top.family})` : "No leading candidate"} />
        <CardBody className="space-y-3">
          <Callout tone="grey">A physical relationship supports a path but is not proof it caused this incident.</Callout>
          {edgeRows.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Edge</Th>
                  <Th>From → to</Th>
                  <Th>Relation</Th>
                  <Th>Summary</Th>
                  <Th>Basis</Th>
                  <Th>Review</Th>
                </tr>
              </thead>
              <tbody>
                {edgeRows.map(({ id, edge }) => (
                  <tr key={id}>
                    <Td className="mono whitespace-nowrap">
                      <Link href={`/knowledge/matrix?edge=${encodeURIComponent(id)}`} className="underline decoration-border-strong underline-offset-2 hover:text-accent">
                        {id}
                      </Link>
                    </Td>
                    {edge ? (
                      <>
                        <Td className="mono whitespace-nowrap">
                          {edge.from} → {edge.to}
                        </Td>
                        <Td className="whitespace-nowrap">{edge.relation.replace(/_/g, " ")}</Td>
                        <Td>
                          {edge.summary}
                          {edge.limitations.length ? <span className="block text-[11px] text-muted">Limits: {edge.limitations.join("; ")}</span> : null}
                        </Td>
                        <Td className="text-[12px]">{edge.basis.replace(/_/g, " ")}</Td>
                        <Td>
                          <StatusBadge value={edge.reviewStatus} />
                        </Td>
                      </>
                    ) : (
                      <Td colSpan={5} className="text-muted">
                        Not present in the active knowledge version {knowledge.id}; the diagnosis was computed against {d.knowledgeVersion}.
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-[13px] text-muted">The leading candidate relies on no approved dependency edge.</p>
          )}
          <div className="text-[13px]">
            <p className="font-medium">Modelled impact (conditional, not observed)</p>
            {inc.potentiallyAffectedAssetIds.length ? (
              <ul className="mt-1 flex flex-wrap gap-1">
                {inc.potentiallyAffectedAssetIds.map((a) => (
                  <li key={a}>
                    <Link href={`/plant/${a}`}>
                      <Badge tone="amber" title={assetName(a)}>
                        {a}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No assets are asserted as potentially affected.</p>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
