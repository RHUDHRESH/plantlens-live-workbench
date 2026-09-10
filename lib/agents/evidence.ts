import { redactSensitiveText } from "./security";
import type { AgentAbstention, AgentId, AgentProposalDraft, OfficialEvidence, ProposalCategory, ProposalClaim } from "./types";

export interface ProposalDraftInput {
  id: string;
  category: ProposalCategory;
  title: string;
  summary: string;
  claims: readonly ProposalClaim[];
  evidence: readonly OfficialEvidence[];
  proposedBy: AgentId;
  createdAtMs: number;
  limitations?: readonly string[];
}

export type ProposalDraftResult = { ok: true; proposal: AgentProposalDraft } | { ok: false; abstention: AgentAbstention };

export function validateOfficialEvidence(evidence: readonly OfficialEvidence[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of evidence) {
    if (item.official !== true) errors.push(`${item.id || "Evidence"} is not marked as an official record.`);
    if (!item.id.trim()) errors.push("Evidence id is required.");
    if (ids.has(item.id)) errors.push(`Duplicate evidence id ${item.id}.`);
    ids.add(item.id);
    if (!item.excerpt.trim()) errors.push(`${item.id} has no evidence excerpt.`);
    if (!item.locator.trim()) errors.push(`${item.id} has no resolvable locator.`);
  }
  return errors;
}

export function createProposalDraft(input: ProposalDraftInput): ProposalDraftResult {
  if (!input.evidence.length) {
    return {
      ok: false,
      abstention: {
        kind: "ABSTENTION",
        reason: "A proposal cannot be drafted without official evidence.",
        missingEvidence: ["At least one official PlantLens record with a resolvable locator"],
        suggestedReadTools: ["read_source_excerpts", "read_knowledge"],
      },
    };
  }

  const evidenceErrors = validateOfficialEvidence(input.evidence);
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const uncitedClaims = input.claims
    .filter((claim) => !claim.evidenceIds.length || claim.evidenceIds.some((id) => !evidenceIds.has(id)))
    .map((claim) => claim.text);
  if (evidenceErrors.length || !input.claims.length || uncitedClaims.length) {
    return {
      ok: false,
      abstention: {
        kind: "ABSTENTION",
        reason: "The proposed change is not fully supported by supplied official evidence.",
        missingEvidence: [
          ...evidenceErrors,
          ...(!input.claims.length ? ["At least one explicit, cited claim"] : []),
          ...uncitedClaims.map((claim) => `A valid citation for claim: ${claim}`),
        ],
        suggestedReadTools: ["read_source_excerpts", "read_knowledge"],
      },
    };
  }

  const sanitisedEvidence = input.evidence.map((item) => ({
    ...item,
    title: redactSensitiveText(item.title),
    excerpt: redactSensitiveText(item.excerpt),
  }));
  return {
    ok: true,
    proposal: {
      id: input.id,
      category: input.category,
      title: redactSensitiveText(input.title),
      summary: redactSensitiveText(input.summary),
      claims: input.claims.map((claim) => ({ text: redactSensitiveText(claim.text), evidenceIds: [...claim.evidenceIds] })),
      evidence: sanitisedEvidence,
      proposedBy: input.proposedBy,
      state: "AWAITING_REVIEW",
      createdAtMs: input.createdAtMs,
      limitations: (input.limitations ?? []).map(redactSensitiveText),
    },
  };
}

export function abstainForMissingEvidence(intent: string): AgentAbstention {
  return {
    kind: "ABSTENTION",
    reason: `Official evidence is required before PlantLens can ${intent}.`,
    missingEvidence: ["Relevant official records or source excerpts"],
    suggestedReadTools: ["read_source_excerpts", "read_incidents", "read_knowledge"],
  };
}
