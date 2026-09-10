import { agentForIntent } from "./registry";
import { findProhibitedAction, scanPromptInjection } from "./security";
import type { AgentIntent, AgentRoute } from "./types";

interface IntentRule {
  intent: AgentIntent;
  patterns: readonly RegExp[];
  reason: string;
}

// Ordered from narrow/actionable to broad. This makes routing deterministic and
// testable while preserving the original natural-language request for audit.
const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: "DRAFT_KNOWLEDGE_CHANGE",
    patterns: [/\b(?:draft|propose|suggest)\b.{0,45}\b(?:knowledge|dependency|mapping|requirement|rule|edge)\b/i, /\bknowledge (?:change|proposal)\b/i],
    reason: "The request asks for a knowledge proposal draft.",
  },
  {
    intent: "DRAFT_RECOVERY_CHECKS",
    patterns: [/\b(?:draft|propose|build|create)\b.{0,35}\b(?:recovery|verification)\b/i, /\brecovery (?:check|plan|test)\b/i],
    reason: "The request asks for recovery checks or a recovery plan draft.",
  },
  {
    intent: "DRAFT_MAINTENANCE_WORK",
    patterns: [/\b(?:draft|propose|create|plan)\b.{0,35}\b(?:maintenance|work order|repair)\b/i, /\bwork order\b/i],
    reason: "The request asks for a maintenance work draft.",
  },
  {
    intent: "REVIEW_CONSISTENCY",
    patterns: [/\b(?:review|check|validate)\b.{0,35}\b(?:proposal|consistency|conflict|citation)\b/i, /\b(?:circular|contradictory|inconsistent)\b/i],
    reason: "The request asks for consistency review.",
  },
  {
    intent: "RESOLVE_ASSET_TAG",
    patterns: [/\b(?:resolve|map|match|identify)\b.{0,25}\b(?:asset|tag|alias|signal)\b/i, /\bunmatched tag\b/i],
    reason: "The request asks to resolve an asset or tag identity.",
  },
  {
    intent: "ANALYSE_DEPENDENCY",
    patterns: [/\b(?:dependency|depends on|upstream|downstream|feeds|prerequisite|relationship|path)\b/i],
    reason: "The request concerns plant dependencies.",
  },
  {
    intent: "EXPLAIN_DIAGNOSIS",
    patterns: [/\b(?:diagnos|root cause|why did|why is|fault|failure|cause|hypothesis)\w*\b/i],
    reason: "The request asks for an evidence-bound diagnostic explanation.",
  },
  {
    intent: "BUILD_REPORT",
    patterns: [/\b(?:report|summary|summarise|summarize|brief|export)\b/i],
    reason: "The request asks for a report or summary.",
  },
  {
    intent: "TRIAGE_INCIDENT",
    patterns: [/\b(?:triage|incident|alarm|outage|stoppage|affected cells?)\b/i],
    reason: "The request concerns incident triage.",
  },
  {
    intent: "FIND_EVIDENCE",
    patterns: [/\b(?:find|show|locate|cite|evidence|source|document|observation|reading)\b/i],
    reason: "The request asks to retrieve official evidence.",
  },
] as const;

export function routeIntent(text: string): AgentRoute {
  const injection = scanPromptInjection(text);
  const prohibitedAction = findProhibitedAction(text);
  if (prohibitedAction) {
    return {
      intent: "PROHIBITED_ACTION",
      agentId: agentForIntent("PROHIBITED_ACTION"),
      confidence: 1,
      reason: prohibitedAction,
      injectionDetected: injection.detected,
      prohibitedAction,
    };
  }

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return {
        intent: rule.intent,
        agentId: agentForIntent(rule.intent),
        confidence: rule.patterns.length > 1 ? 0.9 : 0.82,
        reason: rule.reason,
        injectionDetected: injection.detected,
      };
    }
  }

  return {
    intent: "GENERAL_QUESTION",
    agentId: agentForIntent("GENERAL_QUESTION"),
    confidence: 0.5,
    reason: "No specialist phrase matched; use bounded evidence retrieval.",
    injectionDetected: injection.detected,
  };
}
