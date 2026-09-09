import type { KnowledgeVersion, RecoveryPlan } from "@/lib/domain/types";

/**
 * Recovery coverage matrix R: rows are approved requirements / affected dependencies,
 * columns are checks in a plan. Uncovered required relationships stay visible.
 */

export interface CoverageCell {
  rowId: string;
  checkId: string;
  covered: boolean;
  mode?: string;
}

export interface CoverageMatrix {
  rows: Array<{ id: string; kind: "REQUIREMENT" | "EDGE"; title: string }>;
  columns: Array<{ id: string; kind: string }>;
  cells: CoverageCell[];
  uncovered: Array<{ id: string; kind: "REQUIREMENT" | "EDGE"; title: string; reason: string }>;
}

export function coverageMatrix(plan: RecoveryPlan, knowledge: KnowledgeVersion, affectedEdgeIds: string[]): CoverageMatrix {
  const reqIds = Array.from(new Set(plan.checks.map((c) => c.requirementRef)));
  const rows: CoverageMatrix["rows"] = [];
  for (const id of reqIds) {
    const r = knowledge.requirements.find((x) => x.id === id);
    rows.push({ id, kind: "REQUIREMENT", title: r?.title ?? `${id} (not published)` });
  }
  const edgeIds = Array.from(new Set([...affectedEdgeIds, ...plan.checks.flatMap((c) => (c.kind === "DEPENDENCY_COVERAGE" ? c.edgeIds : []))]));
  for (const id of edgeIds) {
    const e = knowledge.edges.find((x) => x.id === id);
    rows.push({ id, kind: "EDGE", title: e?.summary ?? `${id} (not published)` });
  }
  const columns = plan.checks.map((c) => ({ id: c.id, kind: c.kind }));
  const cells: CoverageCell[] = [];
  for (const row of rows) {
    for (const c of plan.checks) {
      let covered = false;
      if (row.kind === "REQUIREMENT") covered = c.requirementRef === row.id;
      else if (c.kind === "DEPENDENCY_COVERAGE") covered = c.edgeIds.includes(row.id);
      else {
        const req = knowledge.requirements.find((r) => r.id === c.requirementRef);
        covered = !!req && req.coversEdgeIds.includes(row.id);
      }
      cells.push({ rowId: row.id, checkId: c.id, covered, mode: plan.scope.mode });
    }
  }
  const uncovered = rows
    .filter((row) => !cells.some((c) => c.rowId === row.id && c.covered))
    .map((row) => ({ ...row, reason: row.kind === "EDGE" ? "No check in this plan covers this affected dependency." : "No check references this requirement." }));
  return { rows, columns, cells, uncovered };
}
