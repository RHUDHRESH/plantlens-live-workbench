export type CadView = "signal" | "electrical" | "presentation";
export type AssetKind = "sensor" | "conditioner" | "isolation" | "controller" | "drive" | "motor" | "protection" | "ground";
export type SignalType = "analog" | "digital" | "power" | "earth" | "telemetry";
export type Verification = "VERIFIED" | "TEMPLATE" | "UNVERIFIED";

export interface CadTerminal { id: string; assetId: string; name: string; direction: "in" | "out" | "bidirectional"; signalType: SignalType; unit?: string; }
export interface CadAsset { id: string; name: string; kind: AssetKind; description: string; terminalIds: string[]; }
export interface CadPlacement { assetId: string; view: CadView; x: number; y: number; }
export interface CadConnection { id: string; view: Exclude<CadView, "presentation">; sourceTerminalId: string; targetTerminalId: string; signalType: SignalType; unit?: string; evidence?: string; verification: Verification; }
export interface CadProposalChange { id: string; kind: "rename_asset" | "add_asset"; summary: string; assetId?: string; value: string; status: "PENDING" | "APPROVED" | "REJECTED"; }
export interface CadProposal { id: string; request: string; source: "LOCAL_MODEL" | "DETERMINISTIC"; status: "READY" | "BLOCKED" | "COMPLETED"; baseRevision?: number; changes: CadProposalChange[]; message?: string; createdAt: string; }
export interface CadDocument { schemaVersion: 1; id: string; name: string; revision: number; assets: CadAsset[]; terminals: CadTerminal[]; placements: CadPlacement[]; connections: CadConnection[]; proposals: CadProposal[]; }
