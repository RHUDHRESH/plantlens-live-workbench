"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, RotateCcw, Save, Sun } from "lucide-react";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, Field, Kbd, KeyValue, PageHeader, Select, StatusBadge, Switch } from "@/components/ui";
import { IDENTITIES, useApp, type AppState } from "@/store/app";
import { fetchAIStatus, type AIStatus } from "@/lib/ai/adapter";
import { SCHEMA_VERSION } from "@/lib/domain/types";
import { DEFAULT_SCENARIO_ID, SCENARIO_BY_ID } from "@/lib/simulation/scenarios";

const THEMES: Array<{ id: AppState["theme"]; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export default function SettingsPage() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const setReducedMotion = useApp((s) => s.setReducedMotion);
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const storage = useApp((s) => s.storage);
  const workspace = useApp((s) => s.workspace);
  const snapshot = useApp((s) => s.snapshot);
  const activeKnowledgeVersionId = useApp((s) => s.activeKnowledgeVersionId);
  const persistNow = useApp((s) => s.persistNow);
  const resetWorkspace = useApp((s) => s.resetWorkspace);
  const toast = useApp((s) => s.toast);

  const [ai, setAi] = useState<AIStatus | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAIStatus().then((s) => {
      if (!cancelled) setAi(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveNow = async () => {
    setSaving(true);
    try {
      await persistNow();
      const st = useApp.getState().storage;
      if (st.error) toast("error", `Save failed: ${st.error}`);
      else if (!st.available) toast("error", st.reason ?? "Storage is not available in this browser.");
      else if (st.readOnly) toast("error", "This tab is read-only; another tab owns the workspace.");
      else toast("success", "Workspace saved in this browser.");
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      await resetWorkspace();
      toast("success", `Demo workspace reset to ${SCENARIO_BY_ID[DEFAULT_SCENARIO_ID]?.title ?? DEFAULT_SCENARIO_ID}.`);
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  const defaultScenario = SCENARIO_BY_ID[DEFAULT_SCENARIO_ID];

  return (
    <div>
      <PageHeader
        title="Settings & workspace"
        description="Local-first demo settings. No authenticated collaboration or cloud sync is claimed."
        badges={<Badge tone="grey">Demo build</Badge>}
        actions={
          <Button variant="primary" onClick={() => void saveNow()} disabled={saving || !storage.available || storage.readOnly} title={!storage.available ? storage.reason : storage.readOnly ? "This tab is read-only" : undefined}>
            <Save size={14} /> {saving || storage.saving ? "Saving…" : "Save now"}
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader title="Appearance" description="Preferences are stored in this browser's local storage." />
          <CardBody className="space-y-4">
            <fieldset>
              <legend className="mb-1 block text-[12px] font-medium text-muted">Theme</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
                {THEMES.map((t) => {
                  const Icon = t.icon;
                  const active = theme === t.id;
                  return (
                    <Button key={t.id} size="sm" variant={active ? "primary" : "outline"} role="radio" aria-checked={active} onClick={() => setTheme(t.id)}>
                      <Icon size={14} /> {t.label}
                    </Button>
                  );
                })}
              </div>
            </fieldset>
            <Switch id="reduced-motion" checked={reducedMotion} onCheckedChange={setReducedMotion} label="Reduce motion (disables non-essential animation)" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Identity" description="Simulated identities only. Nothing here authenticates a person." />
          <CardBody className="space-y-2">
            <Field label="Acting as (simulated)" hint="Reviews, approvals, and audit events are attributed to this simulated identity.">
              <Select id="identity" value={identity} onChange={(e) => setIdentity(e.target.value as AppState["identity"])} className="w-full">
                {IDENTITIES.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="AI provider" description="Credentials stay server-side; the browser never holds a key." actions={ai ? <Badge tone={ai.configured ? "green" : "grey"}>{ai.configured ? "Configured" : "Not configured"}</Badge> : <Badge tone="grey">checking…</Badge>} />
          <CardBody className="space-y-3">
            <KeyValue
              items={[
                { k: "Mode", v: ai ? <span className="mono">{ai.mode}</span> : "…" },
                { k: "Provider", v: ai?.label ?? "…" },
                { k: "Detail", v: ai?.detail ?? "Querying the server route…" },
              ]}
            />
            <div className="flex flex-col gap-1">
              <span className="pointer-events-none opacity-60" aria-disabled="true">
                <Switch id="connected-ai" checked={ai?.configured ?? false} onCheckedChange={() => undefined} label="Connected AI for knowledge compilation" />
              </span>
              <p className="text-[12px] text-muted">{ai?.configured ? "Enabled by the server deployment; bounded model calls on selected excerpts with citation verification." : "Not configured on this deployment. The local deterministic pipeline (parsers, explicit rules, template matching) remains available without keys."}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Workspace" description="One demo workspace per browser." />
          <CardBody className="space-y-3">
            <KeyValue
              items={[
                { k: "Name", v: workspace.name },
                { k: "Mode", v: <StatusBadge value={workspace.mode} /> },
                { k: "Scenario", v: workspace.scenarioId ? <span className="mono">{workspace.scenarioId} · seed <span className="tnum">{workspace.seed ?? "—"}</span></span> : <span className="text-muted">none (imported replay)</span> },
                { k: "Active knowledge", v: <span className="mono">{activeKnowledgeVersionId}</span> },
                { k: "Engine", v: snapshot ? <span className="tnum">{snapshot.clock.running ? `running ×${snapshot.clock.speed}` : "paused"} · {snapshot.stats.observations} observations</span> : "starting…" },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" size="sm" onClick={() => setConfirmReset(true)} disabled={resetting || storage.readOnly} title={storage.readOnly ? "This tab is read-only" : undefined}>
                <RotateCcw size={14} /> Reset demo workspace
              </Button>
            </div>
            <p className="text-[12px] text-muted">
              Reset returns to scenario {defaultScenario?.number} ({defaultScenario?.title}) with seed <span className="tnum">{defaultScenario?.seed}</span> and re-seeds the fixture records. To start another scenario use the Lab.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Storage" actions={storage.available ? <Badge tone={storage.readOnly ? "amber" : "green"}>{storage.readOnly ? "Read-only tab" : "Writer"}</Badge> : <Badge tone="red">Unavailable</Badge>} />
          <CardBody className="space-y-3">
            <Callout tone="grey" title="Stored in this browser — not cloud-synced; not a backup; not tamper-proof.">
              Records live in this browser&apos;s IndexedDB. Clearing site data removes them. Export an evidence bundle from Reports to keep a copy or move it to another browser.
            </Callout>
            <KeyValue
              items={[
                { k: "IndexedDB", v: storage.available ? "available" : (storage.reason ?? "unavailable") },
                { k: "Writer lock", v: storage.readOnly ? "Another tab owns this workspace; this tab is read-only. Reload to reclaim it." : "This tab is the active writer. One active writer per workspace across tabs." },
                { k: "Last saved", v: storage.lastSavedAt ? new Date(storage.lastSavedAt).toLocaleString() : "not yet saved" },
                { k: "Auto-save", v: "About 0.8 s after each record change and every 30 s of simulated time." },
                ...(storage.error ? [{ k: "Last error", v: <span className="text-red">{storage.error}</span> }] : []),
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Keyboard shortcuts" />
          <CardBody>
            <KeyValue
              items={[
                { k: <span><Kbd>Ctrl</Kbd>/<Kbd>Cmd</Kbd> + <Kbd>K</Kbd></span>, v: "Open the command palette (search assets, tags, records, routes)." },
                { k: <Kbd>?</Kbd>, v: "Open the command palette (when not typing in a field)." },
                { k: <Kbd>Esc</Kbd>, v: "Close dialogs, drawers, and the palette." },
              ]}
            />
            <p className="mt-2 text-[12px] text-muted">Shortcuts are not intercepted while typing in inputs.</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="About" />
          <CardBody className="space-y-1.5 text-[13px]">
            <p>
              <strong>PlantLens</strong> by VoltMind — an engineering workbench for a <strong>fictional</strong> plant (VoltMind Components — Demo Plant). Demo build.
            </p>
            <p className="text-muted">
              All plant data is simulated in this browser or replayed from files you import. SIMULATION is not a factory connection; a repair is an action and recovery is an observed result; missing evidence is unavailable, not healthy. Identities are simulated. Bundle schema version <span className="tnum">{SCHEMA_VERSION}</span>.
            </p>
          </CardBody>
        </Card>
      </div>

      <Dialog open={confirmReset} onOpenChange={(v) => !resetting && setConfirmReset(v)} title="Reset the demo workspace?" description="This replaces all live records in this browser.">
        <div className="space-y-3 text-[13px]">
          <Callout tone="amber" title="What is lost">
            Incidents, alarms, recovery plans and runs, non-fixture work orders, inventory transactions, imported sources, proposals, published knowledge versions after the seed, and the audit trail. Export an evidence bundle first if you want to keep them.
          </Callout>
          <p>
            The workspace restarts on scenario {defaultScenario?.number} ({defaultScenario?.title}) with seed <span className="tnum">{defaultScenario?.seed}</span>.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmReset(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void doReset()} disabled={resetting}>
              <RotateCcw size={14} /> {resetting ? "Resetting…" : "Reset workspace"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
