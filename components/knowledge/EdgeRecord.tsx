"use client";

import type { DependencyEdge, RecoveryRequirement, SourceDocument } from "@/lib/domain/types";
import { ASSET_BY_ID } from "@/lib/domain/plant";
import { Badge, KeyValue, SectionTitle, StatusBadge } from "@/components/ui";
import { EvidenceSpans } from "./EvidenceSpans";
import { relationTitle } from "./helpers";

export function assetLabel(id: string): string {
  const a = ASSET_BY_ID[id];
  return a ? `${id} · ${a.name}` : id;
}

function predicateText(p: DependencyEdge["predicate"]): string {
  if (!p) return "none";
  return `${p.tag} ${p.operator} ${String(p.value)}${p.unit ? ` ${p.unit}` : ""}`;
}

/** Read-only view of a dependency edge record with its cited evidence. */
export function EdgeRecord({ edge, sources, badges, showEvidence = true }: { edge: DependencyEdge; sources: SourceDocument[]; badges?: React.ReactNode; showEvidence?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-[13px] font-semibold">{edge.id}</span>
        <StatusBadge value={edge.reviewStatus} />
        <Badge tone="neutral">{edge.knowledgeVersion}</Badge>
        {edge.physicalFeedback ? <Badge tone="grey">physical feedback</Badge> : null}
        {badges}
      </div>
      <p className="text-[13px]">{edge.summary}</p>
      <KeyValue
        items={[
          { k: "From", v: <span className="mono">{assetLabel(edge.from)}</span> },
          { k: "To", v: <span className="mono">{assetLabel(edge.to)}</span> },
          { k: "Relation", v: relationTitle(edge.relation) },
          { k: "Modes", v: edge.applicableModes.length ? edge.applicableModes.join(", ") : "any (not restricted)" },
          { k: "Phases", v: edge.applicablePhases.length ? edge.applicablePhases.join(", ") : "any (not restricted)" },
          { k: "Predicate", v: <span className="mono">{predicateText(edge.predicate)}</span> },
          { k: "Expected observation", v: edge.expectedObservation ? <span className="mono">{edge.expectedObservation}</span> : "none stated" },
          { k: "Expected lag", v: edge.expectedLagMs ? <span className="tnum">{edge.expectedLagMs.min}–{edge.expectedLagMs.max} ms</span> : "not stated" },
          { k: "Basis", v: relationTitle(edge.basis) },
        ]}
      />
      {edge.limitations.length ? (
        <div>
          <SectionTitle>Limitations</SectionTitle>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
            {edge.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {showEvidence ? (
        <div>
          <SectionTitle>Evidence</SectionTitle>
          <div className="mt-1">
            <EvidenceSpans spans={edge.evidenceRefs} sources={sources} compact />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Read-only view of a recovery requirement. */
export function RequirementRecord({ requirement, sources, knowledgeEdges }: { requirement: RecoveryRequirement; sources: SourceDocument[]; knowledgeEdges: DependencyEdge[] }) {
  const r = requirement;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-[13px] font-semibold">{r.id}</span>
        <StatusBadge value={r.reviewStatus} />
        <Badge tone="neutral">{r.knowledgeVersion}</Badge>
      </div>
      <p className="text-[13px] font-medium">{r.title}</p>
      <KeyValue
        items={[
          { k: "Predicate", v: <span className="mono">{predicateText(r.predicate)}</span> },
          { k: "Band", v: r.band ? <span className="tnum">{r.band.min}–{r.band.max} {r.band.unit}{r.band.phase ? ` during ${r.band.phase}` : ""}</span> : "none" },
          { k: "Sequence", v: r.sequence ? <span className="mono">{r.sequence.events.join(" → ")} within {r.sequence.maximumElapsedSeconds} s</span> : "none" },
          { k: "Recipes", v: r.applicableRecipes.length ? r.applicableRecipes.join(", ") : "any" },
          { k: "Modes", v: r.applicableModes.length ? r.applicableModes.join(", ") : "any" },
          { k: "Phases", v: r.applicablePhases.length ? r.applicablePhases.join(", ") : "any" },
          { k: "Basis", v: relationTitle(r.basis) },
          {
            k: "Covers edges",
            v: r.coversEdgeIds.length ? (
              <span className="flex flex-wrap gap-1">
                {r.coversEdgeIds.map((id) => (
                  <Badge key={id} tone={knowledgeEdges.some((e) => e.id === id) ? "neutral" : "amber"} title={knowledgeEdges.some((e) => e.id === id) ? "published in the selected version" : "not published in the selected version"}>
                    <span className="mono">{id}</span>
                  </Badge>
                ))}
              </span>
            ) : (
              "none"
            ),
          },
        ]}
      />
      {r.limitations.length ? (
        <div>
          <SectionTitle>Limitations</SectionTitle>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
            {r.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <SectionTitle>Evidence</SectionTitle>
        <div className="mt-1">
          <EvidenceSpans spans={r.evidenceRefs} sources={sources} compact />
        </div>
      </div>
    </div>
  );
}
