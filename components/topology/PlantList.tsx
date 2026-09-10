"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge, StatusBadge } from "@/components/ui";
import { ASSETS, ZONES } from "@/lib/domain/plant";
import type { RuntimeSnapshot } from "@/lib/simulation/runtime";
import { cn } from "@/lib/util";
import { useApp } from "@/store/app";
import { Cog } from "lucide-react";
import { coverageLabel, freshnessLabel, openIncidents, relationTitle, statusVisual } from "./plantMeta";
import { focusEdgeIds } from "./graphData";
import { ASSET_ICONS } from "./assetIcons";

/**
 * List alternative to the topology graph: the same asset information grouped by zone,
 * with the published dependencies of each asset spelled out in words.
 */
export function PlantList({ snapshot, focusIncidentId, className }: { snapshot: RuntimeSnapshot; focusIncidentId?: string | null; className?: string }) {
  const knowledge = useApp((s) => s.activeKnowledge());
  const focusIncident = useMemo(() => openIncidents(snapshot.incidents).find((i) => i.id === focusIncidentId), [snapshot.incidents, focusIncidentId]);
  const focusIds = useMemo(() => focusEdgeIds(focusIncident), [focusIncident]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {ZONES.map((z) => (
        <section key={z.id} aria-labelledby={`zone-${z.id}`} className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-3 py-2">
            <h3 id={`zone-${z.id}`} className="text-[12px] font-semibold uppercase tracking-wider text-muted">
              {z.name}
            </h3>
            <p className="text-[12px] text-muted">{z.purpose}</p>
          </div>
          <ul className="divide-y divide-border">
            {ASSETS.filter((a) => a.zone === z.id).map((a) => {
              const v = snapshot.assets[a.id];
              const vis = statusVisual(v?.status);
              const Icon = ASSET_ICONS[a.id] ?? Cog;
              const fresh = freshnessLabel(v?.freshnessMs ?? null);
              const inbound = knowledge.edges.filter((e) => e.to === a.id);
              const outbound = knowledge.edges.filter((e) => e.from === a.id);
              const onPath = focusIncident ? [...inbound, ...outbound].some((e) => focusIds.has(e.id)) : false;
              return (
                <li key={a.id} className={cn("px-3 py-2", focusIncident && !onPath && "opacity-60")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon size={15} className="shrink-0 text-muted" aria-hidden />
                      <Link href={`/plant/${a.id}`} className="min-w-0 text-[13px] font-medium hover:underline">
                        <span className="mono font-normal text-muted">{a.id}</span> {a.name}
                      </Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {v?.phase ? <Badge tone="grey">{v.phase}</Badge> : null}
                      <StatusBadge value={v?.status} />
                      {onPath ? <Badge tone="accent">on selected path</Badge> : null}
                    </div>
                  </div>
                  {vis.hint ? <p className={cn("mt-0.5 text-[12px]", vis.tone === "red" ? "text-red" : vis.tone === "amber" ? "text-amber" : "text-muted")}>{vis.hint}</p> : null}
                  <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                    {(v?.headline ?? []).map((h) => (
                      <div key={h.tag} className="contents">
                        <dt className="mono text-muted">{h.tag}</dt>
                        <dd className="tnum">
                          {h.value}
                          {h.unit ? ` ${h.unit}` : ""}
                          {h.quality !== "GOOD" ? <span className="ml-1 text-grey">({h.quality})</span> : null}
                        </dd>
                      </div>
                    ))}
                    <dt className="text-muted">freshness</dt>
                    <dd className={cn("tnum", fresh.stale && "text-amber")}>{fresh.text}</dd>
                    <dt className="text-muted">coverage</dt>
                    <dd>{coverageLabel(v?.coverage ?? a.coverage)}</dd>
                    {inbound.length ? (
                      <>
                        <dt className="text-muted">depends on</dt>
                        <dd>
                          {inbound.map((e) => (
                            <span key={e.id} className={cn("mr-2 inline-block", focusIds.has(e.id) && "font-semibold text-accent")}>
                              <Link href={`/plant/${e.from}`} className="mono hover:underline">
                                {e.from}
                              </Link>{" "}
                              <span className="text-muted">({relationTitle(e.relation).toLowerCase()}{e.physicalFeedback ? ", feedback" : ""})</span>
                            </span>
                          ))}
                        </dd>
                      </>
                    ) : null}
                    {outbound.length ? (
                      <>
                        <dt className="text-muted">feeds</dt>
                        <dd>
                          {outbound.map((e) => (
                            <span key={e.id} className={cn("mr-2 inline-block", focusIds.has(e.id) && "font-semibold text-accent")}>
                              <Link href={`/plant/${e.to}`} className="mono hover:underline">
                                {e.to}
                              </Link>{" "}
                              <span className="text-muted">({relationTitle(e.relation).toLowerCase()}{e.physicalFeedback ? ", feedback" : ""})</span>
                            </span>
                          ))}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
