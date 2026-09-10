# Implementation decisions

Reversible choices made while building PlantLens, recorded so they can be revisited.

## Reference material

The build specification referenced a "supplied PlantLens source ZIP and standalone HTML". Neither was present in the workspace or the Downloads folder at build time. The application was built from the specification alone; the six asset IDs from the earlier build (CNC-01, SPN-01, PUMP-01, ROB-01, FIX-01, CNC-02) are retained by name.

## Simulation and replay

- Fixed 1 s step, seeded `sfc32` PRNG. The same seed, scenario, and recorded interventions reproduce identical observations regardless of playback speed (test: `tests/unit/engine.test.ts`).
- The observation store is the event log. Seeking backwards moves a view cursor over the recording; nothing is regenerated. Playing from the past scrubs through the recording until it reaches the live edge, then the simulation resumes. Interventions apply only at the live edge and are recorded for deterministic restore.
- Checkpoints (phases, active alarms, open incidents every 30 s) are kept for the timeline; asset state at any time is derived from the log.
- Robot events carry their own clock source and uncertainty. Scenario 10 shifts them by −4 s with ±5 s uncertainty, which the interpreter and diagnosis treat as unresolved ordering.
- Hidden truth (`lib/simulation/truth.ts`) never enters the diagnosis or recovery input; a test greps the protected modules for that import.

## Diagnosis

- Deterministic, versioned rules in `lib/diagnosis/config.ts`. Candidates are ranked by independent supporting evidence groups minus twice the contradicting groups. No probabilities.
- Grouping into a shared-cause incident requires a published dependency path and compatible timing. Unpublished proposals never group anything (test: `tests/unit/knowledge.test.ts`).
- Numeric band decisions ignore the first 20 s after a run starts and require ten consecutive out-of-band samples before a violation is decisive, so start-up transients are not counted as failures. Sequence and alarm checks observe from the exact run start.

## Recovery

- Plans are constrained JSON compiled from templates against the published knowledge version and an approved baseline; an interpreter evaluates them. No generated code is ever executed.
- Aggregate precedence: NOT_COMPARABLE → FAIL (decisive) → INCONCLUSIVE → RUNNING → PASS. Zero valid opportunities is never a pass. Runs time out to INCONCLUSIVE after 20 simulation minutes.
- Editing a plan creates a new version and clears approval. A knowledge publish that changes a referenced requirement or edge invalidates outstanding approvals.

## Knowledge pipeline

- The no-key "local demo pipeline" is deterministic parsers and explicit regex rules over the fictional notes and sequence excerpt. It is labelled LOCAL_DEMO on every proposal and never described as a language-model response.
- The connected pipeline (`app/api/knowledge/route.ts`) calls the Anthropic Messages API only when `PLANTLENS_AI_ENABLED=true`, `ANTHROPIC_API_KEY`, and `PLANTLENS_AI_ACCESS_TOKEN` are configured on the server. Requests are size-capped (60 KB), time-capped (25 s), quota-limited per day, and outputs are schema-validated and citation-verified. It is not configured on the public deployment.

## Persistence

- IndexedDB holds the workspace bundle plus the engine restore data (seed, scenario, live edge, interventions). Restore re-runs the engine deterministically to the saved live edge.
- A BroadcastChannel writer lock makes later tabs read-only rather than allowing last-writer-wins corruption.
- No service worker is shipped, so offline reload is not claimed.

## Money and time

- Money is integer paise; labour cost is rounded to the nearest paisa at the accounting boundary; display uses Indian digit grouping.
- Timestamps are shown in IST (+05:30). Simulation time, event time, ingestion time, and wall time are separate fields.

## Known limitations

- Imported replay supports CSV traces with the documented column set; alarm history CSV is optional. PDF/DOCX/XLSX and proprietary PLC projects are reported as unsupported with the export that is required.
- No what-if branch workspace is implemented; the UI says so.
- Approval and identity are simulated; a browser demo has no authenticated audit.
