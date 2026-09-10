"use client";

import { Check } from "lucide-react";
import type { CoverageMatrix } from "@/lib/recovery/coverage";
import { Badge, Callout, Table, Td, Th } from "@/components/ui";
import { CHECK_KIND_LABEL } from "./helpers";
import type { RecoveryCheckKind } from "@/lib/domain/types";

/** Requirement/edge × check grid. A blank cell is not evidence; the uncovered list stays visible. */
export function CoverageGrid({ matrix, highlightCheckId }: { matrix: CoverageMatrix; highlightCheckId?: string | null }) {
  return (
    <div className="space-y-3">
      {matrix.uncovered.length ? (
        <Callout tone="amber" title="Required coverage not met">
          <ul className="list-disc space-y-0.5 pl-5">
            {matrix.uncovered.map((u) => (
              <li key={u.id}>
                <span className="mono">{u.id}</span> ({u.kind.toLowerCase()}) — {u.title}. {u.reason}
              </li>
            ))}
          </ul>
        </Callout>
      ) : (
        <Callout tone="green" title="Every listed requirement and affected dependency is covered by at least one check">
          Coverage says a check exists, not that it passed. Outcomes come from runs.
        </Callout>
      )}
      <Table>
        <thead>
          <tr>
            <Th className="sticky left-0 z-10 min-w-56">Requirement / dependency</Th>
            {matrix.columns.map((c) => (
              <Th key={c.id} className={`whitespace-nowrap text-center ${highlightCheckId === c.id ? "bg-accent-soft" : ""}`}>
                <span className="mono block">{c.id}</span>
                <span className="block text-[11px] font-normal">{CHECK_KIND_LABEL[c.kind as RecoveryCheckKind] ?? c.kind}</span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => {
            const rowCells = matrix.cells.filter((c) => c.rowId === row.id);
            const covered = rowCells.some((c) => c.covered);
            return (
              <tr key={row.id} className={covered ? undefined : "bg-amber-soft/40"}>
                <Td className="sticky left-0 z-10 bg-surface">
                  <div className="flex items-start gap-2">
                    <Badge tone={row.kind === "EDGE" ? "accent" : "neutral"}>{row.kind === "EDGE" ? "edge" : "req"}</Badge>
                    <div className="min-w-0">
                      <span className="mono block text-[12px]">{row.id}</span>
                      <span className="block text-[12px] text-muted">{row.title}</span>
                    </div>
                  </div>
                </Td>
                {matrix.columns.map((col) => {
                  const cell = rowCells.find((c) => c.checkId === col.id);
                  return (
                    <Td key={col.id} className={`text-center ${highlightCheckId === col.id ? "bg-accent-soft" : ""}`}>
                      {cell?.covered ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-green">
                          <Check size={14} aria-hidden /> covers{cell.mode ? <span className="text-muted">({cell.mode})</span> : null}
                        </span>
                      ) : (
                        <span className="text-muted" aria-label="not covered">
                          ·
                        </span>
                      )}
                    </Td>
                  );
                })}
              </tr>
            );
          })}
          {!matrix.rows.length ? (
            <tr>
              <Td colSpan={matrix.columns.length + 1} className="text-center text-muted">
                No requirements or affected dependencies to cover.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
