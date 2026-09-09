"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { X } from "lucide-react";
import { cn } from "@/lib/util";

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase = "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none select-none";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white border-accent hover:opacity-90",
  secondary: "bg-surface-2 text-text border-border hover:bg-border/60",
  outline: "bg-transparent text-text border-border-strong hover:bg-surface-2",
  ghost: "bg-transparent text-text border-transparent hover:bg-surface-2",
  danger: "bg-red text-white border-red hover:opacity-90",
};
const buttonSizes: Record<ButtonSize, string> = { sm: "h-7 px-2.5 text-[13px]", md: "h-8 px-3 text-sm", lg: "h-10 px-4 text-[15px]" };

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }>(function Button({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props} />;
});

/* ------------------------------------------------------------------ Badge */

export type Tone = "neutral" | "accent" | "amber" | "red" | "green" | "grey";
const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text border-border",
  accent: "bg-accent-soft text-accent border-accent/30",
  amber: "bg-amber-soft text-amber border-amber/30",
  red: "bg-red-soft text-red border-red/30",
  green: "bg-green-soft text-green border-green/30",
  grey: "bg-grey-soft text-grey border-grey/30",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[12px] font-medium leading-none tracking-wide", toneClasses[tone], className)}>
      {children}
    </span>
  );
}

export function toneFor(value: string | undefined): Tone {
  switch (value) {
    case "PASS":
    case "PUBLISHED":
    case "APPROVED":
    case "GOOD":
    case "OK":
    case "NORMAL":
    case "CLOSED":
    case "VERIFIED":
      return "green";
    case "FAIL":
    case "FAULT":
    case "REJECTED":
    case "INVALID":
    case "VERIFICATION_FAILED":
    case "SUSPECTED_CAUSE":
      return "red";
    case "WARNING":
    case "AMBIGUOUS":
    case "SENSOR_CHECK":
    case "NOT_COMPARABLE":
    case "NEEDS_REVIEW":
    case "REVIEW_REQUIRED":
    case "SUSPECT":
    case "STALE":
    case "POTENTIALLY_AFFECTED":
    case "INVALIDATED":
    case "PROPOSED":
    case "DRAFT":
      return "amber";
    case "RUNNING":
    case "INVESTIGATING":
    case "VERIFICATION_IN_PROGRESS":
    case "SUPPORTED":
    case "OPEN":
      return "accent";
    case "INCONCLUSIVE":
    case "UNKNOWN":
    case "MISSING":
    case "UNAVAILABLE":
    case "NOT_INSTRUMENTED":
    case "PENDING":
    case "DEFERRED":
    case "SUPERSEDED":
      return "grey";
    default:
      return "neutral";
  }
}

export function StatusBadge({ value, className }: { value: string | undefined; className?: string }) {
  return (
    <Badge tone={toneFor(value)} className={className}>
      {(value ?? "—").replace(/_/g, " ")}
    </Badge>
  );
}

/* ------------------------------------------------------------------ Card / Section */

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("text-[12px] font-semibold uppercase tracking-wider text-muted", className)}>{children}</h3>;
}

export function PageHeader({ title, description, actions, badges }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; badges?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold leading-tight">{title}</h1>
          {badges}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Form controls */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-text placeholder:text-muted focus:border-accent", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-muted focus:border-accent", className)} {...props} />;
});

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("h-8 rounded-md border border-border bg-surface px-2 text-sm text-text focus:border-accent", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1 block text-[12px] font-medium text-muted", className)} {...props}>
      {children}
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onCheckedChange, label, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: string; id?: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <SwitchPrimitive.Root id={id} checked={checked} onCheckedChange={onCheckedChange} className={cn("relative h-5 w-9 rounded-full border border-border transition-colors", checked ? "bg-accent" : "bg-surface-2")}>
        <SwitchPrimitive.Thumb className={cn("block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ Dialog / Drawer */

export function Dialog({ open, onOpenChange, title, description, children, wide, side }: { open: boolean; onOpenChange: (v: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; wide?: boolean; side?: "right" }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex flex-col border border-border bg-surface shadow-xl focus:outline-none",
            side === "right"
              ? "inset-y-0 right-0 w-full max-w-xl"
              : cn("left-1/2 top-1/2 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg", wide ? "max-w-4xl" : "max-w-lg"),
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">Dialog</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Tabs */

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return <TabsPrimitive.List className={cn("flex flex-wrap gap-1 border-b border-border", className)}>{children}</TabsPrimitive.List>;
}
export function TabsTrigger({ value, children, count }: { value: string; children: React.ReactNode; count?: number }) {
  return (
    <TabsPrimitive.Trigger value={value} className="-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text">
      {children}
      {count !== undefined ? <span className="tnum rounded-sm bg-surface-2 px-1 text-[11px]">{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
}
export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Content value={value} className={cn("pt-3 focus:outline-none", className)}>
      {children}
    </TabsPrimitive.Content>
  );
}

/* ------------------------------------------------------------------ Tooltip */

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={4} className="z-50 max-w-xs rounded-md border border-border bg-surface px-2 py-1.5 text-[12px] text-text shadow-md">
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* ------------------------------------------------------------------ Table */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("scroll-thin overflow-x-auto rounded-md border border-border", className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("border-b border-border bg-surface-2 px-2.5 py-1.5 text-left text-[12px] font-semibold text-muted", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-border px-2.5 py-1.5 align-top", className)}>
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ States */

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border-strong px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-red/40 bg-red-soft px-4 py-4">
      <p className="text-sm font-medium text-red">{title}</p>
      {description ? <p className="mt-1 text-[13px]">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted" role="status" aria-live="polite">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent" />
      {label}
    </div>
  );
}

export function KeyValue({ items, className }: { items: Array<{ k: React.ReactNode; v: React.ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]", className)}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <dt className="text-muted">{it.k}</dt>
          <dd className="min-w-0 break-words">{it.v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function Callout({ tone = "neutral", title, children, className }: { tone?: Tone; title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border px-3 py-2 text-[13px]", toneClasses[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={cn(title ? "mt-0.5" : "", "text-text")}>{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-sm border border-border bg-surface-2 px-1 font-mono text-[11px]">{children}</kbd>;
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="tnum">{label ?? `${value}/${max}`}</span>
    </div>
  );
}
