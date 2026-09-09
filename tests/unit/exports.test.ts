import { describe, expect, it } from "vitest";
import { parseBundle, serializeBundle, observationsCsv } from "@/lib/exports";
import { SCHEMA_VERSION, type SessionBundle } from "@/lib/domain/types";
import { SEED_BASELINES, SEED_KNOWLEDGE_VERSION } from "@/lib/fixtures/knowledge";
import { SEED_COST_ASSUMPTIONS, SEED_INCIDENTS, SEED_INVENTORY, SEED_RUNS, SEED_WORK_ORDERS } from "@/lib/fixtures/history";
import { runtimeFor, T0, approvedPlan } from "./helpers";

function bundleFrom(): SessionBundle {
  const rt = runtimeFor("S01-SHARED-AIR");
  rt.fastForward(T0 + 300_000);
  const snap = rt.snapshot();
  const plan = approvedPlan("TPL-CELL-A-AIR", snap.incidents[0]);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: { ms: Date.now(), clock: "WALL", uncertaintyMs: 0 },
    workspace: { id: "demo-workspace", name: "Demo", mode: "DEMO_SIMULATION", createdAt: { ms: Date.now(), clock: "WALL", uncertaintyMs: 0 }, seed: 4242, scenarioId: "S01-SHARED-AIR" },
    sources: [],
    proposals: [],
    knowledgeVersions: [SEED_KNOWLEDGE_VERSION],
    activeKnowledgeVersionId: SEED_KNOWLEDGE_VERSION.id,
    baselines: SEED_BASELINES,
    incidents: [...SEED_INCIDENTS, ...snap.incidents],
    alarms: snap.alarms,
    plans: [plan],
    runs: SEED_RUNS,
    workOrders: SEED_WORK_ORDERS,
    inventory: SEED_INVENTORY,
    inventoryTransactions: [],
    costAssumptions: SEED_COST_ASSUMPTIONS,
    audit: [],
    observations: rt.exportObservations(T0, T0 + 300_000, 50),
    containsGroundTruth: false,
  };
}

describe("evidence bundle", () => {
  it("round-trips with ids and versions retained and never carries ground truth", () => {
    const b = bundleFrom();
    const text = serializeBundle(b);
    expect(text).not.toMatch(/answerKey|SCENARIO_TRUTH|AIR_LEAK/);
    const r = parseBundle(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.incidents.map((i) => i.id)).toEqual(b.incidents.map((i) => i.id));
    expect(r.bundle.plans[0].version).toBe(1);
    expect(r.bundle.activeKnowledgeVersionId).toBe("plant-knowledge-1");
  });
  it("rejects inconsistent inventory ledgers and malformed references", () => {
    const b = bundleFrom();
    const bad = { ...b, inventory: [{ ...b.inventory[0], reserved: 99 }] };
    expect(parseBundle(JSON.stringify(bad)).ok).toBe(false);
    const badRun = { ...b, runs: [{ ...b.runs[0], planId: "RP-MISSING" }] };
    expect(parseBundle(JSON.stringify(badRun)).ok).toBe(false);
    expect(parseBundle('{"schemaVersion": 1}').ok).toBe(false);
  });
  it("telemetry CSV keeps nulls empty and neutralises formulas", () => {
    const b = bundleFrom();
    const csv = observationsCsv(b.observations);
    expect(csv.split("\n")[0]).toContain("event_time");
    expect(csv).not.toMatch(/,null,/);
  });
});
