/**
 * Scenario catalog visible in the Lab. Story text is presenter material; the fault
 * schedule lives in truth.ts and is never part of the diagnosis input.
 */

export const DEMO_START_MS = Date.UTC(2026, 7, 31, 20, 30, 0); // 2026-09-01T02:00:00+05:30

export type InterventionId =
  | "REPAIR_AIR_LEAK"
  | "CLEAR_ALARMS_ONLY"
  | "REPLACE_FIXTURE_SENSOR"
  | "REPLACE_COOLANT_FILTER"
  | "REPAIR_ACK_PATH"
  | "REPLACE_PROXIMITY_SENSOR"
  | "RESTORE_FEEDER"
  | "REMOVE_SPN1_RESISTANCE"
  | "REMOVE_SPN2_RESISTANCE"
  | "RESTORE_COOLING"
  | "RESTORE_FLOW_SENSOR"
  | "REPLACE_TEMP_SENSOR"
  | "SET_SPEED"
  | "RESTORE_RECIPE_SPEED"
  | "SET_RECIPE"
  | "SYNC_ROBOT_CLOCK";

export interface InterventionDef {
  id: InterventionId;
  title: string;
  description: string;
  /** What this intervention physically changes in the simulation (honest label). */
  effect: string;
  assetId: string;
  needsParam?: "rpm" | "recipe";
  /** Approx labor minutes and parts used when recorded through a work order. */
  laborMinutes: number;
  partIds: string[];
}

export const INTERVENTIONS: InterventionDef[] = [
  { id: "REPAIR_AIR_LEAK", title: "Repair header leak", description: "Tighten/replace the leaking header coupling.", effect: "Removes the simulated header leak.", assetId: "AIR-HDR-01", laborMinutes: 45, partIds: ["PRT-COUPLING-12"] },
  { id: "CLEAR_ALARMS_ONLY", title: "Acknowledge and clear alarms", description: "Reset the alarm list without physical work.", effect: "No physical change. Alarms re-raise if conditions persist.", assetId: "CNC-01", laborMinutes: 2, partIds: [] },
  { id: "REPLACE_FIXTURE_SENSOR", title: "Replace fixture clamp-proof sensor", description: "Replace the FIX-01 clamp-proof pressure switch.", effect: "No effect on a header leak. Only changes the sensor.", assetId: "FIX-01", laborMinutes: 35, partIds: ["PRT-PSW-05"] },
  { id: "REPLACE_COOLANT_FILTER", title: "Replace coolant filter", description: "Replace the PUMP-01 suction filter element.", effect: "Removes the simulated coolant restriction.", assetId: "PUMP-01", laborMinutes: 30, partIds: ["PRT-FILTER-CF20"] },
  { id: "REPAIR_ACK_PATH", title: "Repair unload-complete acknowledgement path", description: "Re-terminate the ROB-01 to CNC-01 acknowledgement signal.", effect: "Removes the simulated acknowledgement delay.", assetId: "ROB-01", laborMinutes: 40, partIds: [] },
  { id: "REPLACE_PROXIMITY_SENSOR", title: "Replace robot proximity sensor", description: "Replace the ROB-01 part-present proximity sensor.", effect: "No effect on the acknowledgement path.", assetId: "ROB-01", laborMinutes: 25, partIds: ["PRT-PROX-M12"] },
  { id: "RESTORE_FEEDER", title: "Restore feeder supply", description: "Utility corrects the incoming supply.", effect: "Removes the simulated supply sag.", assetId: "FDR-01", laborMinutes: 20, partIds: [] },
  { id: "REMOVE_SPN1_RESISTANCE", title: "Corrective spindle service (SPN-01)", description: "Remove the added mechanical resistance on SPN-01.", effect: "Removes the simulated mechanical resistance on SPN-01.", assetId: "SPN-01", laborMinutes: 90, partIds: ["PRT-BRG-6205"] },
  { id: "REMOVE_SPN2_RESISTANCE", title: "Corrective spindle service (SPN-02)", description: "Remove the added mechanical resistance on SPN-02.", effect: "Removes the simulated mechanical resistance on SPN-02.", assetId: "SPN-02", laborMinutes: 90, partIds: ["PRT-BRG-6205"] },
  { id: "RESTORE_COOLING", title: "Restore coolant delivery", description: "Clear the cooling restriction on PUMP-01.", effect: "Removes the simulated cooling degradation.", assetId: "PUMP-01", laborMinutes: 30, partIds: ["PRT-FILTER-CF20"] },
  { id: "RESTORE_FLOW_SENSOR", title: "Restore flow transmitter FT-301", description: "Reconnect the coolant flow transmitter.", effect: "Flow channel reports again.", assetId: "PUMP-01", laborMinutes: 15, partIds: [] },
  { id: "REPLACE_TEMP_SENSOR", title: "Replace bearing temperature sensor TT-201", description: "Replace the stuck temperature sensor.", effect: "Temperature channel reports live values again.", assetId: "SPN-01", laborMinutes: 20, partIds: ["PRT-RTD-PT100"] },
  { id: "SET_SPEED", title: "Operator speed override", description: "Change the commanded spindle speed on CNC-01.", effect: "Changes the commanded speed; does not change the mechanism.", assetId: "CNC-01", needsParam: "rpm", laborMinutes: 1, partIds: [] },
  { id: "RESTORE_RECIPE_SPEED", title: "Restore recipe speed", description: "Return CNC-01 to the approved recipe speed.", effect: "Removes the operator override.", assetId: "CNC-01", laborMinutes: 1, partIds: [] },
  { id: "SET_RECIPE", title: "Change recipe", description: "Change the active recipe on CNC-01.", effect: "Changes recipe context (speed, load, cycle time).", assetId: "CNC-01", needsParam: "recipe", laborMinutes: 2, partIds: [] },
  { id: "SYNC_ROBOT_CLOCK", title: "Synchronise robot controller clock", description: "Establish a clock contract for ROB-01 events.", effect: "Robot timestamps carry ±0.2 s uncertainty from now on.", assetId: "ROB-01", laborMinutes: 10, partIds: [] },
];

export const INTERVENTION_BY_ID: Record<string, InterventionDef> = Object.fromEntries(INTERVENTIONS.map((i) => [i.id, i]));

export interface ScenarioDef {
  id: string;
  number: number;
  title: string;
  story: string;
  seed: number;
  durationMs: number;
  /** Recipe active at start for each cell. */
  recipes: { "CELL-A": string; "CELL-B": string };
  suggestedInterventions: InterventionId[];
  /** Interventions that look like repairs but do not address the mechanism. */
  misleadingInterventions: InterventionId[];
  tags: string[];
}

const TEN_MIN = 10 * 60_000;

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "S01-SHARED-AIR",
    number: 1,
    title: "One shared utility problem, several local alarms",
    story:
      "Header pressure falls. Both fixtures take longer to prove clamp, both machining centres wait, and the robot waits on the sequence. The compressor keeps running.",
    seed: 1001,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["REPAIR_AIR_LEAK"],
    misleadingInterventions: ["REPLACE_FIXTURE_SENSOR", "CLEAR_ALARMS_ONLY"],
    tags: ["shared dependency", "pneumatic", "grouping"],
  },
  {
    id: "S02-COOLANT",
    number: 2,
    title: "The pump is running, but coolant delivery is inadequate",
    story: "Pump run feedback stays true while measured flow declines during the same cutting recipe. Spindle temperature rises later.",
    seed: 1002,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["REPLACE_COOLANT_FILTER"],
    misleadingInterventions: ["CLEAR_ALARMS_ONLY"],
    tags: ["cooling", "delayed thermal"],
  },
  {
    id: "S03-HANDSHAKE",
    number: 3,
    title: "A robot–CNC handshake stalls",
    story: "The robot completes its movement, but the machining centre does not receive a timely unload-complete acknowledgement.",
    seed: 1003,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["REPAIR_ACK_PATH"],
    misleadingInterventions: ["REPLACE_PROXIMITY_SENSOR"],
    tags: ["sequence", "handshake"],
  },
  {
    id: "S04-SUPPLY-SAG",
    number: 4,
    title: "Shared supply sag with a remaining independent fault",
    story: "Feeder voltage sags and downstream cabinets follow along the electrical edges. SPN-02 has its own persistent mechanical deviation.",
    seed: 1004,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["RESTORE_FEEDER", "REMOVE_SPN2_RESISTANCE"],
    misleadingInterventions: ["CLEAR_ALARMS_ONLY"],
    tags: ["electrical", "residual"],
  },
  {
    id: "S05-SPEED-REDUCTION",
    number: 5,
    title: "Slowing the machine makes the chart look better",
    story: "SPN-01 shows elevated matched-load current and vibration at 1500 rpm. An operator lowers the command to 900 rpm; symptoms improve but the mechanism remains.",
    seed: 1005,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["REMOVE_SPN1_RESISTANCE", "RESTORE_RECIPE_SPEED"],
    misleadingInterventions: ["SET_SPEED"],
    tags: ["context", "not comparable"],
  },
  {
    id: "S06-DELAYED-THERMAL",
    number: 6,
    title: "Correct repair, delayed thermal recovery",
    story: "A correct intervention removes the impairment. Flow recovers immediately; temperature settles slowly. The recovery run stays RUNNING until settled.",
    seed: 1006,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["REPLACE_COOLANT_FILTER"],
    misleadingInterventions: [],
    tags: ["settling", "thermal"],
  },
  {
    id: "S07-MISSING-EVIDENCE",
    number: 7,
    title: "Missing or suspect evidence is not health",
    story: "The coolant flow channel becomes unavailable and the temperature channel freezes during a recovery attempt.",
    seed: 1007,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["REPLACE_COOLANT_FILTER", "RESTORE_FLOW_SENSOR", "REPLACE_TEMP_SENSOR"],
    misleadingInterventions: ["CLEAR_ALARMS_ONLY"],
    tags: ["evidence quality", "inconclusive"],
  },
  {
    id: "S08-RECIPE-CHANGE",
    number: 8,
    title: "Normal recipe change should not become a fault",
    story: "Cell A changes from PART-A to the approved heavier PART-B, then to PART-C, which has no approved baseline.",
    seed: 1008,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: [],
    misleadingInterventions: [],
    tags: ["operating context", "baseline coverage"],
  },
  {
    id: "S09-TWO-MECHANISMS",
    number: 9,
    title: "Two mechanisms, one incomplete intervention",
    story: "Added mechanical resistance and cooling degradation together. Restoring only cooling improves temperature but not matched-condition current.",
    seed: 1009,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["RESTORE_COOLING", "REMOVE_SPN1_RESISTANCE"],
    misleadingInterventions: ["RESTORE_COOLING"],
    tags: ["compound", "partial repair"],
  },
  {
    id: "S10-CLOCK-SKEW",
    number: 10,
    title: "Clock skew destroys confident event ordering",
    story: "Robot controller timestamps carry a documented offset and ±5 s uncertainty. A naive sort places the robot delay before the pressure deviation.",
    seed: 1010,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["SYNC_ROBOT_CLOCK", "REPAIR_AIR_LEAK"],
    misleadingInterventions: ["REPLACE_PROXIMITY_SENSOR"],
    tags: ["timestamps", "uncertainty"],
  },
  {
    id: "S11-UNSUPPORTED",
    number: 11,
    title: "A new anomaly does not fit the library",
    story: "GAUGE-01 shows a dimensional shift while the machine traces have no approved explanation.",
    seed: 1011,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: [],
    misleadingInterventions: [],
    tags: ["unknown", "human review"],
  },
  {
    id: "S12-RECURRING",
    number: 12,
    title: "Recurring repairs passed the wrong test",
    story: "Three fictional prior work orders addressed the same mechanism with startup-only tests. The deviation returns under the heavy recipe.",
    seed: 1012,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: ["REMOVE_SPN1_RESISTANCE"],
    misleadingInterventions: [],
    tags: ["recurrence", "test scope"],
  },
  {
    id: "S00-HEALTHY",
    number: 0,
    title: "Healthy plant (control)",
    story: "No injected faults. Used as the evaluation negative case.",
    seed: 1000,
    durationMs: TEN_MIN,
    recipes: { "CELL-A": "PART-A", "CELL-B": "PART-A" },
    suggestedInterventions: [],
    misleadingInterventions: [],
    tags: ["control"],
  },
];

export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
export const DEFAULT_SCENARIO_ID = "S01-SHARED-AIR";

export interface RecipeDef {
  id: string;
  commandedSpeedRpm: number;
  cutSeconds: number;
  loadSeconds: number;
  unloadSeconds: number;
  baseCurrentA: number;
  coolantFlowLpm: number;
  loadFactor: number;
  approvedBaseline: boolean;
}

export const RECIPES: Record<string, RecipeDef> = {
  "PART-A": { id: "PART-A", commandedSpeedRpm: 1500, cutSeconds: 40, loadSeconds: 6, unloadSeconds: 6, baseCurrentA: 6.0, coolantFlowLpm: 18, loadFactor: 1.0, approvedBaseline: true },
  "PART-B": { id: "PART-B", commandedSpeedRpm: 1200, cutSeconds: 60, loadSeconds: 6, unloadSeconds: 6, baseCurrentA: 9.0, coolantFlowLpm: 22, loadFactor: 1.6, approvedBaseline: true },
  "PART-C": { id: "PART-C", commandedSpeedRpm: 1800, cutSeconds: 30, loadSeconds: 6, unloadSeconds: 6, baseCurrentA: 7.2, coolantFlowLpm: 18, loadFactor: 1.2, approvedBaseline: false },
};

/** Fictional approved handshake envelope (seconds). */
export const HANDSHAKE_ENVELOPE_S = 8;
export const DOWNSTREAM_ACK_ENVELOPE_S = 4;
