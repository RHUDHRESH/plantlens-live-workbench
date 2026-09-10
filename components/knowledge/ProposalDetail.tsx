/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import type { DependencyEdge, KnowledgeProposal, KnowledgeVersion, OperatingMode, RelationType, ReviewRecord, SourceDocument } from "@/lib/domain/types";
import { ASSETS } from "@/lib/domain/plant";
import { MODES } from "@/lib/domain/schemas";
import type { ProposalEdits } from "@/lib/knowledge/versions";
import { formatIst } from "@/lib/util";
import { Badge, Button, Callout, Field, Input, KeyValue, SectionTitle, Select, StatusBadge, Textarea } from "@/components/ui";
import { EvidenceSpans } from "./EvidenceSpans";
import { EdgeRecord, RequirementRecord, assetLabel } from "./EdgeRecord";
import { RELATION_TYPES, isPublishedProposal, kindLabel, relationTitle } from "./helpers";

type Decision = ReviewRecord["decision"];

const PIPELINE_LABEL: Record<KnowledgeProposal["pipeline"], { text: string; tone: "grey" | "accent" | "neutral" }> = {
  LOCAL_DEMO: { text: "Local demo pipeline — deterministic rules", tone: "grey" },
  CONNECTED_AI: { text: "Connected AI — schema-validated, citations verified", tone: "accent" },
  HUMAN: { text: "Human draft", tone: "neutral" },
};

export function PipelineBadge({ pipeline }: { pipeline: KnowledgeProposal["pipeline"] }) {
  const l = PIPELINE_LABEL[pipeline];
  return <Badge tone={l.tone}>{l.text}</Badge>;
}

/**
 * Proposal detail: the document-to-knowledge editor. Every action records a reason with
 * the simulated reviewer identity. The payload view is specific to the proposal kind.
 */
export function ProposalDetail({ proposal, sources, knowledge, identity, onReview }: { proposal: KnowledgeProposal; sources: SourceDocument[]; knowledge: KnowledgeVersion; identity: string; onReview: (decision: Decision, reason: string, edits?: ProposalEdits) => void }) {
  const p = proposal;
  const [reason, setReason] = useState("");
  const [mappingAsset, setMappingAsset] = useState<string>(p.payload.kind === "ALIAS_MERGE" ? (p.payload.mapping.assetId ?? "") : "");
  const [chosen, setChosen] = useState<number | null>(p.payload.kind === "SOURCE_CONFLICT" ? (p.payload.resolution?.chosen ?? null) : null);

  useEffect(() => {
    setReason("");
    setMappingAsset(p.payload.kind === "ALIAS_MERGE" ? (p.payload.mapping.assetId ?? "") : "");
    setChosen(p.payload.kind === "SOURCE_CONFLICT" ? (p.payload.resolution?.chosen ?? null) : null);
  }, [p.id, p.payload]);

  const published = isPublishedProposal(p);
  const untrusted = p.kind === "UNTRUSTED_INSTRUCTION";
  const locked = published || untrusted;
  const hasReason = reason.trim().length > 0;

  let approveBlocked: string | null = null;
  if (published) approveBlocked = "Already published; published records are immutable.";
  else if (p.kind === "UNCITED_DRAFT") approveBlocked = "An uncited draft cannot be published without evidence. Request evidence or add a cited human draft.";
  else if (p.kind === "UNMATCHED_TAG") approveBlocked = "No candidate asset. Human mapping is required; this build has no approve-as-mapping action for unmatched tags.";
  else if (!p.validation.ok && p.kind !== "SOURCE_CONFLICT" && p.kind !== "ALIAS_MERGE") approveBlocked = `Validation errors block approval: ${p.validation.errors.join("; ")}`;
  else if (p.kind === "SOURCE_CONFLICT" && chosen === null) approveBlocked = "Choose which option resolves the conflict.";
  else if (p.kind === "ALIAS_MERGE" && !mappingAsset) approveBlocked = "Choose the asset this alias maps to.";

  const approve = () => {
    if (p.payload.kind === "ALIAS_MERGE") onReview("APPROVED", reason.trim(), { mapping: { assetId: mappingAsset } });
    else if (p.payload.kind === "SOURCE_CONFLICT" && chosen !== null) onReview("APPROVED", reason.trim(), { resolution: { chosen, reason: reason.trim() } });
    else onReview("APPROVED", reason.trim());
    setReason("");
  };
  const act = (d: Decision) => {
    onReview(d, reason.trim());
    setReason("");
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">{p.title}</h2>
          <StatusBadge value={p.state} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Badge tone="neutral">{kindLabel(p.kind)}</Badge>
          <PipelineBadge pipeline={p.pipeline} />
          <span>
            produced by <span className="text-text">{p.producedBy.replace(/_/g, " ").toLowerCase()}</span>
          </span>
          <span className="tnum">{formatIst(p.createdAt.ms, { date: true, seconds: false })}</span>
          <span className="mono">{p.id}</span>
        </div>
      </div>

      <div>
        <SectionTitle>Rationale</SectionTitle>
        <p className="mt-1 text-[13px]">{p.rationale}</p>
      </div>

      {p.validation.errors.length ? (
        <Callout tone="red" title="Validation errors">
          <ul className="list-disc pl-4">
            {p.validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      {p.validation.warnings.length ? (
        <Callout tone="amber" title="Validation warnings">
          <ul className="list-disc pl-4">
            {p.validation.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div>
        <SectionTitle>Evidence</SectionTitle>
        <div className="mt-1">
          <EvidenceSpans spans={p.evidence} sources={sources} />
        </div>
      </div>

      <div>
        <SectionTitle>Proposed change</SectionTitle>
        <div className="mt-1 rounded-md border border-border p-3">
          <Payload proposal={p} sources={sources} knowledge={knowledge} locked={locked} mappingAsset={mappingAsset} setMappingAsset={setMappingAsset} chosen={chosen} setChosen={setChosen} reason={reason} onReview={onReview} />
        </div>
      </div>

      {p.review ? (
        <div>
          <SectionTitle>Review record</SectionTitle>
          <KeyValue
            className="mt-1"
            items={[
              { k: "Decision", v: <StatusBadge value={p.review.decision} /> },
              { k: "Reviewer", v: `${p.review.reviewer}${p.review.simulatedIdentity ? " — simulated identity, not an authenticated user" : ""}` },
              { k: "Reason", v: p.review.reason },
              { k: "At", v: <span className="tnum">{formatIst(p.review.at.ms, { date: true })}</span> },
            ]}
          />
        </div>
      ) : null}

      {p.changeSummary.length ? (
        <div>
          <SectionTitle>Change summary</SectionTitle>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
            {p.changeSummary.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-md border border-border bg-surface-2/50 p-3">
        <SectionTitle>Review action</SectionTitle>
        {untrusted ? (
          <p className="mt-1 text-[13px] text-muted">No actions: untrusted instruction text is never a workflow action. It stays recorded as evidence of the note&apos;s content.</p>
        ) : published ? (
          <p className="mt-1 text-[13px] text-muted">This proposal has been published; its record is immutable. Changes need a new proposal.</p>
        ) : (
          <>
            <p className="mt-1 text-[12px] text-muted">
              Reviewing as <span className="text-text">{identity}</span> — simulated identity, not an authenticated user. A reason is required for every decision and is kept in the audit trail.
            </p>
            <label htmlFor={`reason-${p.id}`} className="sr-only">
              Reason
            </label>
            <Textarea id={`reason-${p.id}`} className="mt-2" rows={3} placeholder="Reason for the decision (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" disabled={!hasReason || !!approveBlocked} title={approveBlocked ?? undefined} onClick={approve}>
                Approve
              </Button>
              <Button variant="danger" disabled={!hasReason} onClick={() => act("REJECTED")}>
                Reject
              </Button>
              <Button disabled={!hasReason} onClick={() => act("DEFERRED")}>
                Defer
              </Button>
              <Button variant="outline" disabled={!hasReason} onClick={() => act("EVIDENCE_REQUESTED")}>
                Request evidence
              </Button>
            </div>
            {approveBlocked ? <p className="mt-2 text-[12px] text-amber">{approveBlocked}</p> : null}
            {!hasReason ? <p className="mt-2 text-[12px] text-muted">Enter a reason to enable the actions.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}

function Payload({ proposal: p, sources, knowledge, locked, mappingAsset, setMappingAsset, chosen, setChosen, reason, onReview }: { proposal: KnowledgeProposal; sources: SourceDocument[]; knowledge: KnowledgeVersion; locked: boolean; mappingAsset: string; setMappingAsset: (v: string) => void; chosen: number | null; setChosen: (v: number) => void; reason: string; onReview: (decision: Decision, reason: string, edits?: ProposalEdits) => void }) {
  const pl = p.payload;
  switch (pl.kind) {
    case "DEPENDENCY_EDGE":
    case "UNCITED_DRAFT":
      return (
        <div className="space-y-3">
          {pl.kind === "UNCITED_DRAFT" ? <Callout tone="amber" title="Uncited draft">Held by validation: no source span is cited, so this edge cannot be published. It can be edited, deferred, or sent back for evidence.</Callout> : null}
          <EdgeRecord edge={pl.edge} sources={sources} showEvidence={false} />
          {!locked ? <EdgeEditor edge={pl.edge} reason={reason} onSave={(edits, why) => onReview("EDITED", why, { edge: edits })} /> : null}
        </div>
      );
    case "ALIAS_MERGE": {
      const m = pl.mapping;
      return (
        <div className="space-y-3">
          <KeyValue
            items={[
              { k: "Alias", v: <span className="mono">{m.alias}</span> },
              { k: "Proposed asset", v: <span className="mono">{m.assetId ? assetLabel(m.assetId) : "none"}</span> },
              { k: "Status", v: <StatusBadge value={m.status} /> },
              { k: "Ambiguous", v: m.ambiguous ? <Badge tone="amber">yes — two plausible assets</Badge> : "no" },
            ]}
          />
          <div>
            <SectionTitle>Alternatives considered</SectionTitle>
            <ul className="mt-1 space-y-1 text-[13px]">
              {m.alternatives.length ? (
                m.alternatives.map((a, i) => (
                  <li key={`${a.assetId}-${i}`} className="rounded-md bg-surface-2 px-2.5 py-1.5">
                    <span className="mono">{assetLabel(a.assetId)}</span> <span className="text-muted">— {a.reason}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted">none recorded</li>
              )}
            </ul>
          </div>
          {!locked ? (
            <Field label="Map alias to asset (recorded with the approval)" hint="String resemblance is not a merge reason. Choose the asset the cited evidence supports.">
              <Select value={mappingAsset} onChange={(e) => setMappingAsset(e.target.value)} aria-label="Asset for alias">
                <option value="">— choose asset —</option>
                {ASSETS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      );
    }
    case "SOURCE_CONFLICT":
      return (
        <div className="space-y-3">
          <KeyValue
            items={[
              { k: "Subject", v: <span className="mono">{pl.subject}</span> },
              { k: "Affected edges", v: pl.affectedEdgeIds.length ? <span className="mono">{pl.affectedEdgeIds.join(", ")}</span> : "none" },
              { k: "Affected requirements", v: pl.affectedRequirementIds.length ? <span className="mono">{pl.affectedRequirementIds.join(", ")}</span> : "none" },
            ]}
          />
          <fieldset>
            <legend className="text-[12px] font-medium text-muted">Options — neither wins by date alone; decide by revision, scope, and equipment applicability</legend>
            <ul className="mt-1 space-y-2">
              {pl.options.map((o, i) => (
                <li key={i} className={`rounded-md border p-2.5 ${chosen === i ? "border-accent bg-accent-soft/40" : "border-border"}`}>
                  <label className="flex items-start gap-2 text-[13px]">
                    <input type="radio" name={`conflict-${p.id}`} className="mt-1" checked={chosen === i} disabled={locked} onChange={() => setChosen(i)} />
                    <span className="min-w-0">
                      <span className="font-medium">{o.label}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">
                        value <span className="mono text-text">{o.value}</span> · revision {o.revision ?? "not stated"} · scope {o.scope}
                      </span>
                    </span>
                  </label>
                  <div className="mt-2 pl-6">
                    <EvidenceSpans spans={o.evidence} sources={sources} compact />
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
          {pl.resolution ? (
            <Callout tone="green" title={`Resolved: option ${pl.resolution.chosen + 1}`}>
              {pl.resolution.reason}
            </Callout>
          ) : null}
        </div>
      );
    case "REQUIREMENT":
      return <RequirementRecord requirement={pl.requirement} sources={sources} knowledgeEdges={knowledge.edges} />;
    case "UNTRUSTED_INSTRUCTION":
      return (
        <div className="space-y-2">
          <Callout tone="red" title="Rejected as instruction">
            Document content asked the system to bypass review or act. Imported text is evidence to analyse, never operational authority. Nothing was executed.
          </Callout>
          <p className="text-[12px] text-muted">Quoted as data:</p>
          <blockquote className="mono whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px]">{pl.text}</blockquote>
        </div>
      );
    case "MISSING_CHANNEL":
      return (
        <div className="space-y-2">
          <KeyValue
            items={[
              { k: "Channel", v: <span className="mono">{pl.assetId}.{pl.tagName}</span> },
              { k: "Required by", v: pl.requiredBy.length ? <span className="mono">{pl.requiredBy.join(", ")}</span> : "no published rule" },
            ]}
          />
          <Callout tone="grey">Approving records the channel as not instrumented. Any rule that needs it must show unavailable evidence, never a healthy value.</Callout>
        </div>
      );
    case "UNMATCHED_TAG":
      return (
        <div className="space-y-2">
          <KeyValue
            items={[
              { k: "Raw tag", v: <span className="mono">{pl.rawTag}</span> },
              { k: "Occurrences", v: <span className="tnum">{pl.occurrences}</span> },
            ]}
          />
          <Callout tone="amber" title="Human mapping required">
            The resolver found no registry alias or similar asset name and does not guess. Mapping this tag to an asset needs a human decision; this build has no approve-as-mapping action for unmatched tags, so it can only be deferred, rejected, or sent back for evidence here.
          </Callout>
        </div>
      );
    default:
      return null;
  }
}

function EdgeEditor({ edge, reason, onSave }: { edge: DependencyEdge; reason: string; onSave: (edits: Partial<DependencyEdge>, reason: string) => void }) {
  const [relation, setRelation] = useState<RelationType>(edge.relation);
  const [value, setValue] = useState(edge.predicate ? String(edge.predicate.value) : "");
  const [modes, setModes] = useState<OperatingMode[]>(edge.applicableModes);
  useEffect(() => {
    setRelation(edge.relation);
    setValue(edge.predicate ? String(edge.predicate.value) : "");
    setModes(edge.applicableModes);
  }, [edge]);

  const parsedValue = (): DependencyEdge["predicate"] => {
    if (!edge.predicate) return undefined;
    const orig = edge.predicate.value;
    let v: number | boolean | string = value;
    if (typeof orig === "number") v = Number(value);
    else if (typeof orig === "boolean") v = value.trim().toLowerCase() === "true";
    return { ...edge.predicate, value: v };
  };
  const valueInvalid = !!edge.predicate && typeof edge.predicate.value === "number" && !Number.isFinite(Number(value));
  const changed = relation !== edge.relation || (edge.predicate && String(edge.predicate.value) !== value) || modes.join(",") !== edge.applicableModes.join(",");

  return (
    <div className="rounded-md border border-dashed border-border-strong p-3">
      <SectionTitle>Edit before review</SectionTitle>
      <p className="mt-0.5 text-[12px] text-muted">Edits are recorded as an EDITED review with your reason and return the proposal to needs-review.</p>
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        <Field label="Relation">
          <Select value={relation} onChange={(e) => setRelation(e.target.value as RelationType)} aria-label="Relation">
            {RELATION_TYPES.map((r) => (
              <option key={r} value={r}>
                {relationTitle(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={edge.predicate ? `Predicate value (${edge.predicate.tag} ${edge.predicate.operator} …${edge.predicate.unit ? ` ${edge.predicate.unit}` : ""})` : "Predicate value"} hint={edge.predicate ? undefined : "This edge has no predicate."}>
          <Input value={value} disabled={!edge.predicate} onChange={(e) => setValue(e.target.value)} aria-label="Predicate value" />
        </Field>
        <fieldset>
          <legend className="mb-1 block text-[12px] font-medium text-muted">Applicable modes</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <label key={m} className="flex items-center gap-1 text-[12px]">
                <input type="checkbox" checked={modes.includes(m)} onChange={(e) => setModes(e.target.checked ? [...modes, m] : modes.filter((x) => x !== m))} />
                {m}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={!changed || valueInvalid || !reason.trim()} title={!reason.trim() ? "Enter a reason below first" : valueInvalid ? "Predicate value must be numeric" : undefined} onClick={() => onSave({ relation, applicableModes: modes, ...(edge.predicate ? { predicate: parsedValue() } : {}) }, reason.trim())}>
          Save edits (EDITED)
        </Button>
        {!reason.trim() ? <span className="text-[12px] text-muted">Uses the reason from the review action box.</span> : null}
      </div>
    </div>
  );
}
