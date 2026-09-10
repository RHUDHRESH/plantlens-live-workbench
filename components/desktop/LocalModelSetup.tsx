"use client";

import { useEffect, useState } from "react";

type ModelStatus = { state: string; downloadedBytes?: number; totalBytes?: number; error?: string | null; inference?: { state?: string; busy?: boolean } };
type ModelBridge = { modelStatus(): Promise<ModelStatus>; modelInstall(): Promise<unknown>; modelPause(): Promise<unknown>; modelCancel(): Promise<unknown>; modelUnload(): Promise<unknown> };
const bridge = () => (window as unknown as { plantlensDesktop?: ModelBridge }).plantlensDesktop;

export function LocalModelSetup() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const api = bridge();
    if (!api) return;
    let disposed = false;
    const refresh = () => api.modelStatus().then(value => { if (!disposed) setStatus(value); }).catch(err => { if (!disposed) setError(String(err)); });
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  if (!status) return null;
  const run = async (action: keyof Omit<ModelBridge, "modelStatus">) => {
    setError("");
    try { await bridge()?.[action](); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const active = ["DOWNLOADING", "VERIFYING", "OPTIMIZING"].includes(status.state);
  const progress = Math.min(100, Math.round((status.downloadedBytes ?? 0) / Math.max(1, status.totalBytes ?? 1) * 100));
  return <aside aria-label="Local AI setup" className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><strong>Local AI · {status.state.replaceAll("_", " ")}</strong><p className="text-xs opacity-70">Qwen3 1.7B · CPU only · private on this PC · unsigned development build</p></div>
      <div className="flex gap-3">
        {!active && status.state !== "READY" && <button className="rounded border px-3 py-1" onClick={() => void run("modelInstall")}>{status.state === "PAUSED" ? "Resume download" : "Install local model"}</button>}
        {status.state === "DOWNLOADING" && <button className="rounded border px-3 py-1" onClick={() => void run("modelPause")}>Pause</button>}
        {(active || status.state === "PAUSED" || status.state === "ERROR") && <button className="rounded border px-3 py-1" onClick={() => void run("modelCancel")}>Discard incomplete setup</button>}
        {status.state === "READY" && <button className="rounded border px-3 py-1" onClick={() => void run("modelUnload")}>Free memory / cancel inference</button>}
      </div>
    </div>
    {active && <div className="mt-2"><progress aria-label="Model download progress" max={100} value={progress} className="h-1 w-full"/><p className="text-xs opacity-70">{status.state === "OPTIMIZING" ? "Converting verified official Q8 weights to Q4_K_M locally…" : `${progress}% · ${((status.downloadedBytes ?? 0) / 1e9).toFixed(2)} / ${((status.totalBytes ?? 0) / 1e9).toFixed(2)} GB`}</p></div>}
    {(error || status.error) && <p role="alert" className="mt-2 text-amber-600">{error || status.error} Manual CAD and simulation remain available.</p>}
  </aside>;
}
