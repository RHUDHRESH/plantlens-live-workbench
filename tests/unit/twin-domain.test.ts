import { describe, expect, it } from "vitest";
import {
  CORE_ASSET_CLASS_TEMPLATES,
  TwinProposalQueue,
  createConfigProposal,
  createInductionMotorDemoPlant,
  projectTwinSnapshot,
  validateTopology,
} from "@/lib/twin";

describe("configurable twin domain", () => {
  it("ships ten versioned core templates and a projectable induction-motor demo", () => {
    const demo = createInductionMotorDemoPlant(1000);
    expect(CORE_ASSET_CLASS_TEMPLATES).toHaveLength(15);
    expect(demo.topology.assetInstances.map((asset) => asset.id)).toEqual(["PLC-01", "VFD-01", "MTR-01", "PMP-01", "TK-01"]);
    const motor = projectTwinSnapshot(demo.topology, demo.readings, 1001).assets.find((asset) => asset.asset.id === "MTR-01")!;
    expect(motor.signals.find((signal) => signal.signalId === "MTR-01.speed_rpm")?.value).toBe(1470);
  });

  it("rejects arbitrary/non-numeric transforms and duplicate bindings", () => {
    const demo = createInductionMotorDemoPlant();
    const bad = {
      ...demo.topology,
      channelBindings: [...demo.topology.channelBindings, { id: "BAD", signalId: "MTR-01.running", sourceId: "x", channel: "y", transform: { kind: "AFFINE" as const, multiplier: 0, offset: Number.NaN } }],
    };
    const validation = validateTopology(bad, demo.configuration.classVersions);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/positive|NUMBER|finite/);
  });

  it("serializes immutable proposal review and keeps an auditable chain", () => {
    const demo = createInductionMotorDemoPlant(1000);
    const queue = new TwinProposalQueue(demo.configuration);
    const proposedTopology = { ...demo.topology, id: "induction-motor-demo-draft", name: "Renamed plant", version: undefined, contentHash: undefined, createdAtMs: undefined, createdBy: undefined };
    const proposal = createConfigProposal({ id: "PROP-1", configurationId: demo.configuration.id, baseRevision: 1, title: "Rename", rationale: "Clearer name", submittedBy: "engineer", submittedAtMs: 1100, proposedTopology }, demo.configuration.classVersions);
    queue.submit(proposal);
    expect(Object.isFrozen(proposal)).toBe(true);
    queue.beginNext("reviewer", 1200);
    expect(() => queue.beginNext("reviewer", 1201)).toThrow(/already/);
    const result = queue.approve("PROP-1", "reviewer", 1300);
    expect(result.configuration.activeTopology.name).toBe("Renamed plant");
    expect(result.configuration.activeTopology.version).toBe(2);
    expect(queue.verifyAuditChain()).toBe(true);
  });

  it("rejects with a reason and preserves edits as a new queued proposal", () => {
    const demo = createInductionMotorDemoPlant(1000);
    const queue = new TwinProposalQueue(demo.configuration);
    const draft = { ...demo.topology, id: "draft-1" };
    const first = createConfigProposal({ id: "PROP-ORIGINAL", configurationId: demo.configuration.id, baseRevision: 1, title: "Original", rationale: "Needs a review", submittedBy: "engineer", submittedAtMs: 1100, proposedTopology: draft }, demo.configuration.classVersions);
    const replacement = createConfigProposal({ id: "PROP-REPLACEMENT", configurationId: demo.configuration.id, baseRevision: 1, title: "Replacement", rationale: "Corrected", submittedBy: "engineer", submittedAtMs: 1200, proposedTopology: { ...draft, id: "draft-2", name: "Corrected plant" } }, demo.configuration.classVersions);
    queue.submit(first);
    queue.beginNext("reviewer", 1150);
    queue.edit("PROP-ORIGINAL", replacement, "reviewer", 1250, "Clarified scope");
    expect(queue.proposals.find((record) => record.proposal.id === "PROP-ORIGINAL")?.state).toBe("EDITED");
    queue.beginNext("reviewer", 1300);
    expect(() => queue.reject("PROP-REPLACEMENT", "reviewer", 1350, "")).toThrow(/reason/);
    expect(queue.reject("PROP-REPLACEMENT", "reviewer", 1350, "Duplicate topology").state).toBe("REJECTED");
    expect(queue.verifyAuditChain()).toBe(true);
  });
});
