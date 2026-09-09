# PlantLens UI brief (for page implementers)

PlantLens is a calm, precise engineering workbench for a **fictional** factory. Everything visible must stay honest: SIMULATION is not a factory connection; a repair is an action, recovery is an observed result; missing evidence is unavailable, not healthy.

## Ground rules

- Next.js 16 App Router, TypeScript strict, Tailwind v4. All pages are client components (`"use client"`) because they read the zustand store. Dynamic route params: use `useParams()` from `next/navigation` (params are Promises in server components; avoid that by staying client-side). Query params: `useSearchParams()`.
- **Do not edit** `store/app.ts`, `lib/**`, `components/ui/index.tsx`, `components/shell/**`, `app/layout.tsx`, `app/globals.css`. If you need a helper, create a new file under `components/<area>/` or `lib/ui/` (new files only). If the store lacks an action you truly need, note it in your final report; do not hack around it by mutating state directly.
- Run `npx tsc --noEmit -p .` (ignore only the `LayoutProps` error in `app/layout.tsx` if it appears) and `npx eslint <your files>` before finishing. Zero errors in your files.
- Every primary action must work against the store; no decorative buttons. If something is not implemented, render it disabled with a short reason.
- Handle states: engine not started (`snapshot === null` → `<LoadingState />`), empty lists (`<EmptyState />`), missing record for a deep link (`<ErrorState title="Record not available in this browser" ... />` with a hint about importing a bundle).
- Accessibility: real buttons/links, labels on inputs, `aria-current`, focus visible. Escape closes dialogs (the `Dialog` primitive handles it). Don't intercept shortcuts while typing.
- Responsive: no horizontal page scroll; wide tables inside the `Table` primitive (it scrolls); on small screens prefer lists over dense graphs.
- Numbers use the `tnum` or `mono` class. Times via `formatIst(ms, { date?: boolean, seconds?: boolean })` from `@/lib/util` (simulation clock, IST). Money via `formatInr(paise)`.
- Colour only with words: use `StatusBadge`/`Badge` with tones: amber=warning, red=observed fault/FAIL, green=passed, grey=unavailable, accent=active/in progress.
- Labels: SIMULATION, IMPORTED REPLAY, "LIVE: Not configured"; "Stored in this browser — not cloud-synced"; simulated identities are labelled "(simulated)"; fixtures carry `fixture.fictional` and must be labelled "fictional fixture".
- Never invent percentages, risk scores, RUL, or "certified/permanently fixed" wording. The PASS wording is exactly: "Recovery checks passed within the tested operating conditions."

## Primitives (`@/components/ui`)

`Button` (variant primary|secondary|outline|ghost|danger; size sm|md|lg), `Badge` (tone), `StatusBadge` (maps common status strings to tones), `toneFor`, `Card`/`CardHeader`/`CardBody`, `SectionTitle`, `PageHeader` (title, description, actions, badges), `Input`, `Textarea`, `Select` (native), `Label`, `Field`, `Switch`, `Dialog` (open, onOpenChange, title, description, wide, side="right" for drawers), `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (Radix), `Tip` (tooltip), `Table`/`Th`/`Td`, `EmptyState`, `ErrorState`, `LoadingState`, `KeyValue`, `Callout` (tone, title), `Kbd`, `Progress`.

Icons: `lucide-react` (size 14–16). Charts: `recharts` (LineChart/AreaChart; keep them small, tabular axis labels, use CSS variables via `stroke="var(--accent)"` etc.). Topology: `@xyflow/react` (import its CSS `@xyflow/react/dist/style.css` inside the component file).

## Store (`useApp` from `@/store/app`)

Read state with selectors: `const snapshot = useApp((s) => s.snapshot)`. Key state:
- `snapshot: RuntimeSnapshot | null` (see `lib/simulation/runtime.ts`): `mode`, `scenarioId`, `clock {liveMs, cursorMs, startMs, endMs?, running, speed, viewingPast}`, `assets[assetId] → AssetView {phase?, status, headline[{tag,value,unit,quality}], freshnessMs, activeAlarmCount, incidentIds, coverage}`, `cells["CELL-A"|"CELL-B"] {phase, recipe, mode, commandedSpeedRpm, overrideActive, cycleCount, interrupted, cycleId}`, `alarms: Alarm[]`, `incidents: Incident[]` (live, non-fixture; each has `diagnosis`), `runs: RecoveryRun[]` (live), `interventions`, `knowledgeVersionId`, `stats`, `checkpoints`, `missingBaselines`, `liveAdapter {configured:false, reason}`, `importInfo?`.
- Records: `workspace`, `sources: SourceDocument[]`, `parsedFiles`, `pendingImports`, `pipelineStages`, `proposals: KnowledgeProposal[]`, `knowledgeVersions`, `activeKnowledgeVersionId`, `activeKnowledge()`, `baselines`, `plans: RecoveryPlan[]` (all versions; latest = highest `version` per `id`), `workOrders` (fixtures have `fixture`), `inventory`, `inventoryTransactions`, `costAssumptions`, `audit`, `historicalIncidents`, `historicalRuns`, `evaluation`, `evaluating`, `samplePack`, `identity`, `guided`.
- Engine queries (async): `series(tagIds, fromMs, toMs, maxPoints?) → Record<tagId, {ms, v, q}[]>`, `events(tagIds, fromMs, toMs) → rising edges`, `observations(ids) → Observation[]` (ids look like `OBS-<tagId>-<ms>`).
- Actions: `play/pause/setSpeed/seek/stepOnce`, `intervene(id, params?, workOrderId?)`, `importFiles([{name,text,size}])`, `updatePendingImport`, `previewPendingImport`, `commitPendingImport`, `discardPendingImport`, `loadSamplePack`, `downloadSamplePack`, `runPipeline`, `reviewProposalAction(id, decision, reason, edits?)` (edits: `{edge?, mapping?, resolution?}`), `publishKnowledge(reason)`, `addHumanEdgeDraft(edge, rationale)`, `createWorkOrder`, `transitionWO`, `approveIntervention`, `recordWork(woId, description, interventionId?, params?)`, `addLabor`, `reservePart/consumePart/returnPart/receivePart(…, actionKey)` (actionKey = idempotency key; generate one per user click, e.g. `crypto.randomUUID()` at click time), `createPlan(incidentId, templateId)`, `editPlan`, `approvePlanAction`, `startRun(planId, workOrderId?)`, `abortRun`, `reviewRun`, `closeWO`, `setIncidentStatus`, `draftWorkOrderFromIncident`, `prepareSpareRequest`, `draftHandover()`, `exportBundle`, `importBundle(text)`, `exportTelemetryCsv`, `runEvaluation(config)`, `setGuided`, `updateCostAssumption`, `newDemoWorkspace(scenarioId)`, `resetWorkspace`, `toast(kind, text)`.

## Domain helpers

- `@/lib/domain/plant`: `ASSETS`, `ASSET_BY_ID`, `TAGS`, `TAG_BY_ID`, `tagsForAsset`, `ZONES`, `CELLS`, `LAYOUT` (x,y per asset), `ZONE_BOXES`.
- `@/lib/domain/types`: all record types.
- `@/lib/simulation/scenarios`: `SCENARIOS`, `SCENARIO_BY_ID`, `INTERVENTIONS`, `INTERVENTION_BY_ID`, `RECIPES`, `DEMO_START_MS`.
- `@/lib/fixtures/templates`: `RECOVERY_TEMPLATES`; `@/lib/recovery/compiler`: `templatesFor(family, cellId)`, `planRequirementTitles`; `@/lib/recovery/coverage`: `coverageMatrix(plan, knowledge, affectedEdgeIds)`; `@/lib/recovery/interpreter`: `AGGREGATE_PRECEDENCE` (strings to display).
- `@/lib/knowledge/versions`: `diffVersions(a,b)`, `dependencyMatrix(version, assetIds, pending)`.
- `@/lib/workflow`: `cellCosts(...)`, `workOrderCost(wo)`, `checkVerifiedClosure(wo, plan, runs, review)`, `lowStock(parts)`, `canTransition`.
- `@/lib/diagnosis/config`: `FAMILY_CONFIG`, `NEXT_CHECK_LIBRARY`. `@/lib/diagnosis/engine`: `relationLabel`.
- `@/lib/util`: `formatIst`, `formatIso`, `formatDuration`, `formatRelative`, `formatInr`, `fmt`, `cn`, `unionDurationMs`.
- `@/lib/simulation/runtime`: `formatValue`, `assetLabel`.

## Routes (owner in brackets)

- `/plant`, `/plant/[assetId]` [A]
- `/knowledge/sources`, `/knowledge/review`, `/knowledge/matrix` [B]
- `/incidents`, `/incidents/[id]` (tabs: summary, timeline, evidence, path, recovery, history via `?tab=`) [C]
- `/recovery`, `/recovery/[id]` (`?run=`, `?check=`, `?tab=coverage|history`) [D]
- `/maintenance`, `/maintenance/work-orders/[id]`, `/maintenance/inventory`, `/costs` [D]
- `/lab`, `/lab/evaluation`, `/reports`, `/data-health`, `/settings` [E]

Deep links from other areas use exactly these query parameters; support them.
