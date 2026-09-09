import { describe, expect, it } from "vitest";
import { PlantEngine } from "@/lib/simulation/engine";
import { Runtime } from "@/lib/simulation/runtime";
import { DEMO_START_MS } from "@/lib/simulation/scenarios";
import { SEED_BASELINES, SEED_KNOWLEDGE_VERSION } from "@/lib/fixtures/knowledge";

function runtimeFor(scenarioId: string, seed = 4242) {
  const rt = new Runtime();
  rt.init({ mode: "DEMO_SIMULATION", seed, scenarioId, startMs: DEMO_START_MS, knowledge: SEED_KNOWLEDGE_VERSION, baselines: SEED_BASELINES });
  return rt;
}

describe("engine determinism", () => {
  it("same seed produces identical observations regardless of how steps are batched", () => {
    const a = new PlantEngine({ seed: 11, scenarioId: "S01-SHARED-AIR", startMs: DEMO_START_MS });
    const b = new PlantEngine({ seed: 11, scenarioId: "S01-SHARED-AIR", startMs: DEMO_START_MS });
    a.runUntil(DEMO_START_MS + 300_000);
    for (let i = 0; i < 300; i++) b.step();
    const ta = a.store.range("AIR-HDR-01.header_pressure", DEMO_START_MS, DEMO_START_MS + 300_000).map((s) => s.value);
    const tb = b.store.range("AIR-HDR-01.header_pressure", DEMO_START_MS, DEMO_START_MS + 300_000).map((s) => s.value);
    expect(ta).toEqual(tb);
    expect(ta.length).toBe(301);
  });

  it("healthy plant completes cycles without alarms", () => {
    const rt = runtimeFor("S00-HEALTHY");
    rt.fastForward(DEMO_START_MS + 480_000);
    const snap = rt.snapshot();
    expect(snap.cells["CELL-A"].cycleCount).toBeGreaterThanOrEqual(6);
    expect(snap.alarms.filter((a) => a.severity === "FAULT")).toHaveLength(0);
    expect(snap.incidents.filter((i) => !i.fixture)).toHaveLength(0);
  });
});

describe("scenario 1 — shared air", () => {
  it("groups both clamp delays only when the cell B edge is published", () => {
    const rt = runtimeFor("S01-SHARED-AIR");
    rt.fastForward(DEMO_START_MS + 420_000);
    const snap = rt.snapshot();
    const inc = snap.incidents.find((i) => i.sharedCauseAssetId === "AIR-HDR-01");
    expect(inc).toBeTruthy();
    expect(inc!.diagnosis!.candidates[0].family).toBe("SHARED_PNEUMATIC_LOSS");
    expect(inc!.diagnosis!.state).toBe("SUPPORTED");
    expect(inc!.observedAssetIds).toContain("FIX-01");
    // Cell B not grouped: DEP-AIR-CNC-02 is not published in plant-knowledge-1.
    expect(inc!.observedAssetIds).not.toContain("CNC-02");
    const separate = snap.incidents.find((i) => i.observedAssetIds.includes("CNC-02"));
    expect(separate).toBeTruthy();
    expect(inc!.interruptions.length).toBeGreaterThan(0);
  });
});

describe("scenario 2 — coolant", () => {
  it("ranks inadequate delivery above bearing", () => {
    const rt = runtimeFor("S02-COOLANT");
    rt.fastForward(DEMO_START_MS + 420_000);
    const inc = rt.snapshot().incidents.find((i) => i.observedAssetIds.includes("PUMP-01"));
    expect(inc).toBeTruthy();
    expect(inc!.diagnosis!.candidates[0].family).toBe("COOLANT_DELIVERY_INADEQUATE");
    const bearing = inc!.diagnosis!.candidates.find((c) => c.family === "SPINDLE_BEARING");
    expect(bearing?.contradictionCount ?? 1).toBeGreaterThan(0);
  });
});

describe("scenario 3 — handshake", () => {
  it("identifies the acknowledgement path, not robot mechanics", () => {
    const rt = runtimeFor("S03-HANDSHAKE");
    rt.fastForward(DEMO_START_MS + 400_000);
    const inc = rt.snapshot().incidents.find((i) => i.title.includes("acknowledgement"));
    expect(inc).toBeTruthy();
    expect(inc!.diagnosis!.candidates[0].family).toBe("HANDSHAKE_ACK_UNRESOLVED");
  });
});

describe("scenario 11 — unsupported", () => {
  it("returns UNKNOWN with HUMAN_REVIEW", () => {
    const rt = runtimeFor("S11-UNSUPPORTED");
    rt.fastForward(DEMO_START_MS + 400_000);
    const inc = rt.snapshot().incidents.find((i) => i.observedAssetIds.includes("GAUGE-01"));
    expect(inc).toBeTruthy();
    expect(inc!.diagnosis!.state).toBe("UNKNOWN");
    expect(inc!.diagnosis!.disposition).toBe("HUMAN_REVIEW");
  });
});
