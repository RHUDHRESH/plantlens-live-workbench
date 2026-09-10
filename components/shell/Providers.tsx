"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "@/store/app";
import { AppShell } from "./AppShell";
import { LiveWorkspaceProvider } from "@/components/live/LiveWorkspace";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bootstrap = useApp((s) => s.bootstrap);
  const setHidden = useApp((s) => s.setHidden);
  const theme = useApp((s) => s.theme);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const presentation = useApp((s) => s.guided.presentation);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // Strict Mode double-invoke guard
    started.current = true;
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [setHidden]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-reduced-motion", reducedMotion ? "1" : "0");
  }, [reducedMotion]);

  useEffect(() => {
    document.documentElement.setAttribute("data-presentation", presentation ? "1" : "0");
  }, [presentation]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const st = useApp.getState();
      if (st.storage.saving || st.pendingImports.length) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return <LiveWorkspaceProvider>{pathname === "/workbench" ? <div className="flex h-dvh flex-col overflow-hidden">{children}</div> : <AppShell>{children}</AppShell>}</LiveWorkspaceProvider>;
}
