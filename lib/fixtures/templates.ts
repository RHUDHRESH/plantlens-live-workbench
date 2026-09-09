import type { FaultFamilyId, RecoveryCheck } from "@/lib/domain/types";

/**
 * Constrained recovery template library. The recovery-check drafter may only draw from
 * these templates; it never generates code. Each check carries the requirement that
 * justifies it. Thresholds come from the approved requirements/baselines, not from here.
 */

export interface RecoveryTemplate {
  id: string;
  title: string;
  faultFamilies: FaultFamilyId[];
  cellId: "CELL-A" | "CELL-B" | "PLANT";
  recipe: string;
  requiredCompleteCycles: number;
  requiredEvidence: string[];
  checks: RecoveryCheck[];
  justifications: Record<string, string>;
  validityLimits: string[];
}

export const RECOVERY_TEMPLATES: RecoveryTemplate[] = [
  {
    id: "TPL-CELL-A-AIR",
    title: "Shared pneumatic recovery — cell A handshake under demand",
    faultFamilies: ["SHARED_PNEUMATIC_LOSS", "LOCAL_FIXTURE_SENSOR"],
    cellId: "CELL-A",
    recipe: "PART-A",
    requiredCompleteCycles: 5,
    requiredEvidence: ["AIR-HDR-01.header_pressure", "FIX-01.clamp_proof", "ROB-01.robot_clear", "CNC-01.cycle_ready", "CNC-01.cycle_complete", "ASM-01.downstream_accept"],
    checks: [
      { id: "CHK-QUALITY", kind: "SOURCE_QUALITY", tags: ["AIR-HDR-01.header_pressure", "FIX-01.clamp_proof", "ROB-01.robot_clear", "CNC-01.cycle_ready"], qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-MODE", kind: "MODE_REQUIRED", assetId: "CNC-01", recipe: "PART-A", mode: "AUTO", requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-AIR", kind: "NUMERIC_BAND", tag: "AIR-HDR-01.header_pressure", minimum: 5.5, maximum: 6.5, unit: "bar", phase: "CLAMPING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 5, requirementRef: "REQ-DEMO-AIR-01" },
      { id: "CHK-HANDSHAKE", kind: "EVENT_SEQUENCE", events: ["ROB-01.robot_clear", "FIX-01.clamp_proof", "CNC-01.cycle_ready"], maximumElapsedSeconds: 8, minimumValidOccurrences: 5, requirementRef: "REQ-DEMO-SEQUENCE-01" },
      { id: "CHK-ACCEPT", kind: "DOWNSTREAM_ACK", trigger: "CNC-01.cycle_complete", acknowledgement: "ASM-01.downstream_accept", maximumElapsedSeconds: 4, minimumValidOccurrences: 5, requirementRef: "REQ-DEMO-HANDOFF-01" },
      { id: "CHK-CYCLES", kind: "COMPLETE_CYCLES", assetId: "CNC-01", count: 5, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-ALARMS", kind: "ALARM_ABSENCE", assetIds: ["FIX-01", "CNC-01", "AIR-HDR-01"], severities: ["FAULT"], requirementRef: "REQ-DEMO-AIR-01" },
      { id: "CHK-COVERAGE", kind: "DEPENDENCY_COVERAGE", edgeIds: ["DEP-AIR-FIX-01", "DEP-ROB-CNC-01", "DEP-CNC-ASM-01"], coveredByCheckIds: ["CHK-AIR", "CHK-HANDSHAKE", "CHK-ACCEPT"], requirementRef: "REQ-DEMO-AIR-01" },
    ],
    justifications: {
      "CHK-QUALITY": "Required channels must report GOOD quality; missing channels make the run inconclusive (engineer note, coolant/air rules).",
      "CHK-MODE": "Recovery is scoped to the approved PART-A AUTO context.",
      "CHK-AIR": "REQ-DEMO-AIR-01: header pressure ≥ 5.5 bar during clamping (engineer note lines cited on the requirement).",
      "CHK-HANDSHAKE": "REQ-DEMO-SEQUENCE-01: robot_clear → clamp_proof → cycle_ready within the 8 s envelope.",
      "CHK-ACCEPT": "REQ-DEMO-HANDOFF-01: downstream acknowledgement within 4 s.",
      "CHK-CYCLES": "REQ-DEMO-CYCLES-01: five complete cycles under representative demand.",
      "CHK-ALARMS": "No FAULT alarms on the affected assets while alarm coverage is valid.",
      "CHK-COVERAGE": "Every affected approved dependency must be covered by a check.",
    },
    validityLimits: ["Fictional demonstration conditions, not industrial acceptance standards", "Scoped to PART-A AUTO in cell A"],
  },
  {
    id: "TPL-CELL-B-AIR",
    title: "Shared pneumatic recovery — cell B clamp under demand",
    faultFamilies: ["SHARED_PNEUMATIC_LOSS"],
    cellId: "CELL-B",
    recipe: "PART-A",
    requiredCompleteCycles: 5,
    requiredEvidence: ["AIR-HDR-01.header_pressure", "CNC-02.clamp_proof", "CNC-02.cycle_complete"],
    checks: [
      { id: "CHK-QUALITY", kind: "SOURCE_QUALITY", tags: ["AIR-HDR-01.header_pressure", "CNC-02.clamp_proof"], qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-MODE", kind: "MODE_REQUIRED", assetId: "CNC-02", recipe: "PART-A", mode: "AUTO", requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-AIR", kind: "NUMERIC_BAND", tag: "AIR-HDR-01.header_pressure", minimum: 5.5, maximum: 6.5, unit: "bar", phase: "CLAMPING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 5, requirementRef: "REQ-DEMO-AIR-01" },
      { id: "CHK-CLAMP-B", kind: "NUMERIC_BAND", tag: "CNC-02.clamp_delay_s", minimum: 0, maximum: 4, unit: "s", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 5, requirementRef: "REQ-DEMO-AIR-01" },
      { id: "CHK-CYCLES", kind: "COMPLETE_CYCLES", assetId: "CNC-02", count: 5, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-ALARMS", kind: "ALARM_ABSENCE", assetIds: ["CNC-02", "AIR-HDR-01"], severities: ["FAULT"], requirementRef: "REQ-DEMO-AIR-01" },
      { id: "CHK-COVERAGE", kind: "DEPENDENCY_COVERAGE", edgeIds: ["DEP-AIR-CNC-02"], coveredByCheckIds: ["CHK-AIR", "CHK-CLAMP-B"], requirementRef: "REQ-DEMO-AIR-01" },
    ],
    justifications: {
      "CHK-QUALITY": "Required channels must report GOOD quality.",
      "CHK-MODE": "Scoped to PART-A AUTO in cell B.",
      "CHK-AIR": "REQ-DEMO-AIR-01 applied to cell B only after DEP-AIR-CNC-02 is published.",
      "CHK-CLAMP-B": "Clamp delay band from PART-A-approved-demo-1-B.",
      "CHK-CYCLES": "REQ-DEMO-CYCLES-01.",
      "CHK-ALARMS": "No FAULT alarms on the affected assets.",
      "CHK-COVERAGE": "DEP-AIR-CNC-02 must be published for this coverage to be valid.",
    },
    validityLimits: ["Fictional demonstration conditions", "Requires published DEP-AIR-CNC-02"],
  },
  {
    id: "TPL-CELL-A-COOLANT",
    title: "Coolant delivery recovery — matched cutting context with thermal settling",
    faultFamilies: ["COOLANT_DELIVERY_INADEQUATE", "COOLING_DEGRADATION", "SPINDLE_BEARING"],
    cellId: "CELL-A",
    recipe: "PART-A",
    requiredCompleteCycles: 3,
    requiredEvidence: ["PUMP-01.coolant_flow", "PUMP-01.run_feedback", "SPN-01.bearing_temp", "SPN-01.actual_speed", "CNC-01.cycle_complete"],
    checks: [
      { id: "CHK-QUALITY", kind: "SOURCE_QUALITY", tags: ["PUMP-01.coolant_flow", "SPN-01.bearing_temp", "SPN-01.actual_speed"], qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-FLOW-01" },
      { id: "CHK-MODE", kind: "MODE_REQUIRED", assetId: "CNC-01", recipe: "PART-A", mode: "AUTO", commandedSpeedRpm: 1500, requirementRef: "REQ-DEMO-SPEED-01" },
      { id: "CHK-SPEED", kind: "NUMERIC_BAND", tag: "SPN-01.actual_speed", minimum: 1450, maximum: 1550, unit: "rpm", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-SPEED-01" },
      { id: "CHK-FLOW", kind: "NUMERIC_BAND", tag: "PUMP-01.coolant_flow", minimum: 15, maximum: 21, unit: "L/min", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-FLOW-01" },
      { id: "CHK-TEMP", kind: "STABLE_WINDOW", tag: "SPN-01.bearing_temp", minimum: 35, maximum: 55, unit: "°C", settlingSeconds: 120, windowSeconds: 60, qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-TEMP-01" },
      { id: "CHK-CYCLES", kind: "COMPLETE_CYCLES", assetId: "CNC-01", count: 3, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-ALARMS", kind: "ALARM_ABSENCE", assetIds: ["PUMP-01", "SPN-01"], severities: ["FAULT"], requirementRef: "REQ-DEMO-FLOW-01" },
      { id: "CHK-COVERAGE", kind: "DEPENDENCY_COVERAGE", edgeIds: ["DEP-PUMP-SPN-01"], coveredByCheckIds: ["CHK-FLOW", "CHK-TEMP"], requirementRef: "REQ-DEMO-FLOW-01" },
    ],
    justifications: {
      "CHK-QUALITY": "Flow and temperature must be GOOD; a missing flow channel prevents asserting delivery (engineer note).",
      "CHK-MODE": "Approved PART-A context at 1500 rpm; a slower speed is NOT_COMPARABLE.",
      "CHK-SPEED": "REQ-DEMO-SPEED-01 context requirement.",
      "CHK-FLOW": "REQ-DEMO-FLOW-01: measured flow 15–21 L/min during cutting.",
      "CHK-TEMP": "REQ-DEMO-TEMP-01: temperature stable in band after 120 s settling; restoring flow must not instantly reset temperature.",
      "CHK-CYCLES": "REQ-DEMO-CYCLES-01 (three cycles for thermal coverage).",
      "CHK-ALARMS": "No FAULT alarms on pump or spindle while alarm coverage is valid.",
      "CHK-COVERAGE": "DEP-PUMP-SPN-01 covered by flow and thermal checks.",
    },
    validityLimits: ["Fictional demonstration conditions", "Scoped to PART-A AUTO at 1500 rpm"],
  },
  {
    id: "TPL-CELL-A-HANDSHAKE",
    title: "Handshake recovery — complete load–machine–unload sequences",
    faultFamilies: ["HANDSHAKE_ACK_UNRESOLVED", "ROBOT_MECHANICAL"],
    cellId: "CELL-A",
    recipe: "PART-A",
    requiredCompleteCycles: 5,
    requiredEvidence: ["ROB-01.robot_clear", "FIX-01.clamp_proof", "CNC-01.cycle_ready", "ROB-01.move_complete", "ROB-01.unload_complete", "CNC-01.cycle_complete", "ASM-01.downstream_accept"],
    checks: [
      { id: "CHK-QUALITY", kind: "SOURCE_QUALITY", tags: ["ROB-01.robot_clear", "ROB-01.move_complete", "ROB-01.unload_complete", "CNC-01.cycle_ready"], qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-UNLOAD-01" },
      { id: "CHK-MODE", kind: "MODE_REQUIRED", assetId: "CNC-01", recipe: "PART-A", mode: "AUTO", requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-LOAD-SEQ", kind: "EVENT_SEQUENCE", events: ["ROB-01.robot_clear", "FIX-01.clamp_proof", "CNC-01.cycle_ready"], maximumElapsedSeconds: 8, minimumValidOccurrences: 5, requirementRef: "REQ-DEMO-SEQUENCE-01" },
      { id: "CHK-UNLOAD-SEQ", kind: "EVENT_SEQUENCE", events: ["ROB-01.move_complete", "ROB-01.unload_complete"], maximumElapsedSeconds: 8, minimumValidOccurrences: 5, requirementRef: "REQ-DEMO-UNLOAD-01" },
      { id: "CHK-ACCEPT", kind: "DOWNSTREAM_ACK", trigger: "CNC-01.cycle_complete", acknowledgement: "ASM-01.downstream_accept", maximumElapsedSeconds: 4, minimumValidOccurrences: 5, requirementRef: "REQ-DEMO-HANDOFF-01" },
      { id: "CHK-CYCLES", kind: "COMPLETE_CYCLES", assetId: "CNC-01", count: 5, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-ALARMS", kind: "ALARM_ABSENCE", assetIds: ["CNC-01", "ROB-01"], severities: ["FAULT"], requirementRef: "REQ-DEMO-UNLOAD-01" },
      { id: "CHK-COVERAGE", kind: "DEPENDENCY_COVERAGE", edgeIds: ["DEP-ROB-CNC-01", "DEP-CNC-ASM-01"], coveredByCheckIds: ["CHK-LOAD-SEQ", "CHK-UNLOAD-SEQ", "CHK-ACCEPT"], requirementRef: "REQ-DEMO-UNLOAD-01" },
    ],
    justifications: {
      "CHK-QUALITY": "Event channels must be present; an absent event is different from a missing channel.",
      "CHK-MODE": "Approved PART-A AUTO context.",
      "CHK-LOAD-SEQ": "REQ-DEMO-SEQUENCE-01 load handshake envelope.",
      "CHK-UNLOAD-SEQ": "REQ-DEMO-UNLOAD-01: unload_complete within 8 s of move_complete (sequence excerpt).",
      "CHK-ACCEPT": "REQ-DEMO-HANDOFF-01 downstream acknowledgement.",
      "CHK-CYCLES": "Several complete sequences; one cycle-ready bit is insufficient.",
      "CHK-ALARMS": "No FAULT alarms on CNC-01/ROB-01.",
      "CHK-COVERAGE": "Handshake edges covered by sequence checks.",
    },
    validityLimits: ["Fictional demonstration conditions", "Never bypass the physical interlock"],
  },
  {
    id: "TPL-FEEDER",
    title: "Feeder recovery — downstream cabinet voltage in affected assets",
    faultFamilies: ["SUPPLY_SAG"],
    cellId: "PLANT",
    recipe: "PART-A",
    requiredCompleteCycles: 2,
    requiredEvidence: ["FDR-01.supply_voltage", "CNC-01.supply_voltage", "CNC-02.supply_voltage"],
    checks: [
      { id: "CHK-QUALITY", kind: "SOURCE_QUALITY", tags: ["FDR-01.supply_voltage", "CNC-01.supply_voltage", "CNC-02.supply_voltage"], qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-VOLT-01" },
      { id: "CHK-FDR", kind: "STABLE_WINDOW", tag: "FDR-01.supply_voltage", minimum: 380, maximum: 420, unit: "V", settlingSeconds: 10, windowSeconds: 60, qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-VOLT-01" },
      { id: "CHK-CNC1-V", kind: "STABLE_WINDOW", tag: "CNC-01.supply_voltage", minimum: 380, maximum: 420, unit: "V", settlingSeconds: 10, windowSeconds: 60, qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-VOLT-01" },
      { id: "CHK-CNC2-V", kind: "STABLE_WINDOW", tag: "CNC-02.supply_voltage", minimum: 380, maximum: 420, unit: "V", settlingSeconds: 10, windowSeconds: 60, qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-VOLT-01" },
      { id: "CHK-CYCLES", kind: "COMPLETE_CYCLES", assetId: "CNC-01", count: 2, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-ALARMS", kind: "ALARM_ABSENCE", assetIds: ["FDR-01", "CNC-01", "CNC-02"], severities: ["FAULT"], requirementRef: "REQ-DEMO-VOLT-01" },
      { id: "CHK-COVERAGE", kind: "DEPENDENCY_COVERAGE", edgeIds: ["DEP-FDR-CNC-01", "DEP-FDR-CNC-02"], coveredByCheckIds: ["CHK-CNC1-V", "CHK-CNC2-V"], requirementRef: "REQ-DEMO-VOLT-01" },
    ],
    justifications: {
      "CHK-QUALITY": "Downstream voltage evidence must be present; missing downstream evidence is visible.",
      "CHK-FDR": "REQ-DEMO-VOLT-01 at the feeder.",
      "CHK-CNC1-V": "REQ-DEMO-VOLT-01 at CNC-01 cabinet (DEP-FDR-CNC-01).",
      "CHK-CNC2-V": "REQ-DEMO-VOLT-01 at CNC-02 cabinet (DEP-FDR-CNC-02).",
      "CHK-CYCLES": "Two cycles to show production resumed.",
      "CHK-ALARMS": "No FAULT alarms on feeder or cabinets.",
      "CHK-COVERAGE": "Electrical edges covered by cabinet voltage checks. This does not declare SPN-02 healthy.",
    },
    validityLimits: ["Fictional demonstration conditions", "Does not cover SPN-02 residual deviation"],
  },
  {
    id: "TPL-CELL-A-MECH",
    title: "Mechanical load recovery — matched 1500 rpm PART-A context",
    faultFamilies: ["MECHANICAL_LOAD_INCREASE"],
    cellId: "CELL-A",
    recipe: "PART-A",
    requiredCompleteCycles: 3,
    requiredEvidence: ["SPN-01.actual_speed", "SPN-01.motor_current", "SPN-01.vibration_rms", "CNC-01.commanded_speed", "CNC-01.cycle_complete"],
    checks: [
      { id: "CHK-QUALITY", kind: "SOURCE_QUALITY", tags: ["SPN-01.actual_speed", "SPN-01.motor_current", "SPN-01.vibration_rms"], qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-CURRENT-01" },
      { id: "CHK-MODE", kind: "MODE_REQUIRED", assetId: "CNC-01", recipe: "PART-A", mode: "AUTO", commandedSpeedRpm: 1500, requirementRef: "REQ-DEMO-SPEED-01" },
      { id: "CHK-SPEED", kind: "NUMERIC_BAND", tag: "SPN-01.actual_speed", minimum: 1450, maximum: 1550, unit: "rpm", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-SPEED-01" },
      { id: "CHK-CURRENT", kind: "NUMERIC_BAND", tag: "SPN-01.motor_current", minimum: 5.0, maximum: 7.5, unit: "A", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-CURRENT-01" },
      { id: "CHK-VIB", kind: "NUMERIC_BAND", tag: "SPN-01.vibration_rms", minimum: 0.6, maximum: 2.2, unit: "mm/s", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-VIB-01" },
      { id: "CHK-CYCLES", kind: "COMPLETE_CYCLES", assetId: "CNC-01", count: 3, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-ALARMS", kind: "ALARM_ABSENCE", assetIds: ["SPN-01", "CNC-01"], severities: ["FAULT"], requirementRef: "REQ-DEMO-CURRENT-01" },
      { id: "CHK-COVERAGE", kind: "DEPENDENCY_COVERAGE", edgeIds: ["DEP-SPN-CNC-01"], coveredByCheckIds: ["CHK-CURRENT", "CHK-VIB"], requirementRef: "REQ-DEMO-CURRENT-01" },
    ],
    justifications: {
      "CHK-QUALITY": "Matched-condition channels must be GOOD.",
      "CHK-MODE": "Approved 1500 rpm PART-A context; 900 rpm makes the run NOT_COMPARABLE.",
      "CHK-SPEED": "REQ-DEMO-SPEED-01 context requirement.",
      "CHK-CURRENT": "REQ-DEMO-CURRENT-01 matched-load current band.",
      "CHK-VIB": "REQ-DEMO-VIB-01 vibration band.",
      "CHK-CYCLES": "Three complete cycles.",
      "CHK-ALARMS": "No FAULT alarms.",
      "CHK-COVERAGE": "Spindle subsystem edge covered.",
    },
    validityLimits: ["Fictional demonstration conditions", "Scoped to PART-A AUTO at 1500 rpm"],
  },
  {
    id: "TPL-CELL-A-MULTIMODE",
    title: "Multi-mode spindle suite — PART-A and PART-B sustained cutting",
    faultFamilies: ["MECHANICAL_LOAD_INCREASE"],
    cellId: "CELL-A",
    recipe: "PART-B",
    requiredCompleteCycles: 3,
    requiredEvidence: ["SPN-01.actual_speed", "SPN-01.motor_current", "SPN-01.vibration_rms", "CNC-01.recipe", "CNC-01.cycle_complete"],
    checks: [
      { id: "CHK-QUALITY", kind: "SOURCE_QUALITY", tags: ["SPN-01.actual_speed", "SPN-01.motor_current", "SPN-01.vibration_rms"], qualityPolicy: "REQUIRE_GOOD", requirementRef: "REQ-DEMO-CURRENT-01" },
      { id: "CHK-MODE", kind: "MODE_REQUIRED", assetId: "CNC-01", recipe: "PART-B", mode: "AUTO", commandedSpeedRpm: 1200, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-SPEED-B", kind: "NUMERIC_BAND", tag: "SPN-01.actual_speed", minimum: 1150, maximum: 1250, unit: "rpm", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-CURRENT-B", kind: "NUMERIC_BAND", tag: "SPN-01.motor_current", minimum: 7.5, maximum: 11.0, unit: "A", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-CURRENT-01" },
      { id: "CHK-VIB-B", kind: "NUMERIC_BAND", tag: "SPN-01.vibration_rms", minimum: 0.5, maximum: 2.4, unit: "mm/s", phase: "CUTTING", qualityPolicy: "REQUIRE_GOOD", minimumSamples: 30, requirementRef: "REQ-DEMO-VIB-01" },
      { id: "CHK-CYCLES", kind: "COMPLETE_CYCLES", assetId: "CNC-01", count: 3, requirementRef: "REQ-DEMO-CYCLES-01" },
      { id: "CHK-ALARMS", kind: "ALARM_ABSENCE", assetIds: ["SPN-01", "CNC-01"], severities: ["FAULT"], requirementRef: "REQ-DEMO-CURRENT-01" },
      { id: "CHK-COVERAGE", kind: "DEPENDENCY_COVERAGE", edgeIds: ["DEP-SPN-CNC-01"], coveredByCheckIds: ["CHK-CURRENT-B", "CHK-VIB-B"], requirementRef: "REQ-DEMO-CURRENT-01" },
    ],
    justifications: {
      "CHK-QUALITY": "Channels must be GOOD.",
      "CHK-MODE": "Heavy recipe context PART-B at 1200 rpm — the mode the earlier work orders never tested.",
      "CHK-SPEED-B": "PART-B-approved-demo-1 speed band.",
      "CHK-CURRENT-B": "PART-B-approved-demo-1 current band.",
      "CHK-VIB-B": "PART-B-approved-demo-1 vibration band.",
      "CHK-CYCLES": "Three sustained heavy cycles.",
      "CHK-ALARMS": "No FAULT alarms.",
      "CHK-COVERAGE": "Spindle subsystem edge covered under the heavy recipe.",
    },
    validityLimits: ["Fictional demonstration conditions", "Scoped to PART-B AUTO; pair with TPL-CELL-A-MECH for PART-A coverage"],
  },
];

export const TEMPLATE_BY_ID: Record<string, RecoveryTemplate> = Object.fromEntries(RECOVERY_TEMPLATES.map((t) => [t.id, t]));
