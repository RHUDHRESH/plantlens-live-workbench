export type EngineeringDataType = "FLOAT32" | "FLOAT64" | "INT8" | "UINT8" | "INT16" | "UINT16" | "INT32" | "UINT32" | "INT64" | "UINT64" | "BOOLEAN" | "STRING";
export type RegisterFunctionCode = 3 | 4;
export type BindingState = "PROPOSED" | "APPROVED";

export interface RegisterEvidence {
  id: string;
  title: string;
  url: string;
  official: boolean;
}

export interface ModbusRegisterBinding {
  deviceModel: string;
  address: number;
  functionCode: RegisterFunctionCode;
  evidence: RegisterEvidence;
}

export interface EngineeringBinding {
  id: string;
  assetId: string;
  deviceUuid: string;
  schemaHash: string;
  channelId: string;
  signal: string;
  dataType: EngineeringDataType;
  sourceUnit: string;
  canonicalUnit: string;
  scale: number;
  offset: number;
  range: { min: number; max: number };
  cadenceMs: number;
  state: BindingState;
  createdAtMs: number;
  createdBy: string;
  approvedAtMs?: number;
  approvedBy?: string;
  modbus?: ModbusRegisterBinding;
}

export interface EngineeringProposal {
  id: string;
  baseRevision: number;
  status: "IN_REVIEW" | "APPROVED" | "REJECTED" | "BLOCKED";
  binding: EngineeringBinding;
  validation: { errors: string[]; warnings: string[] };
}

/** Independent engineering configuration; CAD documents are never mutated by this workflow. */
export interface EngineeringState {
  schemaVersion: 1;
  revision: number;
  bindings: EngineeringBinding[];
  proposals: EngineeringProposal[];
}

export interface EngineeringStateAdapter {
  engineeringStateLoad?: () => Promise<EngineeringState | null>;
  engineeringStateSave?: (state: EngineeringState, expectedRevision: number) => Promise<EngineeringState>;
}
