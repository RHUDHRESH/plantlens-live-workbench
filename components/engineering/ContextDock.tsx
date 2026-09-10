"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  BookOpen,
  ChevronDown,
  FileText,
  Globe,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Button, Input } from "@/components/ui";
import {
  importEvidence,
  listEvidence,
  nativeEvidence,
  searchEvidence,
  type EvidenceDocument,
  type EvidenceExcerpt,
  type ResearchResponse,
} from "@/lib/context/evidence-client";
import styles from "./context-dock.module.css";

export function ContextDock() {
  const [tab, setTab] = useState<"files" | "search" | "research" | null>(null);
  const [documents, setDocuments] = useState<EvidenceDocument[]>([]);
  const [results, setResults] = useState<EvidenceExcerpt[]>([]);
  const [query, setQuery] = useState("");
  const [webQuery, setWebQuery] = useState("");
  const [research, setResearch] = useState<ResearchResponse | null>(null);
  const [consent, setConsent] = useState(false);
  const [provider, setProvider] = useState<{
    provider: string;
    configured: boolean;
  } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void listEvidence()
      .then(setDocuments)
      .catch((error) => setMessage(error.message));
  }, []);
  useEffect(() => {
    void nativeEvidence()
      ?.researchStatus?.()
      .then(setProvider)
      .catch(() => {});
  }, []);
  async function configureResearch() {
    const api = nativeEvidence();
    if (!api || !apiKey.trim()) return;
    setBusy(true);
    try {
      setProvider(await api.researchConfigure({ apiKey: apiKey.trim() }));
      setApiKey("");
      setMessage(
        "Search credential encrypted on this device. Each query still requires consent.",
      );
    } catch {
      setMessage(
        "Could not securely save the search credential. Check desktop diagnostics.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addFiles(files: File[]) {
    setTab("files");
    setBusy(true);
    setMessage("");
    let imported = 0;
    try {
      if (files.length > 10)
        throw new Error("Import up to ten context files at a time.");
      for (const file of files) {
        if (file.size > 524288)
          throw new Error(`${file.name} is larger than 512 KB.`);
        await importEvidence({
          name: file.name,
          text: await file.text(),
          mime: file.type,
        });
        imported++;
      }
      setMessage(
        `${imported} context file${imported === 1 ? "" : "s"} indexed locally. Document text is evidence, never agent instructions.`,
      );
    } catch (error) {
      setMessage(
        `${imported ? `${imported} files imported. ` : ""}${error instanceof Error ? error.message : "Import failed."}`,
      );
    } finally {
      await listEvidence()
        .then(setDocuments)
        .catch(() => {});
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) void addFiles(Array.from(event.dataTransfer.files));
  }
  async function search() {
    setBusy(true);
    setMessage("");
    try {
      setResults(await searchEvidence(query));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function researchWeb() {
    if (!consent || !webQuery.trim()) return;
    const api = nativeEvidence();
    if (!api) {
      setResearch({
        status: "BLOCKED",
        reason: "Web research is a desktop-only tool in this preview.",
        action:
          "Open the Windows app and configure its search provider. Local retrieval needs no API key.",
      });
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      setResearch(await api.webResearch({ query: webQuery, approved: true }));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function importResearch(resultId: string) {
    setBusy(true);
    try {
      await nativeEvidence()?.researchImport({ resultId, approved: true });
      setDocuments(await listEvidence());
      setMessage(
        "Selected source imported locally. Manufacturer authority must still be reviewed before mapping approval.",
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`${styles.dock} ${dragging ? styles.dragging : ""}`}
      aria-label="Workspace context"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      <div className={styles.bar}>
        <Button
          size="sm"
          variant={tab === "files" ? "outline" : "ghost"}
          onClick={() => setTab(tab === "files" ? null : "files")}
          aria-expanded={tab === "files"}
        >
          <FileText size={15} />
          Context files <span className={styles.count}>{documents.length}</span>
        </Button>
        <Button
          size="sm"
          variant={tab === "search" ? "outline" : "ghost"}
          onClick={() => setTab(tab === "search" ? null : "search")}
          aria-expanded={tab === "search"}
        >
          <BookOpen size={15} />
          Local retrieval
        </Button>
        <Button
          size="sm"
          variant={tab === "research" ? "outline" : "ghost"}
          onClick={() => setTab(tab === "research" ? null : "research")}
          aria-expanded={tab === "research"}
        >
          <Globe size={15} />
          Web research
        </Button>
        <span className={styles.privacy}>
          Local evidence · external tools require consent
        </span>
        {tab && (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Collapse context panel"
            onClick={() => setTab(null)}
          >
            <ChevronDown size={16} />
          </Button>
        )}
      </div>
      {tab && (
        <div className={styles.body}>
          {tab === "files" && (
            <>
              <div className={styles.intro}>
                <h2>Give the workspace context.</h2>
                <p>
                  Drop manuals exported as text, register tables, or engineering
                  notes. Files stay on this device.
                </p>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  <Upload size={15} />
                  Choose files
                </Button>
                <input
                  ref={input}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json"
                  hidden
                  onChange={(event) =>
                    void addFiles(Array.from(event.target.files || []))
                  }
                />
                <small>
                  TXT · MD · CSV · JSON / 512 KB per file
                  <br />
                  PDF and image extraction are not yet supported.
                </small>
              </div>
              <div className={styles.fileList}>
                {documents.length ? (
                  documents.map((document) => (
                    <article key={document.id}>
                      <FileText size={18} />
                      <div>
                        <strong>{document.name}</strong>
                        <small>
                          {(document.bytes / 1024).toFixed(1)} KB ·{" "}
                          {document.chunkCount} excerpts · locally indexed
                        </small>
                        <code>{document.id.slice(0, 18)}</code>
                      </div>
                      <span className={styles.count}>CONTEXT</span>
                    </article>
                  ))
                ) : (
                  <div className={styles.empty}>
                    <Upload size={25} />
                    <strong>Drop your first context file here</strong>
                    <span>No files uploaded. No cloud storage.</span>
                  </div>
                )}
              </div>
            </>
          )}
          {tab === "search" && (
            <>
              <div className={styles.intro}>
                <h2>Search the evidence, not guesses.</h2>
                <p>
                  Local text retrieval returns source excerpts. A match does not
                  verify a register or prove causality.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void search();
                  }}
                >
                  <Input
                    aria-label="Search local context"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Motor current register…"
                    maxLength={200}
                  />
                  <Button
                    disabled={busy || !query.trim()}
                    type="submit"
                    size="sm"
                  >
                    <Search size={15} />
                    Search
                  </Button>
                </form>
              </div>
              <div className={styles.fileList}>
                {results.length ? (
                  results.map((result) => (
                    <article key={result.excerptId}>
                      <div>
                        <strong>
                          {result.name} · excerpt {result.chunkIndex + 1}
                        </strong>
                        <p>{result.text}</p>
                        <code>{result.excerptId}</code>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className={styles.empty}>
                    <BookOpen size={25} />
                    <strong>No excerpts selected</strong>
                    <span>Import context, then enter a phrase to search.</span>
                  </div>
                )}
              </div>
            </>
          )}
          {tab === "research" && (
            <>
              <div className={styles.intro}>
                <h2>Research with a clear boundary.</h2>
                {provider && (
                  <details>
                    <summary>
                      {provider.provider} ·{" "}
                      {provider.configured ? "Configured" : "Set up search"}
                    </summary>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void configureResearch();
                      }}
                    >
                      <label htmlFor="research-api-key">
                        Brave Search API key
                      </label>
                      <Input
                        id="research-api-key"
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        maxLength={256}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || !apiKey.trim()}
                      >
                        Save encrypted credential
                      </Button>
                      <small>
                        Stored with Windows credential encryption. Never
                        included in model prompts.
                      </small>
                    </form>
                  </details>
                )}
                <p>
                  Only this query is sent to the configured provider. Workspace
                  files and telemetry are not attached.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void researchWeb();
                  }}
                >
                  <Input
                    aria-label="Web research query"
                    value={webQuery}
                    onChange={(event) => {
                      setWebQuery(event.target.value);
                      setConsent(false);
                    }}
                    maxLength={200}
                    placeholder="Exact manufacturer and model manual"
                  />
                  <label className={styles.consent}>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    I approve sending this query to the search provider.
                  </label>
                  <Button
                    disabled={busy || !consent || !webQuery.trim()}
                    type="submit"
                    size="sm"
                  >
                    <Globe size={15} />
                    Search web
                  </Button>
                </form>
              </div>
              <div className={styles.fileList}>
                {research?.status === "BLOCKED" ? (
                  <div className={styles.empty}>
                    <X size={24} />
                    <strong>{research.reason}</strong>
                    <span>{research.action}</span>
                  </div>
                ) : research?.status === "OK" ? (
                  research.results.map((result) => (
                    <article key={result.resultId}>
                      <div>
                        <strong>{result.title}</strong>
                        <p>{result.snippet}</p>
                        <code>{result.url}</code>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void importResearch(result.resultId)}
                        >
                          Import selected source
                        </Button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className={styles.empty}>
                    <Globe size={25} />
                    <strong>No external search has run</strong>
                    <span>
                      Review the query and give explicit consent first.
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
    </section>
  );
}
