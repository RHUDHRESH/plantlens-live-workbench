"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { SourceDocument, SourceSpan } from "@/lib/domain/types";
import { Badge } from "@/components/ui";
import { spanLines, viewerHref } from "./helpers";

/**
 * Renders cited source spans with the actual text from the imported document. Text is
 * rendered as text (React escaping), never as HTML. A missing document is reported as
 * such rather than hidden.
 */
export function EvidenceSpans({ spans, sources, compact }: { spans: SourceSpan[]; sources: SourceDocument[]; compact?: boolean }) {
  if (!spans.length) return <p className="text-[13px] text-muted">No cited source span.</p>;
  return (
    <ul className="space-y-2">
      {spans.map((s, i) => {
        const r = spanLines(sources, s, compact ? 4 : 12);
        return (
          <li key={`${s.sourceId}-${s.startLine}-${s.endLine}-${i}`} className="rounded-md border border-border bg-surface-2/60">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
              <span className="mono text-[12px]">
                {s.sourceId}:{s.startLine}
                {s.endLine !== s.startLine ? `-${s.endLine}` : ""}
                {s.column ? ` (${s.column})` : ""}
                {r.doc ? <span className="ml-2 text-muted">{r.doc.fileName}</span> : null}
              </span>
              <span className="flex items-center gap-1.5">
                {r.aliased ? <Badge tone="grey" title="Fixture id matched to the imported file by name">fixture id</Badge> : null}
                {r.outOfRange ? <Badge tone="red">outside document</Badge> : null}
                {r.doc ? (
                  <Link href={viewerHref(s)} className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
                    Open in viewer <ExternalLink size={12} />
                  </Link>
                ) : null}
              </span>
            </div>
            {r.doc ? (
              <ol className="mono max-h-48 overflow-auto px-2.5 py-1.5 text-[12px] leading-5">
                {r.lines.map((l) => (
                  <li key={l.n} className="flex gap-2">
                    <span className="tnum w-8 shrink-0 select-none text-right text-muted">{l.n}</span>
                    <span className="whitespace-pre-wrap break-words">{l.text}</span>
                  </li>
                ))}
                {r.truncated ? <li className="text-muted">… (span continues; open in viewer)</li> : null}
              </ol>
            ) : (
              <p className="px-2.5 py-1.5 text-[12px] text-muted">Source document {s.sourceId} is not in this browser. Load the sample factory pack or import a bundle to see the cited text.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
