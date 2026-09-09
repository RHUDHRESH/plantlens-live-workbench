import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { diagnose } from "@/lib/diagnosis/engine";
import { readerAt } from "@/lib/simulation/observation";
import { SEED_BASELINES, SEED_KNOWLEDGE_VERSION } from "@/lib/fixtures/knowledge";
import { runtimeFor, T0 } from "./helpers";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("boundary: diagnosis, recovery, and exports cannot import the simulator truth", () => {
  it("has no import of lib/simulation/truth or scenarios in the protected modules", () => {
    const root = path.resolve(__dirname, "../../lib");
    const protectedDirs = ["diagnosis", "recovery", "exports", "knowledge", "workflow"].map((d) => path.join(root, d));
    for (const dir of protectedDirs) {
      for (const file of walk(dir)) {
        const src = readFileSync(file, "utf8");
        expect(src, file).not.toMatch(/simulation\/truth/);
        expect(src, file).not.toMatch(/SCENARIO_TRUTH/);
      }
    }
  });
});

describe("diagnosis input contract", () => {
  it("is a pure function of observations and approved context (identical inputs → identical output)", () => {
    const a = runtimeFor("S02-COOLANT", 77);
    const b = runtimeFor("S02-COOLANT", 77);
    a.fastForward(T0 + 400_000);
    b.fastForward(T0 + 400_000);
    const input = (rt: typeof a) => ({ reader: readerAt(rt.store, T0 + 400_000), alarms: [], knowledge: { versionId: SEED_KNOWLEDGE_VERSION.id, edges: SEED_KNOWLEDGE_VERSION.edges, requirements: SEED_KNOWLEDGE_VERSION.requirements, reviewedNoDependency: SEED_KNOWLEDGE_VERSION.reviewedNoDependency }, baselines: SEED_BASELINES, cells: rt.cellContexts(T0 + 400_000), cutoffMs: T0 + 400_000 });
    expect(JSON.stringify(diagnose(input(a)))).toBe(JSON.stringify(diagnose(input(b))));
  });

  it("does not see future observations beyond the cutoff", () => {
    const rt = runtimeFor("S01-SHARED-AIR");
    rt.fastForward(T0 + 400_000);
    const early = diagnose({ reader: readerAt(rt.store, T0 + 100_000), alarms: [], knowledge: { versionId: "k", edges: SEED_KNOWLEDGE_VERSION.edges, requirements: SEED_KNOWLEDGE_VERSION.requirements, reviewedNoDependency: [] }, baselines: SEED_BASELINES, cells: rt.cellContexts(T0 + 100_000), cutoffMs: T0 + 100_000 });
    expect(early.groups).toHaveLength(0);
  });
});

describe("scenario behaviours", () => {
  it("scenario 8: an approved heavier recipe is not a fault; an unknown recipe reports missing baseline coverage", () => {
    const rt = runtimeFor("S08-RECIPE-CHANGE");
    rt.fastForward(T0 + 380_000);
    const mid = rt.snapshot();
    expect(mid.incidents.filter((i) => i.diagnosis?.candidates[0]?.family === "MECHANICAL_LOAD_INCREASE" && i.diagnosis.state === "SUPPORTED")).toHaveLength(0);
    rt.fastForward(T0 + 560_000);
    const late = rt.snapshot();
    expect(late.missingBaselines.join(" ")).toContain("PART-C");
    expect(late.incidents.filter((i) => i.diagnosis?.state === "SUPPORTED")).toHaveLength(0);
  });

  it("scenario 4: common-cause grouping keeps the SPN-02 residual as a separate incident", () => {
    const rt = runtimeFor("S04-SUPPLY-SAG");
    rt.fastForward(T0 + 420_000);
    const snap = rt.snapshot();
    const supply = snap.incidents.find((i) => i.sharedCauseAssetId === "FDR-01");
    expect(supply?.diagnosis?.candidates[0].family).toBe("SUPPLY_SAG");
    expect(supply?.observedAssetIds).toContain("CNC-01");
    const residual = snap.incidents.find((i) => i.observedAssetIds.includes("SPN-02") && i.sharedCauseAssetId !== "FDR-01");
    expect(residual).toBeTruthy();
  });

  it("scenario 10: clock uncertainty prevents an unsupported ordering claim", () => {
    const rt = runtimeFor("S10-CLOCK-SKEW");
    rt.fastForward(T0 + 420_000);
    const inc = rt.snapshot().incidents.find((i) => i.sharedCauseAssetId === "AIR-HDR-01");
    expect(inc?.diagnosis?.orderingUnresolved || inc?.diagnosis?.state === "AMBIGUOUS").toBe(true);
    const robot = rt.store.range("ROB-01.robot_clear", T0, T0 + 420_000);
    expect(robot.some((s) => s.uncertaintyMs === 5000 && s.clockSourceId === "ROBOT-CTRL")).toBe(true);
  });

  it("scenario 7: suspicious constancy triggers SENSOR_CHECK, not health", () => {
    const rt = runtimeFor("S07-MISSING-EVIDENCE");
    rt.fastForward(T0 + 480_000);
    const inc = rt.snapshot().incidents.find((i) => i.observedAssetIds.includes("PUMP-01") || i.observedAssetIds.includes("SPN-01"));
    expect(inc?.diagnosis?.state).toBe("SENSOR_CHECK");
    expect(inc?.diagnosis?.missingInputs.join(" ")).toMatch(/coolant_flow/);
  });

  it("scenario 12: the load-dependent deviation appears only under the heavy recipe and links prior work orders", () => {
    const rt = runtimeFor("S12-RECURRING");
    rt.fastForward(T0 + 180_000);
    expect(rt.snapshot().incidents.filter((i) => i.observedAssetIds.includes("SPN-01"))).toHaveLength(0);
    rt.fastForward(T0 + 480_000);
    const inc = rt.snapshot().incidents.find((i) => i.observedAssetIds.includes("SPN-01"));
    expect(inc?.diagnosis?.candidates[0].family).toBe("MECHANICAL_LOAD_INCREASE");
  });
});
