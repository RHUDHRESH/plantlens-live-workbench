import type { Incident, KnowledgeProposal, KnowledgeVersion, RecoveryPlan, RecoveryRun, SourceDocument, WorkOrder } from "@/lib/domain/types";
import { ASSETS, TAGS } from "@/lib/domain/plant";

/**
 * Global search over real records: assets, tag aliases, document lines, evidence ids,
 * incidents, dependency edges, requirements, plan checks, work orders, and runs.
 */

export interface SearchHit {
  kind: "ASSET" | "TAG" | "DOCUMENT" | "EVIDENCE" | "INCIDENT" | "EDGE" | "REQUIREMENT" | "CHECK" | "WORK_ORDER" | "RUN" | "PROPOSAL" | "PAGE";
  title: string;
  subtitle?: string;
  route: string;
  score: number;
}

export interface SearchSources {
  sources: SourceDocument[];
  incidents: Incident[];
  knowledge: KnowledgeVersion;
  plans: RecoveryPlan[];
  workOrders: WorkOrder[];
  runs: RecoveryRun[];
  proposals: KnowledgeProposal[];
}

const PAGES: Array<{ title: string; route: string; keywords: string }> = [
  { title: "Plant overview", route: "/plant", keywords: "plant topology overview" },
  { title: "Knowledge — Sources", route: "/knowledge/sources", keywords: "sources documents import files" },
  { title: "Knowledge — Review", route: "/knowledge/review", keywords: "review proposals approve publish" },
  { title: "Knowledge — Matrix", route: "/knowledge/matrix", keywords: "matrix dependency graph edges" },
  { title: "Incidents", route: "/incidents", keywords: "incidents alarms diagnosis" },
  { title: "Recovery", route: "/recovery", keywords: "recovery plans runs tests" },
  { title: "Maintenance", route: "/maintenance", keywords: "maintenance work orders inventory spares" },
  { title: "Costs", route: "/costs", keywords: "costs budget downtime" },
  { title: "Reports", route: "/reports", keywords: "reports export print bundle" },
  { title: "Data health", route: "/data-health", keywords: "data health quality channels missing" },
  { title: "Lab", route: "/lab", keywords: "lab scenarios evaluation presentation" },
  { title: "Settings", route: "/settings", keywords: "settings theme identity storage" },
];

function scoreOf(q: string, ...fields: Array<string | undefined>): number {
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const s = f.toLowerCase();
    if (s === q) best = Math.max(best, 100);
    else if (s.startsWith(q)) best = Math.max(best, 80);
    else if (s.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) best = Math.max(best, 60);
    else if (s.includes(q)) best = Math.max(best, 40);
  }
  return best;
}

export function search(query: string, src: SearchSources, limit = 30): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const p of PAGES) {
    const s = scoreOf(q, p.title, p.keywords);
    if (s) hits.push({ kind: "PAGE", title: p.title, route: p.route, score: s - 10 });
  }
  for (const a of ASSETS) {
    const s = scoreOf(q, a.id, a.name, a.description, a.zone);
    if (s) hits.push({ kind: "ASSET", title: `${a.id} — ${a.name}`, subtitle: a.description, route: `/plant/${a.id}`, score: s + 5 });
  }
  for (const t of TAGS) {
    const s = scoreOf(q, t.id, t.name, t.description, ...t.aliases);
    if (s) hits.push({ kind: "TAG", title: t.id, subtitle: `${t.description}${t.aliases.length ? ` · aliases: ${t.aliases.join(", ")}` : ""}`, route: `/plant/${t.assetId}?tag=${t.name}`, score: s });
  }
  for (const d of src.sources) {
    d.lines.forEach((line, i) => {
      if (line.toLowerCase().includes(q)) hits.push({ kind: "DOCUMENT", title: `${d.fileName}:${i + 1}`, subtitle: line.trim().slice(0, 140), route: `/knowledge/sources?doc=${d.id}&line=${i + 1}`, score: 45 });
    });
  }
  for (const i of src.incidents) {
    const s = scoreOf(q, i.id, i.title, i.diagnosis?.summary, ...i.observedAssetIds);
    if (s) hits.push({ kind: "INCIDENT", title: `${i.id} — ${i.title}`, subtitle: i.diagnosis?.state, route: `/incidents/${i.id}`, score: s + 3 });
    for (const e of i.diagnosis?.evidence ?? []) {
      const es = scoreOf(q, e.id, e.title, e.tagId);
      if (es) hits.push({ kind: "EVIDENCE", title: e.title, subtitle: `${e.id} · ${i.id}`, route: `/incidents/${i.id}?tab=evidence&evidence=${e.id}`, score: es });
    }
  }
  for (const e of src.knowledge.edges) {
    const s = scoreOf(q, e.id, e.summary, e.relation, e.from, e.to);
    if (s) hits.push({ kind: "EDGE", title: `${e.id} — ${e.from} → ${e.to}`, subtitle: e.summary, route: `/knowledge/matrix?edge=${e.id}`, score: s });
  }
  for (const r of src.knowledge.requirements) {
    const s = scoreOf(q, r.id, r.title);
    if (s) hits.push({ kind: "REQUIREMENT", title: `${r.id} — ${r.title}`, route: `/knowledge/matrix?requirement=${r.id}`, score: s });
  }
  for (const p of src.plans) {
    for (const c of p.checks) {
      const s = scoreOf(q, c.id, c.kind, c.requirementRef, "tag" in c ? c.tag : undefined);
      if (s) hits.push({ kind: "CHECK", title: `${c.id} (${c.kind}) in ${p.id} v${p.version}`, subtitle: c.requirementRef, route: `/recovery/${p.id}?check=${c.id}`, score: s - 5 });
    }
  }
  for (const w of src.workOrders) {
    const s = scoreOf(q, w.id, w.title, w.assetId, w.suspectedMechanism, w.plannedAction, ...w.workPerformed.map((x) => x.description));
    if (s) hits.push({ kind: "WORK_ORDER", title: `${w.id} — ${w.title}`, subtitle: `${w.state}${w.fixture ? " · fictional fixture" : ""}`, route: `/maintenance/work-orders/${w.id}`, score: s });
  }
  for (const r of src.runs) {
    const s = scoreOf(q, r.id, r.outcome, r.summary);
    if (s) hits.push({ kind: "RUN", title: `${r.id} — ${r.outcome}`, subtitle: r.summary, route: `/recovery/${r.planId}?run=${r.id}`, score: s - 5 });
  }
  for (const p of src.proposals) {
    const s = scoreOf(q, p.id, p.title, p.rationale);
    if (s) hits.push({ kind: "PROPOSAL", title: p.title, subtitle: `${p.kind} · ${p.state}`, route: `/knowledge/review?proposal=${p.id}`, score: s - 2 });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  // De-duplicate document hits beyond a few per file.
  const perDoc = new Map<string, number>();
  return hits
    .filter((h) => {
      if (h.kind !== "DOCUMENT") return true;
      const key = h.title.split(":")[0];
      const n = (perDoc.get(key) ?? 0) + 1;
      perDoc.set(key, n);
      return n <= 4;
    })
    .slice(0, limit);
}
