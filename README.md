# PlantLens

PlantLens is a local-first factory maintenance and recovery workbench built by VoltMind. The bundled experience uses a fictional automotive-component factory near Chennai and explicitly labels all generated observations as **SIMULATION**—it is not connected to a live factory.

## What works

- Seeded Web Worker simulation across 18 assets and 12 scenarios
- CSV, JSON, TXT, PLC-text, and engineer-note ingestion with provenance and quality reports
- Inspectable local knowledge compilation, engineer review, and immutable publication
- Evidence-backed incident grouping and competing diagnostic explanations
- Work orders, intervention approval, inventory ledger, costs, and scoped historical records
- Compiled recovery plans evaluated against observations
- Browser-local IndexedDB persistence, evidence-bundle export, telemetry CSV, and print reports
- Optional server-side connected-AI adapter; the complete demo requires no API key

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Production verification:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

## Data and safety boundaries

Imported files remain in the browser unless the user explicitly exports them. PlantLens does not write to PLCs, bypass interlocks, execute uploaded control code, or claim field validation. Recovery outcomes apply only to the recorded test scope and require a separate review before verified closure.
