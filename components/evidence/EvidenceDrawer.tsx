"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EvidenceItem, Observation } from "@/lib/domain/types";
import { useApp } from "@/store/app";
import { formatIst } from "@/lib/util";
import { Badge, Dialog, KeyValue, LoadingState, StatusBadge, Table, Td, Th } from "@/components/ui";
import { assetName, formatUncertainty, stableEvidenceKey, tagLabel } from "@/components/incidents/helpers";

/**
 * Right-side drawer for one evidence item: description, reference, and the backing
 * observations fetched from the engine by id. Observations are shown verbatim with their
 * quality and source; nothing is interpolated.
 */

function observationValue(o: Observation): string {
  const v = o.value.value;
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}

export function EvidenceDrawer({ item, open, onOpenChange }: { item: EvidenceItem | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const observations = useApp((s) => s.observations);
  // Rows are keyed by the stable evidence key (ids drift with the diagnosis window), so a newly
  // selected item shows the loading state without resetting state inside the effect, and a
  // recompute of the same item keeps the previous rows until the refetch lands.
  const [loaded, setLoaded] = useState<{ key: string; rows: Observation[] } | null>(null);

  const itemKey = item ? stableEvidenceKey(item.id) : undefined;
  // The snapshot re-creates arrays on every tick; depend on the content, not the identity.
  const idsKey = item?.observationIds.join(",");
  useEffect(() => {
    if (!open || !itemKey || !idsKey) return;
    let cancelled = false;
    void observations(idsKey.split(",")).then((obs) => {
      if (!cancelled) setLoaded({ key: itemKey, rows: obs.slice().sort((a, b) => a.eventTime.ms - b.eventTime.ms) });
    });
    return () => {
      cancelled = true;
    };
  }, [open, itemKey, idsKey, observations]);
  const rows = loaded && loaded.key === itemKey ? loaded.rows : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} side="right" title={item?.title ?? "Evidence"} description={item ? `${item.id} · ${tagLabel(item.tagId)}` : undefined}>
      {item ? (
        <div className="space-y-4 text-[13px]">
          <p>{item.description}</p>
          <KeyValue
            items={[
              { k: "Asset", v: `${item.assetId} · ${assetName(item.assetId)}` },
              { k: "Tag", v: <span className="mono">{item.tagId}</span> },
              { k: "Quality", v: <StatusBadge value={item.quality} /> },
              { k: "Observed", v: item.observedValue ?? "—" },
              { k: "Reference", v: item.referenceValue ?? "—" },
              {
                k: "Reference id",
                v: item.referenceId ? (
                  <Link className="underline underline-offset-2 hover:text-accent" href={`/knowledge/matrix?edge=${encodeURIComponent(item.referenceId)}`}>
                    {item.referenceId}
                  </Link>
                ) : (
                  <span className="text-muted">none recorded</span>
                ),
              },
              { k: "Window", v: <span className="mono">{`${formatIst(item.window.startMs, { seconds: true })} – ${formatIst(item.window.endMs, { seconds: true })}`}</span> },
              { k: "Onset", v: item.onsetMs !== undefined ? <span className="mono">{`${formatIst(item.onsetMs, { seconds: true })} ${formatUncertainty(item.onsetUncertaintyMs)}`}</span> : <span className="text-muted">no onset established</span> },
              { k: "Group", v: <span className="mono">{item.group}</span> },
              { k: "Ordering", v: item.orderingReliable ? <Badge tone="green">reliable</Badge> : <Badge tone="amber">not reliable</Badge> },
            ]}
          />
          <p className="text-[12px] text-muted">Correlated channels share a group and count once toward support or contradiction.</p>
          <div>
            <h3 className="mb-1 text-[13px] font-semibold">Backing observations ({item.observationIds.length} referenced)</h3>
            {rows === null ? (
              <LoadingState label="Fetching observations from the engine…" />
            ) : rows.length === 0 ? (
              <p className="text-muted">No backing observations are retained in this browser for this item (they may have been evicted from the bounded store).</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Event time</Th>
                    <Th>Value</Th>
                    <Th>Quality</Th>
                    <Th>Source</Th>
                    <Th>Context</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id}>
                      <Td className="mono whitespace-nowrap">
                        {formatIst(o.eventTime.ms, { seconds: true, millis: true })}
                        <span className="block text-[11px] text-muted">{formatUncertainty(o.eventTime.uncertaintyMs)}</span>
                      </Td>
                      <Td className="tnum whitespace-nowrap">
                        {observationValue(o)}
                        {o.unit ? ` ${o.unit}` : ""}
                      </Td>
                      <Td>
                        <StatusBadge value={o.quality} />
                      </Td>
                      <Td className="mono">{o.sourceId}</Td>
                      <Td className="text-[12px] text-muted">
                        {[o.context?.recipe ? `recipe ${o.context.recipe}` : null, o.context?.phase ? `phase ${o.context.phase}` : null, o.context?.cycleId ? `cycle ${o.context.cycleId}` : null].filter(Boolean).join(" · ") || "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-muted">No evidence item selected.</p>
      )}
    </Dialog>
  );
}
