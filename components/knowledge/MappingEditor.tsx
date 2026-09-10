"use client";

import { useState } from "react";
import type { ColumnRole, QualityReport } from "@/lib/sources/parsers";
import { formatIst } from "@/lib/util";
import { Badge, Button, Callout, Field, Input, KeyValue, Select, Table, Td, Th } from "@/components/ui";
import { useApp, type PendingImport } from "@/store/app";

const ROLES: ColumnRole[] = ["eventTime", "ingestionTime", "asset", "tag", "value", "unit", "quality", "recipe", "phase", "mode", "cycleId", "commandedSpeed", "actualSpeed", "ignore"];

/**
 * Column-mapping editor for an operating trace awaiting replay import. Every choice is
 * explicit: roles per column, the time-zone assumption for local timestamps, and a quality
 * preview before anything is committed. Imported observations are never mutated.
 */
export function MappingEditor({ pending }: { pending: PendingImport }) {
  const updatePendingImport = useApp((s) => s.updatePendingImport);
  const previewPendingImport = useApp((s) => s.previewPendingImport);
  const commitPendingImport = useApp((s) => s.commitPendingImport);
  const discardPendingImport = useApp((s) => s.discardPendingImport);
  const [busy, setBusy] = useState(false);
  const required: ColumnRole[] = ["eventTime", "tag", "value"];
  const assigned = new Set(Object.values(pending.mapping));
  const missing = required.filter((r) => !assigned.has(r));
  const report = pending.report;

  const setRole = (header: string, role: ColumnRole) => updatePendingImport(pending.fileId, { mapping: { ...pending.mapping, [header]: role } });

  return (
    <div className="space-y-3">
      <Callout tone="accent" title="Replay import — column mapping required">
        {pending.fileName}: <span className="tnum">{pending.rowCount}</span> data rows. Assign event time, tag, and value columns; preview the quality report; then create a replay workspace. Nothing is written until you commit.
      </Callout>
      <Table>
        <thead>
          <tr>
            <Th>Column</Th>
            <Th>Role</Th>
            {pending.preview.slice(0, 3).map((_, i) => (
              <Th key={i} className="tnum">
                Row {i + 2}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pending.headers.map((h, ci) => (
            <tr key={`${h}-${ci}`}>
              <Td className="mono">{h}</Td>
              <Td>
                <label className="sr-only" htmlFor={`role-${pending.fileId}-${ci}`}>
                  Role for column {h}
                </label>
                <Select id={`role-${pending.fileId}-${ci}`} value={pending.mapping[h] ?? "ignore"} onChange={(e) => setRole(h, e.target.value as ColumnRole)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Td>
              {pending.preview.slice(0, 3).map((row, i) => (
                <Td key={i} className="mono max-w-[14rem] truncate">
                  {row[ci] ?? ""}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      {missing.length ? <Callout tone="amber">Mapping must assign: {missing.join(", ")}.</Callout> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Time-zone assumption for local timestamps" hint="Timestamps without an offset (e.g. 2026-09-01 02:00:00) cannot be placed on the UTC timeline without an explicit assumption. Rows with an explicit offset or Z are unaffected. The raw string is preserved on every observation.">
          <Input value={pending.timeZoneAssumption} placeholder="+05:30" onChange={(e) => updatePendingImport(pending.fileId, { timeZoneAssumption: e.target.value.trim() })} aria-label="Time-zone assumption" />
        </Field>
        <div className="text-[12px] text-muted">
          <p className="font-medium text-text">Import guarantees</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Imported observations are never mutated by annotations, maintenance records, or interventions.</li>
            <li>Rows that cannot be normalised are counted and excluded, never silently coerced.</li>
            <li>Unit conflicts are kept as SUSPECT until a conversion is approved; none is applied automatically.</li>
            <li>A what-if branch would be a separate, labelled workspace. Not implemented in this build.</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => previewPendingImport(pending.fileId)} disabled={missing.length > 0}>
          Preview quality
        </Button>
        <Button
          variant="primary"
          disabled={!report || busy || missing.length > 0}
          title={!report ? "Preview the quality report first" : undefined}
          onClick={async () => {
            setBusy(true);
            try {
              await commitPendingImport(pending.fileId);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create replay workspace"}
        </Button>
        <Button variant="ghost" onClick={() => discardPendingImport(pending.fileId)}>
          Discard
        </Button>
      </div>
      {report ? <QualityReportView report={report} /> : null}
    </div>
  );
}

export function QualityReportView({ report }: { report: QualityReport }) {
  const unmatchedTags = Object.entries(report.unmatchedTags).sort((a, b) => b[1] - a[1]);
  const unmatchedAssets = Object.entries(report.unmatchedAssets).sort((a, b) => b[1] - a[1]);
  const num = (n: number) => <span className="tnum">{n}</span>;
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">Quality report</h3>
        <Badge tone={report.accepted ? "green" : "red"}>
          {report.accepted} / {report.rowsParsed} rows accepted
        </Badge>
        {report.range ? (
          <Badge tone="neutral">
            {formatIst(report.range.startMs, { date: true })} → {formatIst(report.range.endMs, { date: true })} IST
          </Badge>
        ) : (
          <Badge tone="grey">no accepted rows</Badge>
        )}
      </div>
      <KeyValue
        items={[
          { k: "Rows parsed", v: num(report.rowsParsed) },
          { k: "Accepted", v: num(report.accepted) },
          { k: "Duplicates dropped", v: num(report.duplicates) },
          { k: "Missing timestamps", v: num(report.missingTimestamps) },
          { k: "Invalid timestamps", v: num(report.invalidTimestamps) },
          { k: "Local timestamps assumed", v: <>{num(report.localTimestampsAssumed)} {report.localTimestampsAssumed ? <span className="text-muted">(offset assumption applied; raw string preserved)</span> : null}</> },
          { k: "Out-of-order rows", v: num(report.outOfOrder) },
          { k: "Invalid values", v: num(report.invalidValues) },
          { k: "Null values (kept as MISSING)", v: num(report.nullValues) },
        ]}
      />
      {report.notes.length ? <Callout tone="amber">{report.notes.join(" ")}</Callout> : null}
      {unmatchedTags.length ? (
        <div>
          <p className="text-[12px] font-medium">Unmatched tags (not replayed)</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {unmatchedTags.map(([t, c]) => (
              <li key={t}>
                <Badge tone="amber">
                  <span className="mono">{t}</span> <span className="tnum">×{c}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unmatchedAssets.length ? (
        <div>
          <p className="text-[12px] font-medium">Unmatched assets</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {unmatchedAssets.map(([a, c]) => (
              <li key={a}>
                <Badge tone="amber">
                  <span className="mono">{a}</span> <span className="tnum">×{c}</span>
                </Badge>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-muted">Approve an alias mapping in Review to resolve these; the resolver does not guess.</p>
        </div>
      ) : null}
      {report.unknownUnits.length ? (
        <div>
          <p className="text-[12px] font-medium">Unknown units</p>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {report.unknownUnits.map((u) => (
              <li key={`${u.tagId}|${u.unit}`}>
                <span className="mono">{u.tagId}</span> reports <span className="mono">{u.unit}</span>; the registry has no unit for this tag (<span className="tnum">{u.count}</span> rows).
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.unitConflicts.length ? (
        <Callout tone="amber" title="Unit conflicts — rows marked SUSPECT">
          <ul className="space-y-0.5">
            {report.unitConflicts.map((u) => (
              <li key={`${u.tagId}|${u.found}`}>
                <span className="mono">{u.tagId}</span>: file says <span className="mono">{u.found}</span>, registry expects <span className="mono">{u.expected}</span> (<span className="tnum">{u.count}</span> rows). No conversion is applied without an approval; approving unit conversions is not available in this build, so these rows replay as SUSPECT.
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </div>
  );
}
