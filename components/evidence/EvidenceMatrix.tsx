"use client";

import type { EvidenceItem, FaultCandidate } from "@/lib/domain/types";
import { relationLabel } from "@/lib/diagnosis/engine";
import { Badge, Callout, Table, Td, Th, Tip, type Tone } from "@/components/ui";

/**
 * Fault–evidence matrix: rows are evidence items, columns are ranked candidates. Each cell
 * shows the recorded relation with its reason. Evidence that is not linked to a candidate is
 * shown as "—" (not considered), never as a contradiction.
 */

function relationTone(r: string): Tone {
  switch (r) {
    case "SUPPORT":
      return "green";
    case "CONTRADICT":
      return "red";
    case "PENDING":
      return "amber";
    default:
      return "grey";
  }
}

export function EvidenceMatrix({ evidence, candidates, missingInputs, onSelectEvidence }: { evidence: EvidenceItem[]; candidates: FaultCandidate[]; missingInputs: string[]; onSelectEvidence?: (id: string) => void }) {
  if (!evidence.length || !candidates.length) {
    return <p className="text-[13px] text-muted">No evidence–candidate relations recorded for this diagnosis.</p>;
  }
  return (
    <div className="space-y-3">
      <Table>
        <thead>
          <tr>
            <Th>Evidence</Th>
            {candidates.map((c) => (
              <Th key={c.family}>
                <span className="block">
                  #{c.rank} {c.title}
                </span>
                <span className="mono font-normal">{c.family}</span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evidence.map((e) => (
            <tr key={e.id}>
              <Td>
                {onSelectEvidence ? (
                  <button type="button" className="text-left underline decoration-border-strong underline-offset-2 hover:text-accent" onClick={() => onSelectEvidence(e.id)}>
                    {e.title}
                  </button>
                ) : (
                  e.title
                )}
                <span className="mono block text-[11px] text-muted">
                  {e.tagId} · group {e.group}
                </span>
              </Td>
              {candidates.map((c) => {
                const link = c.links.find((l) => l.evidenceId === e.id);
                if (!link) {
                  return (
                    <Td key={c.family} className="text-muted">
                      —
                    </Td>
                  );
                }
                return (
                  <Td key={c.family}>
                    <Tip content={link.reason}>
                      <span>
                        <Badge tone={relationTone(link.relation)}>{relationLabel(link.relation)}</Badge>
                      </span>
                    </Tip>
                    <span className="mt-1 block max-w-[28ch] text-[12px] text-muted">{link.reason}</span>
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
      <Callout tone="grey" title="Missing evidence is unavailable, not contradictory">
        {missingInputs.length ? (
          <ul className="mt-1 list-disc pl-4">
            {missingInputs.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
          <p>No missing inputs recorded for this diagnosis.</p>
        )}
      </Callout>
    </div>
  );
}
