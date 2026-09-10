"use client";

import Link from "next/link";
import type { Diagnosis, EvidenceItem } from "@/lib/domain/types";
import { formatIst } from "@/lib/util";
import { Badge, Card, CardBody, CardHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { EvidenceDrawer } from "@/components/evidence/EvidenceDrawer";
import { EvidenceMatrix } from "@/components/evidence/EvidenceMatrix";
import { assetName, formatUncertainty, resolveEvidenceId, tagLabel } from "./helpers";

/** Evidence tab: ledger, drawer for the selected item, and the fault–evidence matrix. */

export function EvidenceTab({ d, selectedId: selectedParam, onSelect }: { d: Diagnosis; selectedId: string | null; onSelect: (id: string | null) => void }) {
  // Ids drift with the diagnosis window, so the URL parameter is resolved against the live ledger.
  const selectedId = resolveEvidenceId(d.evidence, selectedParam);
  const selected: EvidenceItem | null = d.evidence.find((e) => e.id === selectedId) ?? null;
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Evidence ledger" description="Every item cites its window, its reference, and whether its ordering relative to other items is reliable." />
        <CardBody className="p-0">
          {d.evidence.length ? (
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Evidence</Th>
                  <Th>Asset</Th>
                  <Th>Tag</Th>
                  <Th>Quality</Th>
                  <Th>Observed vs reference</Th>
                  <Th>Window (IST)</Th>
                  <Th>Onset</Th>
                  <Th>Group</Th>
                  <Th>Ordering</Th>
                </tr>
              </thead>
              <tbody>
                {d.evidence.map((e) => (
                  <tr key={e.id} className={e.id === selectedId ? "bg-accent-soft/40" : undefined} aria-selected={e.id === selectedId}>
                    <Td>
                      <button type="button" className="text-left underline decoration-border-strong underline-offset-2 hover:text-accent" onClick={() => onSelect(e.id)}>
                        {e.title}
                      </button>
                      <span className="mono block text-[11px] text-muted">{e.id}</span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Link href={`/plant/${e.assetId}`} className="hover:text-accent">
                        {e.assetId}
                      </Link>
                      <span className="block text-[11px] text-muted">{assetName(e.assetId)}</span>
                    </Td>
                    <Td className="mono whitespace-nowrap">{tagLabel(e.tagId)}</Td>
                    <Td>
                      <StatusBadge value={e.quality} />
                    </Td>
                    <Td className="tnum">
                      <span className="block">{e.observedValue ?? "—"}</span>
                      <span className="block text-[11px] text-muted">ref: {e.referenceValue ?? "—"}</span>
                    </Td>
                    <Td className="mono whitespace-nowrap text-[12px]">
                      {formatIst(e.window.startMs, { seconds: true })} – {formatIst(e.window.endMs, { seconds: true })}
                    </Td>
                    <Td className="mono whitespace-nowrap text-[12px]">{e.onsetMs !== undefined ? `${formatIst(e.onsetMs, { seconds: true })} ${formatUncertainty(e.onsetUncertaintyMs)}` : <span className="text-muted">—</span>}</Td>
                    <Td className="mono">{e.group}</Td>
                    <Td>{e.orderingReliable ? <Badge tone="green">reliable</Badge> : <Badge tone="amber">not reliable</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted">No evidence items recorded for this diagnosis.</p>
          )}
          <p className="px-3 py-2 text-[12px] text-muted">Correlated channels share a group and count once.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Fault–evidence matrix" description="How each candidate relates to each evidence item, with the recorded reason." />
        <CardBody>
          <EvidenceMatrix evidence={d.evidence} candidates={d.candidates} missingInputs={d.missingInputs} onSelectEvidence={onSelect} />
        </CardBody>
      </Card>

      <EvidenceDrawer item={selected} open={selected !== null} onOpenChange={(v) => !v && onSelect(null)} />
    </div>
  );
}
