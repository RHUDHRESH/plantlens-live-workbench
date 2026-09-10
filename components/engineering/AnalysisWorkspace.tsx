"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
} from "@/components/ui";
import type { CadAsset } from "@/lib/cad/types";
import { loadEngineeringState } from "@/lib/engineering";
import {
  buildCoverageRows,
  createAnalysisDocument,
  findDagCycle,
  loadAnalysisDocument,
  loadCadAssets,
  saveAnalysisDocument,
  validateRelationship,
  type AnalysisDocument,
  type AnalysisRelationship,
} from "@/lib/analysis-workspace";
import styles from "./analysis-workspace.module.css";

export function AnalysisWorkspace() {
  const [document, setDocument] = useState<AnalysisDocument>(
    createAnalysisDocument(),
  );
  const [assets, setAssets] = useState<CadAsset[]>([]);
  const [bindings, setBindings] = useState<
    Awaited<ReturnType<typeof loadEngineeringState>>["bindings"]
  >([]);
  const [draft, setDraft] = useState<AnalysisRelationship>({
    id: "REL-DRAFT",
    fromAssetId: "",
    toAssetId: "",
    label: "",
    kind: "DAG",
    sign: 1,
    note: "",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void Promise.all([
      loadAnalysisDocument(),
      loadEngineeringState(),
      loadCadAssets(),
    ])
      .then(([d, e, a]) => {
        setDocument(d);
        setBindings(e.bindings);
        setAssets(a);
        setDraft({
          id: `REL-${Date.now()}`,
          fromAssetId: a[0]?.id ?? "",
          toAssetId: a[1]?.id ?? "",
          label: "",
          kind: "DAG",
          sign: 1,
          note: "",
        });
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Workspace could not be loaded.",
        ),
      );
  }, []);
  const rows = useMemo(
    () => buildCoverageRows(assets, bindings),
    [assets, bindings],
  );
  const dag = document.relationships.filter((r) => r.kind === "DAG");
  const loops = document.relationships.filter((r) => r.kind === "LOOP");
  const assetName = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
  function addRelationship() {
    const issues = validateRelationship(draft, assets, document.relationships);
    if (issues.length) {
      setError(issues.join(" "));
      return;
    }
    setError("");
    setDocument({
      ...document,
      relationships: [
        ...document.relationships,
        { ...draft, label: draft.label.trim(), note: draft.note.trim() },
      ],
    });
    setDraft({ ...draft, id: `REL-${Date.now()}`, label: "", note: "" });
  }
  function remove(id: string) {
    setDocument({
      ...document,
      relationships: document.relationships.filter((r) => r.id !== id),
    });
  }
  async function persist() {
    try {
      const next = await saveAnalysisDocument(document, document.revision);
      setDocument(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save locally.");
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
      <div className="mb-3">
        <Link
          href="/workbench"
          className="text-[12px] text-accent hover:underline"
        >
          ← Back to workbench
        </Link>
      </div>
      <PageHeader
        title="Analysis workspace"
        description="Bounded relationships, explicit feedback loops, and instrumentation coverage. Every relationship is a hypothesis until evidence supports it."
        badges={
          <Badge tone="grey">Browser-local · not SQLite or cloud-synced</Badge>
        }
        actions={
          <Button variant="primary" onClick={() => void persist()}>
            Save locally
          </Button>
        }
      />
      {saved && (
        <Callout tone="green" className="mb-4" title="Saved on this device">
          Analysis document revision {document.revision} is stored in browser
          localStorage.
        </Callout>
      )}
      {error && (
        <Callout tone="red" className="mb-4" title="Cannot add relationship">
          {error}
        </Callout>
      )}
      <div className={styles.grid}>
        <Card>
          <CardHeader
            title="Relationship editor"
            description="DAG edges must remain acyclic. Signed causal loops intentionally permit cycles and are not proof of causation."
          />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="From asset">
                <Select
                  aria-label="From asset"
                  value={draft.fromAssetId}
                  onChange={(e) =>
                    setDraft({ ...draft, fromAssetId: e.target.value })
                  }
                  className="w-full"
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To asset">
                <Select
                  aria-label="To asset"
                  value={draft.toAssetId}
                  onChange={(e) =>
                    setDraft({ ...draft, toAssetId: e.target.value })
                  }
                  className="w-full"
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select
                  aria-label="Relationship type"
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      kind: e.target.value as AnalysisRelationship["kind"],
                    })
                  }
                  className="w-full"
                >
                  <option value="DAG">DAG dependency</option>
                  <option value="LOOP">Signed causal loop</option>
                </Select>
              </Field>
              <Field label="Sign">
                <Select
                  aria-label="Relationship sign"
                  value={draft.sign}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sign: Number(e.target.value) as 1 | -1,
                    })
                  }
                  className="w-full"
                >
                  <option value="1">+ same-direction</option>
                  <option value="-1">− opposite-direction</option>
                </Select>
              </Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto] items-end">
              <Field label="Relationship label">
                <Input
                  aria-label="Relationship label"
                  value={draft.label}
                  onChange={(e) =>
                    setDraft({ ...draft, label: e.target.value })
                  }
                  placeholder="pressure rise precedes load increase"
                  maxLength={120}
                />
              </Field>
              <Field label="Evidence / boundary note">
                <Input
                  aria-label="Evidence or boundary note"
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="Hypothesis; cite an observation or source later"
                  maxLength={240}
                />
              </Field>
              <Button onClick={addRelationship}>
                <Plus size={15} />
                Add
              </Button>
            </div>
            <Diagram title="DAG" relationships={dag} assets={assets} />
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted">
                  DAG relationships ({dag.length})
                </h3>
                {findDagCycle(document.relationships) && (
                  <StatusBadge value="INVALID" />
                )}
              </div>
              {dag.length ? (
                <div className={styles.scroll}>
                  {dag.map((r) => (
                    <RelationshipRow
                      key={r.id}
                      relationship={r}
                      assetName={assetName}
                      onRemove={remove}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No DAG edges yet"
                  description="Add a bounded dependency to start the analysis graph."
                />
              )}
            </div>
            <div className="mt-5">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                Signed causal loops ({loops.length})
              </h3>
              <Diagram title="Loops" relationships={loops} assets={assets} />
              {loops.length ? (
                <div className={styles.scroll}>
                  {loops.map((r) => (
                    <RelationshipRow
                      key={r.id}
                      relationship={r}
                      assetName={assetName}
                      onRemove={remove}
                    />
                  ))}
                </div>
              ) : (
                <p className={styles.meta}>
                  Loops are stored separately so feedback does not invalidate
                  the DAG.
                </p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Instrumentation coverage"
            description="Only actual CAD assets and approved descriptor-pinned bindings can be mapped."
          />
          <CardBody className="p-0">
            <Table className={`${styles.matrix} rounded-none border-0`}>
              <thead>
                <tr>
                  <Th>Asset</Th>
                  <Th>Status</Th>
                  <Th>Channels</Th>
                  <Th>Basis</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assetId}>
                    <Td>
                      <span className="mono">{r.assetId}</span>
                      <span className="block text-[12px] text-muted">
                        {r.assetName}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge value={r.status} />
                    </Td>
                    <Td className="mono text-[12px]">
                      {r.channels.length ? r.channels.join(", ") : "—"}
                    </Td>
                    <Td className="text-[12px] text-muted">{r.detail}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="border-t border-border px-4 py-3 text-[12px] text-muted">
              Missing and unverified coverage never counts as mapped. Device
              UUID and schema hash remain pinned in each approved binding.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
function RelationshipRow({
  relationship: r,
  assetName,
  onRemove,
}: {
  relationship: AnalysisRelationship;
  assetName: (id: string) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <div className={styles.relationship}>
      <div>
        <span className="mono text-[12px]">{r.fromAssetId}</span>
        <span className="block text-[12px] text-muted">
          {assetName(r.fromAssetId)}
        </span>
      </div>
      <div>
        <span className="mono text-[12px]">{r.toAssetId}</span>
        <span className="block text-[12px] text-muted">
          {assetName(r.toAssetId)}
        </span>
      </div>
      <div>
        <span className="block text-[10px] font-semibold tracking-wider text-amber">
          HYPOTHESIS ·{" "}
          {r.sign > 0 ? "+ same direction" : "− opposite direction"}
        </span>
        <strong className="text-[13px]">{r.label}</strong>
        {r.note && (
          <span className="block text-[11px] text-muted">{r.note}</span>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove ${r.label}`}
        onClick={() => onRemove(r.id)}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}
function Diagram({
  title,
  relationships,
  assets,
}: {
  title: string;
  relationships: AnalysisRelationship[];
  assets: CadAsset[];
}) {
  const shown = assets.slice(0, 20);
  const diagramWidth = Math.max(600, shown.length * 98 + 8);
  return (
    <figure
      className="mt-3 overflow-x-auto rounded-md border border-border bg-surface-2 p-2"
      aria-label={`${title} relationship diagram`}
    >
      <figcaption className="mb-2 text-xs text-muted">{title} · hypotheses, not verified causation. Showing {shown.length} of {assets.length} assets; all relationships are listed below.</figcaption>
      <svg viewBox={`0 0 ${diagramWidth} 145`} style={{ minWidth: diagramWidth }} className="h-36 w-full" role="img" aria-label={`${title} directed relationship overview`}>
        <defs>
          <marker
            id={`arrow-${title}`}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="currentColor" />
          </marker>
        </defs>
        {shown.map((a, i) => (
          <g key={a.id}>
            <rect
              x={8 + i * 98}
              y="82"
              width="84"
              height="28"
              rx="4"
              fill="var(--surface)"
              stroke="var(--border-strong)"
            />
            <text
              x={50 + i * 98}
              y="100"
              textAnchor="middle"
              fontSize="10"
              fill="var(--text)"
            >
              {a.id}
            </text>
          </g>
        ))}
        {relationships.map((r) => {
          const f = shown.findIndex((a) => a.id === r.fromAssetId);
          const t = shown.findIndex((a) => a.id === r.toAssetId);
          if (f < 0 || t < 0) return null;
          const x1 = 92 + f * 98;
          const x2 = 8 + t * 98;
          return (
            <g key={r.id}>
              <path
                d={`M${x1} 82 C${x1} 25 ${x2} 25 ${x2} 82`}
                fill="none"
                stroke="var(--accent)"
                markerEnd={`url(#arrow-${title})`}
              />
              <text
                x={(x1 + x2) / 2}
                y="19"
                textAnchor="middle"
                fontSize="9"
                fill="var(--amber)"
              >
                HYPOTHESIS {r.sign > 0 ? "+" : "−"}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
