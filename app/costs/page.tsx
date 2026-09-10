"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CellId, CostAssumption } from "@/lib/domain/types";
import { cellCosts, whatIfDifference, workOrderCost } from "@/lib/workflow";
import { formatDuration, formatInr } from "@/lib/util";
import { useApp } from "@/store/app";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Input, KeyValue, LoadingState, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";

function rupees(paise: number): string {
  return (paise / 100).toString();
}

function AssumptionForm({ a, onSave }: { a: CostAssumption; onSave: (patch: Partial<CostAssumption>) => void }) {
  const [rate, setRate] = useState(rupees(a.interruptionPaisePerMinute));
  const [labor, setLabor] = useState(rupees(a.laborPaisePerHour));
  const [budget, setBudget] = useState(rupees(a.budgetPaise));
  const toPaise = (s: string) => Math.round(Number(s) * 100);
  const valid = [rate, labor, budget].every((s) => Number.isFinite(Number(s)) && Number(s) >= 0);
  const dirty = toPaise(rate) !== a.interruptionPaisePerMinute || toPaise(labor) !== a.laborPaisePerHour || toPaise(budget) !== a.budgetPaise;
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || !dirty) return;
        onSave({ interruptionPaisePerMinute: toPaise(rate), laborPaisePerHour: toPaise(labor), budgetPaise: toPaise(budget) });
      }}
    >
      <Field label="Interruption ₹ per cell-minute">
        <Input type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="tnum" aria-label={`${a.cellId} interruption rate`} />
      </Field>
      <Field label="Labour ₹ per hour">
        <Input type="number" min={0} step="0.01" value={labor} onChange={(e) => setLabor(e.target.value)} className="tnum" aria-label={`${a.cellId} labour rate`} />
      </Field>
      <Field label="Budget ₹">
        <Input type="number" min={0} step="1" value={budget} onChange={(e) => setBudget(e.target.value)} className="tnum" aria-label={`${a.cellId} budget`} />
      </Field>
      <Button type="submit" variant="primary" disabled={!valid || !dirty} title={dirty ? undefined : "No changes"}>
        Save
      </Button>
    </form>
  );
}

export default function CostsPage() {
  const snapshot = useApp((s) => s.snapshot);
  const workOrders = useApp((s) => s.workOrders);
  const costAssumptions = useApp((s) => s.costAssumptions);
  const inventory = useApp((s) => s.inventory);
  const updateCostAssumption = useApp((s) => s.updateCostAssumption);
  const toast = useApp((s) => s.toast);
  const [whatIfCell, setWhatIfCell] = useState<CellId>("CELL-A");
  const [reductionMin, setReductionMin] = useState("10");

  const liveMs = snapshot?.clock.liveMs ?? 0;
  const costs = useMemo(() => (snapshot ? cellCosts(snapshot.incidents, workOrders, costAssumptions, inventory, liveMs) : []), [snapshot, workOrders, costAssumptions, inventory, liveMs]);

  if (!snapshot) return <LoadingState label="Starting simulation engine…" />;

  const base = costs.find((c) => c.cellId === whatIfCell);
  const assumption = costAssumptions.find((a) => a.cellId === whatIfCell);
  const reductionMs = Math.max(0, Number(reductionMin) || 0) * 60_000;
  const whatIf = base && assumption ? whatIfDifference(base.downtimeMs, Math.max(0, base.downtimeMs - reductionMs), assumption.interruptionPaisePerMinute) : null;

  const liveWos = workOrders.filter((w) => !w.fixture);
  const fixtureWos = workOrders.filter((w) => w.fixture);

  return (
    <div>
      <PageHeader title="Costs" description="Fictional, editable assumptions applied to observed interruption time and recorded work. Nothing here is a customer result, a saving, or a return on investment." badges={<Badge tone="amber">fictional assumptions</Badge>} />

      <div className="grid gap-4 md:grid-cols-2">
        {costs.map((c) => {
          const a = costAssumptions.find((x) => x.cellId === c.cellId)!;
          const minutes = c.downtimeMs / 60_000;
          const remaining = c.budgetPaise - c.maintenancePaise - c.committedPaise;
          return (
            <Card key={c.cellId}>
              <CardHeader title={c.cellId} description={a.note} />
              <CardBody className="space-y-3">
                <KeyValue
                  items={[
                    {
                      k: "Downtime",
                      v: (
                        <span>
                          <span className="tnum">{formatDuration(c.downtimeMs)}</span> <span className="text-muted">({minutes.toFixed(1)} cell-minutes)</span>
                        </span>
                      ),
                    },
                    { k: "Basis", v: "cell-minutes: the union of this cell's interruption intervals across incidents. A child spindle and its parent CNC never double count, and a shared-loss scope across dependent cells is counted per cell, never added together." },
                    {
                      k: "Interruption estimate",
                      v: (
                        <span>
                          <span className="tnum font-medium">{formatInr(c.interruptionEstimatePaise)}</span>
                          <span className="block text-[12px] text-muted tnum">
                            = {minutes.toFixed(1)} min × {formatInr(a.interruptionPaisePerMinute)}/min
                          </span>
                        </span>
                      ),
                    },
                    {
                      k: "Recorded maintenance",
                      v: (
                        <span>
                          <span className="tnum font-medium">{formatInr(c.maintenancePaise)}</span>
                          <span className="block text-[12px] text-muted tnum">
                            labour {formatInr(c.laborPaise)} + parts {formatInr(c.partsPaise)} (live work orders in this cell)
                          </span>
                        </span>
                      ),
                    },
                    { k: "Committed (reserved parts)", v: <span className="tnum">{formatInr(c.committedPaise)}</span> },
                    { k: "Budget", v: <span className="tnum">{formatInr(c.budgetPaise)}</span> },
                    {
                      k: "Budget remaining",
                      v: (
                        <span className={`tnum ${remaining < 0 ? "text-red" : ""}`}>
                          {formatInr(remaining)} <span className="text-[12px] text-muted">= budget − recorded maintenance − committed</span>
                        </span>
                      ),
                    },
                  ]}
                />
                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Assumptions (rupees; stored as paise)</p>
                  <AssumptionForm
                    key={`${a.id}-${a.interruptionPaisePerMinute}-${a.laborPaisePerHour}-${a.budgetPaise}`}
                    a={a}
                    onSave={(patch) => {
                      updateCostAssumption(a.id, patch);
                      toast("success", `${a.cellId} assumptions updated; existing labour records keep the rate they were recorded at.`);
                    }}
                  />
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <CardHeader title="Scenario difference (not verified ROI)" description="Type a hypothetical reduction in interruption minutes. The result is the arithmetic difference under the stated rate; it is not a measured saving." />
        <CardBody className="grid gap-3 md:grid-cols-[auto_auto_1fr] md:items-end">
          <Field label="Cell">
            <Select value={whatIfCell} onChange={(e) => setWhatIfCell(e.target.value as CellId)} aria-label="Cell">
              {costAssumptions.map((a) => (
                <option key={a.cellId} value={a.cellId}>
                  {a.cellId}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hypothetical downtime reduction (minutes)">
            <Input type="number" min={0} step="1" value={reductionMin} onChange={(e) => setReductionMin(e.target.value)} className="tnum w-40" aria-label="Downtime reduction in minutes" />
          </Field>
          {whatIf && base && assumption ? (
            <Callout tone="neutral">
              <span className="tnum">
                Observed {(base.downtimeMs / 60_000).toFixed(1)} min → scenario {(Math.max(0, base.downtimeMs - reductionMs) / 60_000).toFixed(1)} min at {formatInr(assumption.interruptionPaisePerMinute)}/min: difference <strong>{formatInr(whatIf.differencePaise)}</strong>
              </span>
              <span className="block text-[12px] text-muted">{whatIf.assumption}</span>
            </Callout>
          ) : null}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Cost per work order" description="Labour at the rate recorded on each entry; parts at the unit price frozen when consumed. Returns appear as negative quantities." />
        <CardBody className="p-0">
          <Table className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Work order</Th>
                <Th>Cell</Th>
                <Th>State</Th>
                <Th className="text-right">Labour</Th>
                <Th className="text-right">Parts</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {[...liveWos, ...fixtureWos].map((w) => {
                const c = workOrderCost(w);
                return (
                  <tr key={w.id}>
                    <Td>
                      <Link className="text-accent hover:underline mono" href={`/maintenance/work-orders/${w.id}`}>
                        {w.id}
                      </Link>
                      <span className="block max-w-xs truncate text-[12px] text-muted">{w.title}</span>
                      {w.fixture ? <Badge tone="grey">fictional fixture — excluded from cell totals</Badge> : null}
                    </Td>
                    <Td>{w.cellId ?? "—"}</Td>
                    <Td>
                      <StatusBadge value={w.state} />
                    </Td>
                    <Td className="tnum text-right">{formatInr(c.laborPaise)}</Td>
                    <Td className="tnum text-right">{formatInr(c.partsPaise)}</Td>
                    <Td className="tnum text-right font-medium">{formatInr(c.totalPaise)}</Td>
                  </tr>
                );
              })}
              {workOrders.length === 0 ? (
                <tr>
                  <Td colSpan={6} className="text-center text-muted">
                    No work orders recorded.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
