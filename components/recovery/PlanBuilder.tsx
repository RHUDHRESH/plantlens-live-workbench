"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FileJson } from "lucide-react";
import type { Incident } from "@/lib/domain/types";
import { templatesFor } from "@/lib/recovery/compiler";
import type { RecoveryTemplate } from "@/lib/fixtures/templates";
import { useApp } from "@/store/app";
import { Badge, Button, Callout, Dialog, EmptyState, Field, Select, Switch } from "@/components/ui";
import { CHECK_KIND_LABEL, buildableIncidents, checkParams } from "./helpers";

/**
 * Build a plan from an approved template for an open, diagnosed incident. The output is
 * constrained JSON compiled against the published knowledge version; no code is generated.
 */
export function PlanBuilder({ open, onOpenChange, preselectIncidentId }: { open: boolean; onOpenChange: (v: boolean) => void; preselectIncidentId?: string | null }) {
  const router = useRouter();
  const snapshot = useApp((s) => s.snapshot);
  const activeKnowledge = useApp((s) => s.activeKnowledge);
  const baselines = useApp((s) => s.baselines);
  const createPlan = useApp((s) => s.createPlan);
  const knowledge = activeKnowledge();
  const incidents = useMemo(() => buildableIncidents(snapshot), [snapshot]);
  const [incidentId, setIncidentId] = useState<string>(() => preselectIncidentId ?? "");
  const [showAll, setShowAll] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const incident: Incident | undefined = incidents.find((i) => i.id === incidentId) ?? (incidentId ? undefined : incidents[0]);
  const effectiveIncidentId = incident?.id ?? "";
  const top = incident?.diagnosis?.candidates[0];
  const cell = incident?.affectedCellIds[0];
  const templates: RecoveryTemplate[] = useMemo(() => (showAll || !incident ? templatesFor(undefined) : templatesFor(top?.family, cell)), [showAll, incident, top?.family, cell]);
  const selected = templates.find((t) => t.id === templateId) ?? templates[0];

  const reqTitle = (id: string) => knowledge.requirements.find((r) => r.id === id);
  const baselineFor = (t: RecoveryTemplate) => baselines.find((b) => b.recipe === t.recipe && b.cellId === (t.cellId === "CELL-B" ? "CELL-B" : "CELL-A"));

  const create = () => {
    if (!incident || !selected) return;
    setBusy(true);
    try {
      const plan = createPlan(incident.id, selected.id);
      if (plan) {
        onOpenChange(false);
        router.push(`/recovery/${plan.id}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Build recovery plan" description="Choose an open incident and an approved template. Thresholds come from published requirements and the approved baseline." wide>
      <div className="space-y-4">
        <Callout tone="neutral" title={<span className="inline-flex items-center gap-1.5"><FileJson size={14} /> Plans are data, not code</span>}>
          A plan is constrained JSON compiled from an approved template plus the requirements published in <span className="mono">{knowledge.id}</span>. The interpreter evaluates it against observations; nothing in a plan is executed as
          code, and no threshold is invented at build time.
        </Callout>

        {incidents.length === 0 ? (
          <EmptyState title="No open, diagnosed incident" description="Plans are built for live incidents that have a diagnosis. Historical fixtures and resolved incidents are not eligible." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Incident" hint={incident ? `${incident.diagnosis?.state ?? "—"} · top candidate ${top?.title ?? "none"} · cell ${cell ?? "—"}` : undefined}>
              <Select value={effectiveIncidentId} onChange={(e) => { setIncidentId(e.target.value); setTemplateId(""); }} className="w-full" aria-label="Incident">
                {incidents.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} — {i.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Template" hint={showAll ? "Showing every approved template regardless of fault family." : `Filtered to templates for ${top?.family ?? "any family"} in ${cell ?? "any cell"}.`}>
              <Select value={selected?.id ?? ""} onChange={(e) => setTemplateId(e.target.value)} className="w-full" aria-label="Template">
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} — {t.title}
                  </option>
                ))}
              </Select>
              <div className="mt-2">
                <Switch checked={showAll} onCheckedChange={setShowAll} label="Show all templates" />
              </div>
            </Field>
          </div>
        )}

        {selected ? (
          <div className="rounded-md border border-border">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium">{selected.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                <span className="mono">{selected.id}</span>
                {selected.faultFamilies.map((f) => (
                  <Badge key={f} tone="accent">
                    {f.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-muted">
                Scope: {selected.cellId} · recipe {selected.recipe} · AUTO · {selected.requiredCompleteCycles} complete cycles required · baseline{" "}
                {baselineFor(selected) ? <span className="mono">{baselineFor(selected)!.id}</span> : <Badge tone="amber">no approved baseline — plan cannot be created</Badge>}
              </p>
              <p className="mt-1 text-[12px] text-muted">Required evidence: <span className="mono">{selected.requiredEvidence.join(", ")}</span></p>
              <p className="mt-1 text-[12px] text-muted">Validity limits: {selected.validityLimits.join("; ")}</p>
            </div>
            <ul className="divide-y divide-border">
              {selected.checks.map((c) => {
                const req = reqTitle(c.requirementRef);
                return (
                  <li key={c.id} className="px-3 py-2 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono font-medium">{c.id}</span>
                      <Badge tone="neutral">{CHECK_KIND_LABEL[c.kind]}</Badge>
                      <span className="text-[12px] text-muted">
                        ref <span className="mono">{c.requirementRef}</span> — {req ? req.title : <Badge tone="amber">not published in {knowledge.id}</Badge>}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted">{checkParams(c).map((p) => `${p.k}: ${p.v}`).join(" · ")}</p>
                    <p className="mt-0.5">{selected.justifications[c.id]}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!incident || !selected || busy || !baselineFor(selected)} title={!incident ? "Select an open incident" : !selected ? "Select a template" : !baselineFor(selected) ? "No approved baseline for this recipe and cell" : undefined}>
            Create plan
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
