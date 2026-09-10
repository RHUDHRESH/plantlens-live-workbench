"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useLiveWorkspace } from "@/components/live/LiveWorkspace";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Input, Select, StatusBadge } from "@/components/ui";
import { approveEngineeringProposal, loadEngineeringState, previewEngineeringValue, saveEngineeringState, validateEngineeringBinding, validateLiveEngineeringSample, type EngineeringBinding, type EngineeringProposal, type EngineeringState } from "@/lib/engineering";

export function RegisterInspector({ assetId }: { assetId: string }) {
  const live = useLiveWorkspace();
  const [state, setState] = useState<EngineeringState>({ schemaVersion: 1, revision: 0, bindings: [], proposals: [] });
  const [channelId, setChannelId] = useState("");
  const [signal, setSignal] = useState("");
  const [canonicalUnit, setCanonicalUnit] = useState("");
  const [scale, setScale] = useState("1");
  const [offset, setOffset] = useState("0");
  const [minimum, setMinimum] = useState("0");
  const [maximum, setMaximum] = useState("100");
  const [cadenceMs, setCadenceMs] = useState("1000");
  const [deviceModel, setDeviceModel] = useState("");
  const [functionCode, setFunctionCode] = useState<3 | 4>(3);
  const [evidenceId, setEvidenceId] = useState("");
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceOfficial, setEvidenceOfficial] = useState(false);
  const [draft, setDraft] = useState<EngineeringProposal | null>(null);
  const [message, setMessage] = useState("");
  const [nowMs, setNowMs] = useState(0);
  const proposalId = useId().replaceAll(":", "");

  useEffect(() => { void loadEngineeringState().then((loaded) => { setState(loaded); setDraft(loaded.proposals.find((item) => item.status === "IN_REVIEW" && item.binding.assetId === assetId) ?? null); }).catch((error) => setMessage(error instanceof Error ? error.message : "Engineering state could not be loaded.")); const timer = setInterval(() => setNowMs(Date.now()), 500); return () => clearInterval(timer); }, [assetId]);
  const channels = live.profile?.channels ?? [];
  const channel = channels.find((item) => item.id === channelId);

  const proposedBinding = useMemo<EngineeringBinding | null>(() => channel ? {
    id: `ENG-${assetId}-${channel.id}`,
    assetId,
    deviceUuid: live.profile!.deviceUuid,
    schemaHash: live.profile!.schemaHash,
    channelId: channel.id,
    signal: signal.trim(),
    dataType: channel.dataType,
    sourceUnit: channel.rawUnit,
    canonicalUnit: canonicalUnit.trim(),
    scale: Number(scale), offset: Number(offset),
    range: { min: Number(minimum), max: Number(maximum) },
    cadenceMs: Number(cadenceMs),
    state: "PROPOSED",
    createdAtMs: 0,
    createdBy: live.role,
    ...(channel.sourceKind === "MODBUS_RTU" ? { modbus: {
      deviceModel: deviceModel.trim(), address: channel.registerAddress ?? -1, functionCode,
      evidence: { id: evidenceId.trim(), title: evidenceTitle.trim(), url: evidenceUrl.trim(), official: evidenceOfficial },
    } } : {}),
  } : null, [assetId, cadenceMs, canonicalUnit, channel, deviceModel, evidenceId, evidenceOfficial, evidenceTitle, evidenceUrl, functionCode, live.profile, live.role, maximum, minimum, offset, scale, signal]);
  const validationContext = { advertisedChannels: channels, deviceUuid: live.profile?.deviceUuid ?? "", schemaHash: live.profile?.schemaHash ?? "" };
  const validation = proposedBinding ? validateEngineeringBinding(proposedBinding, validationContext) : { errors: [], warnings: [] };
  const sample = channel ? live.latest[channel.id] : undefined;
  const preview = proposedBinding && live.connection === "STREAMING" ? previewEngineeringValue(proposedBinding, sample, nowMs) : null;
  const displayedPreview = draft
    ? previewEngineeringValue(draft.binding, live.latest[draft.binding.channelId], nowMs)
    : preview;

  const propose = async () => {
    if (!proposedBinding) return;
    const nextRevision = state.revision + 1;
    const proposal: EngineeringProposal = { id: `ENG-PROP-${proposalId}-${nowMs}`, baseRevision: nextRevision, status: validation.errors.length ? "BLOCKED" : "IN_REVIEW", binding: { ...proposedBinding, createdAtMs: nowMs }, validation };
    setDraft(proposal);
    if (validation.errors.length) { setMessage("Proposal blocked by validation. No active binding changed."); return; }
    try {
      const candidate = { ...state, revision: nextRevision, proposals: [proposal, ...state.proposals.filter((item) => !(item.status === "IN_REVIEW" && item.binding.assetId === assetId))] };
      const saved = await saveEngineeringState(candidate, state.revision); setState(saved);
      setMessage("Proposal persisted for individual human approval. No active binding changed.");
    } catch (error) { setDraft(null); setMessage(error instanceof Error ? error.message : "Proposal persistence failed."); }
  };
  const approve = async () => {
    if (!draft) return;
    if (!(["Engineer", "Supervisor", "Administrator"] as string[]).includes(live.role)) { setMessage("Development UI role check: Engineer or higher is required. Backend authorization is not certified here."); return; }
    try {
      const draftSample = live.profile?.deviceUuid === draft.binding.deviceUuid && live.profile.schemaHash === draft.binding.schemaHash ? live.latest[draft.binding.channelId] : undefined;
      const liveErrors = live.connection === "STREAMING" ? validateLiveEngineeringSample(draft.binding, draftSample, nowMs) : ["The pinned device must be streaming before approval."];
      if (liveErrors.length) throw new Error(liveErrors.join(" "));
      const next = approveEngineeringProposal(state, draft.id, live.role, nowMs, validationContext);
      const saved = await saveEngineeringState(next, state.revision);
      setState(saved); setDraft(null); setMessage(`Binding approved at engineering revision ${saved.revision}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Approval failed."); }
  };
  const reject = async () => {
    if (!draft) return;
    try {
      const candidate: EngineeringState = { ...state, revision: state.revision + 1, proposals: state.proposals.map((item) => item.id === draft.id ? { ...item, status: "REJECTED" } : item) };
      const saved = await saveEngineeringState(candidate, state.revision); setState(saved); setDraft(null); setMessage("Proposal rejected. Active bindings were unchanged.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Rejection could not be saved."); }
  };

  return <Card>
    <CardHeader title="Register inspector" description="Bind one advertised read-only channel to the selected CAD asset, then verify its live normalization." actions={<Badge>r{state.revision}</Badge>} />
    <CardBody className="space-y-4">
      <Callout tone="neutral">Selected CAD asset: <strong>{assetId}</strong>. This workflow creates a separate engineering binding; it never edits or actuates equipment.</Callout>
      {!live.profile ? <Callout tone="amber" title="Live source unavailable">Connect and verify a device to enumerate its advertised channels. Values and register facts are never fabricated.</Callout> : <>
        <div className="grid gap-3">
          <Field label="Advertised channel"><Select aria-label="Advertised channel" className="w-full" value={channelId} onChange={(event) => { const selected = channels.find((item) => item.id === event.target.value); setChannelId(event.target.value); setSignal(event.target.value.replaceAll(".", "_")); setCanonicalUnit(selected?.rawUnit ?? ""); setScale("1"); setOffset("0"); setCadenceMs(selected ? String(Math.max(50, Math.round(1000 / selected.samplingRateHz))) : "1000"); }}><option value="">Select a channel…</option>{channels.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}</Select></Field>
          <Field label="Signal name"><Input aria-label="Signal name" value={signal} onChange={(event) => setSignal(event.target.value)} /></Field>
          <Field label="Data type"><Input aria-label="Data type" readOnly value={channel?.dataType ?? "—"} /></Field>
          <Field label="Source unit"><Input aria-label="Source unit" readOnly value={channel?.rawUnit ?? "—"} /></Field>
          <Field label="Canonical unit"><Input aria-label="Canonical unit" value={canonicalUnit} onChange={(event) => setCanonicalUnit(event.target.value)} /></Field>
          <Field label="Expected cadence (ms)"><Input aria-label="Expected cadence in milliseconds" type="number" min={50} value={cadenceMs} onChange={(event) => setCadenceMs(event.target.value)} /></Field>
          <Field label="Scale"><Input aria-label="Scale" type="number" step="any" value={scale} onChange={(event) => setScale(event.target.value)} /></Field>
          <Field label="Offset"><Input aria-label="Offset" type="number" step="any" value={offset} onChange={(event) => setOffset(event.target.value)} /></Field>
          <div className="grid gap-2"><Field label="Range min"><Input aria-label="Range minimum" type="number" step="any" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></Field><Field label="Range max"><Input aria-label="Range maximum" type="number" step="any" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></Field></div>
        </div>
        {channel?.sourceKind === "MODBUS_RTU" ? <div className="rounded-md border border-border p-3"><p className="mb-3 text-sm font-semibold">Descriptor-backed Modbus evidence</p><div className="grid gap-3">
          <Field label="Exact device model"><Input aria-label="Exact device model" value={deviceModel} onChange={(event) => setDeviceModel(event.target.value)} placeholder="Manufacturer model number" /></Field>
          <Field label="Advertised address"><Input aria-label="Advertised register address" readOnly value={channel.registerAddress ?? "Not advertised"} /></Field>
          <Field label="Read function"><Select aria-label="Read function" className="w-full" value={functionCode} onChange={(event) => setFunctionCode(Number(event.target.value) as 3 | 4)}><option value={3}>03 · Holding register</option><option value={4}>04 · Input register</option></Select></Field>
          <Field label="Evidence ID"><Input aria-label="Evidence ID" value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)} /></Field>
          <Field label="Official manual title"><Input aria-label="Official manual title" value={evidenceTitle} onChange={(event) => setEvidenceTitle(event.target.value)} /></Field>
          <Field label="Official HTTPS citation"><Input aria-label="Official HTTPS citation" type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} /></Field>
        </div><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={evidenceOfficial} onChange={(event) => setEvidenceOfficial(event.target.checked)} />I verified this citation is an official manufacturer source for the exact model.</label><p className="mt-2 text-xs text-muted">Imported documents are not automatically treated as official manufacturer evidence.</p></div> : null}
        <div className="rounded-md border border-border bg-surface-2 p-3"><div className="flex items-center justify-between"><p className="text-sm font-semibold">{draft ? "Frozen proposal live preview" : "Live preview"}</p><StatusBadge value={displayedPreview?.quality ?? "UNAVAILABLE"} /></div>{displayedPreview ? <div className="mt-2 grid gap-2 text-sm"><p>Raw <strong>{String(displayedPreview.raw)} {draft?.binding.sourceUnit ?? channel?.rawUnit}</strong></p><p>Normalized <strong>{String(displayedPreview.normalized)} {draft?.binding.canonicalUnit ?? canonicalUnit}</strong></p><p className="tnum">{new Date(displayedPreview.atMs).toLocaleTimeString()} · {displayedPreview.ageMs} ms old</p></div> : <p className="mt-2 text-sm text-muted">No current sample. No placeholder value is substituted.</p>}</div>
        {validation.errors.length ? <Callout tone="red" title="Cannot activate"><ul className="list-disc pl-4">{validation.errors.map((item) => <li key={item}>{item}</li>)}</ul></Callout> : validation.warnings.length ? <Callout tone="amber">{validation.warnings.join(" ")}</Callout> : channel ? <Callout tone="green">Deterministic checks pass. Preview the proposal before approving it.</Callout> : null}
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!channel} onClick={() => void propose()}>Preview proposal</Button>{draft ? <><Button disabled={draft.status !== "IN_REVIEW"} onClick={() => void approve()}>Approve this binding</Button><Button variant="outline" disabled={draft.status !== "IN_REVIEW"} onClick={() => void reject()}>Reject proposal</Button></> : null}</div>
        {draft ? <div className="rounded-md border border-border p-3 text-sm"><div className="flex items-center justify-between"><strong>{draft.binding.channelId} → {draft.binding.assetId}.{draft.binding.signal || "(missing signal)"}</strong><StatusBadge value={draft.status} /></div><div className="mt-2 space-y-1 text-xs text-muted"><p>Type {draft.binding.dataType} · {draft.binding.sourceUnit} × {draft.binding.scale} + {draft.binding.offset} → {draft.binding.canonicalUnit}</p><p>Range {draft.binding.range.min}…{draft.binding.range.max} · cadence {draft.binding.cadenceMs} ms</p><p className="break-all">Device {draft.binding.deviceUuid} · schema {draft.binding.schemaHash}</p><p>Based on revision {draft.baseRevision}. Approval is individual and version-checked.</p></div></div> : null}
      </>}
      {message ? <p aria-live="polite" className="text-sm text-muted">{message}</p> : null}
      <p className="text-xs text-muted">Role checks shown here are development workflow guards, not a claim of certified backend authorization.</p>
    </CardBody>
  </Card>;
}
