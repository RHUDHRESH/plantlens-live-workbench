import type { CadAsset, CadConnection, CadDocument, CadProposal, CadTerminal, CadView } from "./types";

const terminals: CadTerminal[] = [
  { id: "T-PT101-OUT", assetId: "PT-101", name: "4–20 mA OUT", direction: "out", signalType: "analog", unit: "bar" },
  { id: "T-ISO101-IN", assetId: "ISO-101", name: "AI IN", direction: "in", signalType: "analog", unit: "bar" },
  { id: "T-ISO101-OUT", assetId: "ISO-101", name: "AI OUT", direction: "out", signalType: "analog", unit: "bar" },
  { id: "T-UNO-A0", assetId: "UNO-Q-01", name: "A0", direction: "in", signalType: "analog", unit: "bar" },
  { id: "T-VFD-TX", assetId: "VFD-101", name: "Telemetry", direction: "out", signalType: "telemetry", unit: "Hz" },
  { id: "T-UNO-RX", assetId: "UNO-Q-01", name: "Read-only RX", direction: "in", signalType: "telemetry", unit: "Hz" },
  { id: "T-QF1-OUT", assetId: "QF-101", name: "T1/T2/T3", direction: "out", signalType: "power" },
  { id: "T-VFD-LINE", assetId: "VFD-101", name: "LINE (template)", direction: "in", signalType: "power" },
  { id: "T-VFD-MOTOR", assetId: "VFD-101", name: "MOTOR (template)", direction: "out", signalType: "power" },
  { id: "T-MOTOR-IN", assetId: "M-101", name: "Supply (template)", direction: "in", signalType: "power" },
  { id: "T-MOTOR-PE", assetId: "M-101", name: "PE", direction: "bidirectional", signalType: "earth" },
  { id: "T-PE1", assetId: "PE-101", name: "Protective earth", direction: "bidirectional", signalType: "earth" },
];
const assets: CadAsset[] = [
  { id: "PT-101", name: "Discharge pressure", kind: "sensor", description: "Pressure transmitter", terminalIds: ["T-PT101-OUT"] },
  { id: "ISO-101", name: "Signal isolator", kind: "isolation", description: "Galvanic isolation interface", terminalIds: ["T-ISO101-IN", "T-ISO101-OUT"] },
  { id: "UNO-Q-01", name: "UNO Q edge controller", kind: "controller", description: "Acquisition and gateway controller", terminalIds: ["T-UNO-A0", "T-UNO-RX"] },
  { id: "VFD-101", name: "Variable frequency drive", kind: "drive", description: "Drive telemetry is read-only", terminalIds: ["T-VFD-TX", "T-VFD-LINE", "T-VFD-MOTOR"] },
  { id: "M-101", name: "Process motor", kind: "motor", description: "Three-phase induction motor assembly", terminalIds: ["T-MOTOR-IN", "T-MOTOR-PE"] },
  { id: "QF-101", name: "Protective device", kind: "protection", description: "Rating requires manufacturer evidence", terminalIds: ["T-QF1-OUT"] },
  { id: "PE-101", name: "Protective earth bar", kind: "ground", description: "Grounding reference", terminalIds: ["T-PE1"] },
];
const place = (view: CadView, ids: string[]): CadDocument["placements"] => ids.map((assetId, i) => ({ assetId, view, x: 70 + (i % 3) * 260, y: 90 + Math.floor(i / 3) * 190 }));

export function createCadDocument(): CadDocument {
  return { schemaVersion: 1, id: "PL-CAD-001", name: "Motor cell engineering model", revision: 1, assets, terminals,
    placements: [...place("signal", ["PT-101", "ISO-101", "UNO-Q-01", "VFD-101"]), ...place("electrical", ["QF-101", "VFD-101", "M-101", "PE-101"]), ...place("presentation", ["PT-101", "VFD-101", "M-101", "UNO-Q-01"])],
    connections: [
      { id: "C-SIG-01", view: "signal", sourceTerminalId: "T-PT101-OUT", targetTerminalId: "T-ISO101-IN", signalType: "analog", unit: "bar", evidence: "Illustrative signal path; no manufacturer evidence attached", verification: "UNVERIFIED" },
      { id: "C-SIG-02", view: "signal", sourceTerminalId: "T-ISO101-OUT", targetTerminalId: "T-UNO-A0", signalType: "analog", unit: "bar", evidence: "Illustrative signal path; binding is not approved", verification: "UNVERIFIED" },
      { id: "C-TEL-01", view: "signal", sourceTerminalId: "T-VFD-TX", targetTerminalId: "T-UNO-RX", signalType: "telemetry", unit: "Hz", evidence: "Read-only interface; register map not verified", verification: "UNVERIFIED" },
      { id: "C-PWR-01", view: "electrical", sourceTerminalId: "T-QF1-OUT", targetTerminalId: "T-VFD-LINE", signalType: "power", verification: "TEMPLATE" },
      { id: "C-PWR-02", view: "electrical", sourceTerminalId: "T-VFD-MOTOR", targetTerminalId: "T-MOTOR-IN", signalType: "power", verification: "TEMPLATE" },
      { id: "C-PE-01", view: "electrical", sourceTerminalId: "T-MOTOR-PE", targetTerminalId: "T-PE1", signalType: "earth", verification: "TEMPLATE" },
    ], proposals: [] };
}

export function validateConnection(document: CadDocument, candidate: Omit<CadConnection, "id" | "verification">): string[] {
  const source = document.terminals.find(t => t.id === candidate.sourceTerminalId);
  const target = document.terminals.find(t => t.id === candidate.targetTerminalId);
  const errors: string[] = [];
  if (!source || !target) return ["Both terminal references must exist."];
  if (source.id === target.id || source.assetId === target.assetId) errors.push("Connection endpoints must belong to different assets.");
  if (source.direction === "in") errors.push(`${source.name} is input-only.`);
  if (target.direction === "out") errors.push(`${target.name} is output-only.`);
  if (source.signalType !== target.signalType || candidate.signalType !== source.signalType) errors.push("Signal types are incompatible.");
  if (source.unit && target.unit && source.unit !== target.unit) errors.push("Terminal units are incompatible.");
  if (candidate.view === "electrical" && !["power", "earth"].includes(candidate.signalType)) errors.push("Electrical view accepts power and protective-earth connections only.");
  return errors;
}

export function deterministicDraft(request: string, document: CadDocument): CadProposal {
  const text = request.trim(); const id = `PROP-${Date.now()}`; const createdAt = new Date().toISOString();
  const rename = text.match(/^rename\s+([\w-]+)\s+to\s+(.+)$/i);
  if (rename) {
    const asset = document.assets.find(a => a.id.toLowerCase() === rename[1].toLowerCase());
    if (!asset) return { id, request: text, source: "DETERMINISTIC", status: "BLOCKED", changes: [], message: `Asset ${rename[1]} does not exist.`, createdAt };
    return { id, request: text, source: "DETERMINISTIC", status: "READY", baseRevision: document.revision, changes: [{ id: `${id}-1`, kind: "rename_asset", assetId: asset.id, value: rename[2].trim(), summary: `Rename ${asset.id} from “${asset.name}” to “${rename[2].trim()}”`, status: "PENDING" }], createdAt };
  }
  const add = text.match(/^add\s+(sensor|motor|drive|controller)\s+([\w-]+)(?:\s+named\s+(.+))?$/i);
  if (add && !document.assets.some(a => a.id.toLowerCase() === add[2].toLowerCase())) return { id, request: text, source: "DETERMINISTIC", status: "READY", baseRevision: document.revision, changes: [{ id: `${id}-1`, kind: "add_asset", value: JSON.stringify({ id: add[2].toUpperCase(), kind: add[1].toLowerCase(), name: add[3]?.trim() || add[2].toUpperCase() }), summary: `Add ${add[1].toLowerCase()} ${add[2].toUpperCase()} without inferred terminals`, status: "PENDING" }], createdAt };
  return { id, request: text, source: "DETERMINISTIC", status: "BLOCKED", changes: [], message: "Local AI is unavailable. Supported offline intents: “rename ASSET-ID to NAME” and “add sensor|motor|drive|controller ID named NAME”.", createdAt };
}

export function approveProposalChange(document: CadDocument, proposalId: string, changeId: string): CadDocument {
  const proposal = document.proposals.find(p => p.id === proposalId); const change = proposal?.changes.find(c => c.id === changeId);
  if (!proposal || !change || change.status !== "PENDING") return document;
  const block = (message: string): CadDocument => ({ ...document, proposals: document.proposals.map(p => p.id === proposalId ? { ...p, status: "BLOCKED", message } : p) });
  if (proposal.baseRevision === undefined || proposal.baseRevision !== document.revision) return block("Proposal is stale or lacks a base revision; draft it again against the current workspace.");
  let assets = document.assets;
  if (change.kind === "rename_asset") { if (!change.assetId || !document.assets.some(a => a.id === change.assetId) || !change.value.trim() || change.value.length > 120) return block("Rename change contains an invalid asset reference or name."); assets = assets.map(a => a.id === change.assetId ? { ...a, name: change.value.trim() } : a); }
  if (change.kind === "add_asset") { let x: { id: string; kind: CadAsset["kind"]; name: string }; try { x = JSON.parse(change.value) as typeof x; } catch { return block("Add-asset change is not valid structured data."); } const kinds: CadAsset["kind"][] = ["sensor", "motor", "drive", "controller"]; if (!x || typeof x !== "object" || Array.isArray(x) || Object.keys(x).some(key => !["id", "kind", "name"].includes(key)) || typeof x.name !== "string" || !/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(x.id) || !kinds.includes(x.kind) || !x.name?.trim() || x.name.length > 120 || assets.some(a => a.id === x.id)) return block("Add-asset change contains an invalid or duplicate ID, kind, or name."); assets = [...assets, { ...x, name: x.name.trim(), description: "Unconfigured asset", terminalIds: [] }]; }
  const nextRevision = document.revision + 1;
  const proposals = document.proposals.map(p => p.id !== proposalId ? p : ({ ...p, baseRevision: nextRevision, status: p.changes.every(c => c.id === changeId || c.status !== "PENDING") ? "COMPLETED" : p.status, changes: p.changes.map(c => c.id === changeId ? { ...c, status: "APPROVED" as const } : c) }));
  return { ...document, revision: nextRevision, assets, proposals };
}

export function rejectProposalChange(document: CadDocument, proposalId: string, changeId: string): CadDocument {
  const proposal = document.proposals.find(p => p.id === proposalId); const change = proposal?.changes.find(c => c.id === changeId);
  if (!proposal || !change || change.status !== "PENDING") return document;
  if (proposal.baseRevision === undefined || proposal.baseRevision !== document.revision) return { ...document, proposals: document.proposals.map(p => p.id === proposalId ? { ...p, status: "BLOCKED", message: "Proposal is stale or lacks a base revision; draft it again." } : p) };
  const nextRevision = document.revision + 1;
  return { ...document, revision: nextRevision, proposals: document.proposals.map(p => p.id !== proposalId ? p : ({ ...p, baseRevision: nextRevision, status: p.changes.every(c => c.id === changeId || c.status !== "PENDING") ? "COMPLETED" : p.status, changes: p.changes.map(c => c.id === changeId ? { ...c, status: "REJECTED" as const } : c) })) };
}
