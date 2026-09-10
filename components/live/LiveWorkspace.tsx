"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEMO_DEVICE_UUID, DemoReadOnlyTransport, DeviceProfileSchema, LiveConnectionController, type ChannelDescriptor, type DeviceProfile } from "@/lib/live";

export type LiveRole = "Technician" | "Engineer" | "Supervisor" | "Administrator";
export type MappingState = "UNMAPPED" | "PROPOSED" | "APPROVED";

export interface LiveMapping {
  channelId: string;
  assetId: string;
  signal: string;
  canonicalUnit: string;
  scale: number;
  offset: number;
  state: MappingState;
}

export interface LiveAsset {
  id: string;
  name: string;
  classId: string;
  description: string;
}

export interface LiveProposal {
  id: string;
  title: string;
  baseRevision: number;
  description: string;
  assumptions: string[];
  citations: Array<{ label: string; url?: string }>;
  mappings: LiveMapping[];
  assets: LiveAsset[];
  status: "IN_REVIEW" | "APPROVED" | "REJECTED";
  validation: { errors: string[]; warnings: string[] };
}

export interface LiveAudit {
  id: string;
  atMs: number;
  actor: string;
  kind: string;
  subject: string;
  detail: string;
}

const SPECIALISTS = [
  "Device Identification",
  "Official Manual Research",
  "Transport & Protocol",
  "Sensor Onboarding",
  "VFD Register",
  "Asset-Class Curator",
  "Channel Mapping",
  "Digital-Twin Composer",
  "Diagnostic Rule",
  "Evidence & Maintenance",
] as const;

const CORE_CLASSES = [
  ["induction-motor", "Induction motor"],
  ["pump", "Pump"],
  ["fan", "Fan"],
  ["compressor", "Compressor"],
  ["conveyor", "Conveyor"],
  ["spindle", "Spindle"],
  ["tank", "Tank"],
  ["valve", "Valve"],
  ["sensor", "Sensor / instrument"],
  ["generic-machine", "Generic machine"],
] as const;

type LatestValues = Record<string, { value: number | boolean | string; atMs: number; quality: "GOOD" | "STALE" }>;

interface LiveWorkspaceValue {
  role: LiveRole;
  setRole: (role: LiveRole) => void;
  connection: "DISCONNECTED" | "DISCOVERED" | "HANDSHAKING" | "STREAMING" | "ERROR";
  connectionDetail: string;
  profile: DeviceProfile | null;
  classes: typeof CORE_CLASSES;
  specialists: typeof SPECIALISTS;
  currentAgent: number;
  runningAgents: boolean;
  assets: LiveAsset[];
  mappings: LiveMapping[];
  proposal: LiveProposal | null;
  revision: number;
  latest: LatestValues;
  audit: LiveAudit[];
  companionCandidates: Array<{ path: string; manufacturer: string; serialNumber: string | null; vendorId: string | null; productId: string | null; recoveryMode: boolean }>;
  discover: () => Promise<void>;
  discoverCompanion: (url: string, token: string) => Promise<void>;
  connectCompanion: (url: string, token: string, path: string, unoQ?: { address: string; expectedDeviceUuid: string; credential: string }) => Promise<void>;
  connectDemo: () => Promise<void>;
  disconnect: () => Promise<void>;
  runAgents: (description: string) => Promise<void>;
  editProposal: (description: string) => void;
  editProposalMapping: (channelId: string, patch: Partial<Pick<LiveMapping, "assetId" | "signal" | "canonicalUnit" | "scale" | "offset">>) => void;
  approveProposal: () => void;
  rejectProposal: (reason: string) => void;
}

const LiveWorkspaceContext = createContext<LiveWorkspaceValue | null>(null);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeAudit(actor: string, kind: string, subject: string, detail: string): LiveAudit {
  return { id: `AUD-LIVE-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, atMs: Date.now(), actor, kind, subject, detail };
}

function approvedAssets(): LiveAsset[] {
  return [
    { id: "VFD-01", name: "Read-only motor drive", classId: "variable-frequency-drive", description: "VFD telemetry only; control functions are not exposed." },
    { id: "MTR-01", name: "AC induction motor", classId: "induction-motor", description: "Three-phase induction motor monitored through isolated instruments." },
    { id: "SNS-01", name: "Motor sensor bank", classId: "sensor", description: "Three physical inputs; exact models remain required before real activation." },
  ];
}

export function proposedMappings(profile: DeviceProfile): LiveMapping[] {
  const isDemo = profile.deviceUuid === DEMO_DEVICE_UUID;
  const choices: Record<string, Omit<LiveMapping, "channelId" | "state">> = {
    "sensor.vibration_rms": { assetId: "MTR-01", signal: "vibration_rms", canonicalUnit: "mm/s", scale: 1, offset: 0 },
    "sensor.bearing_temperature": { assetId: "MTR-01", signal: "bearing_temperature", canonicalUnit: "°C", scale: 6.25, offset: -25 },
    "sensor.shaft_pulses": isDemo
      ? { assetId: "MTR-01", signal: "shaft_speed", canonicalUnit: "rpm", scale: 60, offset: 0 }
      : { assetId: "", signal: "", canonicalUnit: profile.channels.find((channel) => channel.id === "sensor.shaft_pulses")?.rawUnit ?? "pulses", scale: 1, offset: 0 },
    "vfd.output_frequency": { assetId: "VFD-01", signal: "output_frequency", canonicalUnit: "Hz", scale: 0.01, offset: 0 },
    "vfd.output_current": { assetId: "VFD-01", signal: "output_current", canonicalUnit: "A", scale: 0.1, offset: 0 },
    "vfd.dc_bus_voltage": { assetId: "VFD-01", signal: "dc_bus_voltage", canonicalUnit: "V", scale: 1, offset: 0 },
    "vfd.status_word": { assetId: "VFD-01", signal: "status_word", canonicalUnit: "bitfield", scale: 1, offset: 0 },
  };
  return profile.channels.map((channel) => ({ channelId: channel.id, ...(choices[channel.id] ?? { assetId: "SNS-01", signal: channel.id.replaceAll(".", "_"), canonicalUnit: channel.rawUnit, scale: 1, offset: 0 }), state: "PROPOSED" }));
}

export function LiveWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const controllerRef = useRef<LiveConnectionController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const companionRef = useRef<{ url: string; token: string } | null>(null);
  const [role, setRole] = useState<LiveRole>("Engineer");
  const [connection, setConnection] = useState<LiveWorkspaceValue["connection"]>("DISCONNECTED");
  const [connectionDetail, setConnectionDetail] = useState("No local hardware session. Vercel cannot access USB devices.");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [currentAgent, setCurrentAgent] = useState(-1);
  const [runningAgents, setRunningAgents] = useState(false);
  const [assets, setAssets] = useState<LiveAsset[]>([]);
  const [mappings, setMappings] = useState<LiveMapping[]>([]);
  const [proposal, setProposal] = useState<LiveProposal | null>(null);
  const [revision, setRevision] = useState(1);
  const [latest, setLatest] = useState<LatestValues>({});
  const [audit, setAudit] = useState<LiveAudit[]>([
    makeAudit("system", "SAFETY_BOUNDARY_INITIALIZED", "live-workspace", "Read-only hardware capability. No write, terminal, reset, or firmware tool exists."),
  ]);
  const [companionCandidates, setCompanionCandidates] = useState<LiveWorkspaceValue["companionCandidates"]>([]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamAbortRef.current?.abort();
    void controllerRef.current?.disconnect();
  }, []);

  const appendAudit = useCallback((kind: string, subject: string, detail: string) => {
    setAudit((events) => [makeAudit(role, kind, subject, detail), ...events].slice(0, 500));
  }, [role]);

  const discover = useCallback(async () => {
    const controller = new LiveConnectionController([new DemoReadOnlyTransport({ sampleCycles: 10_000, hostStartMs: Date.now() })], {
      onState: (state, detail) => {
        if (state === "ERROR") setConnection("ERROR");
        if (detail) setConnectionDetail(detail);
      },
    });
    controllerRef.current = controller;
    const candidates = await controller.discover();
    setConnection("DISCOVERED");
    setConnectionDetail(`${candidates.length} safe candidate found. Real COM ports are enumerated only by the local Windows companion.`);
    appendAudit("DEVICE_DISCOVERY", "demo:uno-q-01", "One verified simulator candidate enumerated; no serial ports were probed.");
  }, [appendAudit]);

  const companionFetch = useCallback(async (url: string, token: string, path: string, init?: RequestInit) => {
    const base = url.replace(/\/$/, "");
    const response = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Companion returned HTTP ${response.status}.`);
    return response;
  }, []);

  const discoverCompanion = useCallback(async (url: string, token: string) => {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) throw new Error("Companion URL must be loopback-only.");
    if (!token.trim()) throw new Error("Enter the companion pairing token.");
    const response = await companionFetch(url, token, "/v1/devices");
    const payload = await response.json() as { devices?: LiveWorkspaceValue["companionCandidates"] };
    setCompanionCandidates(payload.devices ?? []);
    setConnection("DISCOVERED");
    setConnectionDetail(`${payload.devices?.length ?? 0} COM candidates enumerated. No port was opened or probed.`);
    appendAudit("COMPANION_DISCOVERY", "windows-loopback", `${payload.devices?.length ?? 0} COM candidates enumerated without probing.`);
  }, [appendAudit, companionFetch]);

  const connectCompanion = useCallback(async (url: string, token: string, path: string, unoQ?: { address: string; expectedDeviceUuid: string; credential: string }) => {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url) || !token.trim()) throw new Error("A paired loopback companion is required.");
    if (!unoQ && !/^COM\d+$/i.test(path)) throw new Error("Select one explicit COM port.");
    const candidate = companionCandidates.find((item) => item.path.toLowerCase() === path.toLowerCase());
    if (!unoQ && (!candidate || candidate.recoveryMode)) throw new Error("The selected port is unavailable or is a recovery/EDL device.");
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setConnection("HANDSHAKING");
    let response: Response;
    try { response = await companionFetch(url, token, unoQ ? "/v1/connect/uno-q" : "/v1/connect/serial", { method: "POST", body: JSON.stringify(unoQ ? { ...unoQ, actor: role } : { path, actor: role }) }); }
    catch (error) { setConnection("ERROR"); setConnectionDetail(error instanceof Error ? error.message : "Handshake failed."); throw error; }
    const payload = await response.json() as { descriptor: {
      deviceUuid: string; boardModel: string; firmwareHash: string; schemaHash: string; protocol: { major: number; minor: number };
      capabilities: string[]; clock: { uncertaintyMs?: number }; channelCount: number; maximumRateHz: number;
      channels: Array<{ id: string; label: string; valueType: string; unit: string; sampleRateHz: number; access: "READ_ONLY"; mappingState: "UNMAPPED" | "MAPPED" }>;
    } };
    const descriptor = payload.descriptor;
    const verified = DeviceProfileSchema.parse({
      deviceUuid: descriptor.deviceUuid,
      boardModel: descriptor.boardModel,
      firmwareHash: descriptor.firmwareHash,
      protocolVersion: descriptor.protocol,
      schemaHash: descriptor.schemaHash,
      capabilities: ["SENSOR_STREAM", "CLOCK_MONOTONIC", "NDJSON_DIAGNOSTIC"],
      clock: { source: "DEVICE_MONOTONIC", resolutionUs: 1_000, uncertaintyUs: (descriptor.clock.uncertaintyMs ?? 5) * 1_000 },
      channelCount: descriptor.channelCount,
      maximumRateHz: descriptor.maximumRateHz,
      channels: descriptor.channels.map((channel) => ({ id: channel.id, label: channel.label, dataType: channel.valueType === "bool" ? "BOOLEAN" : channel.valueType === "text" ? "STRING" : channel.valueType.toUpperCase(), sourceKind: "UNSPECIFIED", rawUnit: channel.unit, samplingRateHz: channel.sampleRateHz, calibrationRevision: 0, access: channel.access, mappingStatus: "UNMAPPED" })),
    });
    companionRef.current = { url, token };
    setProfile(verified);
    setMappings(verified.channels.map((channel) => ({ channelId: channel.id, assetId: "", signal: "", canonicalUnit: channel.rawUnit, scale: 1, offset: 0, state: "UNMAPPED" })));
    setConnection("STREAMING");
    setConnectionDetail(`Verified ${verified.boardModel} on ${unoQ ? "App Lab service" : path}; UUID and schema pinned; writesSupported=false.`);
    appendAudit("DEVICE_VERIFIED", verified.deviceUuid, `Loopback companion verified ${unoQ ? "selected App Lab service" : `explicit port ${path}`}; schema ${verified.schemaHash}.`);

    streamAbortRef.current?.abort();
    const abort = new AbortController();
    streamAbortRef.current = abort;
    let checkingHealth = false;
    timerRef.current = setInterval(() => {
      setLatest(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, Date.now() - value.atMs > 1500 ? { ...value, quality: "STALE" as const } : value])));
      if (checkingHealth || abort.signal.aborted) return;
      checkingHealth = true;
      void companionFetch(url, token, "/v1/status", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]) }).then(response => response.json()).then(status => {
        if (!status.connected && !abort.signal.aborted) { setConnection("ERROR"); setConnectionDetail("Device identity changed or the service disconnected. Select and verify the device again."); abort.abort(); }
      }).catch(() => { if (!abort.signal.aborted) { setConnection("ERROR"); setConnectionDetail("Companion unavailable; readings marked stale."); } }).finally(() => { checkingHealth = false; });
    }, 1000);
    void companionFetch(url, token, "/v1/stream", { signal: abort.signal }).then(async (streamResponse) => {
      const reader = streamResponse.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffered = "";
      while (!abort.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) { if (!abort.signal.aborted) throw new Error("Companion stream ended; readings are stale."); break; }
        buffered += decoder.decode(chunk.value, { stream: true });
        if (buffered.length > 1_048_576) throw new Error("Companion stream frame exceeds the size limit.");
        const frames = buffered.split("\n\n");
        buffered = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const sample = JSON.parse(line.slice(6)) as { receivedTimeMs: number; quality: string; values: Array<{ channelId: string; rawValue: number | boolean | string }> };
          setLatest(Object.fromEntries(sample.values.map((value) => [value.channelId, { value: value.rawValue, atMs: sample.receivedTimeMs, quality: sample.quality === "GOOD" ? "GOOD" as const : "STALE" as const }])));
        }
      }
    }).catch((cause) => { if (!abort.signal.aborted) { setConnection("ERROR"); setConnectionDetail(cause instanceof Error ? cause.message : "Companion stream ended."); } });
  }, [appendAudit, companionCandidates, companionFetch, role]);

  const connectDemo = useCallback(async () => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    if (!controllerRef.current) await discover();
    const controller = controllerRef.current;
    if (!controller) return;
    setConnection("HANDSHAKING");
    setConnectionDetail("Exchanging fixed read-only nonce and validating UUID, protocol, schema, and capabilities…");
    const candidates = await controller.discover();
    const session = await controller.connect(candidates[0]);
    const verified = controller.profile;
    setProfile(verified);
    setMappings((verified?.channels ?? []).map((channel) => ({ channelId: channel.id, assetId: "", signal: "", canonicalUnit: channel.rawUnit, scale: 1, offset: 0, state: "UNMAPPED" })));
    setConnection("STREAMING");
    setConnectionDetail(`Identity pinned to ${session.deviceUuid.slice(0, 8)}…; schema ${session.schemaHash.slice(0, 10)}…; writesSupported=false.`);
    appendAudit("DEVICE_VERIFIED", session.deviceUuid, "Handshake, read-only capability, protocol v1, and schema hash verified.");

    if (timerRef.current) clearInterval(timerRef.current);
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const t = (Date.now() - started) / 1000;
      const raw: Record<string, number> = {
        "sensor.vibration_rms": 2.35 + Math.sin(t * 1.7) * 0.13,
        "sensor.bearing_temperature": 11.9 + t / 900 + Math.sin(t / 8) * 0.05,
        "sensor.shaft_pulses": 30 + (Math.sin(t) > 0.8 ? 1 : 0),
        "vfd.output_frequency": 5000,
        "vfd.output_current": 86 + Math.round(Math.sin(t * 2)),
        "vfd.dc_bus_voltage": 565 + Math.round(Math.sin(t / 2)),
        "vfd.status_word": 3,
      };
      setLatest(Object.fromEntries(Object.entries(raw).map(([channelId, value]) => [channelId, { value: Number(value.toFixed(3)), atMs: Date.now(), quality: "GOOD" as const }])));
    }, 100);
  }, [appendAudit, discover]);

  const disconnect = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    if (companionRef.current) {
      const { url, token } = companionRef.current;
      await companionFetch(url, token, "/v1/disconnect", { method: "POST", body: JSON.stringify({ actor: role }) }).catch(() => undefined);
      companionRef.current = null;
    }
    await controllerRef.current?.disconnect();
    setConnection("DISCONNECTED");
    setConnectionDetail("Session closed and values marked unavailable. Device identity remains pinned for safe reconnection.");
    setLatest({});
    appendAudit("DEVICE_DISCONNECTED", profile?.deviceUuid ?? "none", "Operator ended the observation session.");
  }, [appendAudit, companionFetch, profile, role]);

  const runAgents = useCallback(async (description: string) => {
    if (!profile) throw new Error("Connect and verify a device before asking agents to map it.");
    if (proposal?.status === "IN_REVIEW") throw new Error("Review the current proposal before starting another agent run.");
    if (!description.trim()) throw new Error("Describe the plant and intended assets first.");
    setRunningAgents(true);
    setCurrentAgent(0);
    appendAudit("AGENT_RUN_STARTED", "agent-team", "Bounded ten-specialist workflow started from an operator description.");
    try {
      const graphRequest = fetch("/api/live/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: description, hasVerifiedDevice: true, hasExactHardwareModels: false }),
      });
      for (let index = 0; index < SPECIALISTS.length; index += 1) {
        setCurrentAgent(index);
        await wait(110);
      }
      const graphResponse = await graphRequest;
      if (!graphResponse.ok) throw new Error("The bounded LangGraph workflow did not complete.");
      const graphResult = await graphResponse.json() as { completed: string[]; activationBlocked: boolean; outcomes: Array<{ specialist: string; status: "COMPLETED" | "BLOCKED" | "SKIPPED" | "FAILED" }> };
      if (graphResult.outcomes.length !== SPECIALISTS.length || !graphResult.activationBlocked || !graphResult.outcomes.some(item => item.status === "BLOCKED")) throw new Error("The specialist graph returned an invalid hardware-safety result.");
      const isDemo = profile.deviceUuid === DEMO_DEVICE_UUID;
      const next: LiveProposal = {
      id: `CFG-PROP-${Date.now()}`,
      title: "Create induction-motor monitoring twin",
      baseRevision: revision,
      description,
      assumptions: [
        ...(isDemo ? ["The connected source is the explicitly labelled verified simulator, not physical plant telemetry.", "Demo shaft speed assumes the reported pulse count is a one-second count from a one-pulse-per-revolution sensor."] : []),
        "The real VFD model and three sensor part numbers are still unknown; physical mappings remain blocked.",
        "All device and VFD access is read-only.",
      ],
      citations: [
        { label: "Verified PlantLens device descriptor" },
        { label: "Arduino UNO Q official documentation", url: "https://docs.arduino.cc/hardware/uno-q" },
        { label: "Operator plant description" },
      ],
      mappings: proposedMappings(profile),
      assets: approvedAssets(),
      status: "IN_REVIEW",
      validation: { errors: isDemo ? [] : ["Physical mapping activation is forbidden until exact hardware manuals are attached and verified."], warnings: ["Hardware activation requires the exact VFD and sensor manuals.", "Demonstration register addresses are not transferable to a real VFD."] },
    };
      setProposal(next);
      setCurrentAgent(SPECIALISTS.length);
      appendAudit("PROPOSAL_READY", next.id, "One configuration proposal is awaiting engineer review; no active configuration was changed.");
    } finally {
      setRunningAgents(false);
    }
  }, [appendAudit, profile, proposal, revision]);

  const editProposal = useCallback((description: string) => {
    if (!proposal || proposal.status !== "IN_REVIEW") throw new Error("Only an in-review proposal can be edited.");
    setProposal({ ...proposal, description });
    appendAudit("PROPOSAL_EDITED", proposal?.id ?? "none", "Human edited the draft; validation must remain clean before approval.");
  }, [appendAudit, proposal]);

  const editProposalMapping: LiveWorkspaceValue["editProposalMapping"] = useCallback((channelId, patch) => {
    if (!proposal || proposal.status !== "IN_REVIEW") throw new Error("Only an in-review proposal can be edited.");
    const current = proposal.mappings.find((mapping) => mapping.channelId === channelId);
    if (!current) throw new Error("The proposal does not contain that channel.");
    const next = { ...current, ...patch, channelId: current.channelId, state: "PROPOSED" as const };
    if (!next.assetId.trim() || !next.signal.trim() || !next.canonicalUnit.trim()) throw new Error("Asset, signal, and canonical unit are required.");
    if (!Number.isFinite(next.scale) || next.scale === 0 || !Number.isFinite(next.offset)) throw new Error("Scale must be a finite non-zero number and offset must be finite.");
    setProposal({ ...proposal, mappings: proposal.mappings.map((mapping) => mapping.channelId === channelId ? next : mapping) });
    appendAudit("PROPOSAL_MAPPING_EDITED", proposal.id, `Human edited proposed mapping ${channelId}; active mappings were unchanged.`);
  }, [appendAudit, proposal]);

  const approveProposal = useCallback(() => {
    if (!proposal || proposal.status !== "IN_REVIEW") return;
    if (role !== "Engineer" && role !== "Supervisor" && role !== "Administrator") throw new Error("Engineer approval is required.");
    if (proposal.baseRevision !== revision) throw new Error(`Proposal is based on revision ${proposal.baseRevision}, but revision ${revision} is active. Run the agents again.`);
    if (proposal.validation.errors.length > 0) throw new Error(proposal.validation.errors.join(" "));
    setProposal({ ...proposal, status: "APPROVED" });
    setAssets(proposal.assets);
    setMappings(proposal.mappings.map((mapping) => ({ ...mapping, state: "APPROVED" })));
    setRevision((value) => value + 1);
    appendAudit("CONFIG_VERSION_APPROVED", proposal.id, `Published immutable configuration revision ${revision + 1}.`);
  }, [appendAudit, proposal, revision, role]);

  const rejectProposal = useCallback((reason: string) => {
    if (!proposal || proposal.status !== "IN_REVIEW" || !reason.trim()) return;
    setProposal({ ...proposal, status: "REJECTED" });
    appendAudit("PROPOSAL_REJECTED", proposal.id, reason);
  }, [appendAudit, proposal]);

  const value = useMemo<LiveWorkspaceValue>(() => ({ role, setRole, connection, connectionDetail, profile, classes: CORE_CLASSES, specialists: SPECIALISTS, currentAgent, runningAgents, assets, mappings, proposal, revision, latest, audit, companionCandidates, discover, discoverCompanion, connectCompanion, connectDemo, disconnect, runAgents, editProposal, editProposalMapping, approveProposal, rejectProposal }), [role, connection, connectionDetail, profile, currentAgent, runningAgents, assets, mappings, proposal, revision, latest, audit, companionCandidates, discover, discoverCompanion, connectCompanion, connectDemo, disconnect, runAgents, editProposal, editProposalMapping, approveProposal, rejectProposal]);

  return <LiveWorkspaceContext.Provider value={value}>{children}</LiveWorkspaceContext.Provider>;
}

export function useLiveWorkspace() {
  const value = useContext(LiveWorkspaceContext);
  if (!value) throw new Error("useLiveWorkspace must be used inside LiveWorkspaceProvider");
  return value;
}

export function channelDisplay(channel: ChannelDescriptor, value: LatestValues[string] | undefined) {
  if (!value) return "—";
  return `${typeof value.value === "number" ? value.value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : String(value.value)} ${channel.rawUnit}`;
}
