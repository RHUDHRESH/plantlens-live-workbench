import { describe, expect, it } from "vitest";
import { SequentialProposalReviewQueue } from "@/lib/agents";
import type { AgentProposalDraft, OfficialEvidence } from "@/lib/agents";

const source: OfficialEvidence = {
  id: "SRC-1:1",
  official: true,
  kind: "SOURCE_DOCUMENT",
  title: "Source",
  excerpt: "A cited fact.",
  locator: "/source/1#line=1",
};

function proposal(id: string): AgentProposalDraft {
  return {
    id,
    category: "KNOWLEDGE_CHANGE",
    title: id,
    summary: "Draft only",
    claims: [{ text: "A cited fact", evidenceIds: [source.id] }],
    evidence: [source],
    proposedBy: "KNOWLEDGE_PROPOSER",
    state: "AWAITING_REVIEW",
    createdAtMs: 1,
    limitations: [],
  };
}

describe("sequential proposal review", () => {
  it("allows exactly one active proposal and advances only after a human decision", () => {
    const queue = new SequentialProposalReviewQueue([proposal("P-1"), proposal("P-2")]);
    expect(queue.beginNext()?.id).toBe("P-1");
    expect(queue.beginNext()?.id).toBe("P-1");
    expect(queue.snapshot().pending.map((item) => item.id)).toEqual(["P-2"]);

    expect(() => queue.decide({ proposalId: "P-2", decision: "APPROVED", reviewer: "Supervisor A", reason: "Reviewed", decidedAtMs: 2 })).toThrow(/not the active review/);
    expect(() => queue.decide({ proposalId: "P-1", decision: "APPROVED", reviewer: "", reason: "Reviewed", decidedAtMs: 2 })).toThrow(/human reviewer/);

    const completed = queue.decide({ proposalId: "P-1", decision: "APPROVED", reviewer: "Supervisor A", reason: "Evidence and scope checked", decidedAtMs: 2 });
    expect(completed.proposal.state).toBe("APPROVED");
    expect(queue.beginNext()?.id).toBe("P-2");
    expect(queue.snapshot().active?.state).toBe("IN_REVIEW");
  });

  it("rejects duplicate and non-reviewable queue entries", () => {
    const queue = new SequentialProposalReviewQueue([proposal("P-1")]);
    expect(() => queue.enqueue(proposal("P-1"))).toThrow(/already/);
    expect(() => queue.enqueue({ ...proposal("P-2"), state: "APPROVED" })).toThrow(/AWAITING_REVIEW/);
  });
});
