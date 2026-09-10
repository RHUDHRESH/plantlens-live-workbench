"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Save, X } from "lucide-react";
import type { KnowledgeVersion, RecoveryCheck, RecoveryPlan } from "@/lib/domain/types";
import { planRequirementTitles } from "@/lib/recovery/compiler";
import { Badge, Button, Callout, Input, Table, Td, Th, Tip } from "@/components/ui";
import { CHECK_KIND_LABEL, EDITABLE_FIELDS, checkParams, checksDiffer, readNumericField, withNumericField } from "./helpers";
import { ReasonDialog } from "./ReasonDialog";

/**
 * Plan checks with an explicit edit mode. Editing never mutates the stored version: saving
 * produces a new DRAFT version and the previous approval is invalidated by the store.
 */
export function ChecksTable({ plan, knowledge, highlightCheckId, canEdit, editLabel, onSave }: { plan: RecoveryPlan; knowledge: KnowledgeVersion; highlightCheckId?: string | null; canEdit: boolean; editLabel: string; onSave: (checks: RecoveryCheck[], reason: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RecoveryCheck[]>(plan.checks);
  const [saveOpen, setSaveOpen] = useState(false);
  const highlightRef = useRef<HTMLTableRowElement>(null);
  const titles = planRequirementTitles(plan, knowledge);

  useEffect(() => {
    if (highlightCheckId) highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightCheckId]);

  const begin = () => {
    setDraft(structuredClone(plan.checks));
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(plan.checks);
  };
  const dirty = editing && checksDiffer(draft, plan.checks);

  const requirementBand = (c: RecoveryCheck) => {
    const req = knowledge.requirements.find((r) => r.id === c.requirementRef);
    return req?.band ? `${req.band.min}–${req.band.max} ${req.band.unit}` : req?.sequence ? `≤ ${req.sequence.maximumElapsedSeconds} s` : undefined;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {plan.checks.length} checks · every check cites the published requirement that justifies it. Tags, assets, and requirement references are fixed by the template; only thresholds, minimum occurrences, and settling can be tuned.
        </p>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel}>
                <X size={14} /> Discard
              </Button>
              <Button variant="primary" size="sm" disabled={!dirty} title={dirty ? undefined : "No changes to save"} onClick={() => setSaveOpen(true)}>
                <Save size={14} /> Save as new version
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={!canEdit} title={canEdit ? undefined : "Superseded versions are read-only; edit the latest version."} onClick={begin}>
              <Pencil size={14} /> {editLabel}
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <Callout tone="amber" title="Editing creates a new version">
          Saving produces <span className="mono">{plan.id} v{plan.version + 1}</span> as a DRAFT and marks v{plan.version} superseded. Any approval on v{plan.version} is invalidated; the new version must be approved before a run can start, and runs against the old version cannot authorise closure.
          There is no delete control: every check is required by the template so that each requirement and affected dependency stays covered. Removing one would leave a row uncovered (see the coverage tab).
        </Callout>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>Check</Th>
            <Th>Kind</Th>
            <Th>Parameters</Th>
            <Th>Requirement</Th>
            <Th>Justification</Th>
          </tr>
        </thead>
        <tbody>
          {(editing ? draft : plan.checks).map((c) => {
            const fields = EDITABLE_FIELDS[c.kind] ?? [];
            const band = requirementBand(c);
            return (
              <tr key={c.id} ref={highlightCheckId === c.id ? highlightRef : undefined} className={highlightCheckId === c.id ? "bg-accent-soft" : undefined} id={`check-${c.id}`}>
                <Td className="mono whitespace-nowrap font-medium">{c.id}</Td>
                <Td className="whitespace-nowrap">
                  <Badge tone="neutral">{CHECK_KIND_LABEL[c.kind]}</Badge>
                </Td>
                <Td className="min-w-64">
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 text-[12px]">
                    {checkParams(c).map((p) => (
                      <div key={p.k} className="contents">
                        <dt className="text-muted">{p.k}</dt>
                        <dd className="mono break-all">{p.v}</dd>
                      </div>
                    ))}
                  </dl>
                  {editing ? (
                    fields.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {fields.map((f) => (
                          <label key={f.key} className="text-[12px]">
                            <span className="block text-muted">{f.label}</span>
                            <Input
                              type="number"
                              step={f.integer ? 1 : "any"}
                              min={f.min}
                              className="h-7 w-28 tnum"
                              value={Number.isFinite(readNumericField(c, f.key)) ? readNumericField(c, f.key) : ""}
                              onChange={(e) => {
                                const v = f.integer ? Math.round(Number(e.target.value)) : Number(e.target.value);
                                setDraft((d) => d.map((x) => (x.id === c.id ? withNumericField(x, f.key, v) : x)));
                              }}
                            />
                          </label>
                        ))}
                        {band ? <span className="self-end pb-1 text-[12px] text-muted">requirement: {band}</span> : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-muted">Not tunable: this check&apos;s parameters are identity, quality policy, or coverage references fixed by the template.</p>
                    )
                  ) : null}
                </Td>
                <Td className="min-w-48">
                  <span className="mono text-[12px]">{c.requirementRef}</span>
                  <span className="block text-[12px] text-muted">{titles[c.id]}</span>
                  {!knowledge.requirements.some((r) => r.id === c.requirementRef) ? (
                    <Tip content={`Not published in ${knowledge.id}; the run will be INCONCLUSIVE for this check.`}>
                      <span>
                        <Badge tone="amber">not published</Badge>
                      </span>
                    </Tip>
                  ) : null}
                </Td>
                <Td className="min-w-64 max-w-md text-[12px]">{plan.checkJustifications[c.id] ?? <span className="text-muted">—</span>}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <ReasonDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title={`Save ${plan.id} as v${plan.version + 1}`}
        description="The new version starts as DRAFT. State what changed and why; the reason is stored on the superseded version and on the audit trail."
        confirmLabel="Save new version"
        onConfirm={(reason) => {
          onSave(draft, reason);
          setEditing(false);
        }}
      />
    </div>
  );
}
