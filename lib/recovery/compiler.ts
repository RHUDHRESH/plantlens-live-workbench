import type { DependencyEdge, FaultFamilyId, Incident, KnowledgeVersion, RecoveryCheck, RecoveryPlan, RecoveryRequirement, ReviewRecord, TimeStamp } from "@/lib/domain/types";
import { RECOVERY_TEMPLATES, type RecoveryTemplate } from "@/lib/fixtures/templates";

/**
 * Builds candidate plans from approved templates and the published knowledge version.
 * No generated code: the output is constrained JSON interpreted by lib/recovery/interpreter.ts.
 */

export function templatesFor(family: FaultFamilyId | undefined, cellId?: string): RecoveryTemplate[] {
  return RECOVERY_TEMPLATES.filter((t) => (!family || t.faultFamilies.includes(family)) && (!cellId || t.cellId === cellId || t.cellId === "PLANT"));
}

export interface CompileInput {
  template: RecoveryTemplate;
  incident: Incident;
  knowledge: KnowledgeVersion;
  baselineId: string;
  planId: string;
  version: number;
  now: TimeStamp;
}

export interface CompileResult {
  plan: RecoveryPlan;
  warnings: string[];
  errors: string[];
}

function requirementById(k: KnowledgeVersion, id: string): RecoveryRequirement | undefined {
  return k.requirements.find((r) => r.id === id);
}

export function compilePlan(input: CompileInput): CompileResult {
  const { template, incident, knowledge, baselineId, planId, version, now } = input;
  const warnings: string[] = [];
  const errors: string[] = [];
  const checks: RecoveryCheck[] = [];
  for (const c of template.checks) {
    const req = requirementById(knowledge, c.requirementRef);
    if (!req) errors.push(`${c.id}: requirement ${c.requirementRef} is not published in ${knowledge.id}.`);
    else if (req.reviewStatus !== "PUBLISHED" && req.reviewStatus !== "APPROVED") errors.push(`${c.id}: requirement ${c.requirementRef} is ${req.reviewStatus}, not published.`);
    if (c.kind === "DEPENDENCY_COVERAGE") {
      const missing = c.edgeIds.filter((id) => !knowledge.edges.some((e: DependencyEdge) => e.id === id && (e.reviewStatus === "PUBLISHED" || e.reviewStatus === "APPROVED")));
      if (missing.length) warnings.push(`${c.id}: dependency ${missing.join(", ")} is not published in ${knowledge.id}; the coverage check will be INCONCLUSIVE until it is.`);
    }
    checks.push(structuredClone(c));
  }
  const plan: RecoveryPlan = {
    id: planId,
    version,
    status: "DRAFT",
    incidentId: incident.id,
    knowledgeVersion: knowledge.id,
    baselineVersion: baselineId,
    scope: {
      cellId: template.cellId,
      recipe: template.recipe,
      mode: "AUTO",
      requiredCompleteCycles: template.requiredCompleteCycles,
      commandedSpeedRpm: (template.checks.find((c) => c.kind === "MODE_REQUIRED") as Extract<RecoveryCheck, { kind: "MODE_REQUIRED" }> | undefined)?.commandedSpeedRpm,
    },
    requiredEvidence: template.requiredEvidence.slice(),
    checks,
    incidentEvidenceSnapshot: incident.diagnosis?.evidence.map((e) => e.id) ?? [],
    healthyReferenceId: baselineId,
    validityLimits: template.validityLimits.slice(),
    approval: null,
    warning: "Fictional demonstration conditions, not industrial acceptance standards",
    createdAt: now,
    templateIds: [template.id],
    checkJustifications: { ...template.justifications },
  };
  return { plan, warnings, errors };
}

/** Editing thresholds/modes/requirements creates a new version and invalidates prior approval. */
export function revisePlan(previous: RecoveryPlan, edits: { checks?: RecoveryCheck[]; scope?: Partial<RecoveryPlan["scope"]> }, now: TimeStamp, reason: string): { previous: RecoveryPlan; next: RecoveryPlan } {
  const superseded: RecoveryPlan = { ...previous, status: "SUPERSEDED", invalidationReason: `Superseded by version ${previous.version + 1}: ${reason}` };
  const next: RecoveryPlan = {
    ...structuredClone(previous),
    version: previous.version + 1,
    status: "DRAFT",
    approval: null,
    invalidationReason: undefined,
    createdAt: now,
    checks: edits.checks ? structuredClone(edits.checks) : structuredClone(previous.checks),
    scope: { ...previous.scope, ...(edits.scope ?? {}) },
  };
  return { previous: superseded, next };
}

export function approvePlan(plan: RecoveryPlan, approval: ReviewRecord): RecoveryPlan {
  if (plan.status !== "DRAFT") throw new Error(`Plan ${plan.id} v${plan.version} is ${plan.status}; only DRAFT plans can be approved.`);
  return { ...plan, status: "APPROVED", approval };
}

/** A knowledge publish that changes covered edges/requirements invalidates outstanding approvals. */
export function invalidateForKnowledgeChange(plan: RecoveryPlan, changedIds: string[], newVersionId: string): RecoveryPlan | null {
  const refs = new Set<string>();
  for (const c of plan.checks) {
    refs.add(c.requirementRef);
    if (c.kind === "DEPENDENCY_COVERAGE") c.edgeIds.forEach((e) => refs.add(e));
  }
  const hit = changedIds.filter((id) => refs.has(id));
  if (!hit.length || plan.status !== "APPROVED") return null;
  return { ...plan, status: "INVALIDATED", invalidationReason: `Knowledge version ${newVersionId} changed ${hit.join(", ")}; approval invalidated and a migration review task created.` };
}

export function planRequirementTitles(plan: RecoveryPlan, knowledge: KnowledgeVersion): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of plan.checks) out[c.id] = requirementById(knowledge, c.requirementRef)?.title ?? c.requirementRef;
  return out;
}
