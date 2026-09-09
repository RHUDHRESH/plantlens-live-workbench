import type { WorkerPush, WorkerRequest, WorkerResponse } from "./protocol";
import type { RuntimeSnapshot } from "./runtime";

/**
 * Main-thread client for the engine worker. One instance per app shell; survives route
 * changes because the store holds it. Guards against duplicate workers under Strict Mode.
 */

export type OkResponse = Extract<WorkerResponse, { ok: true }>;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<WorkerRequest, "id">;
type Pending = { resolve: (v: OkResponse) => void; reject: (e: Error) => void };

export class EngineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(s: RuntimeSnapshot) => void>();
  private errorListeners = new Set<(e: string) => void>();

  start(): void {
    if (this.worker || typeof window === "undefined") return;
    this.worker = new Worker(new URL("../../workers/engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse | WorkerPush>) => {
      const m = ev.data;
      if (m.id === -1) {
        const push = m as WorkerPush;
        if (push.ok && push.type === "TICK") for (const l of this.listeners) l(push.snapshot);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) {
        const ok = m as OkResponse;
        p.resolve(ok);
        if (ok.type === "SNAPSHOT") for (const l of this.listeners) l(ok.snapshot);
      } else {
        for (const l of this.errorListeners) l(m.error);
        p.reject(new Error(m.error));
      }
    };
    this.worker.onerror = (e) => {
      for (const l of this.errorListeners) l(e.message);
    };
  }

  get started(): boolean {
    return this.worker !== null;
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("Engine worker stopped"));
    this.pending.clear();
  }

  onSnapshot(fn: (s: RuntimeSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onError(fn: (e: string) => void): () => void {
    this.errorListeners.add(fn);
    return () => {
      this.errorListeners.delete(fn);
    };
  }

  request(req: RequestBody): Promise<OkResponse> {
    if (!this.worker) this.start();
    if (!this.worker) return Promise.reject(new Error("Web Workers are unavailable in this environment"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, ...req } as WorkerRequest);
    });
  }
}

let singleton: EngineClient | null = null;
export function engineClient(): EngineClient {
  if (!singleton) singleton = new EngineClient();
  return singleton;
}
