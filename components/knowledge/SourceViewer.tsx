/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { SourceDocument } from "@/lib/domain/types";
import type { ParsedFile } from "@/lib/sources/parsers";
import { formatIst, cn } from "@/lib/util";
import { Badge, Button, Callout, Input, KeyValue, StatusBadge, Table, TabsContent, TabsList, TabsTrigger, Tabs, Td, Th } from "@/components/ui";
import { useApp } from "@/store/app";
import { formatBytes } from "./helpers";

const PAGE = 400;
const CSV_PREVIEW_ROWS = 200;

/**
 * Plain-text document viewer. Lines are rendered as text with line numbers (never HTML).
 * Large documents are paged so the DOM stays small; the highlighted line selects its page.
 */
export function SourceViewer({ doc, parsed, highlightLine, aliasedFrom }: { doc: SourceDocument; parsed?: ParsedFile; highlightLine?: number; aliasedFrom?: string }) {
  const toast = useApp((s) => s.toast);
  const [selected, setSelected] = useState<number | null>(highlightLine ?? null);
  const [page, setPage] = useState(() => (highlightLine ? Math.floor((highlightLine - 1) / PAGE) : 0));
  const [jump, setJump] = useState("");
  const lineRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const total = doc.lines.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  useEffect(() => {
    setSelected(highlightLine ?? null);
    if (highlightLine) setPage(Math.floor((highlightLine - 1) / PAGE));
    else setPage(0);
  }, [highlightLine, doc.id]);

  useEffect(() => {
    if (!selected) return;
    const el = lineRefs.current.get(selected);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    }
  }, [selected, page, doc.id]);

  const start = page * PAGE;
  const visible = useMemo(() => doc.lines.slice(start, start + PAGE), [doc.lines, start]);

  const copyCitation = async (line: number) => {
    const text = `${doc.id}:${line}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("success", `Citation copied: ${text}`);
    } catch {
      toast("error", `Clipboard unavailable. Citation: ${text}`);
    }
  };

  const goTo = (line: number) => {
    if (!Number.isFinite(line) || line < 1 || line > total) return;
    setPage(Math.floor((line - 1) / PAGE));
    setSelected(line);
  };

  const meta = (
    <KeyValue
      items={[
        { k: "Source id", v: <span className="mono">{doc.id}</span> },
        { k: "Type", v: `${doc.sourceType} · ${doc.category}` },
        { k: "Size", v: <span className="tnum">{formatBytes(doc.sizeBytes)}{doc.rowCount !== undefined ? ` · ${doc.rowCount} rows` : ` · ${total} lines`}</span> },
        { k: "Fingerprint", v: <span className="mono">{doc.sha256}</span> },
        { k: "Revision", v: doc.revision ?? "not stated in the document" },
        { k: "Imported", v: <span className="tnum">{formatIst(doc.importedAt.ms, { date: true })} (browser wall clock)</span> },
      ]}
    />
  );

  const textView = (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className="tnum">
          Lines {total ? start + 1 : 0}–{Math.min(total, start + PAGE)} of {total}
        </span>
        {pages > 1 ? (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </span>
        ) : null}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            goTo(Number(jump));
          }}
        >
          <label htmlFor={`jump-${doc.id}`} className="sr-only">
            Go to line
          </label>
          <Input id={`jump-${doc.id}`} className="h-7 w-24" placeholder="Line #" inputMode="numeric" value={jump} onChange={(e) => setJump(e.target.value)} />
          <Button size="sm" type="submit">
            Go
          </Button>
        </form>
        {selected ? (
          <Button size="sm" variant="outline" onClick={() => void copyCitation(selected)}>
            <Copy size={13} /> Copy citation {doc.id}:{selected}
          </Button>
        ) : (
          <span>Select a line to copy a citation.</span>
        )}
      </div>
      {total === 0 ? (
        <Callout tone="grey">No text lines. {doc.parseStatus === "UNSUPPORTED" ? doc.requiredExport : "The document is empty."}</Callout>
      ) : (
        <ol className="mono scroll-thin max-h-[60vh] overflow-auto rounded-md border border-border bg-surface-2/40 py-1 text-[12px] leading-5" aria-label={`${doc.fileName} text`}>
          {visible.map((text, i) => {
            const n = start + i + 1;
            const active = n === selected;
            return (
              <li
                key={n}
                ref={(el) => {
                  if (el) lineRefs.current.set(n, el);
                  else lineRefs.current.delete(n);
                }}
                tabIndex={-1}
                aria-current={active ? "true" : undefined}
                onClick={() => setSelected(n)}
                className={cn("flex cursor-pointer gap-2 px-2 focus:outline-none", active ? "bg-accent-soft" : "hover:bg-surface-2")}
              >
                <span className="tnum w-10 shrink-0 select-none text-right text-muted">{n}</span>
                <span className="whitespace-pre-wrap break-words">{text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );

  const csv = parsed?.csv;
  const rowsView = csv ? (
    <div>
      <p className="mb-2 text-[12px] text-muted">
        Parsed rows (first {Math.min(CSV_PREVIEW_ROWS, csv.rows.length)} of {csv.rows.length}). Row numbers are file line numbers (header is line 1).
      </p>
      <Table className="max-h-[60vh] overflow-y-auto">
        <thead>
          <tr>
            <Th className="tnum">Line</Th>
            {csv.headers.map((h, i) => (
              <Th key={`${h}-${i}`}>{h}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csv.rows.slice(0, CSV_PREVIEW_ROWS).map((r, i) => (
            <tr key={i} className={i + 2 === selected ? "bg-accent-soft" : undefined}>
              <Td className="tnum">
                <button type="button" className="text-accent hover:underline" onClick={() => goTo(i + 2)}>
                  {i + 2}
                </button>
              </Td>
              {csv.headers.map((_, j) => (
                <Td key={j} className="mono whitespace-nowrap">
                  {r[j] ?? ""}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      {csv.errors.length ? <Callout tone="amber" title="Parser messages" className="mt-2">{csv.errors.join("; ")}</Callout> : null}
    </div>
  ) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{doc.fileName}</h2>
        <StatusBadge value={doc.parseStatus} />
        <Badge tone="grey">fictional fixture</Badge>
        {aliasedFrom ? <Badge tone="grey" title="The link used a fixture id; matched to this imported file by name">linked as {aliasedFrom}</Badge> : null}
      </div>
      {meta}
      {doc.parseMessages.length ? <Callout tone={doc.parseStatus === "FAILED" ? "red" : "neutral"} title="Parser messages">{doc.parseMessages.join(" ")}</Callout> : null}
      {doc.parseStatus === "UNSUPPORTED" && doc.requiredExport ? <Callout tone="amber" title="Required export">{doc.requiredExport}</Callout> : null}
      {rowsView ? (
        <Tabs defaultValue="text">
          <TabsList>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="rows" count={Math.min(CSV_PREVIEW_ROWS, csv?.rows.length ?? 0)}>
              Parsed rows
            </TabsTrigger>
          </TabsList>
          <TabsContent value="text">{textView}</TabsContent>
          <TabsContent value="rows">{rowsView}</TabsContent>
        </Tabs>
      ) : (
        textView
      )}
    </div>
  );
}
