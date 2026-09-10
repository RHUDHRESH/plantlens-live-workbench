# Windows engineering preview — acceptance record

This is an **unsigned development preview**, not a certified hardware release. The web deployment remains a simulation/presentation application. It cannot reach a user's local UNO Q.

## Implemented and exercised

- Electron shell with a bundled Next standalone service, companion and CPU inference runtime; isolated renderer and narrow IPC.
- Per-user NSIS installer, Start menu entry, workspace retention on uninstall, default exit-on-close.
- SQLite WAL workspace history with optimistic revision checks, local manual full-text search, persisted agent checkpoints, and insert-only approval records.
- Three CAD views with shared IDs, typed connections, selection inspector, placement, undo/redo, and individual proposal review.
- Local model setup with pause/resume, cancellation, pinned source checksum verification and local quantization.
- Structured local AI drafting restricted to asset additions and label changes. Validation runs independently of model output. Drafting does not publish configuration or touch hardware.
- A real CPU-only rename request returned one valid pending change and a durable checkpoint in 7.556 seconds including cold startup on the development PC (32 GB RAM). This is a smoke result, **not** the target-machine benchmark.
- Shared descriptor golden fixture accepted by TypeScript, companion JavaScript and Python. App Lab HTTP transport is separate from serial and does not pretend to support arbitrary COM firmware.

## Model provenance

The official Qwen repository at the pinned revision provides Q8_0, not Q4_K_M. Setup therefore downloads the official 1,834,426,016-byte Q8_0 artifact, verifies SHA-256, then uses the pinned llama.cpp quantizer to produce Q4_K_M locally. The generated file's hash is stored in the local installation receipt and checked on restart. This is explicitly a requantization, not an official Qwen Q4 artifact. Source and runtime revisions, hashes and licenses are in `model-manifest.json`.

Manual operation is available when AI is offline, cancelled, missing or unable to fit the machine. The model has a 4,096-token context, one concurrent request and bounded output; it unloads after five idle minutes.

## Release gates still open

- Clean Windows 11 account installation, upgrade and uninstall testing without developer dependencies.
- 8 GB CPU-only memory/latency benchmark during 2,560-sample/second ingestion; high-DPI, full screen-reader and keyboard-only acceptance.
- Signing identity, signed manifest publication and a tested signed automatic-update channel. Development builds are explicitly unsigned.
- Exact UNO Q board/core build and physical Bridge, ADC, USB ownership, reboot and unplug/replug tests. No board has been flashed by this implementation.
- Exact sensor/VFD identities, manufacturer documentation, approved isolation plan and verified terminal/register mappings. All seeded engineering connections are illustrative or unverified.
- Complete model-driven mapping, schematic patching and diagnostic specialist tools beyond bounded asset editing. The public specialist graph reports prerequisite checks and blocked work; it is not autonomous manual research.
- Full imported-manual management UI and end-to-end migration of existing web knowledge into desktop FTS.
- Production local-team authorization and threat-model review. The CAD review UI checks proposal versions and values, but a transactional, role-enforced individual-approval IPC is still required before treating the desktop database as an authorization boundary. Current workspace saves validate structure; they do not prove that an engineer approved a change.
- Durable evidence export/backup recovery, power-loss and disk-pressure acceptance across the entire platform.
- Edge/ChatGPT generated equipment assets when an Edge connection is available. The engineering canvas uses precise vector components independently of this step.

Do not advertise these open gates as completed. No terminal, arbitrary command, firmware-flashing or machinery-control IPC is provided.
