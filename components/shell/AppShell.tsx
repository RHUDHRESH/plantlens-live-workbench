"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, BookOpen, CircuitBoard, FlaskConical, Gauge, Grid3x3, Layers, Wrench } from "lucide-react";
import { cn } from "@/lib/util";
import { useApp } from "@/store/app";
import { TopBar } from "./TopBar";
import { AskPanel } from "./AskPanel";
import { CommandPalette } from "./CommandPalette";
import { Toasts } from "./Toasts";
import { GuidedStrip } from "./GuidedStrip";

const NAV = [
  { href: "/workbench", label: "Workbench", icon: CircuitBoard, match: ["/workbench"] },
  { href: "/plant", label: "Plant", icon: Layers, match: ["/plant", "/"] },
  { href: "/knowledge/sources", label: "Knowledge", icon: BookOpen, match: ["/knowledge"] },
  { href: "/incidents", label: "Incidents", icon: Activity, match: ["/incidents"] },
  { href: "/recovery", label: "Recovery", icon: Gauge, match: ["/recovery"] },
  { href: "/maintenance", label: "Maintenance", icon: Wrench, match: ["/maintenance"] },
  { href: "/lab", label: "Lab", icon: FlaskConical, match: ["/lab"] },
];

const SUB: Record<string, Array<{ href: string; label: string }>> = {
  "/knowledge": [
    { href: "/knowledge/sources", label: "Sources" },
    { href: "/knowledge/review", label: "Review" },
    { href: "/knowledge/matrix", label: "Matrix" },
  ],
  "/maintenance": [
    { href: "/maintenance", label: "Work orders" },
    { href: "/maintenance/inventory", label: "Inventory" },
    { href: "/costs", label: "Costs" },
  ],
  "/lab": [
    { href: "/lab", label: "Scenarios" },
    { href: "/lab/evaluation", label: "Evaluation" },
    { href: "/data-health", label: "Data health" },
  ],
};

const SECONDARY = [
  { href: "/live", label: "Live hardware" },
  { href: "/explain", label: "How it decides" },
  { href: "/reports", label: "Reports" },
  { href: "/costs", label: "Costs" },
  { href: "/data-health", label: "Data health" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const presentation = useApp((s) => s.guided.presentation);
  const guidedActive = useApp((s) => s.guided.active);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing) return;
      if (e.key === "?" ) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = NAV.find((n) => n.match.some((m) => (m === "/" ? pathname === "/" : pathname.startsWith(m))));
  const subKey = Object.keys(SUB).find((k) => pathname.startsWith(k) || (k === "/maintenance" && pathname.startsWith("/costs")) || (k === "/lab" && pathname.startsWith("/data-health")));

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {!presentation && <TopBar onOpenSearch={() => setPaletteOpen(true)} />}
      <div className="flex min-h-0 flex-1">
        {!presentation && (
          <nav aria-label="Primary" className="no-print hidden w-48 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
            <ul className="flex flex-col gap-0.5 p-2">
              {NAV.map((n) => {
                const isActive = active?.href === n.href;
                const Icon = n.icon;
                return (
                  <li key={n.href}>
                    <Link href={n.href} aria-current={isActive ? "page" : undefined} className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm", isActive ? "bg-accent-soft text-accent" : "text-text hover:bg-surface-2")}>
                      <Icon size={16} aria-hidden />
                      {n.label}
                    </Link>
                    {isActive && subKey && SUB[subKey] ? (
                      <ul className="ml-6 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                        {SUB[subKey].map((s) => (
                          <li key={s.href}>
                            <Link href={s.href} className={cn("block rounded-md px-2 py-1 text-[13px]", pathname === s.href ? "text-accent" : "text-muted hover:text-text")}>
                              {s.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="mt-auto border-t border-border p-2">
              <ul className="flex flex-col gap-0.5">
                {SECONDARY.map((s) => (
                  <li key={s.href}>
                    <Link href={s.href} className={cn("block rounded-md px-2.5 py-1 text-[13px]", pathname === s.href ? "text-accent" : "text-muted hover:text-text")}>
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 px-2.5 text-[11px] leading-snug text-muted">
                Stored in this browser — not cloud-synced. <br />
                Built by VoltMind.
              </p>
            </div>
          </nav>
        )}
        <main id="main" className={cn("min-w-0 flex-1", guidedActive ? "pb-40" : "pb-16 md:pb-6")}>
          <div className="mx-auto max-w-[1600px] px-3 py-4 md:px-5">{children}</div>
        </main>
        <AskPanel />
      </div>
      {!presentation && (
        <nav aria-label="Primary (mobile)" className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface md:hidden">
          {NAV.map((n) => {
            const isActive = active?.href === n.href;
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} aria-current={isActive ? "page" : undefined} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", isActive ? "text-accent" : "text-muted")}>
                <Icon size={18} aria-hidden />
                {n.label}
              </Link>
            );
          })}
          <Link href="/settings" className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", pathname === "/settings" ? "text-accent" : "text-muted")}>
            <Grid3x3 size={18} aria-hidden />
            More
          </Link>
        </nav>
      )}
      <GuidedStrip />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Toasts />
    </div>
  );
}
