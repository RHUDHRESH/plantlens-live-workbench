"use client";

import { X } from "lucide-react";
import { useApp } from "@/store/app";
import { cn } from "@/lib/util";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="no-print pointer-events-none fixed right-3 top-14 z-50 flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn("pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] shadow-md", t.kind === "error" ? "border-red/40 bg-red-soft" : t.kind === "success" ? "border-green/40 bg-green-soft" : "border-border bg-surface")}>
          <span className="flex-1">{t.text}</span>
          <button type="button" aria-label="Dismiss" className="text-muted hover:text-text" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
