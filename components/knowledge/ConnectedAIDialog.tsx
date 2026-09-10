"use client";

import { useMemo, useState } from "react";
import type { SourceDocument } from "@/lib/domain/types";
import { ASSETS } from "@/lib/domain/plant";
import { callConnectedAI, verifyCitations, type ExcerptPayload, type ModelOutput } from "@/lib/ai/adapter";
import { Badge, Button, Callout, Dialog, Table, Td, Th } from "@/components/ui";
import { EvidenceSpans } from "./EvidenceSpans";
import { formatBytes, utf8Bytes } from "./helpers";

const MAX_EXCERPTS = 12;
const MAX_EXCERPT_CHARS = 12_000;
const QUESTION = "From these excerpts, list explicit dependency relationships between the named assets. Cite the exact lines for each. Do not infer from co-occurrence.";

type Verified = ReturnType<typeof verifyCitations>;

/**
 * Connected-AI proposal flow. Nothing leaves the browser until the user sees exactly which
 * excerpts will be sent and confirms. Returned citations are verified against the local
 * documents before anything is shown as accepted.
 */
export function ConnectedAIDialog({ open, onOpenChange, sources }: { open: boolean; onOpenChange: (v: boolean) => void; sources: SourceDocument[] }) {
  const eligible = useMemo(() => sources.filter((d) => d.parseStatus !== "UNSUPPORTED" && d.parseStatus !== "FAILED" && d.lines.length > 0 && (d.category === "EXPLANATORY" || d.category === "CONFIGURATION")), [sources]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(eligible.filter((d) => d.sourceType === "ENGINEER_NOTES" || d.sourceType === "PLC_SEQUENCE_EXCERPT").map((d) => d.id)));
  const [stage, setStage] = useState<"select" | "confirm" | "calling" | "done">("select");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ output: ModelOutput; verified: Verified; tokens?: number } | null>(null);

  const excerpts = useMemo(() => {
    const out: ExcerptPayload["excerpts"] = [];
    for (const d of eligible) {
      if (!selectedIds.has(d.id)) continue;
      // Split long documents into consecutive line blocks under the per-excerpt limit.
      let startLine = 1;
      let buf: string[] = [];
      let size = 0;
      for (let i = 0; i < d.lines.length; i++) {
        const l = d.lines[i];
        if (size + l.length + 1 > MAX_EXCERPT_CHARS && buf.length) {
          out.push({ sourceId: d.id, fileName: d.fileName, startLine, text: buf.join("\n") });
          startLine = i + 1;
          buf = [];
          size = 0;
        }
        buf.push(l);
        size += l.length + 1;
      }
      if (buf.length) out.push({ sourceId: d.id, fileName: d.fileName, startLine, text: buf.join("\n") });
    }
    return out.slice(0, MAX_EXCERPTS);
  }, [eligible, selectedIds]);

  const totalBytes = excerpts.reduce((n, e) => n + utf8Bytes(e.text), 0);

  const reset = () => {
    setStage("select");
    setError(null);
    setResult(null);
  };

  const send = async () => {
    setStage("calling");
    setError(null);
    const payload: ExcerptPayload = { excerpts, assetIds: ASSETS.map((a) => a.id), question: QUESTION };
    const r = await callConnectedAI(payload);
    if (!r.ok) {
      setError(r.error);
      setStage("confirm");
      return;
    }
    setResult({ output: r.output, verified: verifyCitations(r.output, sources), tokens: r.tokens });
    setStage("done");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title="Propose with connected AI"
      description="Bounded model call on selected excerpts via the server-side provider. The local pipeline remains the default; model output is validated and every citation is verified locally before it is shown."
      wide
    >
      {stage === "select" ? (
        <div className="space-y-3">
          {eligible.length === 0 ? <Callout tone="grey">No explanatory or configuration text documents are loaded. Import notes or a sequence excerpt first.</Callout> : null}
          <ul className="space-y-1">
            {eligible.map((d) => (
              <li key={d.id}>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(d.id)}
                    onChange={(e) => {
                      const next = new Set(selectedIds);
                      if (e.target.checked) next.add(d.id);
                      else next.delete(d.id);
                      setSelectedIds(next);
                    }}
                  />
                  <span className="mono">{d.fileName}</span>
                  <span className="text-muted">
                    {d.sourceType} · <span className="tnum">{d.lines.length}</span> lines
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={!excerpts.length} onClick={() => setStage("confirm")}>
              Review what will be sent
            </Button>
            <span className="tnum text-[12px] text-muted">
              {excerpts.length} excerpt{excerpts.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
            </span>
          </div>
        </div>
      ) : null}

      {stage === "confirm" || stage === "calling" ? (
        <div className="space-y-3">
          <Callout tone="amber" title="These excerpts will leave the browser">
            They are sent to this deployment&apos;s server route, which forwards them to the configured model provider. Nothing else from the workspace is included. Excerpts over the limit are cut at line boundaries.
          </Callout>
          <Table>
            <thead>
              <tr>
                <Th>Source id</Th>
                <Th>File</Th>
                <Th>Lines</Th>
                <Th className="text-right">Bytes</Th>
              </tr>
            </thead>
            <tbody>
              {excerpts.map((e, i) => {
                const lineCount = e.text.split("\n").length;
                return (
                  <tr key={`${e.sourceId}-${e.startLine}-${i}`}>
                    <Td className="mono">{e.sourceId}</Td>
                    <Td className="mono">{e.fileName}</Td>
                    <Td className="tnum">
                      {e.startLine}–{e.startLine + lineCount - 1}
                    </Td>
                    <Td className="tnum text-right">{utf8Bytes(e.text)}</Td>
                  </tr>
                );
              })}
              <tr>
                <Td colSpan={3} className="font-medium">
                  Total
                </Td>
                <Td className="tnum text-right font-medium">{totalBytes}</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-[12px] text-muted">Question sent with the excerpts: “{QUESTION}”</p>
          {error ? <Callout tone="red" title="Call failed">{error}</Callout> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={stage === "calling"} onClick={() => void send()}>
              {stage === "calling" ? "Calling connected AI…" : "I confirm — send these excerpts"}
            </Button>
            <Button variant="ghost" disabled={stage === "calling"} onClick={() => setStage("select")}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {stage === "done" && result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">{result.verified.accepted.length} accepted</Badge>
            <Badge tone="red">{result.verified.rejected.length} rejected</Badge>
            {result.tokens !== undefined ? <span className="tnum text-[12px] text-muted">{result.tokens} tokens</span> : null}
          </div>
          <Callout tone="neutral">
            Accepted proposals passed schema validation and cite real, non-empty lines. They are shown here for engineer reading only: this build has no store action to enqueue connected-AI proposals into the review queue, so nothing has been added to knowledge. Copy a cited line into a human draft edge if you want it reviewed.
          </Callout>
          {result.verified.accepted.map((p, i) => (
            <div key={`a-${i}`} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-[13px]">
                  {p.from} → {p.to}
                </span>
                <Badge tone="accent">{p.relation.replace(/_/g, " ").toLowerCase()}</Badge>
                {p.temporalOnly ? <Badge tone="amber">temporal association only</Badge> : null}
                <Badge tone="green">citations verified</Badge>
              </div>
              <p className="mt-1 text-[13px]">{p.summary}</p>
              {p.uncertainty ? <p className="mt-1 text-[12px] text-muted">Uncertainty stated by the model: {p.uncertainty}</p> : null}
              <div className="mt-2">
                <EvidenceSpans spans={p.citations} sources={sources} compact />
              </div>
            </div>
          ))}
          {result.verified.rejected.map((r, i) => (
            <div key={`r-${i}`} className="rounded-md border border-red/40 bg-red-soft p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-[13px]">
                  {r.proposal.from} → {r.proposal.to}
                </span>
                <Badge tone="red">rejected</Badge>
              </div>
              <p className="mt-1 text-[13px]">{r.reason}</p>
            </div>
          ))}
          <Button variant="ghost" onClick={reset}>
            Start over
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
