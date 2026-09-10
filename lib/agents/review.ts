import type { AgentProposalDraft, ProposalReviewState } from "./types";

export interface HumanProposalDecision {
  proposalId: string;
  decision: Extract<ProposalReviewState, "APPROVED" | "REJECTED" | "DEFERRED">;
  reviewer: string;
  reason: string;
  decidedAtMs: number;
}

export interface ReviewedProposal {
  proposal: AgentProposalDraft;
  decision: HumanProposalDecision;
}

/**
 * In-memory orchestration primitive with an explicit single active review slot.
 * Persistence/UI layers can serialise its snapshot, but cannot begin a second review.
 */
export class SequentialProposalReviewQueue {
  private readonly pending: AgentProposalDraft[] = [];
  private readonly completed: ReviewedProposal[] = [];
  private active: AgentProposalDraft | null = null;

  constructor(initial: readonly AgentProposalDraft[] = []) {
    for (const proposal of initial) this.enqueue(proposal);
  }

  enqueue(proposal: AgentProposalDraft): void {
    if (proposal.state !== "AWAITING_REVIEW") throw new Error("Only AWAITING_REVIEW proposal drafts can be queued.");
    if (this.has(proposal.id)) throw new Error(`Proposal ${proposal.id} is already in the review queue.`);
    this.pending.push(structuredClone(proposal));
  }

  beginNext(): AgentProposalDraft | null {
    if (this.active) return structuredClone(this.active);
    const next = this.pending.shift();
    if (!next) return null;
    this.active = { ...next, state: "IN_REVIEW" };
    return structuredClone(this.active);
  }

  decide(decision: HumanProposalDecision): ReviewedProposal {
    if (!this.active) throw new Error("No proposal is currently in review.");
    if (decision.proposalId !== this.active.id) throw new Error(`Proposal ${decision.proposalId} is not the active review (${this.active.id}).`);
    if (!decision.reviewer.trim() || !decision.reason.trim()) throw new Error("A named human reviewer and reason are required.");
    const reviewed: ReviewedProposal = {
      proposal: { ...this.active, state: decision.decision },
      decision: { ...decision },
    };
    this.completed.push(reviewed);
    this.active = null;
    return structuredClone(reviewed);
  }

  snapshot(): { pending: AgentProposalDraft[]; active: AgentProposalDraft | null; completed: ReviewedProposal[] } {
    return structuredClone({ pending: this.pending, active: this.active, completed: this.completed });
  }

  private has(id: string): boolean {
    return this.active?.id === id || this.pending.some((proposal) => proposal.id === id) || this.completed.some((item) => item.proposal.id === id);
  }
}
