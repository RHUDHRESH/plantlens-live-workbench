/* eslint-disable react-hooks/set-state-in-effect, react-hooks/static-components */
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { DependencyEdge, EvidenceRelation, Incident, OperatingMode, RelationType, ZoneId } from "@/lib/domain/types";
import { ASSETS, ASSET_BY_ID, ZONES } from "@/lib/domain/plant";
import { MODES } from "@/lib/domain/schemas";
import { dependencyMatrix } from "@/lib/knowledge/versions";
import { coverageMatrix } from "@/lib/recovery/coverage";
import { relationLabel } from "@/lib/diagnosis/engine";
import { cn } from "@/lib/util";
import { useApp } from "@/store/app";
import { Badge, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, ErrorState, Label, LoadingState, PageHeader, Select, StatusBadge, Switch, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th, type Tone } from "@/components/ui";
import { DependencyGraph, type GraphEdge } from "@/components/knowledge/DependencyGraph";
import { EdgeRecord, RequirementRecord } from "@/components/knowledge/EdgeRecord";
import { RELATION_INITIALS, RELATION_TYPES, latestPlans, pendingEdges, relationTitle, type PendingEdge } from "@/components/knowledge/helpers";

type View = "matrix" | "graph" | "list";
type DialogState = { kind: "cell"; from: string; to: string } | { kind: "edge"; id: string } | { kind: "requirement"; id: string } | null;
type SortKey = "id" | "from" | "to" | "relation" | "basis" | "status" | "version";

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MatrixPage />
    </Suspense>
  );
}

function assetZone(id: string): ZoneId | undefined {
  return ASSET_BY_ID[id]?.zone;
}

function MatrixPage() {
  const router = useRouter();
  const params = useSearchParams();
  const snapshot = useApp((s) => s.snapshot);
  const proposals = useApp((s) => s.proposals);
  const versions = useApp((s) => s.knowledgeVersions);
  const activeId = useApp((s) => s.activeKnowledgeVersionId);
  const plans = useApp((s) => s.plans);
  const historicalIncidents = useApp((s) => s.historicalIncidents);

  const [view, setView] = useState<View>("matrix");
  const [relation, setRelation] = useState<RelationType | "ALL">("ALL");
  const [mode, setMode] = useState<OperatingMode | "ALL">("ALL");
  const [zone, setZone] = useState<ZoneId | "ALL">("ALL");
  const [showProposed, setShowProposed] = useState(true);
  const [versionId, setVersionId] = useState<string>(activeId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });

  useEffect(() => {
    if (!versions.some((v) => v.id === versionId)) setVersionId(activeId);
  }, [versions, versionId, activeId]);

  const edgeParam = params.get("edge");
  const reqParam = params.get("requirement");
  useEffect(() => {
    if (edgeParam) setDialog({ kind: "edge", id: edgeParam });
    else if (reqParam) setDialog({ kind: "requirement", id: reqParam });
  }, [edgeParam, reqParam]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    if (edgeParam || reqParam) router.replace("/knowledge/matrix");
  }, [router, edgeParam, reqParam]);

  const version = versions.find((v) => v.id === versionId) ?? versions.find((v) => v.id === activeId) ?? versions[0];
  const pending = useMemo(() => (showProposed ? pendingEdges(proposals) : []), [proposals, showProposed]);

  const matchesFilters = useCallback(
    (e: DependencyEdge) => {
      if (relation !== "ALL" && e.relation !== relation) return false;
      if (mode !== "ALL" && e.applicableModes.length && !e.applicableModes.includes(mode)) return false;
      if (zone !== "ALL" && assetZone(e.from) !== zone && assetZone(e.to) !== zone) return false;
      return true;
    },
    [relation, mode, zone],
  );

  const publishedEdges = useMemo(() => version.edges.filter(matchesFilters), [version, matchesFilters]);
  const proposedEdges = useMemo(() => pending.filter((p) => matchesFilters(p.edge)), [pending, matchesFilters]);
  const assetIds = useMemo(() => ASSETS.map((a) => a.id), []);
  const cells = useMemo(() => dependencyMatrix({ ...version, edges: publishedEdges }, assetIds, proposedEdges.map((p) => p.edge)), [version, publishedEdges, assetIds, proposedEdges]);

  const graphEdges = useMemo<GraphEdge[]>(() => [...publishedEdges.map((edge) => ({ edge, proposed: false })), ...proposedEdges.map((p) => ({ edge: p.edge, proposed: true }))], [publishedEdges, proposedEdges]);

  const listRows = useMemo(() => {
    const rows = graphEdges.map((g) => ({ ...g, pendingInfo: proposedEdges.find((p) => p.edge.id === g.edge.id) }));
    const val = (r: (typeof rows)[number]): string => {
      switch (sort.key) {
        case "id":
          return r.edge.id;
        case "from":
          return r.edge.from;
        case "to":
          return r.edge.to;
        case "relation":
          return r.edge.relation;
        case "basis":
          return r.edge.basis;
        case "status":
          return r.proposed ? `PROPOSED ${r.pendingInfo?.state ?? ""}` : r.edge.reviewStatus;
        case "version":
          return r.edge.knowledgeVersion;
      }
    };
    return rows.sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
  }, [graphEdges, proposedEdges, sort]);

  const liveIncidents = useMemo(() => (snapshot?.incidents ?? []).filter((i) => !i.fixture), [snapshot]);
  const allIncidents = useMemo(() => [...liveIncidents, ...historicalIncidents], [liveIncidents, historicalIncidents]);
  const openIncidents = useMemo(() => liveIncidents.filter((i) => i.status !== "CLOSED" && i.status !== "RESOLVED" && i.diagnosis), [liveIncidents]);
  const [incidentId, setIncidentId] = useState<string>("");
  const incident = openIncidents.find((i) => i.id === incidentId) ?? openIncidents[0];

  const latest = useMemo(() => latestPlans(plans).sort((a, b) => b.createdAt.ms - a.createdAt.ms), [plans]);
  const [planId, setPlanId] = useState<string>("");
  const plan = latest.find((p) => p.id === planId) ?? latest[0];
  const planIncident = plan ? allIncidents.find((i) => i.id === plan.incidentId) : undefined;
  const planKnowledge = plan ? (versions.find((v) => v.id === plan.knowledgeVersion) ?? version) : version;
  const coverage = useMemo(() => (plan ? coverageMatrix(plan, planKnowledge, planIncident?.diagnosis?.candidates[0]?.edgeIds ?? []) : null), [plan, planKnowledge, planIncident]);

  if (!snapshot) return <LoadingState label="Starting the simulation engine…" />;

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const SortTh = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <Th>
      <button type="button" className="inline-flex items-center gap-1 hover:text-text" onClick={() => toggleSort(k)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
        {children}
        {sort.key === k ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </Th>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dependency matrix"
        description="One set of reviewed records rendered three ways. Blank means unknown (not reviewed); a grey dash means reviewed as no dependency; dotted means proposed only. Nothing here is inferred from co-occurrence."
        badges={
          <>
            <Badge tone={version.id === activeId ? "accent" : "grey"}>{version.id === activeId ? `active ${version.id}` : `viewing ${version.id} (not active)`}</Badge>
            <Badge tone="grey">fictional plant</Badge>
          </>
        }
      />

      <Card>
        <CardBody className="grid gap-3 md:grid-cols-5">
          <div>
            <Label htmlFor="f-version">Knowledge version</Label>
            <Select id="f-version" className="w-full" value={version.id} onChange={(e) => setVersionId(e.target.value)}>
              {[...versions].sort((a, b) => b.number - a.number).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} ({v.status.toLowerCase()})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-relation">Relation type</Label>
            <Select id="f-relation" className="w-full" value={relation} onChange={(e) => setRelation(e.target.value as RelationType | "ALL")}>
              <option value="ALL">all</option>
              {RELATION_TYPES.map((r) => (
                <option key={r} value={r}>
                  {RELATION_INITIALS[r]} · {relationTitle(r)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-mode">Operating mode</Label>
            <Select id="f-mode" className="w-full" value={mode} onChange={(e) => setMode(e.target.value as OperatingMode | "ALL")}>
              <option value="ALL">all</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-zone">Cell / zone</Label>
            <Select id="f-zone" className="w-full" value={zone} onChange={(e) => setZone(e.target.value as ZoneId | "ALL")}>
              <option value="ALL">all</option>
              {ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end pb-1">
            <Switch id="f-proposed" checked={showProposed} onCheckedChange={setShowProposed} label="Show proposed (unpublished)" />
          </div>
        </CardBody>
      </Card>

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="graph" count={graphEdges.length}>
            Graph
          </TabsTrigger>
          <TabsTrigger value="list" count={graphEdges.length}>
            List
          </TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="space-y-4">
          <Card>
            <CardHeader title="D — asset dependency matrix" description={`${assetIds.length} × ${assetIds.length}. Rows are causes (from), columns are effects (to). Click a filled or dotted cell to see the edge records.`} />
            <CardBody>
              <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-muted">
                <span>
                  <span className="inline-block h-3 w-5 rounded-sm border border-border bg-surface align-middle" /> unknown — not reviewed
                </span>
                <span>
                  <span className="inline-block h-3 w-5 rounded-sm border border-border bg-grey-soft text-center align-middle leading-3">—</span> reviewed, no dependency
                </span>
                <span>
                  <span className="inline-block h-3 w-5 rounded-sm bg-accent-soft align-middle" /> published edge (relation initials)
                </span>
                <span>
                  <span className="inline-block h-3 w-5 rounded-sm border border-dotted border-amber align-middle" /> proposed only
                </span>
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th className="sticky left-0 z-10">from \ to</Th>
                    {assetIds.map((id) => (
                      <Th key={id} className="mono px-1 text-center text-[10px]">
                        <span title={ASSET_BY_ID[id]?.name}>{id}</span>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assetIds.map((from) => (
                    <tr key={from}>
                      <Td className="mono sticky left-0 z-10 bg-surface text-[11px] whitespace-nowrap" >
                        <span title={ASSET_BY_ID[from]?.name}>{from}</span>
                      </Td>
                      {assetIds.map((to) => {
                        const c = cells[`${from}|${to}`];
                        if (from === to) return <Td key={to} className="bg-surface-2 p-0 text-center" />;
                        if (c.edges.length || c.pending.length) {
                          const initials = Array.from(new Set([...c.edges, ...c.pending].map((e) => RELATION_INITIALS[e.relation]))).join("/");
                          const onlyProposed = !c.edges.length;
                          const title = [...c.edges.map((e) => `${e.id}: ${e.summary}`), ...c.pending.map((e) => `${e.id} (proposed): ${e.summary}`)].join("\n");
                          return (
                            <Td key={to} className="p-0 text-center">
                              <button type="button" title={title} aria-label={`${from} to ${to}: ${title}`} onClick={() => setDialog({ kind: "cell", from, to })} className={cn("mono block h-7 w-full min-w-[2rem] text-[10px] hover:outline hover:outline-1 hover:outline-accent", onlyProposed ? "border border-dotted border-amber text-amber" : "bg-accent-soft text-accent", c.edges.length > 0 && c.pending.length > 0 && "border border-dotted border-amber")}> 
                                {initials}
                              </button>
                            </Td>
                          );
                        }
                        if (c.noDependency) {
                          return (
                            <Td key={to} className="bg-grey-soft p-0 text-center text-[11px] text-grey" >
                              <span title={`${from} → ${to}: reviewed — no dependency`} aria-label={`${from} to ${to}: reviewed, no dependency`}>—</span>
                            </Td>
                          );
                        }
                        return <Td key={to} className="p-0 text-center"><span className="block h-7 w-full" title={`${from} → ${to}: unknown — not reviewed`} /></Td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="E — fault–evidence matrix"
              description="For an open incident: rows are evidence items, columns are candidate mechanisms. Words, not scores. Unavailable is not evidence against."
              actions={
                openIncidents.length ? (
                  <>
                    <Label htmlFor="f-incident" className="sr-only">
                      Incident
                    </Label>
                    <Select id="f-incident" value={incident?.id ?? ""} onChange={(e) => setIncidentId(e.target.value)}>
                      {openIncidents.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.id} — {i.title}
                        </option>
                      ))}
                    </Select>
                  </>
                ) : undefined
              }
            />
            <CardBody>{incident?.diagnosis ? <EvidenceMatrix incident={incident} /> : <EmptyState title="No open incident with a diagnosis" description="Matrix E appears when the simulation raises an incident. Grouped alarms without a diagnosis are not shown as evidence." />}</CardBody>
          </Card>

          <Card>
            <CardHeader
              title="R — recovery coverage matrix"
              description="For the latest version of a plan: rows are required relationships and requirements, columns are executable checks. Uncovered rows stay visible."
              actions={
                latest.length ? (
                  <>
                    <Label htmlFor="f-plan" className="sr-only">
                      Plan
                    </Label>
                    <Select id="f-plan" value={plan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)}>
                      {latest.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} v{p.version} ({p.status.toLowerCase()})
                        </option>
                      ))}
                    </Select>
                  </>
                ) : undefined
              }
            />
            <CardBody>
              {plan && coverage ? (
                <div className="space-y-3">
                  <p className="text-[12px] text-muted">
                    <Link href={`/recovery/${plan.id}?tab=coverage`} className="mono text-accent hover:underline">
                      {plan.id} v{plan.version}
                    </Link>{" "}
                    · <StatusBadge value={plan.status} /> · compiled against <span className="mono">{plan.knowledgeVersion}</span>
                    {plan.knowledgeVersion !== activeId ? <span className="text-amber"> (not the active version)</span> : null} · affected edges from {planIncident ? <span className="mono">{planIncident.id}</span> : "no incident record"}: {planIncident?.diagnosis?.candidates[0]?.edgeIds.length ? <span className="mono">{planIncident.diagnosis.candidates[0].edgeIds.join(", ")}</span> : "none"}
                  </p>
                  {coverage.uncovered.length ? (
                    <Callout tone="amber" title={`${coverage.uncovered.length} uncovered row${coverage.uncovered.length === 1 ? "" : "s"}`}>
                      <ul className="list-disc pl-4">
                        {coverage.uncovered.map((u) => (
                          <li key={u.id}>
                            <span className="mono">{u.id}</span> ({u.kind.toLowerCase()}) — {u.title}. {u.reason}
                          </li>
                        ))}
                      </ul>
                    </Callout>
                  ) : (
                    <Callout tone="green">Every row is covered by at least one check in this plan. Coverage is a structural property of the plan, not a recovery result.</Callout>
                  )}
                  <Table>
                    <thead>
                      <tr>
                        <Th>Row</Th>
                        {coverage.columns.map((c) => (
                          <Th key={c.id} className="text-center">
                            <span className="mono block text-[11px]">{c.id}</span>
                            <span className="block text-[10px] font-normal">{c.kind.replace(/_/g, " ").toLowerCase()}</span>
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {coverage.rows.map((r) => {
                        const uncovered = coverage.uncovered.some((u) => u.id === r.id);
                        return (
                          <tr key={r.id} className={uncovered ? "bg-amber-soft" : undefined}>
                            <Td>
                              <button type="button" className="mono text-left text-accent hover:underline" onClick={() => setDialog(r.kind === "EDGE" ? { kind: "edge", id: r.id } : { kind: "requirement", id: r.id })}>
                                {r.id}
                              </button>
                              <span className="block text-[12px] text-muted">
                                {r.kind.toLowerCase()} · {r.title}
                              </span>
                              {uncovered ? <Badge tone="amber">uncovered</Badge> : null}
                            </Td>
                            {coverage.columns.map((c) => {
                              const cell = coverage.cells.find((x) => x.rowId === r.id && x.checkId === c.id);
                              return (
                                <Td key={c.id} className="text-center">
                                  {cell?.covered ? <Badge tone="green" title={`covered in ${cell.mode ?? "plan"} mode`}>covered</Badge> : <span className="text-muted" aria-label="not covered">·</span>}
                                </Td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No recovery plan" description="Create a plan from an incident in Recovery; coverage is computed from its checks against the published requirements." />
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="graph">
          <Card>
            <CardHeader title="Graph" description="Solid: published in the selected version. Dashed amber: proposed, not published. Grey dotted: reviewed no-dependency proposal. Click an edge for its record." />
            <CardBody>
              <DependencyGraph edges={graphEdges} onEdgeClick={(id) => setDialog({ kind: "edge", id })} />
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <Card>
            <CardHeader title="Edges" description={`${listRows.length} edge records after filters`} />
            <CardBody>
              {listRows.length === 0 ? (
                <EmptyState title="No edges match the filters" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <SortTh k="id">Id</SortTh>
                      <SortTh k="from">From</SortTh>
                      <SortTh k="to">To</SortTh>
                      <SortTh k="relation">Relation</SortTh>
                      <Th>Conditions</Th>
                      <SortTh k="basis">Basis</SortTh>
                      <SortTh k="status">Status</SortTh>
                      <SortTh k="version">Version</SortTh>
                      <Th>Evidence</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {listRows.map((r) => (
                      <tr key={r.edge.id}>
                        <Td>
                          <button type="button" className="mono text-accent hover:underline" onClick={() => setDialog({ kind: "edge", id: r.edge.id })}>
                            {r.edge.id}
                          </button>
                        </Td>
                        <Td className="mono">{r.edge.from}</Td>
                        <Td className="mono">{r.edge.to}</Td>
                        <Td className="whitespace-nowrap">{relationTitle(r.edge.relation)}</Td>
                        <Td className="text-[12px]">
                          {r.edge.applicableModes.length ? r.edge.applicableModes.join("/") : "any mode"}
                          {r.edge.applicablePhases.length ? ` · ${r.edge.applicablePhases.join("/")}` : ""}
                          {r.edge.predicate ? <span className="mono block">{`${r.edge.predicate.tag} ${r.edge.predicate.operator} ${String(r.edge.predicate.value)}${r.edge.predicate.unit ? ` ${r.edge.predicate.unit}` : ""}`}</span> : null}
                        </Td>
                        <Td className="text-[12px]">{relationTitle(r.edge.basis)}</Td>
                        <Td>{r.proposed ? <Badge tone="amber">proposed · {(r.pendingInfo?.state ?? "").replace(/_/g, " ").toLowerCase()}</Badge> : <StatusBadge value={r.edge.reviewStatus} />}</Td>
                        <Td className="mono text-[12px]">{r.edge.knowledgeVersion}</Td>
                        <Td className="tnum text-[12px]">{r.edge.evidenceRefs.length ? `${r.edge.evidenceRefs.length} span${r.edge.evidenceRefs.length === 1 ? "" : "s"}` : <span className="text-amber">uncited</span>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Requirements" description={`${version.requirements.length} published requirements in ${version.id}. Thresholds are illustrative fixtures, not industrial acceptance standards.`} />
            <CardBody>
              {version.requirements.length === 0 ? (
                <EmptyState title="No requirements in this version" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Id</Th>
                      <Th>Title</Th>
                      <Th>Band / sequence</Th>
                      <Th>Recipes · modes · phases</Th>
                      <Th>Covers edges</Th>
                      <Th>Basis</Th>
                      <Th>Limitations</Th>
                      <Th>Evidence</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {version.requirements.map((r) => (
                      <tr key={r.id}>
                        <Td>
                          <button type="button" className="mono text-accent hover:underline" onClick={() => setDialog({ kind: "requirement", id: r.id })}>
                            {r.id}
                          </button>
                        </Td>
                        <Td className="min-w-[14rem]">{r.title}</Td>
                        <Td className="text-[12px]">
                          {r.band ? <span className="tnum block">{r.band.min}–{r.band.max} {r.band.unit}{r.band.phase ? ` (${r.band.phase})` : ""}</span> : null}
                          {r.sequence ? <span className="mono block">{r.sequence.events.map((e) => e.split(".").pop()).join(" → ")} ≤ {r.sequence.maximumElapsedSeconds} s</span> : null}
                          {!r.band && !r.sequence && r.predicate ? <span className="mono block">{`${r.predicate.tag} ${r.predicate.operator} ${String(r.predicate.value)}`}</span> : null}
                          {!r.band && !r.sequence && !r.predicate ? "—" : null}
                        </Td>
                        <Td className="text-[12px]">
                          {r.applicableRecipes.join("/") || "any"} · {r.applicableModes.join("/") || "any"} · {r.applicablePhases.join("/") || "any"}
                        </Td>
                        <Td className="mono text-[12px]">{r.coversEdgeIds.join(", ") || "—"}</Td>
                        <Td className="text-[12px]">{relationTitle(r.basis)}</Td>
                        <Td className="max-w-[18rem] text-[12px]">{r.limitations.join("; ") || "—"}</Td>
                        <Td className="tnum text-[12px]">{r.evidenceRefs.length} span{r.evidenceRefs.length === 1 ? "" : "s"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <RecordDialog state={dialog} onClose={closeDialog} versionEdges={version.edges} versionId={version.id} noDependency={version.reviewedNoDependency} pending={pendingEdges(proposals)} />
    </div>
  );
}

/* ------------------------------------------------------------------ E matrix */

function relationTone(r: EvidenceRelation): Tone {
  switch (r) {
    case "SUPPORT":
      return "green";
    case "CONTRADICT":
      return "red";
    case "PENDING":
      return "accent";
    default:
      return "grey";
  }
}

function EvidenceMatrix({ incident }: { incident: Incident }) {
  const d = incident.diagnosis!;
  const rowIds = useMemo(() => {
    const ids = d.evidence.map((e) => e.id);
    for (const c of d.candidates) for (const l of c.links) if (!ids.includes(l.evidenceId)) ids.push(l.evidenceId);
    return ids;
  }, [d]);
  if (!d.candidates.length) return <EmptyState title="No candidate mechanisms" description={`${incident.id} is ${d.state}; ${d.summary}`} />;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">
        <Link href={`/incidents/${incident.id}?tab=evidence`} className="mono text-accent hover:underline">
          {incident.id}
        </Link>{" "}
        · {d.state} · knowledge <span className="mono">{d.knowledgeVersion}</span> · {d.summary}
      </p>
      <Table>
        <thead>
          <tr>
            <Th>Evidence</Th>
            {d.candidates.map((c) => (
              <Th key={c.family} className="min-w-[9rem]">
                <span className="block">{c.title}</span>
                <span className="tnum block text-[10px] font-normal">
                  rank {c.rank} · {c.supportCount} support · {c.contradictionCount} contradict · {c.pendingCount} pending · {c.unavailableCount} unavailable
                </span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIds.map((id) => {
            const ev = d.evidence.find((e) => e.id === id);
            return (
              <tr key={id}>
                <Td>
                  {ev ? (
                    <>
                      <span className="block text-[13px]">{ev.title}</span>
                      <span className="mono block text-[11px] text-muted">
                        {ev.tagId} · <StatusBadge value={ev.quality} />
                      </span>
                    </>
                  ) : (
                    <span className="mono text-[12px] text-muted">{id.replace(/_/g, " ").toLowerCase()} (expected, not observed)</span>
                  )}
                </Td>
                {d.candidates.map((c) => {
                  const link = c.links.find((l) => l.evidenceId === id);
                  return (
                    <Td key={c.family}>
                      {link ? (
                        <Badge tone={relationTone(link.relation)} title={link.reason}>
                          {relationLabel(link.relation)}
                        </Badge>
                      ) : (
                        <span className="text-muted" title="no link recorded for this candidate">
                          —
                        </span>
                      )}
                      {link ? <span className="mt-0.5 block max-w-[16rem] text-[11px] text-muted">{link.reason}</span> : null}
                    </Td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="text-[12px] text-muted">Unavailable is not evidence against: a missing or suspect channel neither supports nor contradicts a mechanism.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ Record dialog */

function RecordDialog({ state, onClose, versionEdges, versionId, noDependency, pending }: { state: DialogState; onClose: () => void; versionEdges: DependencyEdge[]; versionId: string; noDependency: string[]; pending: PendingEdge[] }) {
  const sources = useApp((s) => s.sources);
  const versions = useApp((s) => s.knowledgeVersions);
  const proposals = useApp((s) => s.proposals);
  const open = state !== null;

  let title = "";
  let body: React.ReactNode = null;
  if (state?.kind === "cell") {
    const published = versionEdges.filter((e) => e.from === state.from && e.to === state.to);
    const proposed = pending.filter((p) => p.edge.from === state.from && p.edge.to === state.to);
    const noDep = noDependency.includes(`${state.from}->${state.to}`);
    title = `${state.from} → ${state.to}`;
    body = (
      <div className="space-y-4">
        {noDep ? <Callout tone="grey">Reviewed as no dependency in {versionId}.</Callout> : null}
        {published.map((e) => (
          <div key={e.id} className="rounded-md border border-border p-3">
            <EdgeRecord edge={e} sources={sources} badges={<Badge tone="green">published in {versionId}</Badge>} />
          </div>
        ))}
        {proposed.map((p) => (
          <div key={p.proposalId} className="rounded-md border border-dotted border-amber p-3">
            <EdgeRecord edge={p.edge} sources={sources} badges={<ProposedBadges p={p} />} />
          </div>
        ))}
        {!published.length && !proposed.length && !noDep ? <EmptyState title="Unknown — not reviewed" description="No edge record exists for this pair. Absence of a record is not evidence of independence." /> : null}
      </div>
    );
  } else if (state?.kind === "edge") {
    const inVersion = versionEdges.find((e) => e.id === state.id);
    const proposed = pending.find((p) => p.edge.id === state.id);
    const elsewhere = !inVersion && !proposed ? versions.flatMap((v) => v.edges.filter((e) => e.id === state.id).map((e) => ({ v, e }))) : [];
    const rejected = !inVersion && !proposed ? proposals.find((p) => (p.payload.kind === "DEPENDENCY_EDGE" || p.payload.kind === "UNCITED_DRAFT") && p.payload.edge.id === state.id) : undefined;
    title = state.id;
    body = inVersion ? (
      <EdgeRecord edge={inVersion} sources={sources} badges={<Badge tone="green">published in {versionId}</Badge>} />
    ) : proposed ? (
      <EdgeRecord edge={proposed.edge} sources={sources} badges={<ProposedBadges p={proposed} />} />
    ) : elsewhere.length ? (
      <div className="space-y-3">
        <Callout tone="amber">Not in {versionId}. Found in {elsewhere.map((x) => x.v.id).join(", ")}.</Callout>
        <EdgeRecord edge={elsewhere[elsewhere.length - 1].e} sources={sources} />
      </div>
    ) : rejected && (rejected.payload.kind === "DEPENDENCY_EDGE" || rejected.payload.kind === "UNCITED_DRAFT") ? (
      <div className="space-y-3">
        <Callout tone="red">
          Proposal <Link href={`/knowledge/review?proposal=${rejected.id}`} className="mono underline">{rejected.id}</Link> is {rejected.state.replace(/_/g, " ").toLowerCase()}; the edge is not published.
        </Callout>
        <EdgeRecord edge={rejected.payload.edge} sources={sources} />
      </div>
    ) : (
      <ErrorState title="Record not available in this browser" description={`Edge ${state.id} is not in any knowledge version or proposal in this workspace. Import an evidence bundle that contains it.`} />
    );
  } else if (state?.kind === "requirement") {
    const hit = versions.flatMap((v) => v.requirements.filter((r) => r.id === state.id).map((r) => ({ v, r }))).sort((a, b) => b.v.number - a.v.number)[0];
    title = state.id;
    body = hit ? (
      <div className="space-y-3">
        {hit.v.id !== versionId ? <Callout tone="amber">Shown from {hit.v.id}; not present in {versionId}.</Callout> : null}
        <RequirementRecord requirement={hit.r} sources={sources} knowledgeEdges={versionEdges} />
      </div>
    ) : (
      <ErrorState title="Record not available in this browser" description={`Requirement ${state.id} is not in any knowledge version in this workspace. Import an evidence bundle that contains it.`} />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)} title={title || "Record"} description={state?.kind === "cell" ? "Edge records for this asset pair, with conditions, evidence, version, and review status." : undefined} side="right">
      {body}
    </Dialog>
  );
}

function ProposedBadges({ p }: { p: PendingEdge }) {
  return (
    <>
      <Badge tone="amber">proposed · {p.state.replace(/_/g, " ").toLowerCase()}</Badge>
      {p.uncited ? <Badge tone="red">uncited draft</Badge> : null}
      <Link href={`/knowledge/review?proposal=${encodeURIComponent(p.proposalId)}`} className="text-[12px] text-accent hover:underline">
        Review {p.proposalId}
      </Link>
    </>
  );
}

