# PlantLens Live hardware milestone

## What is implemented

- Safe explicit device selection and a fixed read-only identity handshake.
- Versioned protocol schemas, bounded NDJSON diagnostic framing, sequence/schema validation, same-UUID reconnect rules, and a deterministic UNO Q demonstration source.
- A separate Node.js Windows companion with explicit COM selection, loopback HTTP/SSE APIs, SQLite WAL storage, and append-only hash-chained audit records.
- An Arduino UNO Q App Lab scaffold: the STM32 sketch samples three analog inputs; the Debian service publishes descriptors, health, snapshots, and telemetry. It has no write/control handler.
- Versioned asset classes, channel bindings, restricted affine transforms, topology, twin projection, immutable approvals, and seed migration support.
- A real LangGraph.js supervisor and ten sequential configuration specialists. The no-key runtime is deterministic; model adapters cannot acquire serial, shell, file, register-write, or activation tools.
- Judge pages at `/live`: Devices, Assets, Mappings, Agents, Twin, and Audit.

## Run the Windows companion

```powershell
cd companion
npm install
npm start
```

The service binds to `127.0.0.1:43117`. Set `PLANTLENS_COMPANION_TOKEN` to a strong pairing token before connecting a UI. A serial connection must name one explicit COM port; the companion never scans baud rates, toggles modem-control lines, or probes unrelated ports.

## Hardware activation gate

The demonstration mappings are not real VFD register claims. Before a physical configuration can be activated, capture:

1. The UNO Q SKU, OS image/core versions, and Windows USB descriptors.
2. The exact VFD manufacturer and model label.
3. The exact model and output type of all three sensors.
4. Official manuals and an engineer-approved isolated wiring plan.

Only Modbus read functions are in scope. Never connect UNO Q pins directly to motor phases, mains, the VFD DC bus, or an unisolated industrial output.

## Deliberate milestone boundaries

- Production CBOR, signed MSI/service installation, encrypted backup keys, full Argon2id enrollment, and hardware-in-loop certification remain hardening work.
- Vercel cannot access local USB hardware; it is the presentation/simulation surface only.
- The repository contains no device-write, arbitrary-register, terminal, flash, reset, or destructive evidence-delete API.
