# Engineering workspace delivery check — 2026-09-10

## Implemented in this increment

- Neutral, unbranded equipment SVGs; three-view CAD workbench with controlled drag, multi-selection placement, undo/redo, resizable panels, inline proposal editing, source citations and a persistent context dock.
- Device UUID/schema-pinned, advertised-channel mapping review. Frozen proposals persist and require a current quality-checked sample for UI approval. Unsupported unit conversions remain blocked.
- Desktop SQLite text evidence with FTS5 retrieval, content hashes and excerpt provenance. Browser preview keeps its own bounded IndexedDB context.
- Separate consent-gated Brave Search and selected-source import. Credentials use Electron safeStorage; imported HTTPS pages have DNS pinning, private-address rejection, bounded bodies and deadlines.
- Local Qwen drafts retrieve bounded excerpts and remain pending human review. Supported model edits are asset creation and renaming, not arbitrary wiring or autonomous register research.
- Editable dependency DAG, signed feedback hypotheses and mapping coverage at `/analysis`. Analysis persistence is browser-local, including inside Electron; it is not claimed to be SQLite-backed.

## Verification

- TypeScript, ESLint and production Next.js build pass.
- 119 unit tests, 23 desktop tests, 10 companion tests and the Python golden-contract test pass.
- 10 Playwright workflows pass: existing simulation/live-demo flows, three CAD views, drag/save, individual proposal approval, local import/retrieval/reload, consent reset, unsupported formats, keyboard resizing and DAG/loop persistence.
- A real CPU local-model smoke retrieved an imported excerpt and returned its evidence ID with a pending rename proposal in 6,983 ms. This was a development PC, **not** the 8 GB acceptance machine.
- Packaged Electron smoke checks model IPC, authenticated companion enumeration, SQLite evidence search, missing-consent rejection, engineering revisions, CAD save/load and process shutdown.

## Boundaries, not completed acceptance claims

- Windows installer is an **unsigned development build**. Signing, clean-account install/update/uninstall and 8 GB performance acceptance remain pending.
- No physical UNO Q, sensor or VFD commissioning was performed. Electrical templates are illustrative, and exact wiring/register claims require equipment identification and manufacturer review.
- Web research needs a user-configured Brave Search API key; an external search was not run using a real paid credential during this check.
- TXT/MD/CSV/JSON import is supported. PDF/image extraction and local photo understanding are not implemented.
- Development role guards and review validation are not a production authentication/authorization boundary. The desktop engineering save API persists strict revisioned state; it is not yet an authoritative signed approval service.
- Causal relations remain hypotheses. MAPPED means an approved binding exists, not that a machine is healthy or the measurement is currently available.
- Public Vercel is demonstration-only and cannot access the local hardware/model.

The separate architecture plan is `ENGINEERING_AI_TOOL_PLAN.md`; operating instructions are in `LOCAL_AI_TOOLS.md`.
