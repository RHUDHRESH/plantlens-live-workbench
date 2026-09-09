/**
 * HIDDEN SCENARIO TRUTH.
 *
 * This module defines which faults the seeded simulator injects and when. It is the
 * instructor answer key. It must never be imported by lib/diagnosis, lib/recovery, or
 * lib/exports (tests/unit/boundary.test.ts enforces this). Nothing here reaches the
 * diagnosis input contract; the engine only emits observations.
 */

export type FaultKind =
  | "AIR_LEAK"
  | "COOLANT_RESTRICTION"
  | "ACK_DELAY"
  | "SUPPLY_SAG"
  | "SPN1_MECH_RESISTANCE"
  | "SPN2_MECH_RESISTANCE"
  | "COOLING_DEGRADATION"
  | "FLOW_SENSOR_MISSING"
  | "TEMP_SENSOR_STUCK"
  | "GAUGE_SHIFT"
  | "CLOCK_SKEW"
  | "RECIPE_CHANGE"
  | "OPERATOR_SPEED_OVERRIDE";

export interface ScheduledFault {
  atOffsetMs: number;
  kind: FaultKind;
  params?: Record<string, number | string>;
}

export interface ScenarioTruth {
  id: string;
  faults: ScheduledFault[];
  /** Instructor answer key (Lab only, never exported in bundles). */
  answerKey: {
    expectedTopFamily: string | null;
    expectedState: "NORMAL" | "SUPPORTED" | "AMBIGUOUS" | "UNKNOWN" | "SENSOR_CHECK";
    misleadingInterpretation: string;
    usefulNextCheck: string;
    expectedRecovery: string;
  };
}

export const SCENARIO_TRUTH: Record<string, ScenarioTruth> = {
  "S01-SHARED-AIR": {
    id: "S01-SHARED-AIR",
    faults: [
      { atOffsetMs: 150_000, kind: "AIR_LEAK", params: { targetBar: 4.4 } },
      { atOffsetMs: 400_000, kind: "GAUGE_SHIFT", params: { um: 24 } },
    ],
    answerKey: {
      expectedTopFamily: "SHARED_PNEUMATIC_LOSS",
      expectedState: "SUPPORTED",
      misleadingInterpretation: "Two independent fixture sensor failures (one per cell).",
      usefulNextCheck: "Inspect the shared header pressure trend against both clamp acknowledgements.",
      expectedRecovery: "PASS only after header pressure is within band under demand and both cells complete handshake cycles.",
    },
  },
  "S02-COOLANT": {
    id: "S02-COOLANT",
    faults: [{ atOffsetMs: 120_000, kind: "COOLANT_RESTRICTION", params: { targetFlow: 5.5, rampMs: 90_000 } }],
    answerKey: {
      expectedTopFamily: "COOLANT_DELIVERY_INADEQUATE",
      expectedState: "SUPPORTED",
      misleadingInterpretation: "Spindle bearing failure because temperature rose.",
      usefulNextCheck: "Compare measured flow with pump run feedback during CUTTING.",
      expectedRecovery: "PASS after flow within band, a comparable cutting sequence, and settled temperature.",
    },
  },
  "S03-HANDSHAKE": {
    id: "S03-HANDSHAKE",
    faults: [{ atOffsetMs: 140_000, kind: "ACK_DELAY", params: { delayMs: 12_000 } }],
    answerKey: {
      expectedTopFamily: "HANDSHAKE_ACK_UNRESOLVED",
      expectedState: "SUPPORTED",
      misleadingInterpretation: "Robot mechanical failure.",
      usefulNextCheck: "Inspect the acknowledgement source and event ordering in the lanes.",
      expectedRecovery: "PASS only after several complete load-machine-unload sequences within envelope.",
    },
  },
  "S04-SUPPLY-SAG": {
    id: "S04-SUPPLY-SAG",
    faults: [
      { atOffsetMs: 90_000, kind: "SPN2_MECH_RESISTANCE", params: { resistance: 0.35 } },
      { atOffsetMs: 180_000, kind: "SUPPLY_SAG", params: { targetV: 340 } },
    ],
    answerKey: {
      expectedTopFamily: "SUPPLY_SAG",
      expectedState: "SUPPORTED",
      misleadingInterpretation: "All alarms are explained by the feeder.",
      usefulNextCheck: "Compare SPN-02 vibration after feeder recovery.",
      expectedRecovery: "Feeder recovery verifies downstream voltage; SPN-02 residual remains open.",
    },
  },
  "S05-SPEED-REDUCTION": {
    id: "S05-SPEED-REDUCTION",
    faults: [{ atOffsetMs: 100_000, kind: "SPN1_MECH_RESISTANCE", params: { resistance: 0.45 } }],
    answerKey: {
      expectedTopFamily: "MECHANICAL_LOAD_INCREASE",
      expectedState: "SUPPORTED",
      misleadingInterpretation: "Charts look better at 900 rpm, so the fault is gone.",
      usefulNextCheck: "Compare current and vibration at the approved 1500 rpm context.",
      expectedRecovery: "NOT_COMPARABLE at 900 rpm; only a 1500 rpm run after a corrective intervention can pass.",
    },
  },
  "S06-DELAYED-THERMAL": {
    id: "S06-DELAYED-THERMAL",
    faults: [{ atOffsetMs: 90_000, kind: "COOLANT_RESTRICTION", params: { targetFlow: 6.0, rampMs: 60_000 } }],
    answerKey: {
      expectedTopFamily: "COOLANT_DELIVERY_INADEQUATE",
      expectedState: "SUPPORTED",
      misleadingInterpretation: "Flow restored, so recovery is immediate.",
      usefulNextCheck: "Watch temperature settle after flow restoration.",
      expectedRecovery: "RUNNING until settling completes, then PASS in tested context.",
    },
  },
  "S07-MISSING-EVIDENCE": {
    id: "S07-MISSING-EVIDENCE",
    faults: [
      { atOffsetMs: 90_000, kind: "COOLANT_RESTRICTION", params: { targetFlow: 6.0, rampMs: 60_000 } },
      { atOffsetMs: 240_000, kind: "FLOW_SENSOR_MISSING" },
      { atOffsetMs: 240_000, kind: "TEMP_SENSOR_STUCK" },
    ],
    answerKey: {
      expectedTopFamily: "COOLANT_DELIVERY_INADEQUATE",
      expectedState: "SENSOR_CHECK",
      misleadingInterpretation: "Constant temperature and no flow alarm means the machine is healthy.",
      usefulNextCheck: "Sensor check on the flow and temperature channels.",
      expectedRecovery: "INCONCLUSIVE until flow evidence returns; a new complete run is required.",
    },
  },
  "S08-RECIPE-CHANGE": {
    id: "S08-RECIPE-CHANGE",
    faults: [
      { atOffsetMs: 150_000, kind: "RECIPE_CHANGE", params: { recipe: "PART-B" } },
      { atOffsetMs: 420_000, kind: "RECIPE_CHANGE", params: { recipe: "PART-C" } },
    ],
    answerKey: {
      expectedTopFamily: null,
      expectedState: "NORMAL",
      misleadingInterpretation: "Higher current after the recipe change is a mechanical fault.",
      usefulNextCheck: "Compare against the approved PART-B baseline; PART-C has none.",
      expectedRecovery: "NOT_COMPARABLE against a PART-A plan; PART-C reports insufficient baseline coverage.",
    },
  },
  "S09-TWO-MECHANISMS": {
    id: "S09-TWO-MECHANISMS",
    faults: [
      { atOffsetMs: 100_000, kind: "SPN1_MECH_RESISTANCE", params: { resistance: 0.4 } },
      { atOffsetMs: 100_000, kind: "COOLING_DEGRADATION", params: { targetFlow: 7.0, rampMs: 60_000 } },
    ],
    answerKey: {
      expectedTopFamily: "MECHANICAL_LOAD_INCREASE",
      expectedState: "AMBIGUOUS",
      misleadingInterpretation: "Restoring cooling fixed everything because temperature improved.",
      usefulNextCheck: "Matched-condition current and vibration after cooling restoration.",
      expectedRecovery: "FAIL after cooling-only intervention; both interventions retained.",
    },
  },
  "S10-CLOCK-SKEW": {
    id: "S10-CLOCK-SKEW",
    faults: [
      { atOffsetMs: 0, kind: "CLOCK_SKEW", params: { source: "ROBOT-CTRL", offsetMs: -4000, uncertaintyMs: 5000 } },
      { atOffsetMs: 150_000, kind: "AIR_LEAK", params: { targetBar: 4.4 } },
    ],
    answerKey: {
      expectedTopFamily: "SHARED_PNEUMATIC_LOSS",
      expectedState: "AMBIGUOUS",
      misleadingInterpretation: "The robot delay came first, so the robot caused the pressure deviation.",
      usefulNextCheck: "Establish the clock contract before ordering-sensitive conclusions.",
      expectedRecovery: "Timing-sensitive checks INCONCLUSIVE until the clock contract is adequate.",
    },
  },
  "S11-UNSUPPORTED": {
    id: "S11-UNSUPPORTED",
    faults: [{ atOffsetMs: 120_000, kind: "GAUGE_SHIFT", params: { um: 28 } }],
    answerKey: {
      expectedTopFamily: null,
      expectedState: "UNKNOWN",
      misleadingInterpretation: "Blame tooling wear without evidence.",
      usefulNextCheck: "Request source/evidence coverage for GAUGE-01 results.",
      expectedRecovery: "No plan can be generated; engineer drafts one through review.",
    },
  },
  "S12-RECURRING": {
    id: "S12-RECURRING",
    faults: [
      { atOffsetMs: 60_000, kind: "SPN1_MECH_RESISTANCE", params: { resistance: 0.3, loadDependent: 1 } },
      { atOffsetMs: 200_000, kind: "RECIPE_CHANGE", params: { recipe: "PART-B" } },
    ],
    answerKey: {
      expectedTopFamily: "MECHANICAL_LOAD_INCREASE",
      expectedState: "SUPPORTED",
      misleadingInterpretation: "Earlier startup-only tests passed, so the repair worked.",
      usefulNextCheck: "Compare heavy-recipe evidence with the prior work orders' test scope.",
      expectedRecovery: "A multi-mode suite is required; historical PASS results stay scoped to their modes.",
    },
  },
  "S00-HEALTHY": {
    id: "S00-HEALTHY",
    faults: [],
    answerKey: {
      expectedTopFamily: null,
      expectedState: "NORMAL",
      misleadingInterpretation: "None.",
      usefulNextCheck: "None.",
      expectedRecovery: "No incident.",
    },
  },
};
