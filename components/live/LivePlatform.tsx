"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Bot, Cable, Check, ChevronRight, CircleAlert, Network, Play, ShieldCheck, Unplug, Waypoints } from "lucide-react";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Input, PageHeader, Progress, Select, StatusBadge, Table, Td, Textarea, Th } from "@/components/ui";
import { channelDisplay, useLiveWorkspace, type LiveMapping } from "./LiveWorkspace";

export type LiveView = "overview" | "devices" | "assets" | "mappings" | "twin" | "agents" | "audit";

const QUICK = [
  ["/live/devices", "1. Connect", Cable],
  ["/live/assets", "2. Build plant", Network],
  ["/live/mappings", "3. Map channels", Waypoints],
  ["/live/agents", "4. Review agents", Bot],
  ["/live/twin", "5. Open twin", Activity],
] as const;

const LIVE_NAV = [
  ["/live", "Overview"], ["/live/devices", "Devices"], ["/live/assets", "Assets"],
  ["/live/mappings", "Mappings"], ["/live/agents", "Agents"], ["/live/twin", "Twin"], ["/live/audit", "Audit"],
] as const;

function LiveSectionNav({ view }: { view: LiveView }) {
  const live = useLiveWorkspace();
  const currentHref = view === "overview" ? "/live" : `/live/${view}`;
  return <div className="mb-4 flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1.5">
    {LIVE_NAV.map(([href, label]) => <Link key={href} href={href} className={`rounded px-2.5 py-1 text-xs ${currentHref === href ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"}`}>{label}</Link>)}
    <label className="ml-auto flex items-center gap-2 text-xs text-muted">Review role
      <Select aria-label="Live workspace role" value={live.role} onChange={(event) => live.setRole(event.target.value as typeof live.role)} className="h-7 text-xs">
        <option>Technician</option><option>Engineer</option><option>Supervisor</option><option>Administrator</option>
      </Select>
    </label>
  </div>;
}

function SafetyBanner() {
  return <Callout tone="green" title="Observation-only hardware boundary">PlantLens can discover, verify, read, map, explain, and draft. It has no register-write, VFD-control, terminal, reset, interlock, delete-evidence, or firmware-flash capability.</Callout>;
}

function Overview() {
  const live = useLiveWorkspace();
  return <>
    <PageHeader title="PlantLens Live" description="A judge-ready path from verified UNO Q telemetry to an evidence-backed induction-motor digital twin." badges={<><StatusBadge value={live.connection} /><Badge tone="green">READ ONLY</Badge></>} />
    <SafetyBanner />
    <div className="mt-4 grid gap-3 lg:grid-cols-5">
      {QUICK.map(([href, label, Icon], index) => <Link key={href} href={href}><Card className="h-full transition-colors hover:border-accent"><CardBody><div className="flex items-center justify-between"><Icon size={18} className="text-accent" /><span className="tnum text-xs text-muted">0{index + 1}</span></div><p className="mt-5 font-medium">{label}</p><p className="mt-1 text-xs text-muted">{index === 0 ? "Explicit selection + identity handshake" : index === 1 ? "Versioned industrial asset classes" : index === 2 ? "Raw values stay unmapped until approved" : index === 3 ? "Ten specialists, one proposal at a time" : "Operational, health, and evidence state"}</p></CardBody></Card></Link>)}
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <Card><CardHeader title="Connection contract" /><CardBody className="space-y-2 text-sm"><p><strong>Transport:</strong> COM, UNO Q service, secured LAN, or verified simulator</p><p><strong>Handshake:</strong> UUID, nonce, firmware, protocol, boot ID, schema hash</p><p><strong>Failure mode:</strong> fail closed; never guess a device or channel</p></CardBody></Card>
      <Card><CardHeader title="Configuration state" /><CardBody className="space-y-2 text-sm"><p><strong>Revision:</strong> {live.revision}</p><p><strong>Approved assets:</strong> {live.assets.length}</p><p><strong>Approved mappings:</strong> {live.mappings.filter((mapping) => mapping.state === "APPROVED").length}</p></CardBody></Card>
      <Card><CardHeader title="Honest execution modes" /><CardBody className="space-y-2 text-sm"><p><Badge tone="accent">LIVE LOCAL</Badge> Windows companion required</p><p><Badge tone="amber">VERIFIED SIMULATOR</Badge> Available for this hosted demo</p><p><Badge tone="grey">HARDWARE BLOCKED</Badge> Until sensor/VFD models are known</p></CardBody></Card>
    </div>
  </>;
}

function Devices() {
  const live = useLiveWorkspace();
  const [error, setError] = useState("");
  const [companionUrl, setCompanionUrl] = useState("http://127.0.0.1:43117");
  const [pairingToken, setPairingToken] = useState("");
  const [selectedPort, setSelectedPort] = useState("");
  const act = async (fn: () => Promise<void>) => { try { setError(""); await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Device operation failed"); } };
  return <>
    <PageHeader title="Devices" description="Enumerate safely, select explicitly, then prove identity before accepting one sample." badges={<StatusBadge value={live.connection} />} actions={live.connection === "STREAMING" ? <Button variant="outline" onClick={() => act(live.disconnect)}><Unplug size={14} /> Disconnect</Button> : undefined} />
    <SafetyBanner />
    {error ? <Callout tone="red" className="mt-3">{error}</Callout> : null}
    <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
      <Card><CardHeader title="Safe discovery" description="No baud scan and no probe bytes are sent to unrelated COM ports." actions={<Button onClick={() => act(live.discover)}>Discover</Button>} /><CardBody>
        {live.connection === "DISCONNECTED" ? <p className="text-sm text-muted">Start discovery to enumerate the verified demonstration source. The installed companion adds Windows COM candidates.</p> : <div className="rounded-md border border-border bg-surface-2 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Arduino UNO Q — induction motor demonstration</p><p className="font-mono text-xs text-muted">demo://uno-q-01</p></div><Badge tone="amber">SIMULATOR</Badge></div><div className="mt-3 flex gap-2"><Button variant="primary" disabled={live.connection === "STREAMING"} onClick={() => act(live.connectDemo)}><Play size={14} /> Verify & connect</Button></div></div>}
      </CardBody></Card>
      <Card><CardHeader title="Session proof" /><CardBody className="space-y-3 text-sm"><p>{live.connectionDetail}</p>{live.profile ? <><div className="grid grid-cols-2 gap-2 text-xs"><span className="text-muted">Board</span><span>{live.profile.boardModel}</span><span className="text-muted">Channels</span><span>{live.profile.channelCount}</span><span className="text-muted">Protocol</span><span>v{live.profile.protocolVersion.major}.{live.profile.protocolVersion.minor}</span><span className="text-muted">Writes</span><span className="text-green">Forbidden</span></div><p className="break-all font-mono text-[11px] text-muted">UUID {live.profile.deviceUuid}<br />Schema {live.profile.schemaHash}</p></> : null}</CardBody></Card>
    </div>
    <Card className="mt-3"><CardHeader title="Windows companion" description="Runs locally, enumerates COM metadata only, and opens only the port you explicitly select." /><CardBody>
      <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="Loopback URL"><Input aria-label="Companion loopback URL" value={companionUrl} onChange={(event) => setCompanionUrl(event.target.value)} /></Field>
        <Field label="Pairing token"><Input aria-label="Companion pairing token" type="password" autoComplete="off" value={pairingToken} onChange={(event) => setPairingToken(event.target.value)} placeholder="Shown when companion starts" /></Field>
        <Field label="Explicit COM selection"><Select aria-label="Explicit COM selection" value={selectedPort} onChange={(event) => setSelectedPort(event.target.value)}><option value="">Select after discovery</option>{live.companionCandidates.map((candidate) => <option key={candidate.path} value={candidate.path} disabled={candidate.recoveryMode}>{candidate.path} — {candidate.manufacturer}{candidate.recoveryMode ? " (recovery blocked)" : ""}</option>)}</Select></Field>
        <div className="flex gap-2"><Button variant="outline" onClick={() => act(() => live.discoverCompanion(companionUrl, pairingToken))}>List COM ports</Button><Button disabled={!selectedPort} onClick={() => act(() => live.connectCompanion(companionUrl, pairingToken, selectedPort))}>Connect selected</Button></div>
      </div>
      <p className="mt-2 text-xs text-muted">The token stays in this page&apos;s memory. No serial terminal, baud scan, bootloader touch, DTR/RTS toggle, or arbitrary register endpoint exists.</p>
    </CardBody></Card>
    {live.profile ? <Card className="mt-3"><CardHeader title="Discovered raw channels" description="Labels below come from the signed demo descriptor; every channel begins UNMAPPED." /><CardBody><Table><thead><tr><Th>Channel</Th><Th>Source</Th><Th>Raw value</Th><Th>Rate</Th><Th>Access</Th><Th>Mapping</Th></tr></thead><tbody>{live.profile.channels.map((channel) => <tr key={channel.id}><Td><p className="font-medium">{channel.label}</p><code className="text-xs text-muted">{channel.id}</code></Td><Td>{channel.sourceKind}</Td><Td className="tnum">{channelDisplay(channel, live.latest[channel.id])}</Td><Td>{channel.samplingRateHz} Hz</Td><Td><Badge tone="green">READ ONLY</Badge></Td><Td><StatusBadge value={live.mappings.find((mapping) => mapping.channelId === channel.id)?.state ?? "UNMAPPED"} /></Td></tr>)}</tbody></Table></CardBody></Card> : null}
  </>;
}

function Assets() {
  const live = useLiveWorkspace();
  return <>
    <PageHeader title="Asset library" description="Versioned templates provide canonical signals without pretending every plant uses the same registers." badges={<Badge tone="accent">{live.classes.length} CORE CLASSES</Badge>} />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{live.classes.map(([id, name], index) => <Card key={id}><CardBody><div className="flex items-start justify-between"><div className="rounded-md bg-accent-soft p-2 text-accent"><Network size={17} /></div><Badge tone="grey">v1</Badge></div><h2 className="mt-4 font-semibold">{name}</h2><p className="mt-1 text-xs text-muted">{index === 0 ? "Speed, current, vibration, temperature, run state, and nameplate context." : "Required/optional signals, quality policy, cadence, units, and health coverage."}</p><p className="mt-3 font-mono text-[11px] text-muted">{id}@1</p></CardBody></Card>)}</div>
    <Card className="mt-4"><CardHeader title="Current configured plant" description="Assets are created only after a reviewed proposal is approved." /><CardBody>{live.assets.length ? <div className="grid gap-2 md:grid-cols-3">{live.assets.map((asset) => <div key={asset.id} className="rounded-md border border-border p-3"><div className="flex items-center justify-between"><strong>{asset.name}</strong><Badge>{asset.id}</Badge></div><p className="mt-1 text-xs text-muted">{asset.description}</p></div>)}</div> : <p className="text-sm text-muted">No live assets approved yet. Connect a device and describe the plant to the agent team.</p>}</CardBody></Card>
  </>;
}

function MappingTable({ mappings }: { mappings: LiveMapping[] }) {
  const live = useLiveWorkspace();
  return <Table><thead><tr><Th>Raw channel</Th><Th>Target</Th><Th>Transform</Th><Th>Live value</Th><Th>Status</Th></tr></thead><tbody>{mappings.map((mapping) => {
    const channel = live.profile?.channels.find((item) => item.id === mapping.channelId);
    const raw = live.latest[mapping.channelId]?.value;
    const normalized = typeof raw === "number" ? raw * mapping.scale + mapping.offset : raw;
    return <tr key={mapping.channelId}><Td><code>{mapping.channelId}</code><p className="text-xs text-muted">{channel?.rawUnit ?? "unknown"}</p></Td><Td>{mapping.assetId ? <><strong>{mapping.assetId}</strong><p className="text-xs text-muted">{mapping.signal}</p></> : <span className="text-muted">Not assigned</span>}</Td><Td className="font-mono text-xs">y = {mapping.scale}·x + {mapping.offset}</Td><Td className="tnum">{normalized === undefined ? "—" : `${typeof normalized === "number" ? normalized.toFixed(2) : normalized} ${mapping.canonicalUnit}`}</Td><Td><StatusBadge value={mapping.state} /></Td></tr>;
  })}</tbody></Table>;
}

function Mappings() {
  const live = useLiveWorkspace();
  return <>
    <PageHeader title="Mapping studio" description="Raw values remain separate from their proposed engineering meaning. Only positive affine transforms are allowed." badges={<Badge tone="accent">CONFIG r{live.revision}</Badge>} />
    <Callout tone="amber" title="Hardware activation gate">The demo descriptor supports this walkthrough. A real VFD register or sensor mapping cannot become active until its exact model and official manual are attached.</Callout>
    <Card className="mt-4"><CardHeader title="Channel bindings" description="No executable formulas and no silent unit coercion." /><CardBody>{live.mappings.length ? <MappingTable mappings={live.mappings} /> : <p className="text-sm text-muted">Connect a device to see its channel registry.</p>}</CardBody></Card>
  </>;
}

function Agents() {
  const live = useLiveWorkspace();
  const [description, setDescription] = useState("Build a read-only digital twin for our AC induction motor, three isolated sensors, and VFD. Map verified demo channels and clearly block all real hardware assumptions until manuals are attached.");
  const [message, setMessage] = useState("");
  const [rejectReason, setRejectReason] = useState("Missing or incorrect device evidence");
  const run = async () => { try { setMessage(""); await live.runAgents(description); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Agent run failed"); } };
  const approve = () => { try { live.approveProposal(); setMessage("Configuration approved and published as a new immutable revision."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Approval failed"); } };
  return <>
    <PageHeader title="Agent configuration studio" description="Describe the plant. Ten bounded specialists produce one editable proposal; they cannot activate it." badges={<><Badge tone="accent">SUPERVISOR + 10</Badge><Badge tone="green">NO HARDWARE TOOLS</Badge></>} />
    <div className="grid gap-3 lg:grid-cols-[.8fr_1.2fr]">
      <Card><CardHeader title="Describe the change" description="Natural language becomes a typed, reviewable configuration diff." /><CardBody className="space-y-3"><Field label="Plant description"><Textarea aria-label="Plant description" rows={7} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Button variant="primary" disabled={live.runningAgents || !live.profile || live.proposal?.status === "IN_REVIEW"} onClick={run}><Bot size={14} /> Run specialist team</Button>{!live.profile ? <p className="text-xs text-amber">Connect and verify the device first.</p> : null}{message ? <Callout tone={message.includes("approved") ? "green" : "amber"}>{message}</Callout> : null}</CardBody></Card>
      <Card><CardHeader title="Specialist execution" description="The supervisor advances sequentially so proposals cannot race." /><CardBody className="space-y-2">{live.specialists.map((agent, index) => <div key={agent} className="flex items-center gap-3 rounded-md border border-border px-3 py-2"><div className={`flex h-6 w-6 items-center justify-center rounded-full ${index < live.currentAgent || (!live.runningAgents && live.currentAgent === live.specialists.length) ? "bg-green-soft text-green" : index === live.currentAgent && live.runningAgents ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>{index < live.currentAgent || (!live.runningAgents && live.currentAgent === live.specialists.length) ? <Check size={13} /> : index + 1}</div><span className="text-sm">{agent}</span><span className="ml-auto text-xs text-muted">{index < live.currentAgent || (!live.runningAgents && live.currentAgent === live.specialists.length) ? "complete" : index === live.currentAgent && live.runningAgents ? "working" : "waiting"}</span></div>)}{live.runningAgents ? <Progress value={live.currentAgent + 1} max={live.specialists.length} /> : null}</CardBody></Card>
    </div>
    {live.proposal ? <Card className="mt-4"><CardHeader title={live.proposal.title} description={`Proposal ${live.proposal.id} · based on revision ${live.proposal.baseRevision}`} actions={<StatusBadge value={live.proposal.status} />} /><CardBody className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2"><Field label="Editable description"><Textarea aria-label="Editable proposal description" rows={4} value={live.proposal.description} disabled={live.proposal.status !== "IN_REVIEW"} onChange={(event) => live.editProposal(event.target.value)} /></Field><div><p className="mb-1 text-xs font-medium text-muted">Evidence</p><ul className="space-y-1 text-sm">{live.proposal.citations.map((citation) => <li key={citation.label}>{citation.url ? <a className="text-accent underline" href={citation.url} target="_blank" rel="noreferrer">{citation.label}</a> : citation.label}</li>)}</ul></div></div>
      <Callout tone="amber" title="Unverified assumptions">{live.proposal.assumptions.map((assumption) => <p key={assumption}>• {assumption}</p>)}</Callout>
      <MappingTable mappings={live.proposal.mappings} />
      {live.proposal.validation.warnings.map((warning) => <p key={warning} className="flex gap-2 text-xs text-amber"><CircleAlert size={14} />{warning}</p>)}
      {live.proposal.status === "IN_REVIEW" ? <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3"><Button variant="primary" onClick={approve}><ShieldCheck size={14} /> Approve immutable revision</Button><div className="min-w-64 flex-1"><Field label="Rejection reason"><Input aria-label="Rejection reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} /></Field></div><Button variant="outline" onClick={() => live.rejectProposal(rejectReason)}>Reject</Button></div> : null}
    </CardBody></Card> : null}
  </>;
}

function Twin() {
  const live = useLiveWorkspace();
  const approved = live.mappings.filter((mapping) => mapping.state === "APPROVED");
  const fields = useMemo(() => approved.map((mapping) => {
    const raw = live.latest[mapping.channelId];
    const value = typeof raw?.value === "number" ? raw.value * mapping.scale + mapping.offset : raw?.value;
    return { ...mapping, value, quality: raw?.quality ?? "MISSING" };
  }), [approved, live.latest]);
  return <>
    <PageHeader title="AC induction motor digital twin" description="Design, operational, health, maintenance, and evidence views share the same approved configuration revision." badges={<><Badge tone="accent">r{live.revision}</Badge><StatusBadge value={live.connection} /></>} />
    {!live.assets.length ? <Callout tone="amber" title="Twin not activated">Run the agent workflow and approve its proposal. Until then, discovered values remain raw and unmapped.</Callout> : <>
      <div className="grid gap-3 lg:grid-cols-[.8fr_1.2fr]"><Card><CardHeader title="Plant topology" /><CardBody><div className="space-y-2">{live.assets.map((asset, index) => <div key={asset.id} className="relative rounded-md border border-border bg-surface-2 p-3"><div className="flex items-center justify-between"><strong>{asset.name}</strong><Badge>{asset.id}</Badge></div><p className="text-xs text-muted">{asset.classId}</p>{index < live.assets.length - 1 ? <ChevronRight className="absolute -bottom-4 left-1/2 z-10 rotate-90 text-muted" size={16} /> : null}</div>)}</div></CardBody></Card>
      <Card><CardHeader title="Live operational state" description="Normalized only through the approved affine mappings." /><CardBody><div className="grid gap-2 sm:grid-cols-2">{fields.map((field) => <div key={field.channelId} className="rounded-md border border-border p-3"><p className="text-xs text-muted">{field.assetId} · {field.signal}</p><p className="tnum mt-2 text-2xl font-semibold">{field.value === undefined ? "—" : typeof field.value === "number" ? field.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(field.value)} <span className="text-sm font-normal text-muted">{field.canonicalUnit}</span></p><div className="mt-2"><StatusBadge value={field.quality} /></div></div>)}</div></CardBody></Card></div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3"><Card><CardHeader title="Health twin" /><CardBody className="text-sm"><p className="font-medium text-green">All mapped demo channels current</p><p className="mt-1 text-muted">No calibrated physical baseline is claimed.</p></CardBody></Card><Card><CardHeader title="Maintenance twin" /><CardBody className="text-sm"><p>No active physical work order.</p><p className="mt-1 text-muted">Agents may draft; humans approve.</p></CardBody></Card><Card><CardHeader title="Evidence twin" /><CardBody className="text-sm"><p>{approved.length} bindings pinned to schema.</p><p className="mt-1 text-muted">Configuration revision {live.revision} is immutable.</p></CardBody></Card></div>
    </>}
  </>;
}

function Audit() {
  const live = useLiveWorkspace();
  return <><PageHeader title="Live audit ledger" description="Connect, agent, review, and publication events are retained. Production companion storage uses SQLite WAL and a hash chain." badges={<Badge tone="green">APPEND ONLY</Badge>} /><Card><CardBody><Table><thead><tr><Th>Time</Th><Th>Actor</Th><Th>Event</Th><Th>Subject</Th><Th>Detail</Th></tr></thead><tbody>{live.audit.map((event) => <tr key={event.id}><Td className="tnum whitespace-nowrap">{new Date(event.atMs).toLocaleTimeString()}</Td><Td>{event.actor}</Td><Td><StatusBadge value={event.kind} /></Td><Td><code className="text-xs">{event.subject}</code></Td><Td>{event.detail}</Td></tr>)}</tbody></Table></CardBody></Card></>;
}

export function LivePlatform({ view }: { view: LiveView }) {
  const content = view === "devices" ? <Devices />
    : view === "assets" ? <Assets />
      : view === "mappings" ? <Mappings />
        : view === "agents" ? <Agents />
          : view === "twin" ? <Twin />
            : view === "audit" ? <Audit />
              : <Overview />;
  return <><LiveSectionNav view={view} />{content}</>;
}
