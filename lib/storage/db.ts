import { openDB, type IDBPDatabase } from "idb";
import type { SessionBundle } from "@/lib/domain/types";
import { SCHEMA_VERSION } from "@/lib/domain/types";

/**
 * IndexedDB persistence. Data is stored in this browser only — not cloud-synced, not a
 * backup, not tamper-proof. One active writer per workspace is enforced with a
 * BroadcastChannel lock so two tabs cannot silently overwrite each other.
 */

const DB_NAME = "plantlens";
const DB_VERSION = 3;
const STORE = "workspaces";
const META = "meta";

export interface StoredWorkspace {
  id: string;
  savedAt: number;
  schemaVersion: number;
  bundle: SessionBundle;
  /** Engine restore data (demo mode only). */
  engine?: { seed: number; scenarioId: string; startMs: number; liveMs: number; interventions: unknown[] };
}

export type StorageStatus = { available: true } | { available: false; reason: string };

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
        void oldVersion;
      },
    });
  }
  return dbPromise;
}

export async function storageStatus(): Promise<StorageStatus> {
  try {
    if (typeof indexedDB === "undefined") return { available: false, reason: "IndexedDB is not available in this browser context." };
    await db();
    return { available: true };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : "IndexedDB could not be opened." };
  }
}

export async function saveWorkspace(ws: StoredWorkspace): Promise<void> {
  const d = await db();
  await d.put(STORE, ws);
}

export async function loadWorkspace(id: string): Promise<StoredWorkspace | undefined> {
  const d = await db();
  const raw = (await d.get(STORE, id)) as StoredWorkspace | undefined;
  if (!raw) return undefined;
  if (raw.schemaVersion !== SCHEMA_VERSION) return migrate(raw);
  return raw;
}

export async function listWorkspaces(): Promise<Array<{ id: string; name: string; mode: string; savedAt: number }>> {
  const d = await db();
  const all = (await d.getAll(STORE)) as StoredWorkspace[];
  return all.map((w) => ({ id: w.id, name: w.bundle.workspace.name, mode: w.bundle.workspace.mode, savedAt: w.savedAt }));
}

export async function deleteWorkspace(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.clear(STORE);
  await d.clear(META);
}

/** Schema migration: older bundles are rejected as corrupted unless a migration exists. */
function migrate(raw: StoredWorkspace): StoredWorkspace | undefined {
  // No older on-disk schema versions were ever shipped; anything else is treated as corrupted.
  if (raw.schemaVersion < SCHEMA_VERSION) return undefined;
  return undefined;
}

// ---------------------------------------------------------------------------
// Writer lock across tabs
// ---------------------------------------------------------------------------

export interface WriterLock {
  isWriter: boolean;
  release: () => void;
  onChange: (fn: (isWriter: boolean) => void) => () => void;
}

export function acquireWriterLock(workspaceId: string): WriterLock {
  const listeners = new Set<(w: boolean) => void>();
  const state = { isWriter: true };
  if (typeof BroadcastChannel === "undefined") return { isWriter: true, release: () => {}, onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
  const ch = new BroadcastChannel(`plantlens-lock-${workspaceId}`);
  const token = Math.random().toString(36).slice(2);
  const notify = () => listeners.forEach((l) => l(state.isWriter));
  ch.onmessage = (ev: MessageEvent<{ kind: string; token: string }>) => {
    if (ev.data.kind === "CLAIM" && ev.data.token !== token) {
      // Another tab claimed the workspace; this tab becomes read-only until reload.
      if (state.isWriter) {
        state.isWriter = false;
        notify();
      }
    }
    if (ev.data.kind === "QUERY" && state.isWriter) ch.postMessage({ kind: "CLAIM", token });
  };
  ch.postMessage({ kind: "CLAIM", token });
  return {
    get isWriter() {
      return state.isWriter;
    },
    release: () => ch.close(),
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const LOCAL_PREF_KEYS = { theme: "plantlens.theme", reducedMotion: "plantlens.reducedMotion", lastWorkspace: "plantlens.lastWorkspace", guidedStep: "plantlens.guidedStep" } as const;

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preferences are optional */
  }
}
