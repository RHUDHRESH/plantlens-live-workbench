"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, FileUp, Play, Sparkles } from "lucide-react";
import type { SourceDocument } from "@/lib/domain/types";
import { MAX_FILE_BYTES } from "@/lib/sources/parsers";
import { fetchAIStatus, type AIStatus } from "@/lib/ai/adapter";
import { formatIst, cn } from "@/lib/util";
import { useApp } from "@/store/app";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { SourceViewer } from "@/components/knowledge/SourceViewer";
import { MappingEditor } from "@/components/knowledge/MappingEditor";
import { PipelineStepper } from "@/components/knowledge/PipelineStepper";
import { ConnectedAIDialog } from "@/components/knowledge/ConnectedAIDialog";
import { formatBytes, resolveSource } from "@/components/knowledge/helpers";

const PACK_COUNT_LABELS: Record<string, string> = {
  assets: "assets",
  tags: "tag rows",
  traceRows: "trace rows",
  traceMinutes: "trace minutes",
  alarms: "alarms",
  workOrders: "work orders",
  completeCycles: "complete cycles",
  templates: "templates",
  baselines: "baselines",
  noteEntries: "note entries",
};

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SourcesPage />
    </Suspense>
  );
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  });
}

function SourcesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const snapshot = useApp((s) => s.snapshot);
  const sources = useApp((s) => s.sources);
  const parsedFiles = useApp((s) => s.parsedFiles);
  const pendingImports = useApp((s) => s.pendingImports);
  const pipelineStages = useApp((s) => s.pipelineStages);
  const proposals = useApp((s) => s.proposals);
  const samplePack = useApp((s) => s.samplePack);
  const workspace = useApp((s) => s.workspace);
  const importFiles = useApp((s) => s.importFiles);
  const loadSamplePack = useApp((s) => s.loadSamplePack);
  const downloadSamplePack = useApp((s) => s.downloadSamplePack);
  const runPipeline = useApp((s) => s.runPipeline);
  const toast = useApp((s) => s.toast);

  const docParam = params.get("doc") ?? undefined;
  const lineParam = Number(params.get("line"));
  const highlightLine = Number.isFinite(lineParam) && lineParam > 0 ? lineParam : undefined;
  const wantsImport = params.get("import") === "1";

  const [ai, setAi] = useState<AIStatus | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingPack, setLoadingPack] = useState(false);
  const importRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void fetchAIStatus().then((s) => {
      if (alive) setAi(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (wantsImport && importRef.current) {
      importRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
      fileInput.current?.focus();
    }
  }, [wantsImport]);

  const resolved = useMemo(() => resolveSource(sources, docParam), [sources, docParam]);
  const selectedDoc = resolved.doc;
  const selectedParsed = selectedDoc ? parsedFiles.find((p) => p.document.id === selectedDoc.id) : undefined;
  const selectedPending = selectedDoc ? pendingImports.find((p) => p.fileId === selectedDoc.id) : undefined;

  useEffect(() => {
    if (selectedDoc && viewerRef.current && !highlightLine) viewerRef.current.scrollIntoView({ block: "start" });
  }, [selectedDoc?.id, highlightLine, selectedDoc]);

  const select = useCallback(
    (doc: SourceDocument, line?: number) => {
      const q = new URLSearchParams();
      q.set("doc", doc.id);
      if (line) q.set("line", String(line));
      router.push(`/knowledge/sources?${q.toString()}`);
    },
    [router],
  );

  const handleFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (!files.length) return;
      setImporting(true);
      try {
        const payload: Array<{ name: string; text: string; size: number }> = [];
        for (const f of files) {
          if (f.size > MAX_FILE_BYTES) {
            toast("error", `${f.name} is ${formatBytes(f.size)}; the limit is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB. Not imported.`);
            continue;
          }
          try {
            payload.push({ name: f.name, text: await readAsText(f), size: f.size });
          } catch (e) {
            toast("error", `${f.name} could not be read: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (!payload.length) return;
        await importFiles(payload);
        const after = useApp.getState().sources;
        for (const p of payload) {
          const d = after.find((s) => s.fileName === p.name);
          if (d?.parseStatus === "UNSUPPORTED") toast("error", `${d.fileName}: unsupported. ${d.requiredExport ?? ""}`);
          else if (d?.parseStatus === "FAILED") toast("error", `${d.fileName}: ${d.parseMessages.join(" ")}`);
        }
        const first = after.find((s) => s.fileName === payload[0].name);
        if (first) select(first);
      } finally {
        setImporting(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [importFiles, select, toast],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  if (!snapshot) return <LoadingState label="Starting the simulation engine…" />;

  const sortedSources = [...sources].sort((a, b) => a.fileName.localeCompare(b.fileName));
  const modeLabel = workspace.mode === "IMPORTED_REPLAY" ? "IMPORTED REPLAY" : workspace.mode === "DEMO_SIMULATION" ? "SIMULATION" : "LIVE: Not configured";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Knowledge sources"
        description="Factory files enter here as evidence: parsed deterministically, kept with their line numbers, and cited by every later proposal. Uploaded content is never executed and never treated as an instruction."
        badges={
          <>
            <Badge tone="accent">{modeLabel}</Badge>
            <Badge tone="grey">Stored in this browser — not cloud-synced</Badge>
          </>
        }
        actions={
          <>
            <Button
              disabled={loadingPack}
              onClick={async () => {
                setLoadingPack(true);
                try {
                  await loadSamplePack();
                } finally {
                  setLoadingPack(false);
                }
              }}
            >
              <Play size={14} /> {loadingPack ? "Loading…" : "Load sample factory pack"}
            </Button>
            <Button variant="outline" onClick={() => void downloadSamplePack()}>
              <Download size={14} /> Download sample pack (.zip)
            </Button>
          </>
        }
      />

      {samplePack ? (
        <Callout tone="neutral" title="Sample factory pack (fictional fixture)">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(samplePack.counts).map(([k, v]) => (
              <span key={k}>
                <span className="tnum font-medium">{v}</span> <span className="text-muted">{PACK_COUNT_LABELS[k] ?? k}</span>
              </span>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-muted">Counts are computed from the generated pack. The operating trace is not loaded as a source; import operating_trace.csv from the downloaded pack to create a replay workspace.</p>
        </Callout>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Import files" description="CSV, JSON, TXT and MD are parsed locally. Binary PLC projects are reported as unsupported with the export that is required instead." />
          <CardBody>
            <div
              ref={importRef}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn("rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors", dragging ? "border-accent bg-accent-soft" : "border-border-strong")}
            >
              <FileUp size={20} className="mx-auto text-muted" aria-hidden />
              <p className="mt-2 text-sm">Drag files here, or</p>
              <label htmlFor="source-files" className="sr-only">
                Choose files to import
              </label>
              <input id="source-files" ref={fileInput} type="file" multiple accept=".csv,.json,.txt,.md,.ap15,.ap16,.ap17,.ap18,.zap16,.s7p,.acd,.l5x,.pro,.xef,.gxw,.zip,.pdf,.docx,.xlsx" className="sr-only" onChange={(e) => void handleFiles(e.target.files ?? [])} />
              <Button className="mt-2" variant="primary" disabled={importing} onClick={() => fileInput.current?.click()}>
                {importing ? "Reading…" : "Choose files"}
              </Button>
              <p className="mt-2 text-[12px] text-muted">
                Up to {Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per file. Files are read in this browser; nothing is uploaded unless you explicitly confirm a connected-AI request.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Compilation pipeline"
            description={ai ? ai.detail : "Checking AI mode…"}
            actions={
              <>
                {ai?.mode === "CONNECTED" ? (
                  <Button size="sm" variant="outline" onClick={() => setAiOpen(true)} disabled={!sources.length}>
                    <Sparkles size={14} /> Propose with connected AI
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => runPipeline()} disabled={!parsedFiles.length} title={!parsedFiles.length ? "Import files first" : undefined}>
                  Re-run local pipeline
                </Button>
              </>
            }
          />
          <CardBody>
            <div className="mb-3">
              {ai === null ? <Badge tone="grey">AI mode: checking…</Badge> : ai.mode === "CONNECTED" ? <Badge tone="accent">Connected AI — server-side provider, bounded calls, explicit confirmation</Badge> : <Badge tone="grey">Local demo pipeline — deterministic rules, no language model</Badge>}
            </div>
            <PipelineStepper stages={pipelineStages} />
            {proposals.length ? (
              <p className="mt-3 text-[12px] text-muted">
                <span className="tnum">{proposals.length}</span> proposals in the review queue.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {pendingImports.length ? (
        <Card>
          <CardHeader title="Trace files awaiting column mapping" description="Operating traces are not replayed until their columns are mapped and the quality report has been reviewed." />
          <CardBody className="flex flex-wrap gap-2">
            {pendingImports.map((p) => {
              const doc = sources.find((s) => s.id === p.fileId);
              return (
                <Button key={p.fileId} variant="outline" onClick={() => (doc ? select(doc) : undefined)} disabled={!doc}>
                  <span className="mono">{p.fileName}</span>
                  <span className="tnum text-muted">{p.rowCount} rows</span>
                  {p.report ? <Badge tone="green">previewed</Badge> : <Badge tone="amber">mapping needed</Badge>}
                </Button>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Source documents" description="Select a row to open the viewer. Every proposal cites these files by id and line." />
        <CardBody>
          {sortedSources.length === 0 ? (
            <EmptyState title="No sources imported" description="Load the sample factory pack or import your own CSV/JSON/TXT exports." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Type</Th>
                  <Th>Category</Th>
                  <Th>Parse</Th>
                  <Th className="text-right">Rows / lines</Th>
                  <Th>Fingerprint</Th>
                  <Th>Revision</Th>
                  <Th>Imported</Th>
                </tr>
              </thead>
              <tbody>
                {sortedSources.map((d) => {
                  const active = selectedDoc?.id === d.id;
                  return (
                    <tr key={d.id} className={cn("cursor-pointer hover:bg-surface-2", active && "bg-accent-soft")} onClick={() => select(d)} aria-current={active ? "true" : undefined}>
                      <Td>
                        <button type="button" className="mono text-left text-accent hover:underline" onClick={(e) => { e.stopPropagation(); select(d); }}>
                          {d.fileName}
                        </button>
                        {d.parseStatus === "UNSUPPORTED" && d.requiredExport ? <p className="mt-0.5 max-w-md text-[12px] text-amber">{d.requiredExport}</p> : null}
                        {d.parseStatus === "FAILED" && d.parseMessages.length ? <p className="mt-0.5 max-w-md text-[12px] text-red">{d.parseMessages.join(" ")}</p> : null}
                      </Td>
                      <Td className="whitespace-nowrap">{d.sourceType.replace(/_/g, " ").toLowerCase()}</Td>
                      <Td className="whitespace-nowrap">{d.category.toLowerCase()}</Td>
                      <Td>
                        <StatusBadge value={d.parseStatus} />
                      </Td>
                      <Td className="tnum text-right">{d.rowCount !== undefined ? `${d.rowCount} rows` : `${d.lines.length} lines`}</Td>
                      <Td className="mono text-[12px]">{d.sha256}</Td>
                      <Td className="text-[12px]">{d.revision ?? "—"}</Td>
                      <Td className="tnum whitespace-nowrap text-[12px]">{formatIst(d.importedAt.ms, { date: true, seconds: false })}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div ref={viewerRef}>
        {docParam && !selectedDoc ? (
          <ErrorState title="Record not available in this browser" description={`Source ${docParam} is not in this workspace. Load the sample factory pack, re-import the file, or import an evidence bundle that contains it.`} />
        ) : selectedDoc ? (
          <Card>
            <CardHeader title="Document viewer" description="Text is shown exactly as imported, with line numbers. Click a line and copy its citation to reference it in a review." />
            <CardBody className="space-y-4">
              {selectedPending ? <MappingEditor pending={selectedPending} /> : null}
              <SourceViewer doc={selectedDoc} parsed={selectedParsed} highlightLine={highlightLine} aliasedFrom={resolved.aliased ? docParam : undefined} />
            </CardBody>
          </Card>
        ) : null}
      </div>

      <ConnectedAIDialog open={aiOpen} onOpenChange={setAiOpen} sources={sources} />
    </div>
  );
}
