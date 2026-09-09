"use client";

import { create } from "zustand";
import type {
  Alarm,
  AuditEvent,
  CostAssumption,
  HealthyBaseline,
  Incident,
  InventoryPart,
  InventoryTransaction,
  KnowledgeProposal,
  KnowledgeVersion,
  Observation,
  RecoveryCheck,
  RecoveryPlan,
  RecoveryRun,
  ReviewRecord,
  SessionBundle,
  SourceDocument,
  TimeStamp,
  WorkOrder,
  WorkOrderState,
  Workspace,
} from "@/lib/domain/types";
import { SCHEMA_VERSION } from "@/lib/domain/types";
import { engineClient, type OkResponse } from "@/lib/simulation/client";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import type { RecordedIntervention } from "@/lib/simulation/engine";
import { DEFAULT_SCENARIO_ID, DEMO_START_MS, INTERVENTION_BY_ID, SCENARIO_BY_ID, type InterventionId } from "@/lib/simulation/scenarios";
import type { SeriesPoint, Sample } from "@/lib/simulation/observation";
import type { EvaluationConfig, EvaluationReport } from "@/lib/simulation/evaluation";
import { SEED_BASELINES, SEED_KNOWLEDGE_VERSION } from "@/lib/fixtures/knowledge";
import { SEED_COST_ASSUMPTIONS, SEED_INCIDENTS, SEED_INVENTORY, SEED_RUNS, SEED_WORK_ORDERS } from "@/lib/fixtures/history";
import { ENGINEER_NOTES, PLC_SEQUENCE, docText } from "@/lib/fixtures/documents";
import type { SamplePack } from "@/lib/fixtures/pack";
import { parseFile, normalizeTrace, proposeMapping, type ColumnMapping, type NormalizeOptions, type ParsedFile, type QualityReport } from "@/lib/sources/parsers";
import { runLocalPipeline, type StageReport } from "@/lib/knowledge/pipeline";
import { publishVersion, reviewProposal } from "@/lib/knowledge/versions";
import { approvePlan, compilePlan, invalidateForKnowledgeChange, revisePlan, templatesFor } from "@/lib/recovery/compiler";
import { applyInventory, audit as makeAudit, checkVerifiedClosure, closeWorkOrder, transitionWorkOrder, WorkflowError } from "@/lib/workflow";
import { acquireWriterLock, loadWorkspace, readPref, saveWorkspace, storageStatus, writePref, LOCAL_PREF_KEYS, type WriterLock } from "@/lib/storage/db";
import { downloadText, observationsCsv, parseBundle, serializeBundle } from "@/lib/exports";
import { stableId, wallTs } from "@/lib/util";

/**
 * Application store. One engine client survives route changes; records are persisted to
 * IndexedDB (this browser only). Every mutation goes through an action here so the UI
 * never edits records directly.
 */

export const IDENTITIES = ["Maintenance engineer (simulated)", "Technician R. (simulated)", "Supervisor M. (simulated)", "Reliability lead (simulated)"] as const;

export interface Toast {
  id: string;
  kind: "info" | "error" | "success";
  text: string;
}

export interface PendingImport {
  fileId: string;
  fileName: string;
  headers: string[];
  preview: string[][];
  rowCount: number;
  mapping: ColumnMapping;
  timeZoneAssumption: string;
  report?: QualityReport;
  parsed: ParsedFile;
}

export interface GuidedState {
  active: boolean;
  presentation: boolean;
  stepIndex: number;
  branch: "main" | "speed" | "missing" | "partial";
  log: string[];
}

export interface AppState {
  hydrated: boolean;
  snapshot: RuntimeSnapshot | null;
  engineError: string | null;
  identity: (typeof IDENTITIES)[number];
  theme: "light" | "dark" | "system";
  reducedMotion: boolean;
  storage: { available: boolean; reason?: string; lastSavedAt?: number; saving: boolean; error?: string; readOnly: boolean };
  toasts: Toast[];
  askOpen: boolean;
  guided: GuidedState;
  pendingImports: PendingImport[];
  pipelineStages: StageReport[];
  parsedFiles: ParsedFile[];
  evaluation: EvaluationReport | null;
  evaluating: boolean;
  samplePack: SamplePack | null;

  workspace: Workspace;
  sources: SourceDocument[];
  proposals: KnowledgeProposal[];
  knowledgeVersions: KnowledgeVersion[];
  activeKnowledgeVersionId: string;
  baselines: HealthyBaseline[];
  plans: RecoveryPlan[];
  workOrders: WorkOrder[];
  inventory: InventoryPart[];
  inventoryTransactions: InventoryTransaction[];
  costAssumptions: CostAssumption[];
  audit: AuditEvent[];
  historicalIncidents: Incident[];
  historicalRuns: RecoveryRun[];

  // --- lifecycle ---
  bootstrap: () => Promise<void>;
  newDemoWorkspace: (scenarioId: string, seed?: number) => Promise<void>;
  resetWorkspace: () => Promise<void>;
  persistNow: () => Promise<void>;
  setIdentity: (id: AppState["identity"]) => void;
  setTheme: (t: AppState["theme"]) => void;
  setReducedMotion: (v: boolean) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: string) => void;
  setAskOpen: (v: boolean) => void;

  // --- engine ---
  play: () => void;
  pause: () => void;
  setSpeed: (s: number) => void;
  seek: (ms: number) => void;
  stepOnce: () => void;
  setHidden: (hidden: boolean) => void;
  series: (tagIds: string[], fromMs: number, toMs: number, maxPoints?: number) => Promise<Record<string, SeriesPoint[]>>;
  events: (tagIds: string[], fromMs: number, toMs: number) => Promise<Record<string, Array<{ ms: number; uncertaintyMs: number; cycleId?: string; clockSourceId?: string; rawMs?: number }>>>;
  observations: (ids: string[]) => Promise<Observation[]>;
  intervene: (id: InterventionId, params?: Record<string, number | string>, workOrderId?: string) => Promise<RecordedIntervention | null>;

  // --- sources & knowledge ---
  importFiles: (files: Array<{ name: string; text: string; size?: number }>) => Promise<void>;
  updatePendingImport: (fileId: string, patch: Partial<Pick<PendingImport, "mapping" | "timeZoneAssumption">>) => void;
  previewPendingImport: (fileId: string) => void;
  commitPendingImport: (fileId: string) => Promise<void>;
  discardPendingImport: (fileId: string) => void;
  loadSamplePack: () => Promise<void>;
  downloadSamplePack: () => Promise<void>;
  runPipeline: () => void;
  reviewProposalAction: (id: string, decision: ReviewRecord["decision"], reason: string, edits?: { edge?: Partial<import("@/lib/domain/types").DependencyEdge>; resolution?: { chosen: number; reason: string } }) => void;
  publishKnowledge: (reason: string) => Promise<void>;
  activeKnowledge: () => KnowledgeVersion;
  addHumanEdgeDraft: (edge: import("@/lib/domain/types").DependencyEdge, rationale: string) => void;

  // --- incidents, work orders, recovery ---
  createWorkOrder: (incidentId: string | undefined, fields: { assetId: string; title: string; priority: WorkOrder["priority"]; suspectedMechanism: string; plannedAction: string; assignee: string }) => WorkOrder;
  transitionWO: (id: string, to: WorkOrderState, reason: string) => void;
  approveIntervention: (id: string, reason: string) => void;
  recordWork: (id: string, description: string, interventionId?: InterventionId, params?: Record<string, number | string>) => Promise<void>;
  addLabor: (id: string, minutes: number, note: string) => void;
  reservePart: (woId: string, partId: string, quantity: number, actionKey: string) => void;
  consumePart: (woId: string, partId: string, quantity: number, actionKey: string) => void;
  returnPart: (woId: string, partId: string, quantity: number, actionKey: string) => void;
  receivePart: (partId: string, quantity: number, actionKey: string) => void;
  createPlan: (incidentId: string, templateId: string) => RecoveryPlan | null;
  editPlan: (planId: string, edits: { checks?: RecoveryCheck[]; scope?: Partial<RecoveryPlan["scope"]> }, reason: string) => void;
  approvePlanAction: (planId: string, reason: string) => void;
  startRun: (planId: string, workOrderId?: string) => Promise<RecoveryRun | null>;
  abortRun: (runId: string) => void;
  reviewRun: (runId: string, decision: ReviewRecord["decision"], reason: string) => void;
  closeWO: (id: string, reason: string) => void;
  setIncidentStatus: (id: string, status: Incident["status"]) => void;
  draftWorkOrderFromIncident: (incidentId: string) => WorkOrder | null;
  prepareSpareRequest: (woId: string, interventionId: InterventionId) => void;
  draftHandover: () => string;

  // --- export / import ---
  buildBundle: () => Promise<SessionBundle>;
  exportBundle: () => Promise<void>;
  importBundle: (text: string) => Promise<void>;
  exportTelemetryCsv: () => Promise<void>;
  runEvaluation: (config: EvaluationConfig) => Promise<void>;

  // --- guided demo ---
  setGuided: (patch: Partial<GuidedState>) => void;

  // --- settings ---
  updateCostAssumption: (id: string, patch: Partial<CostAssumption>) => void;
}

const WORKSPACE_ID = "demo-workspace";

function now(): TimeStamp {
  return wallTs();
}

function demoWorkspace(scenarioId: string, seed: number): Workspace {
  return { id: WORKSPACE_ID, name: "VoltMind Components — Demo Plant", mode: "DEMO_SIMULATION", createdAt: now(), seed, scenarioId };
}

const client = () => engineClient();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lock: WriterLock | null = null;
let liveMsAtLastSave = 0;

export const useApp = create<AppState>((set, get) => {
  const auditEvent = (kind: string, subjectId: string, detail: string) => {
    const ev = makeAudit(get().identity, kind, subjectId, detail, now());
    set((s) => ({ audit: [...s.audit, ev].slice(-2000) }));
    return ev;
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().persistNow(), 800);
  };

  const mutate = (patch: Partial<AppState>) => {
    set(patch);
    scheduleSave();
  };

  const req = async (r: Parameters<ReturnType<typeof engineClient>["request"]>[0]): Promise<OkResponse | null> => {
    try {
      return await client().request(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ engineError: msg });
      get().toast("error", msg);
      return null;
    }
  };

  const startEngine = async (cfg: { seed: number; scenarioId: string; incidents?: Incident[]; runs?: RecoveryRun[]; interventions?: RecordedIntervention[]; resumeLiveMs?: number }) => {
    const c = client();
    if (!c.started) {
      c.start();
      c.onSnapshot((snapshot) => {
        set({ snapshot, engineError: null });
        if (snapshot.clock.liveMs - liveMsAtLastSave > 30_000) scheduleSave();
      });
      c.onError((e) => set({ engineError: e }));
    }
    const st = get();
    await req({ type: "INIT", cfg: { mode: "DEMO_SIMULATION", seed: cfg.seed, scenarioId: cfg.scenarioId, startMs: DEMO_START_MS, knowledge: st.activeKnowledge(), baselines: st.baselines, existingIncidents: cfg.incidents, existingRuns: cfg.runs, interventions: cfg.interventions, resumeLiveMs: cfg.resumeLiveMs } });
  };

  const seedRecords = (scenarioId: string, seed: number): Partial<AppState> => ({
    workspace: demoWorkspace(scenarioId, seed),
    sources: [],
    proposals: [],
    knowledgeVersions: [structuredClone(SEED_KNOWLEDGE_VERSION)],
    activeKnowledgeVersionId: SEED_KNOWLEDGE_VERSION.id,
    baselines: structuredClone(SEED_BASELINES),
    plans: [],
    workOrders: structuredClone(SEED_WORK_ORDERS),
    inventory: structuredClone(SEED_INVENTORY),
    inventoryTransactions: [],
    costAssumptions: structuredClone(SEED_COST_ASSUMPTIONS),
    audit: [],
    historicalIncidents: structuredClone(SEED_INCIDENTS),
    historicalRuns: structuredClone(SEED_RUNS),
    pipelineStages: [],
    parsedFiles: [],
    pendingImports: [],
    evaluation: null,
    samplePack: null,
  });

  return {
    hydrated: false,
    snapshot: null,
    engineError: null,
    identity: IDENTITIES[0],
    theme: "system",
    reducedMotion: false,
    storage: { available: true, saving: false, readOnly: false },
    toasts: [],
    askOpen: false,
    guided: { active: false, presentation: false, stepIndex: 0, branch: "main", log: [] },
    pendingImports: [],
    pipelineStages: [],
    parsedFiles: [],
    evaluation: null,
    evaluating: false,
    samplePack: null,
    ...(seedRecords(DEFAULT_SCENARIO_ID, SCENARIO_BY_ID[DEFAULT_SCENARIO_ID].seed) as Pick<AppState, "workspace" | "sources" | "proposals" | "knowledgeVersions" | "activeKnowledgeVersionId" | "baselines" | "plans" | "workOrders" | "inventory" | "inventoryTransactions" | "costAssumptions" | "audit" | "historicalIncidents" | "historicalRuns">),

    // ----------------------------------------------------------------- lifecycle
    bootstrap: async () => {
      if (get().hydrated) return;
      const theme = (readPref(LOCAL_PREF_KEYS.theme) as AppState["theme"]) ?? "system";
      const reducedMotion = readPref(LOCAL_PREF_KEYS.reducedMotion) === "1";
      set({ theme, reducedMotion });
      const status = await storageStatus();
      set({ storage: { ...get().storage, available: status.available, reason: status.available ? undefined : status.reason } });
      lock = acquireWriterLock(WORKSPACE_ID);
      lock.onChange((isWriter) => {
        set({ storage: { ...get().storage, readOnly: !isWriter } });
        if (!isWriter) get().toast("error", "Another tab took over this workspace. This tab is now read-only; reload to reclaim it.");
      });
      let restored = false;
      if (status.available) {
        try {
          const stored = await loadWorkspace(WORKSPACE_ID);
          if (stored) {
            const b = stored.bundle;
            set({
              workspace: b.workspace,
              sources: b.sources,
              proposals: b.proposals,
              knowledgeVersions: b.knowledgeVersions,
              activeKnowledgeVersionId: b.activeKnowledgeVersionId,
              baselines: b.baselines,
              plans: b.plans,
              workOrders: b.workOrders,
              inventory: b.inventory,
              inventoryTransactions: b.inventoryTransactions,
              costAssumptions: b.costAssumptions,
              audit: b.audit,
              historicalIncidents: b.incidents.filter((i) => i.fixture),
              historicalRuns: b.runs.filter((r) => r.fixture),
            });
            if (stored.engine) {
              await startEngine({
                seed: stored.engine.seed,
                scenarioId: stored.engine.scenarioId,
                incidents: b.incidents.filter((i) => !i.fixture),
                runs: b.runs.filter((r) => !r.fixture),
                interventions: stored.engine.interventions as RecordedIntervention[],
                resumeLiveMs: stored.engine.liveMs,
              });
              restored = true;
              set({ storage: { ...get().storage, lastSavedAt: stored.savedAt } });
            }
          }
        } catch (e) {
          get().toast("error", `Stored workspace could not be restored (${e instanceof Error ? e.message : "corrupted"}); starting a fresh demo.`);
        }
      }
      if (!restored) {
        const scenarioId = get().workspace.scenarioId ?? DEFAULT_SCENARIO_ID;
        await startEngine({ seed: get().workspace.seed ?? SCENARIO_BY_ID[scenarioId].seed, scenarioId });
      }
      set({ hydrated: true });
      get().play();
    },

    newDemoWorkspace: async (scenarioId, seed) => {
      const sc = SCENARIO_BY_ID[scenarioId];
      if (!sc) return;
      const s = seed ?? sc.seed;
      set(seedRecords(scenarioId, s));
      await startEngine({ seed: s, scenarioId });
      auditEvent("WORKSPACE_RESET", WORKSPACE_ID, `New demo workspace: ${sc.title} (seed ${s})`);
      await get().persistNow();
      get().play();
    },

    resetWorkspace: async () => {
      await get().newDemoWorkspace(DEFAULT_SCENARIO_ID);
    },

    persistNow: async () => {
      const st = get();
      if (!st.storage.available || st.storage.readOnly) return;
      set({ storage: { ...st.storage, saving: true } });
      try {
        const bundle = await st.buildBundle();
        const snap = st.snapshot;
        await saveWorkspace({
          id: WORKSPACE_ID,
          savedAt: Date.now(),
          schemaVersion: SCHEMA_VERSION,
          bundle,
          engine: snap && snap.mode === "DEMO_SIMULATION" ? { seed: snap.seed ?? 0, scenarioId: snap.scenarioId ?? DEFAULT_SCENARIO_ID, startMs: snap.clock.startMs, liveMs: snap.clock.liveMs, interventions: snap.interventions } : undefined,
        });
        liveMsAtLastSave = snap?.clock.liveMs ?? 0;
        set({ storage: { ...get().storage, saving: false, lastSavedAt: Date.now(), error: undefined } });
      } catch (e) {
        set({ storage: { ...get().storage, saving: false, error: e instanceof Error ? e.message : "Save failed" } });
      }
    },

    setIdentity: (identity) => set({ identity }),
    setTheme: (theme) => {
      writePref(LOCAL_PREF_KEYS.theme, theme);
      set({ theme });
    },
    setReducedMotion: (reducedMotion) => {
      writePref(LOCAL_PREF_KEYS.reducedMotion, reducedMotion ? "1" : "0");
      set({ reducedMotion });
    },
    toast: (kind, text) => {
      const id = stableId("T", Date.now(), Math.random());
      set((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-4) }));
      setTimeout(() => get().dismissToast(id), kind === "error" ? 9000 : 5000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    setAskOpen: (askOpen) => set({ askOpen }),

    // ----------------------------------------------------------------- engine
    play: () => void req({ type: "PLAY" }),
    pause: () => void req({ type: "PAUSE" }),
    setSpeed: (speed) => void req({ type: "SET_SPEED", speed }),
    seek: (ms) => void req({ type: "SEEK", ms }),
    stepOnce: () => void req({ type: "STEP" }),
    setHidden: (hidden) => void req({ type: "SET_HIDDEN", hidden }),
    series: async (tagIds, fromMs, toMs, maxPoints) => {
      const r = await req({ type: "SERIES", query: { tagIds, fromMs, toMs, maxPoints } });
      return r && r.type === "SERIES" ? r.series : {};
    },
    events: async (tagIds, fromMs, toMs) => {
      const r = await req({ type: "EVENTS", tagIds, fromMs, toMs });
      return r && r.type === "EVENTS" ? r.events : {};
    },
    observations: async (ids) => {
      const r = await req({ type: "OBSERVATIONS", ids });
      return r && r.type === "OBSERVATIONS" ? r.observations : [];
    },
    intervene: async (id, params, workOrderId) => {
      if (get().workspace.mode !== "DEMO_SIMULATION") {
        get().toast("error", "Interventions are only available in the demo simulation. Imported traces are never mutated.");
        return null;
      }
      const r = await req({ type: "INTERVENE", interventionId: id, params, by: get().identity });
      if (!r || r.type !== "INTERVENTION") return null;
      auditEvent("INTERVENTION", workOrderId ?? id, `${INTERVENTION_BY_ID[id]?.title ?? id}${params ? ` ${JSON.stringify(params)}` : ""} — ${INTERVENTION_BY_ID[id]?.effect ?? ""}`);
      // Any approved plan whose run is in progress is now stale; mark WOs awaiting verification.
      scheduleSave();
      return r.intervention;
    },

    // ----------------------------------------------------------------- sources & knowledge
    importFiles: async (files) => {
      const st = get();
      const parsed: ParsedFile[] = [];
      const pending: PendingImport[] = [];
      for (const f of files) {
        const id = stableId("SRC", f.name.replace(/\W+/g, "-"), Date.now() % 100000);
        const p = parseFile(id, f.name, f.text, now());
        if (f.size) p.document.sizeBytes = f.size;
        parsed.push(p);
        if (p.csv && (p.document.sourceType === "OPERATING_TRACE" || p.document.sourceType === "ALARM_HISTORY") && p.document.sourceType === "OPERATING_TRACE") {
          pending.push({ fileId: id, fileName: f.name, headers: p.csv.headers, preview: p.csv.rows.slice(0, 8), rowCount: p.csv.rows.length, mapping: proposeMapping(p.csv.headers), timeZoneAssumption: "+05:30", parsed: p });
        }
      }
      const docs = parsed.map((p) => p.document);
      // Replace documents with the same file name (re-import), keep others.
      const sources = [...st.sources.filter((s) => !docs.some((d) => d.fileName === s.fileName)), ...docs];
      const parsedFiles = [...st.parsedFiles.filter((p) => !docs.some((d) => d.fileName === p.document.fileName)), ...parsed];
      mutate({ sources, parsedFiles, pendingImports: [...st.pendingImports, ...pending] });
      auditEvent("IMPORT", WORKSPACE_ID, `Imported ${files.length} file(s): ${files.map((f) => f.name).join(", ")}`);
      get().runPipeline();
      if (pending.length) get().toast("info", `${pending.length} trace file(s) need column mapping before replay.`);
    },

    updatePendingImport: (fileId, patch) => set((s) => ({ pendingImports: s.pendingImports.map((p) => (p.fileId === fileId ? { ...p, ...patch, report: undefined } : p)) })),

    previewPendingImport: (fileId) => {
      const st = get();
      const p = st.pendingImports.find((x) => x.fileId === fileId);
      if (!p?.parsed.csv) return;
      const opts = normalizeOptionsFor(st, p);
      const { report } = normalizeTrace(p.headers, p.parsed.csv.rows, p.mapping, opts);
      set({ pendingImports: st.pendingImports.map((x) => (x.fileId === fileId ? { ...x, report } : x)) });
    },

    commitPendingImport: async (fileId) => {
      const st = get();
      const p = st.pendingImports.find((x) => x.fileId === fileId);
      if (!p?.parsed.csv) return;
      const opts = normalizeOptionsFor(st, p);
      const { samples, report } = normalizeTrace(p.headers, p.parsed.csv.rows, p.mapping, opts);
      if (!samples.length) {
        get().toast("error", "No rows could be normalised with this mapping.");
        return;
      }
      if (report.localTimestampsAssumed && !p.timeZoneAssumption) {
        get().toast("error", "Local timestamps need an explicit time-zone assumption.");
        return;
      }
      const alarms: Alarm[] = [];
      const alarmFile = st.parsedFiles.find((f) => f.document.sourceType === "ALARM_HISTORY" && f.csv);
      if (alarmFile?.csv) {
        const h = alarmFile.csv.headers;
        const ix = (n: string) => h.indexOf(n);
        for (const row of alarmFile.csv.rows) {
          const raised = Date.parse(row[ix("raised_at")] ?? "");
          if (!Number.isFinite(raised)) continue;
          const cleared = Date.parse(row[ix("cleared_at")] ?? "");
          alarms.push({ id: row[ix("alarm_id")] || stableId("ALM-IMP", raised), assetId: row[ix("asset_id")], tagId: row[ix("tag")] ? `${row[ix("asset_id")]}.${row[ix("tag")]}` : undefined, severity: (row[ix("severity")] as Alarm["severity"]) || "WARNING", message: row[ix("message")] ?? "", raisedAt: { ms: raised, clock: "EVENT", uncertaintyMs: 0 }, clearedAt: Number.isFinite(cleared) ? { ms: cleared, clock: "EVENT", uncertaintyMs: 0 } : undefined });
        }
      }
      const importInfo: Workspace["importInfo"] = {
        fileNames: [p.fileName, ...(alarmFile ? [alarmFile.document.fileName] : [])],
        observedRange: report.range,
        timeZoneAssumption: report.localTimestampsAssumed ? p.timeZoneAssumption : "explicit offsets in file",
        limitations: [
          `${report.accepted} of ${report.rowsParsed} rows accepted`,
          ...(report.duplicates ? [`${report.duplicates} duplicate rows dropped`] : []),
          ...(report.missingTimestamps ? [`${report.missingTimestamps} rows without timestamps`] : []),
          ...(report.outOfOrder ? [`${report.outOfOrder} out-of-order rows re-sequenced`] : []),
          ...Object.keys(report.unmatchedTags).map((t) => `Unmatched tag ${t} (${report.unmatchedTags[t]} rows) not replayed`),
          ...report.unitConflicts.map((u) => `Unit conflict on ${u.tagId}: file says ${u.found}, registry expects ${u.expected} (${u.count} rows marked SUSPECT)`),
          ...(report.nullValues ? [`${report.nullValues} null values kept as MISSING`] : []),
          "Imported observations are never modified by annotations or maintenance records.",
        ],
      };
      await req({ type: "LOAD_IMPORTED", samples: samples.map((s) => ({ tagId: s.tagId, sample: s.sample as Sample })), alarms, importInfo });
      const ws: Workspace = { ...st.workspace, id: WORKSPACE_ID, name: `Imported replay — ${p.fileName}`, mode: "IMPORTED_REPLAY", importInfo };
      mutate({ workspace: ws, pendingImports: st.pendingImports.filter((x) => x.fileId !== fileId) });
      auditEvent("IMPORT_COMMIT", fileId, `Replay workspace created from ${p.fileName}: ${report.accepted} observations, range ${report.range ? new Date(report.range.startMs).toISOString() : "?"}`);
      get().toast("success", `Imported replay ready: ${report.accepted} observations. Use the playback controls to replay.`);
    },

    discardPendingImport: (fileId) => set((s) => ({ pendingImports: s.pendingImports.filter((p) => p.fileId !== fileId) })),

    loadSamplePack: async () => {
      let pack = get().samplePack;
      if (!pack) {
        const r = await req({ type: "BUILD_PACK" });
        if (!r || r.type !== "PACK") return;
        pack = r.pack;
        set({ samplePack: pack });
      }
      // Load the explanatory/configuration/historical files into the current workspace as sources.
      const files = pack.files.filter((f) => f.name !== "operating_trace.csv").map((f) => ({ name: f.name, text: f.text }));
      await get().importFiles(files);
      auditEvent("SAMPLE_PACK", WORKSPACE_ID, `Loaded sample factory pack (${pack.files.length} files, ${pack.counts.traceRows} trace rows available for replay import)`);
      get().toast("success", `Sample factory pack loaded: ${files.length} source files parsed. The operating trace can be imported separately for replay.`);
    },

    downloadSamplePack: async () => {
      let pack = get().samplePack;
      if (!pack) {
        const r = await req({ type: "BUILD_PACK" });
        if (!r || r.type !== "PACK") return;
        pack = r.pack;
        set({ samplePack: pack });
      }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of pack.files) zip.file(f.name, f.text);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plantlens-sample-factory-pack.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    runPipeline: () => {
      const st = get();
      const { proposals, stages } = runLocalPipeline(st.parsedFiles, st.activeKnowledge(), now());
      // Keep review decisions already made on proposals with the same id.
      const merged = proposals.map((p) => st.proposals.find((x) => x.id === p.id && x.review) ?? p);
      const untouched = st.proposals.filter((x) => !proposals.some((p) => p.id === x.id) && x.pipeline === "HUMAN");
      mutate({ proposals: [...untouched, ...merged], pipelineStages: stages });
    },

    reviewProposalAction: (id, decision, reason, edits) => {
      const st = get();
      const p = st.proposals.find((x) => x.id === id);
      if (!p) return;
      try {
        const reviewed = reviewProposal(p, { reviewer: st.identity, simulatedIdentity: true, decision, reason, at: now() }, edits);
        mutate({ proposals: st.proposals.map((x) => (x.id === id ? reviewed : x)) });
        auditEvent("PROPOSAL_REVIEW", id, `${decision}: ${reason}`);
      } catch (e) {
        get().toast("error", e instanceof Error ? e.message : String(e));
      }
    },

    publishKnowledge: async (reason) => {
      const st = get();
      const approved = st.proposals.filter((p) => p.state === "APPROVED" && !p.changeSummary.some((c) => c.startsWith("Published in")));
      if (!approved.length) {
        get().toast("error", "No approved proposals to publish.");
        return;
      }
      const current = st.activeKnowledge();
      const { next, superseded, changedIds } = publishVersion(current, approved, st.identity, reason, now());
      const plans = st.plans.map((pl) => invalidateForKnowledgeChange(pl, changedIds, next.id) ?? pl);
      const invalidated = plans.filter((pl, i) => pl !== st.plans[i]);
      const proposals = st.proposals.map((p) => (approved.includes(p) ? { ...p, changeSummary: [...p.changeSummary, `Published in ${next.id}`] } : p));
      mutate({ knowledgeVersions: [...st.knowledgeVersions.map((k) => (k.id === superseded.id ? superseded : k)), next], activeKnowledgeVersionId: next.id, proposals, plans });
      auditEvent("KNOWLEDGE_PUBLISH", next.id, `${reason}. Changed: ${changedIds.join(", ")}${invalidated.length ? `. Invalidated plan approvals: ${invalidated.map((p) => `${p.id} v${p.version}`).join(", ")}` : ""}`);
      for (const pl of invalidated) {
        auditEvent("MIGRATION_TASK", pl.id, `Plan ${pl.id} v${pl.version} needs review after ${next.id}; outstanding approval invalidated.`);
        const wo = st.workOrders.find((w) => w.recoveryPlanId === pl.id && !w.locked);
        if (wo) get().toast("info", `Work order ${wo.id}: recovery suite needs re-approval and rerun after ${next.id}.`);
      }
      await req({ type: "SET_KNOWLEDGE", knowledge: next });
      await get().persistNow();
      get().toast("success", `Published ${next.id} (${changedIds.length} change${changedIds.length === 1 ? "" : "s"}).`);
    },

    activeKnowledge: () => {
      const st = get();
      return st.knowledgeVersions.find((k) => k.id === st.activeKnowledgeVersionId) ?? st.knowledgeVersions[st.knowledgeVersions.length - 1];
    },

    addHumanEdgeDraft: (edge, rationale) => {
      const st = get();
      const p: KnowledgeProposal = {
        id: stableId("PROP-HUMAN", edge.id, Date.now()),
        kind: edge.evidenceRefs.length ? "DEPENDENCY_EDGE" : "UNCITED_DRAFT",
        title: `${edge.relation.replace(/_/g, " ").toLowerCase()}: ${edge.from} → ${edge.to} (human draft)`,
        state: "NEEDS_REVIEW",
        producedBy: "HUMAN",
        pipeline: "HUMAN",
        createdAt: now(),
        evidence: edge.evidenceRefs,
        rationale,
        validation: { ok: edge.evidenceRefs.length > 0, errors: edge.evidenceRefs.length ? [] : ["No cited source span; cannot be published"], warnings: [] },
        payload: edge.evidenceRefs.length ? { kind: "DEPENDENCY_EDGE", edge } : { kind: "UNCITED_DRAFT", edge },
        changeSummary: [`Adds edge ${edge.id}`],
      };
      mutate({ proposals: [...st.proposals, p] });
    },

    // ----------------------------------------------------------------- work orders
    createWorkOrder: (incidentId, fields) => {
      const st = get();
      const inc = st.snapshot?.incidents.find((i) => i.id === incidentId);
      const id = `WO-${String(st.workOrders.filter((w) => !w.fixture).length + 1).padStart(3, "0")}`;
      const wo: WorkOrder = {
        id,
        incidentId,
        assetId: fields.assetId,
        cellId: inc?.affectedCellIds[0] ?? (fields.assetId.endsWith("02") ? "CELL-B" : "CELL-A"),
        title: fields.title,
        state: "OPEN",
        priority: fields.priority,
        assignee: fields.assignee,
        evidenceRefs: inc?.diagnosis?.evidence.map((e) => e.id) ?? [],
        suspectedMechanism: fields.suspectedMechanism,
        plannedAction: fields.plannedAction,
        approvals: [],
        workPerformed: [],
        labor: [],
        parts: [],
        runIds: [],
        events: [],
        createdAt: now(),
        faultFamily: inc?.diagnosis?.candidates[0]?.family,
      };
      mutate({ workOrders: [...st.workOrders, wo] });
      if (incidentId) void req({ type: "LINK_INCIDENT", incidentId, workOrderIds: [id] });
      auditEvent("WO_CREATE", id, `${fields.title} (${fields.assetId})`);
      return wo;
    },

    transitionWO: (id, to, reason) => {
      const st = get();
      const wo = st.workOrders.find((w) => w.id === id);
      if (!wo) return;
      try {
        const next = transitionWorkOrder(wo, to, st.identity, reason, now());
        mutate({ workOrders: st.workOrders.map((w) => (w.id === id ? next : w)) });
      } catch (e) {
        get().toast("error", e instanceof WorkflowError ? e.message : String(e));
      }
    },

    approveIntervention: (id, reason) => {
      const st = get();
      const wo = st.workOrders.find((w) => w.id === id);
      if (!wo) return;
      try {
        let next = wo.state === "OPEN" ? transitionWorkOrder(wo, "INVESTIGATING", st.identity, "Investigation started", now()) : wo;
        next = transitionWorkOrder(next, "INTERVENTION_APPROVED", st.identity, reason, now());
        next = { ...next, approvals: [...next.approvals, { reviewer: st.identity, simulatedIdentity: true, decision: "APPROVED", reason, at: now() }] };
        mutate({ workOrders: st.workOrders.map((w) => (w.id === id ? next : w)) });
      } catch (e) {
        get().toast("error", e instanceof WorkflowError ? e.message : String(e));
      }
    },

    recordWork: async (id, description, interventionId, params) => {
      const st = get();
      const wo = st.workOrders.find((w) => w.id === id);
      if (!wo) return;
      if (wo.state !== "INTERVENTION_APPROVED" && wo.state !== "WORK_RECORDED" && wo.state !== "VERIFICATION_FAILED" && wo.state !== "AWAITING_VERIFICATION") {
        get().toast("error", `Work cannot be recorded while ${wo.id} is ${wo.state}; approve the intervention first.`);
        return;
      }
      let interventionRecId: string | undefined;
      if (interventionId) {
        const rec = await get().intervene(interventionId, params, id);
        if (!rec) return;
        interventionRecId = rec.id;
      }
      const cur = get().workOrders.find((w) => w.id === id)!;
      let next: WorkOrder = { ...cur, workPerformed: [...cur.workPerformed, { id: stableId("WP", id, cur.workPerformed.length), at: now(), by: get().identity, description, interventionId: interventionRecId }] };
      if (next.state === "INTERVENTION_APPROVED") next = transitionWorkOrder(next, "WORK_RECORDED", get().identity, "Work recorded", now());
      else if (next.state === "VERIFICATION_FAILED") next = transitionWorkOrder(transitionWorkOrder(next, "INTERVENTION_APPROVED", get().identity, "Further work approved", now()), "WORK_RECORDED", get().identity, "Work recorded", now());
      else if (next.state === "AWAITING_VERIFICATION") next = { ...next, events: [...next.events, makeAudit(get().identity, "WO_NOTE", id, "Additional work recorded; any earlier run is stale.", now())] };
      mutate({ workOrders: get().workOrders.map((w) => (w.id === id ? next : w)) });
      auditEvent("WORK_RECORDED", id, description);
    },

    addLabor: (id, minutes, note) => {
      const st = get();
      const wo = st.workOrders.find((w) => w.id === id);
      if (!wo || wo.locked) return;
      const rate = st.costAssumptions.find((c) => c.cellId === wo.cellId)?.laborPaisePerHour ?? 60000;
      const next = { ...wo, labor: [...wo.labor, { id: stableId("L", id, wo.labor.length), who: st.identity, minutes, ratePaisePerHour: rate, at: now(), note }] };
      mutate({ workOrders: st.workOrders.map((w) => (w.id === id ? next : w)) });
    },

    reservePart: (woId, partId, quantity, actionKey) => inventoryAction(get, mutate, auditEvent, "RESERVE", woId, partId, quantity, actionKey),
    consumePart: (woId, partId, quantity, actionKey) => inventoryAction(get, mutate, auditEvent, "CONSUME", woId, partId, quantity, actionKey),
    returnPart: (woId, partId, quantity, actionKey) => inventoryAction(get, mutate, auditEvent, "RETURN", woId, partId, quantity, actionKey),
    receivePart: (partId, quantity, actionKey) => inventoryAction(get, mutate, auditEvent, "RECEIVE", undefined, partId, quantity, actionKey),

    // ----------------------------------------------------------------- recovery
    createPlan: (incidentId, templateId) => {
      const st = get();
      const inc = st.snapshot?.incidents.find((i) => i.id === incidentId) ?? st.historicalIncidents.find((i) => i.id === incidentId);
      const tpl = templatesFor(undefined).find((t) => t.id === templateId);
      if (!inc || !tpl) return null;
      const knowledge = st.activeKnowledge();
      const cell = tpl.cellId === "CELL-B" ? "CELL-B" : "CELL-A";
      const baseline = st.baselines.find((b) => b.recipe === tpl.recipe && b.cellId === cell);
      if (!baseline) {
        get().toast("error", `No approved baseline for ${tpl.recipe} in ${cell}; a missing baseline is a knowledge gap, not a pass.`);
        return null;
      }
      const existing = st.plans.filter((p) => p.incidentId === incidentId);
      const planId = `RP-${incidentId.replace("INC-DEMO-", "")}-${String(existing.length + 1).padStart(3, "0")}`;
      const { plan, warnings, errors } = compilePlan({ template: tpl, incident: inc, knowledge, baselineId: baseline.id, planId, version: 1, now: now() });
      if (errors.length) {
        get().toast("error", errors.join(" "));
        return null;
      }
      for (const w of warnings) get().toast("info", w);
      mutate({ plans: [...st.plans, plan] });
      void req({ type: "LINK_INCIDENT", incidentId, recoveryPlanIds: [planId] });
      auditEvent("PLAN_CREATE", planId, `From ${tpl.id} against ${knowledge.id} / ${baseline.id}`);
      return plan;
    },

    editPlan: (planId, edits, reason) => {
      const st = get();
      const current = st.plans.filter((p) => p.id === planId).sort((a, b) => b.version - a.version)[0];
      if (!current) return;
      const { previous, next } = revisePlan(current, edits, now(), reason);
      mutate({ plans: [...st.plans.map((p) => (p === current ? previous : p)), next] });
      auditEvent("PLAN_EDIT", planId, `v${previous.version} → v${next.version}: ${reason}. Prior approval invalidated.`);
    },

    approvePlanAction: (planId, reason) => {
      const st = get();
      const current = st.plans.filter((p) => p.id === planId).sort((a, b) => b.version - a.version)[0];
      if (!current) return;
      try {
        const approved = approvePlan(current, { reviewer: st.identity, simulatedIdentity: true, decision: "APPROVED", reason, at: now() });
        mutate({ plans: st.plans.map((p) => (p === current ? approved : p)) });
        auditEvent("PLAN_APPROVE", planId, `v${current.version}: ${reason}`);
      } catch (e) {
        get().toast("error", e instanceof Error ? e.message : String(e));
      }
    },

    startRun: async (planId, workOrderId) => {
      const st = get();
      const plan = st.plans.filter((p) => p.id === planId).sort((a, b) => b.version - a.version)[0];
      if (!plan) return null;
      if (plan.status !== "APPROVED") {
        get().toast("error", `Plan ${planId} v${plan.version} is ${plan.status}; approve it before running.`);
        return null;
      }
      const r = await req({ type: "START_RUN", plan, workOrderId });
      if (!r || r.type !== "RUN") return null;
      if (workOrderId) {
        const wo = get().workOrders.find((w) => w.id === workOrderId);
        if (wo) {
          let next: WorkOrder = { ...wo, runIds: [...wo.runIds, r.run.id], recoveryPlanId: planId };
          try {
            if (next.state === "WORK_RECORDED") next = transitionWorkOrder(next, "AWAITING_VERIFICATION", st.identity, "Recovery run started", now());
            if (next.state === "AWAITING_VERIFICATION") next = transitionWorkOrder(next, "VERIFICATION_IN_PROGRESS", st.identity, `Run ${r.run.id}`, now());
          } catch {
            /* keep state */
          }
          mutate({ workOrders: get().workOrders.map((w) => (w.id === workOrderId ? next : w)) });
        }
      }
      auditEvent("RUN_START", r.run.id, `Plan ${planId} v${plan.version}${workOrderId ? ` for ${workOrderId}` : ""}`);
      return r.run;
    },

    abortRun: (runId) => {
      void req({ type: "ABORT_RUN", runId });
      auditEvent("RUN_ABORT", runId, "Aborted by user");
    },

    reviewRun: (runId, decision, reason) => {
      const review: ReviewRecord = { reviewer: get().identity, simulatedIdentity: true, decision, reason, at: now() };
      void req({ type: "REVIEW_RUN", runId, review });
      auditEvent("RUN_REVIEW", runId, `${decision}: ${reason}`);
      scheduleSave();
    },

    closeWO: (id, reason) => {
      const st = get();
      const wo = st.workOrders.find((w) => w.id === id);
      if (!wo) return;
      const plan = wo.recoveryPlanId ? st.plans.filter((p) => p.id === wo.recoveryPlanId).sort((a, b) => b.version - a.version)[0] : undefined;
      const runs = st.snapshot?.runs ?? [];
      const review: ReviewRecord = { reviewer: st.identity, simulatedIdentity: true, decision: "APPROVED", reason, at: now() };
      const check = checkVerifiedClosure(wo, plan, runs, review);
      if (!check.ok) {
        get().toast("error", check.reasons.join(" "));
        return;
      }
      try {
        let current = wo;
        if (current.state === "VERIFICATION_IN_PROGRESS") current = transitionWorkOrder(current, "VERIFIED", st.identity, "Passing run observed", now());
        const closed = closeWorkOrder(current, plan, runs, review, st.identity, now());
        mutate({ workOrders: st.workOrders.map((w) => (w.id === id ? closed : w)) });
        if (wo.incidentId) void req({ type: "SET_INCIDENT_STATUS", incidentId: wo.incidentId, status: "RESOLVED" });
        auditEvent("WO_CLOSE", id, `Verified closure on run ${closed.closure?.runId}: ${reason}`);
        void get().persistNow();
      } catch (e) {
        get().toast("error", e instanceof Error ? e.message : String(e));
      }
    },

    setIncidentStatus: (id, status) => {
      void req({ type: "SET_INCIDENT_STATUS", incidentId: id, status });
      auditEvent("INCIDENT_STATUS", id, status);
    },

    draftWorkOrderFromIncident: (incidentId) => {
      const st = get();
      const inc = st.snapshot?.incidents.find((i) => i.id === incidentId);
      if (!inc?.diagnosis) return null;
      const top = inc.diagnosis.candidates[0];
      const asset = inc.sharedCauseAssetId ?? inc.observedAssetIds[0];
      const wo = get().createWorkOrder(incidentId, {
        assetId: asset,
        title: `${inc.title} — investigate ${top?.title ?? "deviation"}`,
        priority: inc.interruptions.length ? "P1" : "P2",
        suspectedMechanism: top ? `${top.title} (${inc.diagnosis.state})` : "Unknown — human review",
        plannedAction: inc.diagnosis.nextChecks[0]?.title ?? "Investigate evidence",
        assignee: "Technician R. (simulated)",
      });
      auditEvent("AUTOMATION", wo.id, `Drafted from incident ${incidentId} by approval-based automation (record update only; no machinery actuated).`);
      return wo;
    },

    prepareSpareRequest: (woId, interventionId) => {
      const def = INTERVENTION_BY_ID[interventionId];
      if (!def) return;
      for (const partId of def.partIds) get().reservePart(woId, partId, 1, `spare-${woId}-${interventionId}-${partId}`);
      if (def.partIds.length) auditEvent("AUTOMATION", woId, `Spare request prepared for ${def.title}: ${def.partIds.join(", ")} reserved.`);
      else get().toast("info", `${def.title} needs no parts.`);
    },

    draftHandover: () => {
      const st = get();
      const snap = st.snapshot;
      const open = (snap?.incidents ?? []).filter((i) => !i.fixture && i.status !== "CLOSED" && i.status !== "RESOLVED");
      const lines = [
        `Shift handover — ${st.workspace.name} (${snap?.mode ?? "?"}), simulation time ${snap ? new Date(snap.clock.liveMs).toISOString() : "?"}`,
        `Knowledge version: ${st.activeKnowledgeVersionId}`,
        "",
        `Open incidents (${open.length}):`,
        ...open.map((i) => `- ${i.id} ${i.title}: ${i.diagnosis?.state ?? "?"} — ${i.diagnosis?.summary ?? ""}`),
        "",
        `Work orders in progress: ${st.workOrders.filter((w) => !w.fixture && w.state !== "CLOSED").map((w) => `${w.id} (${w.state})`).join(", ") || "none"}`,
        `Recovery runs: ${(snap?.runs ?? []).map((r) => `${r.id} ${r.outcome}`).join(", ") || "none"}`,
        "",
        "Generated from application records by approval-based automation; review before sending.",
      ];
      return lines.join("\n");
    },

    // ----------------------------------------------------------------- export / import
    buildBundle: async () => {
      const st = get();
      const snap = st.snapshot;
      const incidents = [...st.historicalIncidents, ...(snap?.incidents ?? [])];
      const runs = [...st.historicalRuns, ...(snap?.runs ?? [])];
      let observations: Observation[] = [];
      if (snap) {
        const from = Math.max(snap.clock.startMs, snap.clock.liveMs - 30 * 60_000);
        const r = await req({ type: "EXPORT_OBSERVATIONS", fromMs: from, toMs: snap.clock.liveMs });
        if (r && r.type === "EXPORT_OBSERVATIONS") observations = r.observations;
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: now(),
        workspace: st.workspace,
        sources: st.sources,
        proposals: st.proposals,
        knowledgeVersions: st.knowledgeVersions,
        activeKnowledgeVersionId: st.activeKnowledgeVersionId,
        baselines: st.baselines,
        incidents,
        alarms: snap?.alarms ?? [],
        plans: st.plans,
        runs,
        workOrders: st.workOrders,
        inventory: st.inventory,
        inventoryTransactions: st.inventoryTransactions,
        costAssumptions: st.costAssumptions,
        audit: st.audit,
        observations,
        containsGroundTruth: false,
      };
    },

    exportBundle: async () => {
      const bundle = await get().buildBundle();
      downloadText(`plantlens-evidence-bundle-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, serializeBundle(bundle), "application/json");
      auditEvent("EXPORT", WORKSPACE_ID, `Evidence bundle exported (${bundle.observations.length} observations, ${bundle.incidents.length} incidents)`);
    },

    importBundle: async (text) => {
      const res = parseBundle(text);
      if (!res.ok) {
        get().toast("error", res.error);
        return;
      }
      const b = res.bundle;
      set({
        workspace: { ...b.workspace, id: WORKSPACE_ID },
        sources: b.sources,
        proposals: b.proposals,
        knowledgeVersions: b.knowledgeVersions,
        activeKnowledgeVersionId: b.activeKnowledgeVersionId,
        baselines: b.baselines,
        plans: b.plans,
        workOrders: b.workOrders,
        inventory: b.inventory,
        inventoryTransactions: b.inventoryTransactions,
        costAssumptions: b.costAssumptions,
        audit: b.audit,
        historicalIncidents: b.incidents.filter((i) => i.fixture),
        historicalRuns: b.runs.filter((r) => r.fixture),
        parsedFiles: b.sources.map((d) => parseFile(d.id, d.fileName, d.lines.join("\n"), d.importedAt)),
      });
      const scenarioId = b.workspace.scenarioId ?? DEFAULT_SCENARIO_ID;
      await startEngine({ seed: b.workspace.seed ?? SCENARIO_BY_ID[scenarioId].seed, scenarioId, incidents: b.incidents.filter((i) => !i.fixture), runs: b.runs.filter((r) => !r.fixture) });
      for (const w of res.warnings) get().toast("info", w);
      auditEvent("IMPORT_BUNDLE", WORKSPACE_ID, `Bundle imported (exported ${new Date(b.exportedAt.ms).toISOString()})`);
      await get().persistNow();
      get().toast("success", "Bundle imported. IDs and versions retained; the simulation restarted at the scenario start (recorded observations are in the bundle).");
    },

    exportTelemetryCsv: async () => {
      const snap = get().snapshot;
      if (!snap) return;
      const r = await req({ type: "EXPORT_OBSERVATIONS", fromMs: snap.clock.startMs, toMs: snap.clock.liveMs });
      if (!r || r.type !== "EXPORT_OBSERVATIONS") return;
      downloadText("plantlens-telemetry.csv", observationsCsv(r.observations), "text/csv");
    },

    runEvaluation: async (config) => {
      set({ evaluating: true });
      const r = await req({ type: "EVALUATE", config });
      set({ evaluating: false, evaluation: r && r.type === "EVALUATION" ? r.report : get().evaluation });
    },

    setGuided: (patch) => set((s) => ({ guided: { ...s.guided, ...patch } })),

    updateCostAssumption: (id, patch) => {
      const st = get();
      mutate({ costAssumptions: st.costAssumptions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
      auditEvent("COST_ASSUMPTION", id, JSON.stringify(patch));
    },
  };
});

function normalizeOptionsFor(st: AppState, p: PendingImport): NormalizeOptions {
  const k = st.activeKnowledge();
  const assetAliases: Record<string, string> = {};
  for (const m of k.mappings) if (m.status === "APPROVED" && m.assetId) assetAliases[m.alias] = m.assetId;
  return { timeZoneAssumption: p.timeZoneAssumption || undefined, assetAliases, tagAliases: {}, unitApprovals: {}, sourceId: p.fileId, clockSourceId: "IMPORT", uncertaintyMs: 0 };
}

function inventoryAction(get: () => AppState, mutate: (p: Partial<AppState>) => void, auditEvent: (k: string, s: string, d: string) => AuditEvent, kind: InventoryTransaction["kind"], woId: string | undefined, partId: string, quantity: number, actionKey: string): void {
  const st = get();
  const wo = woId ? st.workOrders.find((w) => w.id === woId) : undefined;
  if (woId && (!wo || wo.locked)) {
    get().toast("error", "Work order is closed or missing.");
    return;
  }
  try {
    const { state, transaction, duplicate } = applyInventory({ parts: st.inventory, transactions: st.inventoryTransactions }, { idempotencyKey: actionKey, kind, partId, quantity, workOrderId: woId, at: now() });
    if (duplicate) {
      get().toast("info", "Duplicate request ignored (idempotent).");
      return;
    }
    const workOrders = wo && kind === "CONSUME" ? st.workOrders.map((w) => (w.id === woId ? { ...w, parts: [...w.parts, { transactionId: transaction.id, partId, quantity, unitPricePaise: transaction.unitPricePaise }] } : w)) : wo && kind === "RETURN" ? st.workOrders.map((w) => (w.id === woId ? { ...w, parts: [...w.parts, { transactionId: transaction.id, partId, quantity: -quantity, unitPricePaise: transaction.unitPricePaise }] } : w)) : st.workOrders;
    mutate({ inventory: state.parts, inventoryTransactions: state.transactions, workOrders });
    auditEvent("INVENTORY", transaction.id, `${kind} ${quantity} × ${partId}${woId ? ` for ${woId}` : ""}`);
  } catch (e) {
    get().toast("error", e instanceof WorkflowError ? e.message : String(e));
  }
}

export function useSnapshot(): RuntimeSnapshot | null {
  return useApp((s) => s.snapshot);
}

export function currentIncidents(snapshot: RuntimeSnapshot | null): Incident[] {
  return (snapshot?.incidents ?? []).filter((i) => !i.fixture);
}
