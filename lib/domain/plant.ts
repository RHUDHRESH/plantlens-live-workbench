import type { Asset, CellId, TagDefinition, ZoneId } from "./types";

/**
 * VoltMind Components — Demo Plant (fictional).
 * Eighteen assets across five zones. SPN-01 / SPN-02 are subsystems of their CNCs
 * and are never counted as separate production lines.
 */

export const PLANT_NAME = "VoltMind Components — Demo Plant";
export const PLANT_ID = "DEMO-PLANT";

export const ZONES: Array<{ id: ZoneId; name: string; purpose: string }> = [
  { id: "UTIL", name: "Shared utilities", purpose: "Shared electrical, pneumatic, and thermal dependencies" },
  { id: "CELL-A", name: "Machining cell A", purpose: "Deep incident-to-recovery workflow" },
  { id: "CELL-B", name: "Machining cell B", purpose: "Cross-cell comparison and independent faults" },
  { id: "HANDLING", name: "Handling and extraction", purpose: "Downstream delays, material flow, auxiliary context" },
  { id: "QUALITY", name: "Quality and final operations", purpose: "Sequence completion and acceptance handshakes" },
];

export const CELLS: Array<{ id: CellId; name: string; cncId: string }> = [
  { id: "CELL-A", name: "Machining cell A", cncId: "CNC-01" },
  { id: "CELL-B", name: "Machining cell B", cncId: "CNC-02" },
];

const CNC_PHASES: Asset["phases"] = ["OFF", "STARTING", "IDLE", "LOADING", "CLAMPING", "CUTTING", "UNLOADING", "BLOCKED", "STARVED", "STOPPING", "UNCLASSIFIED"];

export const ASSETS: Asset[] = [
  // Shared utilities
  {
    id: "FDR-01",
    name: "Supply feeder",
    zone: "UTIL",
    kind: "PHYSICAL",
    coverage: "RULE_COVERED",
    coverageReason: "Supply voltage rule and electrical-supply edges are approved; no fault classifier.",
    phases: ["OFF", "IDLE", "UNCLASSIFIED"],
    headlineTags: ["supply_voltage", "supply_frequency"],
    nameplate: { "Nominal voltage": "400 V (fictional)", Frequency: "50 Hz" },
    description: "Incoming feeder for the demonstration plant. Downstream voltage is modelled along approved electrical edges only.",
  },
  {
    id: "COMP-01",
    name: "Compressor",
    zone: "UTIL",
    kind: "PHYSICAL",
    coverage: "CONTEXTUAL_ONLY",
    coverageReason: "Run feedback and load are instrumented; running status alone does not establish adequate air delivery.",
    phases: ["OFF", "STARTING", "IDLE", "UNCLASSIFIED"],
    headlineTags: ["running", "load_pct"],
    description: "Screw compressor feeding the shared header. Availability context only.",
  },
  {
    id: "AIR-HDR-01",
    name: "Compressed-air header",
    zone: "UTIL",
    kind: "PHYSICAL",
    coverage: "RULE_COVERED",
    coverageReason: "Header pressure requirement is approved for AUTO clamping; leak localisation is not modelled.",
    phases: ["UNCLASSIFIED"],
    headlineTags: ["header_pressure", "demand_pct"],
    description: "Shared pneumatic header supplying both machining-cell fixtures.",
  },
  {
    id: "CHLR-01",
    name: "Process chiller",
    zone: "UTIL",
    kind: "PHYSICAL",
    coverage: "CONTEXTUAL_ONLY",
    coverageReason: "Supply temperature instrumented; thermal-supply edge is contextual and has no approved recovery check.",
    phases: ["OFF", "IDLE", "UNCLASSIFIED"],
    headlineTags: ["supply_temp", "running"],
    description: "Process chiller supplying coolant heat rejection for both cells.",
  },
  // Cell A
  {
    id: "CNC-01",
    name: "Machining centre 1",
    zone: "CELL-A",
    kind: "PHYSICAL",
    cellId: "CELL-A",
    coverage: "RECOVERY_COVERED",
    coverageReason: "Sequence model, approved handshake envelope, and recovery templates exist for PART-A / PART-B recipes.",
    phases: CNC_PHASES,
    headlineTags: ["phase", "cycle_count"],
    description: "Primary machining centre. Hosts the spindle subsystem SPN-01 and receives parts from ROB-01.",
  },
  {
    id: "SPN-01",
    name: "Spindle subsystem",
    zone: "CELL-A",
    kind: "SUBSYSTEM",
    parentId: "CNC-01",
    cellId: "CELL-A",
    coverage: "RECOVERY_COVERED",
    coverageReason: "Speed, current, vibration, and temperature bands approved per recipe; bearing fault classifier NOT implemented.",
    phases: ["OFF", "STARTING", "IDLE", "CUTTING", "STOPPING", "UNCLASSIFIED"],
    headlineTags: ["actual_speed", "motor_current"],
    nameplate: { "Max speed": "8000 rpm (nameplate, not a recovery setpoint)" },
    description: "Spindle drive and bearing assembly of CNC-01. Part of CNC-01, not a separate line.",
  },
  {
    id: "PUMP-01",
    name: "Coolant pump A",
    zone: "CELL-A",
    kind: "PHYSICAL",
    cellId: "CELL-A",
    coverage: "RULE_COVERED",
    coverageReason: "Run feedback and measured flow are instrumented; coolant-flow band approved for cutting.",
    phases: ["OFF", "IDLE", "UNCLASSIFIED"],
    headlineTags: ["coolant_flow", "run_feedback"],
    description: "Coolant pump serving CNC-01. Run feedback does not establish delivery; flow is measured separately.",
  },
  {
    id: "ROB-01",
    name: "Loading robot",
    zone: "CELL-A",
    kind: "PHYSICAL",
    cellId: "CELL-A",
    coverage: "SEQUENCE_COVERED",
    coverageReason: "Handshake events are modelled; robot mechanical faults are not diagnosable from available tags.",
    phases: ["OFF", "IDLE", "LOADING", "UNLOADING", "BLOCKED", "UNCLASSIFIED"],
    headlineTags: ["robot_clear", "unload_complete"],
    description: "Six-axis loading robot serving CNC-01 and CONV-01.",
  },
  {
    id: "FIX-01",
    name: "Pneumatic fixture",
    zone: "CELL-A",
    kind: "PHYSICAL",
    cellId: "CELL-A",
    coverage: "SEQUENCE_COVERED",
    coverageReason: "Clamp command/proof timing modelled against header pressure prerequisite.",
    phases: ["IDLE", "CLAMPING", "UNCLASSIFIED"],
    headlineTags: ["clamp_proof", "clamp_delay_s"],
    description: "Pneumatic work-holding fixture inside CNC-01. Clamp proof depends on header pressure.",
  },
  // Cell B
  {
    id: "CNC-02",
    name: "Machining centre 2",
    zone: "CELL-B",
    kind: "PHYSICAL",
    cellId: "CELL-B",
    coverage: "SEQUENCE_COVERED",
    coverageReason: "Phase model and clamp timing modelled; recovery templates approved only for PART-A.",
    phases: CNC_PHASES,
    headlineTags: ["phase", "clamp_delay_s"],
    description: "Second machining centre with an integrated pneumatic clamp. Used for cross-cell comparison.",
  },
  {
    id: "SPN-02",
    name: "Spindle subsystem",
    zone: "CELL-B",
    kind: "SUBSYSTEM",
    parentId: "CNC-02",
    cellId: "CELL-B",
    coverage: "RULE_COVERED",
    coverageReason: "Current and vibration bands approved for PART-A; no thermal channel installed.",
    phases: ["OFF", "STARTING", "IDLE", "CUTTING", "STOPPING", "UNCLASSIFIED"],
    headlineTags: ["actual_speed", "motor_current"],
    description: "Spindle drive of CNC-02. Temperature is NOT instrumented on this spindle.",
  },
  {
    id: "PUMP-02",
    name: "Coolant pump B",
    zone: "CELL-B",
    kind: "PHYSICAL",
    cellId: "CELL-B",
    coverage: "CONTEXTUAL_ONLY",
    coverageReason: "Run feedback only; flow is not instrumented on this pump.",
    phases: ["OFF", "IDLE", "UNCLASSIFIED"],
    headlineTags: ["run_feedback"],
    description: "Local coolant pump for CNC-02. Flow not instrumented.",
  },
  // Handling
  {
    id: "CONV-01",
    name: "Transfer conveyor",
    zone: "HANDLING",
    kind: "PHYSICAL",
    coverage: "CONTEXTUAL_ONLY",
    coverageReason: "Run state and speed instrumented; material-flow context only.",
    phases: ["OFF", "IDLE", "BLOCKED", "STARVED", "UNCLASSIFIED"],
    headlineTags: ["running", "belt_speed"],
    description: "Conveyor moving finished parts from the cells to the transfer buffer.",
  },
  {
    id: "BUF-01",
    name: "Transfer buffer",
    zone: "HANDLING",
    kind: "LOGICAL_STATION",
    coverage: "CONTEXTUAL_ONLY",
    coverageReason: "Occupancy count only.",
    phases: ["IDLE", "BLOCKED", "STARVED", "UNCLASSIFIED"],
    headlineTags: ["occupancy", "capacity"],
    description: "Logical buffer between machining and inspection. Occupancy shows downstream readiness.",
  },
  {
    id: "FAN-01",
    name: "Extraction fan",
    zone: "HANDLING",
    kind: "PHYSICAL",
    coverage: "INSUFFICIENT_DATA",
    coverageReason: "Only a run bit is available; no flow, pressure, or vibration channel.",
    phases: ["OFF", "IDLE", "UNCLASSIFIED"],
    headlineTags: ["running"],
    description: "Mist and chip extraction fan. Auxiliary context only.",
  },
  // Quality
  {
    id: "GAUGE-01",
    name: "Inspection station",
    zone: "QUALITY",
    kind: "LOGICAL_STATION",
    coverage: "INSUFFICIENT_DATA",
    coverageReason: "Dimensional results are recorded, but no approved rule links them to machine evidence.",
    phases: ["IDLE", "UNCLASSIFIED"],
    headlineTags: ["dimension_dev_um", "parts_measured"],
    description: "Post-machining dimensional inspection. Result shifts have no approved explanatory model.",
  },
  {
    id: "ASM-01",
    name: "Assembly station",
    zone: "QUALITY",
    kind: "LOGICAL_STATION",
    coverage: "CONTEXTUAL_ONLY",
    coverageReason: "Accept/complete handshake only.",
    phases: ["IDLE", "BLOCKED", "STARVED", "UNCLASSIFIED"],
    headlineTags: ["downstream_accept", "assembled_count"],
    description: "Assembly station that acknowledges accepted parts from inspection.",
  },
  {
    id: "PACK-01",
    name: "Packaging station",
    zone: "QUALITY",
    kind: "LOGICAL_STATION",
    coverage: "CONTEXTUAL_ONLY",
    coverageReason: "Count only.",
    phases: ["IDLE", "STARVED", "UNCLASSIFIED"],
    headlineTags: ["packed_count"],
    description: "Final packaging station.",
  },
];

export const ASSET_BY_ID: Record<string, Asset> = Object.fromEntries(ASSETS.map((a) => [a.id, a]));

// ---------------------------------------------------------------------------
// Tag registry
// ---------------------------------------------------------------------------

function tag(
  assetId: string,
  name: string,
  valueType: TagDefinition["valueType"],
  description: string,
  opts: { unit?: string; eventLike?: boolean; enumValues?: string[]; aliases?: string[] } = {},
): TagDefinition {
  return {
    id: `${assetId}.${name}`,
    assetId,
    name,
    valueType,
    unit: opts.unit,
    enumValues: opts.enumValues,
    description,
    eventLike: opts.eventLike,
    aliases: opts.aliases ?? [],
  };
}

const PHASE_ENUM = CNC_PHASES as string[];

export const TAGS: TagDefinition[] = [
  // FDR-01
  tag("FDR-01", "supply_voltage", "NUMERIC", "Line-to-line supply voltage at the feeder", { unit: "V", aliases: ["FDR1_U_LL", "Feeder_Voltage"] }),
  tag("FDR-01", "supply_frequency", "NUMERIC", "Supply frequency", { unit: "Hz", aliases: ["FDR1_F"] }),
  tag("FDR-01", "breaker_closed", "BOOLEAN", "Main breaker closed feedback", { aliases: ["FDR1_CB_CLOSED"] }),
  // COMP-01
  tag("COMP-01", "running", "BOOLEAN", "Compressor run feedback", { aliases: ["COMP1_RUN", "Compressor_Run"] }),
  tag("COMP-01", "load_pct", "NUMERIC", "Compressor load", { unit: "%", aliases: ["COMP1_LOAD"] }),
  tag("COMP-01", "discharge_pressure", "NUMERIC", "Compressor discharge pressure", { unit: "bar", aliases: ["COMP1_P_DIS"] }),
  // AIR-HDR-01
  tag("AIR-HDR-01", "header_pressure", "NUMERIC", "Shared header pressure", { unit: "bar", aliases: ["AIR_HDR_P", "HeaderPressure", "PT-101"] }),
  tag("AIR-HDR-01", "demand_pct", "NUMERIC", "Modelled pneumatic demand", { unit: "%", aliases: ["AIR_HDR_DEMAND"] }),
  // CHLR-01
  tag("CHLR-01", "supply_temp", "NUMERIC", "Chilled coolant supply temperature", { unit: "°C", aliases: ["CHLR1_T_SUP"] }),
  tag("CHLR-01", "running", "BOOLEAN", "Chiller run feedback", { aliases: ["CHLR1_RUN"] }),
  // CNC-01
  tag("CNC-01", "phase", "ENUM", "Machine phase from the sequence controller", { enumValues: PHASE_ENUM, aliases: ["CNC1_PHASE", "M1_STATE"] }),
  tag("CNC-01", "mode", "ENUM", "Operating mode", { enumValues: ["AUTO", "MANUAL", "MAINTENANCE", "OFF", "UNKNOWN"], aliases: ["CNC1_MODE"] }),
  tag("CNC-01", "recipe", "TEXT", "Active recipe", { aliases: ["CNC1_RECIPE", "M1_PROGRAM"] }),
  tag("CNC-01", "cycle_id", "TEXT", "Cycle identifier assigned by the sequence controller", { aliases: ["CNC1_CYCLE_ID"] }),
  tag("CNC-01", "cycle_count", "NUMERIC", "Completed cycles since start", { aliases: ["CNC1_CYCLES"] }),
  tag("CNC-01", "part_present", "BOOLEAN", "Part present sensor in fixture", { eventLike: true, aliases: ["CNC1_PART_PRES", "M1_PartPresent"] }),
  tag("CNC-01", "cycle_ready", "BOOLEAN", "Cycle ready (LOAD_COMPLETE -> CYCLE_READY)", { eventLike: true, aliases: ["CNC1_CYC_RDY"] }),
  tag("CNC-01", "cycle_complete", "BOOLEAN", "Cycle complete pulse", { eventLike: true, aliases: ["CNC1_CYC_DONE"] }),
  tag("CNC-01", "cycle_duration_s", "NUMERIC", "Duration of the last completed cycle", { unit: "s", aliases: ["CNC1_CYC_T"] }),
  tag("CNC-01", "supply_voltage", "NUMERIC", "Voltage at the machine cabinet", { unit: "V", aliases: ["CNC1_U"] }),
  tag("CNC-01", "commanded_speed", "NUMERIC", "Spindle speed commanded by the recipe/operator", { unit: "rpm", aliases: ["CNC1_S_CMD"] }),
  // SPN-01
  tag("SPN-01", "actual_speed", "NUMERIC", "Measured spindle speed", { unit: "rpm", aliases: ["SPN1_S_ACT", "Spindle1_Speed"] }),
  tag("SPN-01", "motor_current", "NUMERIC", "Spindle motor current", { unit: "A", aliases: ["SPN1_I", "Spindle1_Current"] }),
  tag("SPN-01", "vibration_rms", "NUMERIC", "Spindle housing vibration RMS", { unit: "mm/s", aliases: ["SPN1_VIB", "VIB-201"] }),
  tag("SPN-01", "bearing_temp", "NUMERIC", "Front bearing temperature", { unit: "°C", aliases: ["SPN1_T_BRG", "TT-201"] }),
  tag("SPN-01", "load_pct", "NUMERIC", "Drive load", { unit: "%", aliases: ["SPN1_LOAD"] }),
  // PUMP-01
  tag("PUMP-01", "run_feedback", "BOOLEAN", "Pump contactor feedback", { aliases: ["CP01_RUN", "CoolantPump_A_Run", "PUMP1_RUN"] }),
  tag("PUMP-01", "coolant_flow", "NUMERIC", "Measured coolant flow to CNC-01", { unit: "L/min", aliases: ["CP01_FLOW", "FT-301", "CoolantPump_A_Flow"] }),
  tag("PUMP-01", "coolant_temp", "NUMERIC", "Coolant return temperature", { unit: "°C", aliases: ["CP01_T"] }),
  // ROB-01
  tag("ROB-01", "robot_clear", "BOOLEAN", "Robot outside machine envelope", { eventLike: true, aliases: ["ROB1_CLEAR", "R1_Clear"] }),
  tag("ROB-01", "unload_complete", "BOOLEAN", "Unload complete acknowledgement", { eventLike: true, aliases: ["ROB1_UNLD_DONE", "R1_UnloadComplete"] }),
  tag("ROB-01", "move_complete", "BOOLEAN", "Robot motion complete (robot controller)", { eventLike: true, aliases: ["ROB1_MOVE_DONE"] }),
  tag("ROB-01", "state", "ENUM", "Robot controller state", { enumValues: ["OFF", "IDLE", "LOADING", "UNLOADING", "BLOCKED", "UNCLASSIFIED"], aliases: ["ROB1_STATE"] }),
  // FIX-01
  tag("FIX-01", "clamp_cmd", "BOOLEAN", "Clamp command from CNC-01", { eventLike: true, aliases: ["FIX1_CLAMP_CMD"] }),
  tag("FIX-01", "clamp_proof", "BOOLEAN", "Clamp proof (pressure switch + position)", { eventLike: true, aliases: ["FIX1_CLAMP_OK", "ClampProof_A"] }),
  tag("FIX-01", "clamp_delay_s", "NUMERIC", "Elapsed time from clamp command to proof", { unit: "s", aliases: ["FIX1_CLAMP_T"] }),
  // CNC-02
  tag("CNC-02", "phase", "ENUM", "Machine phase", { enumValues: PHASE_ENUM, aliases: ["CNC2_PHASE", "M2_STATE"] }),
  tag("CNC-02", "mode", "ENUM", "Operating mode", { enumValues: ["AUTO", "MANUAL", "MAINTENANCE", "OFF", "UNKNOWN"], aliases: ["CNC2_MODE"] }),
  tag("CNC-02", "recipe", "TEXT", "Active recipe", { aliases: ["CNC2_RECIPE"] }),
  tag("CNC-02", "cycle_id", "TEXT", "Cycle identifier", { aliases: ["CNC2_CYCLE_ID"] }),
  tag("CNC-02", "cycle_count", "NUMERIC", "Completed cycles", { aliases: ["CNC2_CYCLES"] }),
  tag("CNC-02", "clamp_proof", "BOOLEAN", "Integrated clamp proof", { eventLike: true, aliases: ["CNC2_CLAMP_OK", "ClampProof_B"] }),
  tag("CNC-02", "clamp_delay_s", "NUMERIC", "Clamp command to proof elapsed", { unit: "s", aliases: ["CNC2_CLAMP_T"] }),
  tag("CNC-02", "cycle_complete", "BOOLEAN", "Cycle complete pulse", { eventLike: true, aliases: ["CNC2_CYC_DONE"] }),
  tag("CNC-02", "supply_voltage", "NUMERIC", "Voltage at the machine cabinet", { unit: "V", aliases: ["CNC2_U"] }),
  tag("CNC-02", "commanded_speed", "NUMERIC", "Commanded spindle speed", { unit: "rpm", aliases: ["CNC2_S_CMD"] }),
  // SPN-02
  tag("SPN-02", "actual_speed", "NUMERIC", "Measured spindle speed", { unit: "rpm", aliases: ["SPN2_S_ACT"] }),
  tag("SPN-02", "motor_current", "NUMERIC", "Spindle motor current", { unit: "A", aliases: ["SPN2_I"] }),
  tag("SPN-02", "vibration_rms", "NUMERIC", "Spindle housing vibration RMS", { unit: "mm/s", aliases: ["SPN2_VIB", "VIB-202"] }),
  // PUMP-02
  tag("PUMP-02", "run_feedback", "BOOLEAN", "Pump contactor feedback", { aliases: ["CP02_RUN", "CoolantPump_B_Run"] }),
  // CONV-01
  tag("CONV-01", "running", "BOOLEAN", "Conveyor running", { aliases: ["CONV1_RUN"] }),
  tag("CONV-01", "belt_speed", "NUMERIC", "Belt speed", { unit: "m/min", aliases: ["CONV1_V"] }),
  // BUF-01
  tag("BUF-01", "occupancy", "NUMERIC", "Parts in buffer", { aliases: ["BUF1_COUNT"] }),
  tag("BUF-01", "capacity", "NUMERIC", "Buffer capacity", { aliases: ["BUF1_CAP"] }),
  // FAN-01
  tag("FAN-01", "running", "BOOLEAN", "Fan run feedback", { aliases: ["FAN1_RUN"] }),
  // GAUGE-01
  tag("GAUGE-01", "dimension_dev_um", "NUMERIC", "Deviation of the measured bore from nominal", { unit: "µm", aliases: ["GAUGE1_DEV"] }),
  tag("GAUGE-01", "parts_measured", "NUMERIC", "Parts measured", { aliases: ["GAUGE1_N"] }),
  tag("GAUGE-01", "result", "ENUM", "Inspection result", { enumValues: ["PASS", "REWORK", "REJECT"], aliases: ["GAUGE1_RESULT"] }),
  // ASM-01
  tag("ASM-01", "downstream_accept", "BOOLEAN", "Downstream accept acknowledgement for a completed cycle", { eventLike: true, aliases: ["ASM1_ACCEPT", "DownstreamAccept"] }),
  tag("ASM-01", "assembled_count", "NUMERIC", "Assembled units", { aliases: ["ASM1_N"] }),
  // PACK-01
  tag("PACK-01", "packed_count", "NUMERIC", "Packed units", { aliases: ["PACK1_N"] }),
];

export const TAG_BY_ID: Record<string, TagDefinition> = Object.fromEntries(TAGS.map((t) => [t.id, t]));

export function tagsForAsset(assetId: string): TagDefinition[] {
  return TAGS.filter((t) => t.assetId === assetId);
}

export function tagId(assetId: string, name: string): string {
  return `${assetId}.${name}`;
}

export function cellOf(assetId: string): CellId | undefined {
  return ASSET_BY_ID[assetId]?.cellId;
}

/** Presentation-only layout, kept separate from the relationship data. */
export const LAYOUT: Record<string, { x: number; y: number }> = {
  "FDR-01": { x: 40, y: 40 },
  "COMP-01": { x: 40, y: 190 },
  "AIR-HDR-01": { x: 40, y: 340 },
  "CHLR-01": { x: 40, y: 490 },
  "CNC-01": { x: 420, y: 60 },
  "SPN-01": { x: 640, y: 60 },
  "FIX-01": { x: 420, y: 200 },
  "PUMP-01": { x: 640, y: 200 },
  "ROB-01": { x: 300, y: 130 },
  "CNC-02": { x: 420, y: 420 },
  "SPN-02": { x: 640, y: 420 },
  "PUMP-02": { x: 640, y: 560 },
  "CONV-01": { x: 920, y: 130 },
  "BUF-01": { x: 920, y: 280 },
  "FAN-01": { x: 920, y: 560 },
  "GAUGE-01": { x: 1200, y: 130 },
  "ASM-01": { x: 1200, y: 280 },
  "PACK-01": { x: 1200, y: 430 },
};

export const ZONE_BOXES: Record<ZoneId, { x: number; y: number; w: number; h: number }> = {
  UTIL: { x: 10, y: 0, w: 230, h: 650 },
  "CELL-A": { x: 270, y: 10, w: 580, h: 330 },
  "CELL-B": { x: 270, y: 380, w: 580, h: 300 },
  HANDLING: { x: 880, y: 10, w: 250, h: 670 },
  QUALITY: { x: 1160, y: 10, w: 250, h: 670 },
};
