"use client";

import { useMemo, useState } from "react";
import type { DependencyEdge, RelationType, SourceDocument, SourceSpan } from "@/lib/domain/types";
import { ASSETS } from "@/lib/domain/plant";
import { stableId } from "@/lib/util";
import { Button, Callout, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { useApp } from "@/store/app";
import { RELATION_TYPES, relationTitle, spanLines } from "./helpers";

/** Dialog for an engineer-entered dependency edge. Uncited drafts are labelled as such. */
export function HumanDraftDialog({ open, onOpenChange, sources }: { open: boolean; onOpenChange: (v: boolean) => void; sources: SourceDocument[] }) {
  const addHumanEdgeDraft = useApp((s) => s.addHumanEdgeDraft);
  const toast = useApp((s) => s.toast);
  const [from, setFrom] = useState(ASSETS[0]?.id ?? "");
  const [to, setTo] = useState(ASSETS[1]?.id ?? "");
  const [relation, setRelation] = useState<RelationType>("PNEUMATIC_PREREQUISITE");
  const [summary, setSummary] = useState("");
  const [rationale, setRationale] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [startLine, setStartLine] = useState("");
  const [endLine, setEndLine] = useState("");

  const citable = useMemo(() => sources.filter((d) => d.lines.length > 0), [sources]);
  const span: SourceSpan | null = useMemo(() => {
    if (!sourceId) return null;
    const s = Number(startLine);
    const e = endLine ? Number(endLine) : s;
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 1 || e < s) return null;
    return { sourceId, startLine: s, endLine: e };
  }, [sourceId, startLine, endLine]);
  const preview = span ? spanLines(sources, span, 6) : null;
  const spanValid = !!preview && !!preview.doc && !preview.outOfRange && preview.lines.some((l) => l.text.trim() !== "");
  const uncited = !sourceId;
  const canSubmit = from && to && from !== to && summary.trim() && rationale.trim() && (uncited || spanValid);

  const submit = () => {
    const evidenceRefs = span && spanValid ? [span] : [];
    const edge: DependencyEdge = {
      id: stableId("DEP-HUMAN", from, to, relation),
      from,
      to,
      relation,
      applicableModes: ["AUTO"],
      applicablePhases: [],
      evidenceRefs,
      basis: evidenceRefs.length ? "DEMO_ENGINEER_AUTHORED_RULE" : "UNRESOLVED_INFERENCE",
      reviewStatus: "DRAFT",
      knowledgeVersion: "draft",
      limitations: evidenceRefs.length ? ["Human draft; requires engineer review before publication"] : ["No cited source span; cannot be published"],
      summary: summary.trim(),
    };
    addHumanEdgeDraft(edge, rationale.trim());
    toast("success", evidenceRefs.length ? `Human draft ${edge.id} added to the review queue.` : `Uncited draft ${edge.id} added; it cannot be published until evidence is cited.`);
    onOpenChange(false);
    setSummary("");
    setRationale("");
    setSourceId("");
    setStartLine("");
    setEndLine("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add human draft edge" description="An engineer-authored dependency proposal. It enters the same review queue as pipeline output and is labelled as a human draft." wide>
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="From (cause)">
            <Select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From asset">
              {ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To (effect)">
            <Select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To asset">
              {ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Relation">
            <Select value={relation} onChange={(e) => setRelation(e.target.value as RelationType)} aria-label="Relation">
              {RELATION_TYPES.map((r) => (
                <option key={r} value={r}>
                  {relationTitle(r)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {from === to ? <Callout tone="red">An asset cannot depend on itself.</Callout> : null}
        <Field label="Summary (one sentence)">
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. CHLR-01 supplies chilled coolant to PUMP-02 during cutting" />
        </Field>
        <Field label="Rationale">
          <Textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this relationship is being proposed" />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Citation source (optional)">
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Citation source">
              <option value="">— no citation (uncited draft) —</option>
              {citable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName} ({d.lines.length} lines)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start line">
            <Input inputMode="numeric" value={startLine} disabled={!sourceId} onChange={(e) => setStartLine(e.target.value)} />
          </Field>
          <Field label="End line (optional)">
            <Input inputMode="numeric" value={endLine} disabled={!sourceId} onChange={(e) => setEndLine(e.target.value)} />
          </Field>
        </div>
        {sourceId ? (
          preview && preview.doc ? (
            spanValid ? (
              <ol className="mono max-h-40 overflow-auto rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5 text-[12px] leading-5">
                {preview.lines.map((l) => (
                  <li key={l.n} className="flex gap-2">
                    <span className="tnum w-8 shrink-0 text-right text-muted">{l.n}</span>
                    <span className="whitespace-pre-wrap break-words">{l.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Callout tone="amber">Enter a line range inside the document (1–{preview.doc.lines.length}) that contains text.</Callout>
            )
          ) : (
            <Callout tone="amber">Enter a start line.</Callout>
          )
        ) : (
          <Callout tone="amber" title="Uncited draft">
            Without a citation this becomes an UNCITED_DRAFT: it is held by validation and cannot be approved or published until evidence is cited.
          </Callout>
        )}
        <div className="flex gap-2">
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {uncited ? "Add uncited draft" : "Add draft edge"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
