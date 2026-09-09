"use client";

import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, LoadingState, PageHeader, StatusBadge } from "@/components/ui";
import { useApp } from "@/store/app";
import { ASSETS, ZONES } from "@/lib/domain/plant";

export default function PlantPage() {
  const snapshot = useApp((s) => s.snapshot);
  if (!snapshot) return <LoadingState label="Starting the simulation engine…" />;
  return (
    <div>
      <PageHeader title="Plant" description="VoltMind Components — Demo Plant (fictional). SIMULATION: observations are generated in this browser." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ZONES.map((z) => (
          <Card key={z.id}>
            <CardHeader title={z.name} description={z.purpose} />
            <CardBody className="flex flex-col gap-2">
              {ASSETS.filter((a) => a.zone === z.id).map((a) => {
                const v = snapshot.assets[a.id];
                return (
                  <Link key={a.id} href={`/plant/${a.id}`} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="mono text-[12px] text-muted">{a.id}</span> <span className="text-[13px]">{a.name}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">
                        {v?.headline.map((h) => `${h.tag} ${h.value}${h.unit ? ` ${h.unit}` : ""}`).join(" · ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {v?.phase ? <Badge tone="grey">{v.phase}</Badge> : null}
                      <StatusBadge value={v?.status} />
                    </span>
                  </Link>
                );
              })}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
