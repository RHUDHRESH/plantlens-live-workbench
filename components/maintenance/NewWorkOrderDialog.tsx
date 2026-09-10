"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WorkOrder } from "@/lib/domain/types";
import { ASSETS } from "@/lib/domain/plant";
import { IDENTITIES, useApp } from "@/store/app";
import { Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";

/** Creates a live work order through the store; optionally linked to an open incident. */
export function NewWorkOrderDialog({ open, onOpenChange, defaultIncidentId }: { open: boolean; onOpenChange: (v: boolean) => void; defaultIncidentId?: string }) {
  const router = useRouter();
  const snapshot = useApp((s) => s.snapshot);
  const createWorkOrder = useApp((s) => s.createWorkOrder);
  const incidents = (snapshot?.incidents ?? []).filter((i) => !i.fixture && i.status !== "CLOSED");
  const [incidentId, setIncidentId] = useState(defaultIncidentId ?? "");
  const [assetId, setAssetId] = useState(ASSETS[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<WorkOrder["priority"]>("P2");
  const [suspectedMechanism, setSuspectedMechanism] = useState("");
  const [plannedAction, setPlannedAction] = useState("");
  const [assignee, setAssignee] = useState<string>(IDENTITIES[1]);

  const pickIncident = (id: string) => {
    setIncidentId(id);
    const inc = incidents.find((i) => i.id === id);
    if (inc) {
      const asset = inc.sharedCauseAssetId ?? inc.observedAssetIds[0];
      if (asset) setAssetId(asset);
      if (!title) setTitle(`${inc.title} — investigate ${inc.diagnosis?.candidates[0]?.title ?? "deviation"}`);
      if (!suspectedMechanism && inc.diagnosis?.candidates[0]) setSuspectedMechanism(`${inc.diagnosis.candidates[0].title} (${inc.diagnosis.state})`);
      if (!plannedAction && inc.diagnosis?.nextChecks[0]) setPlannedAction(inc.diagnosis.nextChecks[0].title);
    }
  };

  const valid = title.trim() && assetId && suspectedMechanism.trim() && plannedAction.trim();
  const submit = () => {
    if (!valid) return;
    const wo = createWorkOrder(incidentId || undefined, { assetId, title: title.trim(), priority, suspectedMechanism: suspectedMechanism.trim(), plannedAction: plannedAction.trim(), assignee });
    onOpenChange(false);
    router.push(`/maintenance/work-orders/${wo.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New work order" description="A record of intended work. Nothing here actuates machinery; interventions are recorded later against the approved plan.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Incident (optional)" hint="Linking copies the diagnosis evidence references onto the work order.">
          <Select value={incidentId} onChange={(e) => pickIncident(e.target.value)} className="w-full" aria-label="Incident">
            <option value="">No incident</option>
            {incidents.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id} — {i.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Asset">
            <Select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="w-full" aria-label="Asset" required>
              {ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} — {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as WorkOrder["priority"])} className="w-full" aria-label="Priority">
              <option value="P1">P1 — production interrupted</option>
              <option value="P2">P2 — degraded</option>
              <option value="P3">P3 — planned</option>
            </Select>
          </Field>
        </div>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required aria-label="Title" />
        </Field>
        <Field label="Suspected mechanism">
          <Input value={suspectedMechanism} onChange={(e) => setSuspectedMechanism(e.target.value)} required aria-label="Suspected mechanism" placeholder="What is believed to be wrong, and how sure the diagnosis is" />
        </Field>
        <Field label="Planned action">
          <Textarea rows={2} value={plannedAction} onChange={(e) => setPlannedAction(e.target.value)} required aria-label="Planned action" />
        </Field>
        <Field label="Assignee (simulated identity)">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full" aria-label="Assignee">
            {IDENTITIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Create work order
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
