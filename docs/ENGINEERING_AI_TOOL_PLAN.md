# Engineering workspace: separate tool and evidence plan

## Ten workstreams

1. CAD placement: 2D component symbols, terminal-aware connections, selection, pan/zoom, undo/redo and readable editing.
2. Register assignment: select an asset, select an advertised channel, describe the intended register binding and review the transform.
3. Live verification: device/schema identity, datatype, units, range, cadence, quality and stale-state checks. A numeric value alone is not proof of a correct register.
4. Context import: bounded local text files, content hashes, provenance, duplicate detection and explicit unsupported-format messages.
5. Local retrieval: chunked excerpts and SQLite FTS in the desktop app; browser-local search for the public preview. No second embedding model in the 8 GB baseline.
6. Opt-in research: review a short outgoing query, explicitly permit search, inspect results, separately choose a source to import.
7. Restricted tool routing: typed evidence access, bounded inspection, deterministic validation and proposed changes. No shell, raw serial, arbitrary database queries or device-control tools.
8. Dependency DAG: directed prerequisites and data flow, with cycles rejected for this graph type.
9. Causal loops and coverage matrix: signed influence hypotheses may have feedback cycles; the matrix distinguishes observed, mapped, missing and unverified coverage.
10. UX and adversarial verification: browser interaction tests, keyboard controls, status accuracy, malformed files/outputs and consent/provider error handling.

## The workflow

Arrange components → select a component → propose a channel/register binding → check official documentation → preview the live transform → review validation → approve the configuration item.

Imported manuals and online pages are untrusted evidence, not instructions. Neither finding a document nor seeing a plausible reading proves that a register is correct. Unknown hardware model, missing citation, stale stream or schema mismatch must remain visible and block activation as applicable. Equipment writes are excluded.

After the evidence is available, the small local model can retrieve bounded excerpts and draft supported changes. It must disclose unavailable tools, missing context and unsupported operations. Returning a fluent answer is not a successful hardware validation.

## Tool contract

| Capability | Input boundary | Output | Authority |
|---|---|---|---|
| Import local context | Allowlisted text formats, size/count limits | Hashed document + excerpt IDs | User chooses files; no cloud upload |
| Search local evidence | Bounded text query and result limit | Cited excerpts | Local read-only |
| Inspect evidence | Existing evidence/excerpt ID | Bounded text + provenance | No filesystem paths |
| Search the web | Explicit consent, bounded query, configured provider | Source results or actionable BLOCKED state | No implicit prompt/telemetry upload |
| Import a web result | Previously returned result ID + separate consent | Local evidence record | No arbitrary URL tool for the model |
| Inspect telemetry | Negotiated channel and bounded sample window | Raw value, time, quality and identity | Read-only companion |
| Validate a binding | Declarative typed mapping + evidence + live state | Errors, warnings and preview | Deterministic, no writes |
| Propose a change | Base revision + allowlisted patch | Pending review item | Cannot activate itself |

API keys are entered through a password field, encrypted by the desktop host, never returned by status APIs, and never stored in the repository or model context. Without a search-provider key, local context, manual configuration and local inference remain usable. Do not substitute a different remote provider silently. Provider search is not itself manufacturer verification.

## Three different graph representations

- **Dependency DAG:** an arrow means a declared dependency. Reject cycles; use this for acquisition and evidence prerequisites.
- **Causal loop:** an arrow is an explicitly labelled positive/negative influence hypothesis, possibly delayed. Cycles are allowed here. A feedback loop is not a DAG and is not a proven diagnosis.
- **Coverage matrix:** assets/diagnostic requirements against signals/evidence. Missing, unverified and unavailable must not be rendered as healthy or covered. Derive coverage from actual mappings and evidence references where available.

Each relation should carry stable IDs, provenance and a verification state. Correlation or an AI suggestion is not sufficient causal evidence. Template diagrams must be clearly marked illustrative.

## Low-memory strategy

Keep acquisition independent of inference. Use the existing pinned Qwen3 1.7B Q4_K_M CPU runtime with one request, bounded retrieved context, 4,096 tokens and idle unloading. Search providers are transport adapters, not models. Evaluate actual memory and latency on an 8 GB machine before making performance claims.

## Explicit release boundaries

The current Windows build is an unsigned development preview. Physical UNO Q/VFD validation and exact wiring require actual equipment and official model manuals. Production role-enforced approval, clean-account installation, 8 GB load acceptance and signed updates remain separate release gates. The implementation must report the supported import formats and AI operations rather than implying full PDF/photo parsing or unrestricted autonomous engineering.
