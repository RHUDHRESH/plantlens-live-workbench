"use client";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import {
  Bot,
  Cable,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  Layers3,
  Library,
  MonitorUp,
  Moon,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Redo2,
  Save,
  Search,
  ShieldAlert,
  Undo2,
  Zap,
} from "lucide-react";
import {
  approveProposalChange,
  createCadDocument,
  deterministicDraft,
  rejectProposalChange,
  validateConnection,
  type CadAsset,
  type CadConnection,
  type CadDocument,
  type CadProposal,
  type CadTerminal,
  type CadView,
} from "@/lib/cad";
import { Badge, Button, Input, StatusBadge, Textarea } from "@/components/ui";
import { EquipmentSymbol } from "./EquipmentSymbol";
import { RegisterInspector } from "@/components/engineering/RegisterInspector";
import { useApp } from "@/store/app";
import styles from "./cad-workbench.module.css";
type DesktopAdapter = {
  workspaceLoad?: () => Promise<CadDocument | null>;
  workspaceSave?: (d: CadDocument, r: number) => Promise<CadDocument | void>;
  agentDraft?: (r: string, d: CadDocument) => Promise<CadProposal>;
  modelStatus?: () => Promise<{ available?: boolean; state?: string }>;
};
const desktop = () =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { plantlensDesktop?: DesktopAdapter })
        .plantlensDesktop;
const views: { id: CadView; label: string; note: string }[] = [
  { id: "signal", label: "Signal wiring", note: "I/O & telemetry" },
  { id: "electrical", label: "Electrical", note: "Illustrative template" },
  { id: "presentation", label: "Operations", note: "Presentation twin" },
];
type NodeData = { asset: CadAsset; terminals: CadTerminal[]; view: CadView };
function AssetNode({ data }: { data: NodeData }) {
  return (
    <article
      className={styles.assetNode}
      aria-label={`${data.asset.id} ${data.asset.name}`}
    >
      <div className={styles.symbol}>
        <EquipmentSymbol kind={data.asset.kind} />
      </div>
      <header>
        <div>
          <b>{data.asset.id}</b>
          <span>{data.asset.name}</span>
        </div>
        <Badge>{data.asset.kind}</Badge>
      </header>
      {data.view === "presentation" ? (
        <div className={styles.metric}>
          <small>OPERATIONAL STATE</small>
          <strong>
            {data.asset.kind === "sensor"
              ? "6.2 bar"
              : data.asset.kind === "drive"
                ? "42.0 Hz"
                : "Normal"}
          </strong>
          <span>SIMULATED · GOOD</span>
        </div>
      ) : (
        <div className={styles.terminals}>
          {data.terminals.map((t) => (
            <div className={styles.terminal} key={t.id}>
              {(t.direction === "in" || t.direction === "bidirectional") && (
                <Handle id={t.id} type="target" position={Position.Left} />
              )}
              <span>{t.name}</span>
              <small>
                {t.signalType}
                {t.unit ? ` · ${t.unit}` : ""}
              </small>
              {(t.direction === "out" || t.direction === "bidirectional") && (
                <Handle id={t.id} type="source" position={Position.Right} />
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
const nodeTypes = { asset: AssetNode };
const loadBrowser = () => {
  try {
    const v = localStorage.getItem("plantlens.cad.workspace.v1");
    return v ? (JSON.parse(v) as CadDocument) : null;
  } catch {
    return null;
  }
};
const textTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  !!t.closest("input,textarea,select,[contenteditable=true]");
function Title({ children }: { children: React.ReactNode }) {
  return <h2 className={styles.panelTitle}>{children}</h2>;
}
export function CadWorkbench() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const [doc, setDoc] = useState<CadDocument>(() => createCadDocument()),
    [view, setView] = useState<CadView>("signal"),
    [selected, setSelected] = useState<{
      type: "asset" | "connection";
      id: string;
    } | null>(null),
    [query, setQuery] = useState(""),
    [draftOpen, setDraftOpen] = useState(false),
    [diagnosticsOpen, setDiagnosticsOpen] = useState(true),
    [request, setRequest] = useState(""),
    [message, setMessage] = useState("Opening workspace…"),
    [modelState, setModelState] = useState("Checking local model"),
    [busy, setBusy] = useState(false),
    [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true),
    [leftWidth, setLeftWidth] = useState(248),
    [rightWidth, setRightWidth] = useState(304),
    [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light"),
    [edit, setEdit] = useState<{ p: string; c: string; value: string } | null>(
      null,
    );
  const undo = useRef<CadDocument[]>([]),
    redo = useRef<CadDocument[]>([]),
    persisted = useRef(0);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const resolve = () =>
      setResolvedTheme(
        theme === "system" ? (media.matches ? "dark" : "light") : theme,
      );
    const frame = requestAnimationFrame(resolve);
    media.addEventListener("change", resolve);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", resolve);
    };
  }, [theme]);
  const replace = useCallback(
    (next: CadDocument, history = true) =>
      setDoc((current) => {
        if (history) {
          undo.current.push(current);
          redo.current = [];
        }
        return next;
      }),
    [],
  );
  useEffect(() => {
    void (async () => {
      const api = desktop();
      let loaded = null;
      try {
        loaded = api?.workspaceLoad ? await api.workspaceLoad() : loadBrowser();
      } catch {
        loaded = loadBrowser();
      }
      if (loaded?.schemaVersion === 1) {
        setDoc(loaded);
        persisted.current = loaded.revision;
      }
      setMessage(loaded ? "Workspace restored" : "New browser-local workspace");
      try {
        const s = await api?.modelStatus?.();
        setModelState(
          s?.available
            ? "Local model ready"
            : s?.state || "Local AI unavailable",
        );
      } catch {
        setModelState("Local AI unavailable");
      }
    })();
  }, []);
  const save = useCallback(async () => {
    setBusy(true);
    try {
      const api = desktop();
      if (api?.workspaceSave) {
        const saved = await api.workspaceSave(doc, persisted.current);
        persisted.current = saved?.revision ?? persisted.current + 1;
        if (saved) setDoc(saved);
        setMessage("Saved to desktop workspace");
      } else {
        localStorage.setItem("plantlens.cad.workspace.v1", JSON.stringify(doc));
        setMessage("Saved in this browser");
      }
    } catch (e) {
      setMessage(
        e instanceof Error ? `Save blocked: ${e.message}` : "Save blocked",
      );
    } finally {
      setBusy(false);
    }
  }, [doc]);
  const doUndo = useCallback(
      () =>
        setDoc((c) => {
          const p = undo.current.pop();
          if (!p) return c;
          redo.current.push(c);
          return p;
        }),
      [],
    ),
    doRedo = useCallback(
      () =>
        setDoc((c) => {
          const n = redo.current.pop();
          if (!n) return c;
          undo.current.push(c);
          return n;
        }),
      [],
    );
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || textTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void save();
      } else if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (k === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    addEventListener("keydown", fn);
    return () => removeEventListener("keydown", fn);
  }, [save, doUndo, doRedo]);
  const derived = useMemo<Node<NodeData>[]>(
    () =>
      doc.placements
        .filter((p) => p.view === view)
        .map((p) => {
          const asset = doc.assets.find((a) => a.id === p.assetId)!;
          return {
            id: asset.id,
            type: "asset",
            position: { x: p.x, y: p.y },
            data: {
              asset,
              terminals: doc.terminals.filter((t) => t.assetId === asset.id),
              view,
            },
          };
        }),
    [doc, view],
  );
  const [nodes, setNodes] = useState(derived);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNodes(derived));
    return () => cancelAnimationFrame(frame);
  }, [derived]);
  const edges = useMemo<Edge[]>(
    () =>
      view === "presentation"
        ? []
        : doc.connections
            .filter((c) => c.view === view)
            .map((c) => ({
              id: c.id,
              source: doc.terminals.find((t) => t.id === c.sourceTerminalId)!
                .assetId,
              target: doc.terminals.find((t) => t.id === c.targetTerminalId)!
                .assetId,
              sourceHandle: c.sourceTerminalId,
              targetHandle: c.targetTerminalId,
              type: "smoothstep",
              label: `${c.signalType}${c.unit ? ` · ${c.unit}` : ""}`,
              markerEnd: { type: MarkerType.ArrowClosed },
              animated: c.signalType === "telemetry",
              style: {
                stroke:
                  c.verification === "TEMPLATE"
                    ? "var(--amber)"
                    : c.signalType === "earth"
                      ? "var(--green)"
                      : "var(--accent)",
                strokeDasharray:
                  c.verification === "VERIFIED" ? undefined : "6 4",
              },
            })),
    [doc, view],
  );
  const nodeChanges = useCallback(
    (c: NodeChange<Node<NodeData>>[]) =>
      setNodes((n) => applyNodeChanges(c, n)),
    [],
  );
  const dragStop = useCallback(() => {
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const moved = doc.placements.some(
      (p) =>
        p.view === view &&
        positions.has(p.assetId) &&
        (p.x !== positions.get(p.assetId)!.x ||
          p.y !== positions.get(p.assetId)!.y),
    );
    if (!moved) return;
    replace({
      ...doc,
      revision: doc.revision + 1,
      placements: doc.placements.map((x) =>
        x.view === view && positions.has(x.assetId)
          ? { ...x, ...positions.get(x.assetId)! }
          : x,
      ),
    });
  }, [doc, view, replace, nodes]);
  const startResize =
    (side: "left" | "right") => (event: React.PointerEvent<HTMLDivElement>) => {
      const startX = event.clientX,
        start = side === "left" ? leftWidth : rightWidth;
      const move = (e: PointerEvent) => {
        const delta = (e.clientX - startX) * (side === "left" ? 1 : -1);
        const width = Math.min(420, Math.max(190, start + delta));
        if (side === "left") setLeftWidth(width);
        else setRightWidth(width);
      };
      const stop = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", stop);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", stop);
    };
  const resizeKey =
    (side: "left" | "right") =>
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta =
        (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1);
      if (side === "left")
        setLeftWidth((w) => Math.min(420, Math.max(190, w + delta)));
      else setRightWidth((w) => Math.min(420, Math.max(190, w + delta)));
    };
  const connect = useCallback(
    (c: Connection) => {
      if (view === "presentation" || !c.sourceHandle || !c.targetHandle) return;
      const source = doc.terminals.find((t) => t.id === c.sourceHandle);
      if (!source) return;
      const candidate = {
        view,
        sourceTerminalId: c.sourceHandle,
        targetTerminalId: c.targetHandle,
        signalType: source.signalType,
        unit: source.unit,
      };
      const errors = validateConnection(doc, candidate);
      if (errors.length) {
        setMessage(`Connection blocked: ${errors.join(" ")}`);
        return;
      }
      const item: CadConnection = {
        ...candidate,
        id: `C-${Date.now()}`,
        verification: view === "electrical" ? "TEMPLATE" : "UNVERIFIED",
      };
      replace({
        ...doc,
        revision: doc.revision + 1,
        connections: [...doc.connections, item],
      });
      setSelected({ type: "connection", id: item.id });
    },
    [doc, view, replace],
  );
  const add = (a: CadAsset) => {
    if (doc.placements.some((p) => p.view === view && p.assetId === a.id)) {
      setSelected({ type: "asset", id: a.id });
      return;
    }
    replace({
      ...doc,
      revision: doc.revision + 1,
      placements: [...doc.placements, { assetId: a.id, view, x: 120, y: 120 }],
    });
  };
  const draft = async (e: FormEvent) => {
    e.preventDefault();
    if (!request.trim()) return;
    setBusy(true);
    try {
      const api = desktop(),
        p = api?.agentDraft
          ? await api.agentDraft(request, doc)
          : deterministicDraft(request, doc);
      replace({ ...doc, proposals: [p, ...doc.proposals] });
      setRequest("");
      setMessage("Draft ready for review");
    } catch (x) {
      setMessage(
        `Draft failed: ${x instanceof Error ? x.message : "invalid output"}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const saveEdit = () => {
    if (!edit) return;
    const value = edit.value.trim();
    if (value)
      replace({
        ...doc,
        proposals: doc.proposals.map((p) =>
          p.id !== edit.p
            ? p
            : {
                ...p,
                changes: p.changes.map((c) =>
                  c.id !== edit.c
                    ? c
                    : {
                        ...c,
                        value,
                        summary: `${c.kind.replace("_", " ")}: ${value}`,
                      },
                ),
              },
        ),
      });
    setEdit(null);
  };
  const asset =
      selected?.type === "asset"
        ? doc.assets.find((a) => a.id === selected.id)
        : undefined,
    connection =
      selected?.type === "connection"
        ? doc.connections.find((c) => c.id === selected.id)
        : undefined,
    library = doc.assets.filter((a) =>
      `${a.id} ${a.name} ${a.kind}`.toLowerCase().includes(query.toLowerCase()),
    ),
    meta = views.find((v) => v.id === view)!;
  return (
    <main
      className={styles.workbench}
      style={
        {
          "--left": leftOpen ? `${leftWidth}px` : "0px",
          "--right": rightOpen ? `${rightWidth}px` : "0px",
        } as React.CSSProperties
      }
    >
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span>
            <Layers3 size={17} />
          </span>
          <div>
            <b>Engineering workspace</b>
            <small>
              {doc.name} · REV {doc.revision}
            </small>
          </div>
        </div>
        <div className={styles.toolbar}>
          <nav>
            <Link href="/plant">Plant</Link>
            <Link href="/live">Live</Link>
            <Link href="/explain">Explain</Link>
            <Link href="/analysis">Analysis</Link>
          </nav>
          <Button
            size="sm"
            variant="ghost"
            aria-label={leftOpen ? "Hide project panel" : "Show project panel"}
            onClick={() => setLeftOpen((v) => !v)}
          >
            <PanelLeftClose size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={rightOpen ? "Hide inspector" : "Show inspector"}
            onClick={() => setRightOpen((v) => !v)}
          >
            <PanelRightClose size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Toggle color theme"
            onClick={() =>
              setTheme(
                theme === "dark"
                  ? "light"
                  : theme === "light"
                    ? "system"
                    : "dark",
              )
            }
          >
            <Moon size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Undo workspace change"
            onClick={doUndo}
          >
            <Undo2 size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Redo workspace change"
            onClick={doRedo}
          >
            <Redo2 size={15} />
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            <Save size={14} />
            Save
          </Button>
          <Button
            size="sm"
            variant="primary"
            aria-expanded={draftOpen}
            onClick={() => setDraftOpen((v) => !v)}
          >
            <Bot size={15} />
            Draft change
          </Button>
        </div>
      </header>
      <div className={styles.contextbar}>
        <div>
          <small>WORKSPACE / PL-CAD-001</small>
          <b>{meta.label}</b>
        </div>
        <nav aria-label="Engineering views">
          {views.map((v) => (
            <button
              key={v.id}
              aria-current={view === v.id ? "page" : undefined}
              onClick={() => {
                setView(v.id);
                setSelected(null);
              }}
            >
              <span>{v.label}</span>
              <small>{v.note}</small>
            </button>
          ))}
        </nav>
        <div className={styles.docStatus}>
          <FileCheck2 size={14} />
          <span>
            <b>Schema v{doc.schemaVersion}</b>
            <small>
              {
                doc.connections.filter((c) => c.verification !== "VERIFIED")
                  .length
              }{" "}
              need review
            </small>
          </span>
        </div>
      </div>
      <div className={styles.mainGrid}>
        <aside className={`${styles.panel} ${!leftOpen ? styles.closed : ""}`}>
          <Title>Project navigator</Title>
          <div className={styles.tree}>
            <button>
              <ChevronDown size={14} />
              <b>PL-CAD-001</b>
            </button>
            {views.map((v) => (
              <button
                className={view === v.id ? styles.active : ""}
                key={v.id}
                onClick={() => setView(v.id)}
              >
                {v.id === "signal" ? (
                  <Cable size={14} />
                ) : v.id === "electrical" ? (
                  <Zap size={14} />
                ) : (
                  <MonitorUp size={14} />
                )}
                <span>
                  {v.label}
                  <small>
                    {doc.placements.filter((p) => p.view === v.id).length}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <hr />
          <Title>Equipment library</Title>
          <label className={styles.search}>
            <Search size={14} />
            <Input
              aria-label="Search equipment library"
              placeholder="Search by tag or type"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className={styles.library}>
            {library.map((a) => (
              <button
                key={a.id}
                onClick={() => add(a)}
                aria-label={`Add ${a.id} ${a.name}`}
              >
                <span>
                  <EquipmentSymbol kind={a.kind} />
                </span>
                <div>
                  <b>{a.id}</b>
                  <small>{a.name}</small>
                </div>
                <Plus size={14} />
              </button>
            ))}
          </div>
        </aside>
        {leftOpen && (
          <div
            className={styles.resizer}
            role="separator"
            aria-label="Resize project panel"
            aria-valuemin={190}
            aria-valuemax={420}
            aria-valuenow={leftWidth}
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={startResize("left")}
            onKeyDown={resizeKey("left")}
          />
        )}
        <section className={styles.canvas} aria-label={`${meta.label} canvas`}>
          <div className={styles.banner}>
            {view === "electrical" ? (
              <ShieldAlert size={14} />
            ) : (
              <Cable size={14} />
            )}
            <span>
              <b>
                {view === "electrical"
                  ? "Illustrative template"
                  : view === "presentation"
                    ? "Presentation twin"
                    : "Typed signal paths"}
              </b>{" "}
              {view === "electrical"
                ? "Verify equipment, terminals and protection."
                : view === "presentation"
                  ? "Measurements are simulated."
                  : "Select a connection to inspect evidence."}
            </span>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={nodeChanges}
            onNodeDragStop={dragStop}
            onSelectionDragStop={dragStop}
            onConnect={connect}
            onNodeClick={(_, n) => setSelected({ type: "asset", id: n.id })}
            onEdgeClick={(_, e) =>
              setSelected({ type: "connection", id: e.id })
            }
            fitView
            snapToGrid
            snapGrid={[20, 20]}
            panOnScroll
            selectionOnDrag
            multiSelectionKeyCode="Shift"
            deleteKeyCode={null}
            colorMode={resolvedTheme}
          >
            <Background gap={20} />
            <Controls position="bottom-left" />
            <MiniMap pannable zoomable />
          </ReactFlow>
          <footer>
            GRID 20 · SNAP ON · {nodes.length} EQUIPMENT · {edges.length}{" "}
            CONNECTIONS
          </footer>
        </section>
        {rightOpen && (
          <div
            className={`${styles.resizer} ${styles.rightResizer}`}
            role="separator"
            aria-label="Resize inspector panel"
            aria-valuemin={190}
            aria-valuemax={420}
            aria-valuenow={rightWidth}
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={startResize("right")}
            onKeyDown={resizeKey("right")}
          />
        )}
        <aside
          className={`${styles.panel} ${styles.inspector} ${!rightOpen ? styles.closed : ""}`}
        >
          <Title>Inspector</Title>
          {asset ? (
            <AssetInspector
              key={asset.id}
              asset={asset}
              doc={doc}
              rename={(name) =>
                replace({
                  ...doc,
                  revision: doc.revision + 1,
                  assets: doc.assets.map((a) =>
                    a.id === asset.id ? { ...a, name } : a,
                  ),
                })
              }
            />
          ) : connection ? (
            <ConnectionInspector
              connection={connection}
              doc={doc}
              remove={() => {
                replace({
                  ...doc,
                  revision: doc.revision + 1,
                  connections: doc.connections.filter(
                    (c) => c.id !== connection.id,
                  ),
                });
                setSelected(null);
              }}
            />
          ) : (
            <div className={styles.empty}>
              <Library size={24} />
              <b>Nothing selected</b>
              <span>Select equipment or a connection to inspect metadata.</span>
            </div>
          )}
        </aside>
      </div>
      {draftOpen && (
        <section className={styles.draftPanel}>
          <div>
            <Title>Change review</Title>
            <p>Suggestions remain proposals until approved.</p>
            <form onSubmit={draft}>
              <Textarea
                rows={3}
                aria-label="Requested engineering change"
                placeholder="Describe a bounded engineering change…"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !request.trim()}
              >
                Generate draft
              </Button>
            </form>
          </div>
          <div className={styles.proposals}>
            {doc.proposals.slice(0, 3).map((p) => (
              <article key={p.id}>
                <header>
                  <StatusBadge value={p.status} />
                  <Badge tone={p.source === "LOCAL_MODEL" ? "accent" : "grey"}>
                    {p.source.replace("_", " ")}
                  </Badge>
                  <span>{p.request}</span>
                </header>
                {p.citations?.length ? (
                  <div className={styles.citations}>
                    <b>Retrieved context · not proof</b>
                    {p.citations.map((citation) => (
                      <span
                        key={`${citation.evidenceId}-${citation.excerptId}`}
                      >
                        {citation.source} · {citation.excerptId}
                      </span>
                    ))}
                  </div>
                ) : null}
                {p.changes.map((c) => (
                  <div className={styles.change} key={c.id}>
                    <div>
                      <b>{c.kind.replace("_", " ")}</b>
                      {edit?.c === c.id ? (
                        <Input
                          autoFocus
                          aria-label="Edit proposal value"
                          value={edit.value}
                          onChange={(e) =>
                            setEdit({ ...edit, value: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") setEdit(null);
                          }}
                        />
                      ) : (
                        <span>{c.summary}</span>
                      )}
                    </div>
                    <StatusBadge value={c.status} />
                    {c.status === "PENDING" &&
                      (edit?.c === c.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={saveEdit}
                          >
                            Save edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEdit(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              replace(approveProposalChange(doc, p.id, c.id))
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setEdit({ p: p.id, c: c.id, value: c.value })
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              replace(rejectProposalChange(doc, p.id, c.id))
                            }
                          >
                            Reject
                          </Button>
                        </>
                      ))}
                  </div>
                ))}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className={styles.diagnostics}>
        <button
          aria-expanded={diagnosticsOpen}
          onClick={() => setDiagnosticsOpen((v) => !v)}
        >
          {diagnosticsOpen ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
          Diagnostics <Badge>Configuration review</Badge>
        </button>
        {diagnosticsOpen && (
          <div>
            <span>● Schema v{doc.schemaVersion} · hardware not verified</span>
            <span>
              ●{" "}
              {
                doc.connections.filter((c) => c.verification !== "VERIFIED")
                  .length
              }{" "}
              unverified
            </span>
            <span>● {modelState}</span>
            <span>{message}</span>
          </div>
        )}
      </section>
    </main>
  );
}
function AssetInspector({
  asset,
  doc,
  rename,
}: {
  asset: CadAsset;
  doc: CadDocument;
  rename: (n: string) => void;
}) {
  const [name, setName] = useState(asset.name),
    terminals = doc.terminals.filter((t) => t.assetId === asset.id);
  return (
    <div className={styles.inspectBody}>
      <div className={styles.inspectHero}>
        <span>
          <EquipmentSymbol kind={asset.kind} />
        </span>
        <div>
          <Badge tone="accent">{asset.kind}</Badge>
          <h3>{asset.id}</h3>
          <p>{asset.description}</p>
        </div>
      </div>
      <label htmlFor={`name-${asset.id}`}>Equipment name</label>
      <Input
        id={`name-${asset.id}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== asset.name && rename(name.trim())}
      />
      <dl>
        <dt>Shared asset ID</dt>
        <dd>{asset.id}</dd>
        <dt>Terminal count</dt>
        <dd>{terminals.length}</dd>
      </dl>
      <Title>Terminals</Title>
      {terminals.map((t) => (
        <div className={styles.terminalCard} key={t.id}>
          <b>{t.name}</b>
          <span>{t.id}</span>
          <small>
            {t.direction} · {t.signalType} {t.unit || ""}
          </small>
        </div>
      ))}
      <Title>Register binding</Title>
      <RegisterInspector assetId={asset.id} />
    </div>
  );
}
function ConnectionInspector({
  connection,
  doc,
  remove,
}: {
  connection: CadConnection;
  doc: CadDocument;
  remove: () => void;
}) {
  const s = doc.terminals.find((t) => t.id === connection.sourceTerminalId),
    t = doc.terminals.find((t) => t.id === connection.targetTerminalId);
  if (!s || !t) return <p>Endpoints unavailable.</p>;
  return (
    <div className={styles.inspectBody}>
      <StatusBadge value={connection.verification} />
      <h3>{connection.id}</h3>
      <div className={styles.endpoint}>
        <small>SOURCE</small>
        <b>
          {s.assetId} · {s.name}
        </b>
        <span>{s.id}</span>
      </div>
      <div className={styles.endpoint}>
        <small>TARGET</small>
        <b>
          {t.assetId} · {t.name}
        </b>
        <span>{t.id}</span>
      </div>
      <dl>
        <dt>Signal</dt>
        <dd>{connection.signalType}</dd>
        <dt>Units</dt>
        <dd>{connection.unit || "—"}</dd>
        <dt>Evidence</dt>
        <dd>{connection.evidence || "Not attached"}</dd>
      </dl>
      {connection.verification === "TEMPLATE" && (
        <p className={styles.warning}>
          Illustrative only. Do not use for construction.
        </p>
      )}
      <Button variant="danger" size="sm" onClick={remove}>
        Remove connection
      </Button>
    </div>
  );
}
