"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PackagePlus } from "lucide-react";
import { lowStock } from "@/lib/workflow";
import { formatInr, formatIst } from "@/lib/util";
import { useApp } from "@/store/app";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Field, Input, LoadingState, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { actionKey } from "@/components/recovery/helpers";

export default function InventoryPage() {
  const snapshot = useApp((s) => s.snapshot);
  const inventory = useApp((s) => s.inventory);
  const transactions = useApp((s) => s.inventoryTransactions);
  const receivePart = useApp((s) => s.receivePart);
  const [partId, setPartId] = useState(inventory[0]?.id ?? "");
  const [qty, setQty] = useState("1");

  const low = useMemo(() => new Set(lowStock(inventory).map((p) => p.id)), [inventory]);
  const part = inventory.find((p) => p.id === partId);
  const ledger = useMemo(() => transactions.slice().sort((a, b) => b.at.ms - a.at.ms), [transactions]);
  const partName = (id: string) => inventory.find((p) => p.id === id)?.name ?? id;

  if (!snapshot) return <LoadingState label="Starting simulation engine…" />;

  const quantity = Number(qty);
  const qtyValid = Number.isFinite(quantity) && quantity > 0 && (!part?.indivisible || Number.isInteger(quantity));

  const receive = () => {
    if (!part || !qtyValid) return;
    receivePart(part.id, quantity, actionKey());
    setQty("1");
  };

  return (
    <div>
      <PageHeader title="Inventory" description="Spare parts held for the fictional plant. Availability is on hand minus reserved; a low-stock flag means available stock is at or below the minimum." badges={<Badge tone="grey">Stored in this browser — not cloud-synced</Badge>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="min-w-0">
          <CardHeader title="Parts" description={`${inventory.length} catalogue items · ${low.size} at or below minimum`} />
          <CardBody className="p-0">
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Part</Th>
                  <Th>Unit</Th>
                  <Th className="text-right">On hand</Th>
                  <Th className="text-right">Reserved</Th>
                  <Th className="text-right">Available</Th>
                  <Th className="text-right">Minimum</Th>
                  <Th className="text-right">Catalogue price</Th>
                  <Th>Stock</Th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((p) => {
                  const available = p.onHand - p.reserved;
                  return (
                    <tr key={p.id}>
                      <Td>
                        <span className="mono">{p.id}</span>
                        <span className="block text-[12px] text-muted">{p.name}</span>
                      </Td>
                      <Td>
                        {p.unit}
                        {p.indivisible ? <span className="block text-[11px] text-muted">whole units</span> : null}
                      </Td>
                      <Td className="tnum text-right">{p.onHand}</Td>
                      <Td className="tnum text-right">{p.reserved}</Td>
                      <Td className="tnum text-right font-medium">{available}</Td>
                      <Td className="tnum text-right">{p.minimumStock}</Td>
                      <Td className="tnum text-right">{formatInr(p.catalogPricePaise)}</Td>
                      <Td>{low.has(p.id) ? <Badge tone="amber">low stock</Badge> : <Badge tone="green">ok</Badge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Receive stock" description="Adds to on-hand quantity at the catalogue price." />
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                receive();
              }}
            >
              <Field label="Part">
                <Select value={partId} onChange={(e) => setPartId(e.target.value)} className="w-full" aria-label="Part">
                  {inventory.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} — {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Quantity${part ? ` (${part.unit})` : ""}`} hint={part?.indivisible ? "Whole numbers only for this part." : undefined}>
                <Input type="number" min={part?.indivisible ? 1 : 0.1} step={part?.indivisible ? 1 : "any"} value={qty} onChange={(e) => setQty(e.target.value)} className="tnum" aria-label="Quantity" />
              </Field>
              <Button type="submit" variant="primary" className="w-full" disabled={!part || !qtyValid} title={qtyValid ? undefined : "Enter a positive quantity; whole numbers for indivisible parts"}>
                <PackagePlus size={15} /> Receive
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Transactions" description={`${ledger.length} entries, newest first. Each request carries an idempotency key, so a repeated click never double-books.`} />
        <CardBody className="space-y-3">
          <Callout tone="neutral">Prices are frozen at consumption; catalogue changes never rewrite history.</Callout>
          {ledger.length === 0 ? (
            <EmptyState title="No transactions yet" description="Reservations, consumption, returns, and receipts will appear here." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Transaction</Th>
                  <Th>Kind</Th>
                  <Th>Part</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th className="text-right">Unit price (frozen)</Th>
                  <Th>Work order</Th>
                  <Th>At</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((t) => (
                  <tr key={t.id}>
                    <Td className="mono text-[12px]">{t.id}</Td>
                    <Td>
                      <Badge tone={t.kind === "CONSUME" ? "accent" : t.kind === "RECEIVE" || t.kind === "RETURN" ? "green" : "neutral"}>{t.kind}</Badge>
                    </Td>
                    <Td>
                      <span className="mono">{t.partId}</span>
                      <span className="block text-[12px] text-muted">{partName(t.partId)}</span>
                    </Td>
                    <Td className="tnum text-right">{t.quantity}</Td>
                    <Td className="tnum text-right">{formatInr(t.unitPricePaise)}</Td>
                    <Td>{t.workOrderId ? <Link className="text-accent hover:underline mono" href={`/maintenance/work-orders/${t.workOrderId}`}>{t.workOrderId}</Link> : <span className="text-muted">—</span>}</Td>
                    <Td className="tnum whitespace-nowrap">{formatIst(t.at.ms, { date: true })}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
