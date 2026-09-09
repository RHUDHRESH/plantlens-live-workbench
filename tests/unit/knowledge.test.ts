import { describe, expect, it } from "vitest";
import { runLocalPipeline, validateEdge, findDiagnosticCycle } from "@/lib/knowledge/pipeline";
import { publishVersion, reviewProposal, dependencyMatrix, diffVersions } from "@/lib/knowledge/versions";
import { parseFile } from "@/lib/sources/parsers";
import { buildSamplePack } from "@/lib/fixtures/pack";
import { SEED_KNOWLEDGE_VERSION, PROPOSED_EDGE_AIR_CNC02 } from "@/lib/fixtures/knowledge";
import { ASSETS } from "@/lib/domain/plant";
import { runtimeFor, review, T0 } from "./helpers";
import type { DependencyEdge } from "@/lib/domain/types";

const now = { ms: T0, clock: "WALL" as const, uncertaintyMs: 0 };

function parsedPack() {
  const pack = buildSamplePack();
  return pack.files.filter((f) => f.name !== "operating_trace.csv").map((f, i) => parseFile(`SRC-${i}`, f.name, f.text, now));
}

describe("local pipeline over the sample pack", () => {
  const files = parsedPack();
  const { proposals, stages } = runLocalPipeline(files, SEED_KNOWLEDGE_VERSION, now);

  it("surfaces the real document conflict (4.5 vs 5.5 bar)", () => {
    const c = proposals.find((p) => p.kind === "SOURCE_CONFLICT");
    expect(c).toBeTruthy();
    expect(c!.payload.kind === "SOURCE_CONFLICT" && c!.payload.options.map((o) => o.value)).toEqual(expect.arrayContaining(["4.5 bar", "5.5 bar"]));
  });

  it("flags the ambiguous alias, the unmatched tag, the missing channel, the uncited draft, and the untrusted instruction", () => {
    expect(proposals.find((p) => p.kind === "ALIAS_MERGE" && p.payload.kind === "ALIAS_MERGE" && p.payload.mapping.alias === "CoolantPump")?.state).toBe("NEEDS_REVIEW");
    expect(proposals.some((p) => p.kind === "UNMATCHED_TAG")).toBe(true);
    expect(proposals.some((p) => p.kind === "MISSING_CHANNEL")).toBe(true);
    expect(proposals.some((p) => p.kind === "UNCITED_DRAFT")).toBe(true);
    const inj = proposals.find((p) => p.kind === "UNTRUSTED_INSTRUCTION");
    expect(inj?.state).toBe("REJECTED");
    expect(() => reviewProposal(inj!, review(), undefined)).toThrow();
  });

  it("proposes the cell B pneumatic edge as needing review and every citation resolves to real lines", () => {
    const e = proposals.find((p) => p.id === "PROP-EDGE-DEP-AIR-CNC-02");
    expect(e?.state).toBe("NEEDS_REVIEW");
    for (const p of proposals) for (const s of p.evidence) {
      const d = files.find((f) => f.document.id === s.sourceId)!.document;
      expect(d.lines.slice(s.startLine - 1, s.endLine).join("").trim().length).toBeGreaterThan(0);
    }
    expect(stages.map((s) => s.stage)).toEqual(["SOURCE_PARSER", "ASSET_TAG_RESOLVER", "DEPENDENCY_PROPOSER", "CONSISTENCY_REVIEWER", "RECOVERY_CHECK_DRAFTER"]);
  });

  it("rejects a fabricated citation location", () => {
    const bad: DependencyEdge = { ...PROPOSED_EDGE_AIR_CNC02, evidenceRefs: [{ sourceId: files[0].document.id, startLine: 9999, endLine: 10000 }] };
    const v = validateEdge(bad, files.map((f) => f.document), SEED_KNOWLEDGE_VERSION);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/outside the document/);
  });

  it("an uncited draft cannot be approved", () => {
    const u = proposals.find((p) => p.kind === "UNCITED_DRAFT")!;
    expect(() => reviewProposal(u, review())).toThrow(/uncited/);
  });
});

describe("versions and runtime isolation", () => {
  it("an unapproved proposed edge never affects runtime results; publishing it does", () => {
    const before = runtimeFor("S01-SHARED-AIR");
    before.fastForward(T0 + 420_000);
    const incBefore = before.incidentsList().find((i) => i.sharedCauseAssetId === "AIR-HDR-01")!;
    expect(incBefore.observedAssetIds).not.toContain("CNC-02");

    const proposal = { id: "P", kind: "DEPENDENCY_EDGE" as const, title: "", state: "APPROVED" as const, producedBy: "HUMAN" as const, pipeline: "HUMAN" as const, createdAt: now, evidence: PROPOSED_EDGE_AIR_CNC02.evidenceRefs, rationale: "", validation: { ok: true, errors: [], warnings: [] }, payload: { kind: "DEPENDENCY_EDGE" as const, edge: PROPOSED_EDGE_AIR_CNC02 }, changeSummary: [], review: review() };
    const { next, superseded } = publishVersion(SEED_KNOWLEDGE_VERSION, [proposal], "sup", "test", now);
    expect(next.id).toBe("plant-knowledge-2");
    expect(superseded.status).toBe("SUPERSEDED");
    // Published version is immutable: the seed object is untouched.
    expect(SEED_KNOWLEDGE_VERSION.edges.some((e) => e.id === "DEP-AIR-CNC-02")).toBe(false);
    expect(next.edges.some((e) => e.id === "DEP-AIR-CNC-02" && e.reviewStatus === "PUBLISHED")).toBe(true);

    const after = runtimeFor("S01-SHARED-AIR", 4242, next);
    after.fastForward(T0 + 420_000);
    const incAfter = after.incidentsList().find((i) => i.sharedCauseAssetId === "AIR-HDR-01")!;
    expect(incAfter.observedAssetIds).toContain("CNC-02");
  });

  it("matrix and graph read the same records", () => {
    const cells = dependencyMatrix(SEED_KNOWLEDGE_VERSION, ASSETS.map((a) => a.id));
    const fromMatrix = Object.values(cells).flatMap((c) => c.edges.map((e) => e.id)).sort();
    const fromGraph = SEED_KNOWLEDGE_VERSION.edges.map((e) => e.id).sort();
    expect(fromMatrix).toEqual(fromGraph);
    expect(cells["FAN-01|CNC-01"].noDependency).toBe(true);
  });

  it("distinguishes a physical feedback relationship from an invalid same-time diagnostic cycle", () => {
    expect(findDiagnosticCycle(SEED_KNOWLEDGE_VERSION.edges)).toBeNull();
    const bad: DependencyEdge = { ...SEED_KNOWLEDGE_VERSION.edges.find((e) => e.id === "DEP-PUMP-SPN-01")!, id: "X", from: "SPN-01", to: "PUMP-01", physicalFeedback: false };
    const v = validateEdge(bad, [], SEED_KNOWLEDGE_VERSION);
    expect(v.warnings.join(" ") + v.errors.join(" ")).toMatch(/loop|circular/i);
  });

  it("diff reports what a publish changed", () => {
    const proposal = { id: "P", kind: "DEPENDENCY_EDGE" as const, title: "", state: "APPROVED" as const, producedBy: "HUMAN" as const, pipeline: "HUMAN" as const, createdAt: now, evidence: PROPOSED_EDGE_AIR_CNC02.evidenceRefs, rationale: "", validation: { ok: true, errors: [], warnings: [] }, payload: { kind: "DEPENDENCY_EDGE" as const, edge: PROPOSED_EDGE_AIR_CNC02 }, changeSummary: [], review: review() };
    const { next } = publishVersion(SEED_KNOWLEDGE_VERSION, [proposal], "sup", "test", now);
    const d = diffVersions(SEED_KNOWLEDGE_VERSION, next);
    expect(d.addedEdges.map((e) => e.id)).toEqual(["DEP-AIR-CNC-02"]);
  });
});
