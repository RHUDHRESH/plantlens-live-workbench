"use client";

import { useMemo, useState } from "react";
import type { KnowledgeVersion } from "@/lib/domain/types";
import { diffVersions } from "@/lib/knowledge/versions";
import { formatIst, cn } from "@/lib/util";
import { Badge, Card, CardBody, CardHeader, KeyValue, SectionTitle, Select, StatusBadge } from "@/components/ui";
import { useApp } from "@/store/app";

/** Knowledge version history and the diff of a version against its parent. */
export function VersionsPanel() {
  const versions = useApp((s) => s.knowledgeVersions);
  const activeId = useApp((s) => s.activeKnowledgeVersionId);
  const [diffId, setDiffId] = useState<string | null>(null);
  const sorted = useMemo(() => [...versions].sort((a, b) => b.number - a.number), [versions]);
  const target: KnowledgeVersion | undefined = versions.find((v) => v.id === (diffId ?? activeId));
  const parent = target?.parentId ? versions.find((v) => v.id === target.parentId) : undefined;
  const diff = target && parent ? diffVersions(parent, target) : null;

  return (
    <Card>
      <CardHeader title="Versions" description="Every published version is retained. The runtime only ever uses the active version." />
      <CardBody className="space-y-3">
        <ul className="space-y-2">
          {sorted.map((v) => (
            <li key={v.id} className={cn("rounded-md border p-2.5", v.id === activeId ? "border-accent" : "border-border")} aria-current={v.id === activeId ? "true" : undefined}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-[13px] font-semibold">{v.id}</span>
                <StatusBadge value={v.status} />
                {v.id === activeId ? <Badge tone="accent">active</Badge> : null}
                <span className="tnum text-[12px] text-muted">#{v.number}</span>
              </div>
              <KeyValue
                className="mt-1.5"
                items={[
                  { k: "Published", v: <span className="tnum">{v.publishedAt ? formatIst(v.publishedAt.ms, { date: true }) : "—"}</span> },
                  { k: "Reviewer", v: v.reviewer ? `${v.reviewer}${/simulated/i.test(v.reviewer) ? "" : " (simulated)"}` : "—" },
                  { k: "Reason", v: v.publishReason ?? "—" },
                  { k: "Parent", v: v.parentId ? <span className="mono">{v.parentId}</span> : "none (seed)" },
                  { k: "Records", v: <span className="tnum">{v.edges.length} edges · {v.requirements.length} requirements · {v.mappings.length} mappings · {v.reviewedNoDependency.length} reviewed no-dependency</span> },
                ]}
              />
              {v.changeLog.length ? (
                <details className="mt-1.5 text-[12px]">
                  <summary className="cursor-pointer text-muted hover:text-text">Change log ({v.changeLog.length})</summary>
                  <ul className="mt-1 space-y-1">
                    {v.changeLog.map((c, i) => (
                      <li key={i} className="rounded-md bg-surface-2 px-2 py-1">
                        <span className="mono">{c.proposalId}</span> — {c.summary}
                        <span className="block text-muted">
                          {c.reviewer}: {c.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <SectionTitle>Diff against parent</SectionTitle>
            <label htmlFor="diff-version" className="sr-only">
              Version to diff
            </label>
            <Select id="diff-version" className="h-7 text-[12px]" value={diffId ?? activeId} onChange={(e) => setDiffId(e.target.value)}>
              {sorted.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
            </Select>
          </div>
          {!target ? null : !parent ? (
            <p className="mt-1 text-[12px] text-muted">{target.id} has no parent; it is the seeded baseline.</p>
          ) : diff ? (
            <div className="mt-2 space-y-2 text-[13px]">
              <p className="text-[12px] text-muted">
                <span className="mono">{parent.id}</span> → <span className="mono">{target.id}</span>
              </p>
              <DiffList title="Added edges" items={diff.addedEdges.map((e) => `${e.id}: ${e.summary}`)} tone="green" />
              <DiffList title="Removed edges" items={diff.removedEdges.map((e) => `${e.id}: ${e.summary}`)} tone="red" />
              <DiffList title="Changed edges" items={diff.changedEdges.map(({ before, after }) => `${after.id}: ${describeEdgeChange(before, after)}`)} tone="amber" />
              <DiffList title="Added requirements" items={diff.addedRequirements.map((r) => `${r.id}: ${r.title}`)} tone="green" />
              <DiffList title="Changed requirements" items={diff.changedRequirements.map(({ before, after }) => `${after.id}: ${describeRequirementChange(before, after)}`)} tone="amber" />
              <DiffList title="Added mappings" items={diff.addedMappings.map((m) => `${m.alias} → ${m.assetId ?? "?"}`)} tone="green" />
              <DiffList title="Reviewed no-dependency" items={diff.changedNoDependency} tone="grey" />
              {!diff.addedEdges.length && !diff.removedEdges.length && !diff.changedEdges.length && !diff.addedRequirements.length && !diff.changedRequirements.length && !diff.addedMappings.length && !diff.changedNoDependency.length ? <p className="text-muted">No record differences.</p> : null}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function DiffList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" | "amber" | "grey" }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="tnum text-[12px] text-muted">{items.length}</span>
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((it, i) => (
          <li key={i} className="break-words">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeEdgeChange(a: KnowledgeVersion["edges"][number], b: KnowledgeVersion["edges"][number]): string {
  const parts: string[] = [];
  if (a.relation !== b.relation) parts.push(`relation ${a.relation} → ${b.relation}`);
  if (JSON.stringify(a.predicate) !== JSON.stringify(b.predicate)) parts.push(`predicate ${a.predicate ? `${a.predicate.operator} ${String(a.predicate.value)}` : "none"} → ${b.predicate ? `${b.predicate.operator} ${String(b.predicate.value)}` : "none"}`);
  if (a.applicableModes.join() !== b.applicableModes.join()) parts.push(`modes ${a.applicableModes.join("/") || "any"} → ${b.applicableModes.join("/") || "any"}`);
  if (a.applicablePhases.join() !== b.applicablePhases.join()) parts.push(`phases ${a.applicablePhases.join("/") || "any"} → ${b.applicablePhases.join("/") || "any"}`);
  if (a.limitations.join("|") !== b.limitations.join("|")) parts.push("limitations updated");
  if (a.summary !== b.summary) parts.push("summary updated");
  return parts.length ? parts.join("; ") : "fields changed";
}

function describeRequirementChange(a: KnowledgeVersion["requirements"][number], b: KnowledgeVersion["requirements"][number]): string {
  const parts: string[] = [];
  if (JSON.stringify(a.predicate) !== JSON.stringify(b.predicate)) parts.push(`predicate value ${a.predicate ? String(a.predicate.value) : "none"} → ${b.predicate ? String(b.predicate.value) : "none"}`);
  if (JSON.stringify(a.band) !== JSON.stringify(b.band)) parts.push(`band ${a.band ? `${a.band.min}–${a.band.max}` : "none"} → ${b.band ? `${b.band.min}–${b.band.max}` : "none"}`);
  if (a.limitations.join("|") !== b.limitations.join("|")) parts.push("limitations updated");
  if (a.title !== b.title) parts.push("title updated");
  return parts.length ? parts.join("; ") : "fields changed";
}
