# Local AI and research tools

PlantLens keeps engineering context and CAD state local by default. The browser workspace uses IndexedDB for context files and `localStorage` for the CAD document. The Windows desktop app uses its local SQLite store and exposes a deliberately small API through the preload bridge.

## Local CAD and AI

- CAD save/load is exposed as `plantlensDesktop.workspaceSave(document, expectedRevision)` and `workspaceLoad()`.
- Drafting is exposed as `agentDraft(request, document)`. The desktop inference service is local-model backed; when it is unavailable the browser falls back to deterministic, bounded intents (`rename ASSET-ID to NAME` and `add sensor|motor|drive|controller ID named NAME`).
- Drafts are proposals. Each change is individually approved, rejected, or edited. Approval checks the proposal base revision and increments the workspace revision; no proposal silently activates.
- `modelStatus()` reports local model availability. No cloud model API is used by this CAD path.

## Local context files and retrieval

The Context dock accepts text exports only: `.txt`, `.md`, `.csv`, and valid `.json`. PDF and image extraction are intentionally unsupported; export their text first. Browser imports are limited to 512 KiB per file, 20 documents, and 8 MiB total. The desktop evidence bridge accepts the same formats and allows up to 2 MiB per document. Desktop evidence is chunked and searchable locally; browser retrieval uses the IndexedDB copy. Search returns excerpts and is evidence for review, not proof of a register value or causal diagnosis.

Imported text is treated as evidence, never as agent instructions. Filenames are plain filenames (no path separators), document names are bounded, and duplicate content is detected by SHA-256. Keep sensitive notes on the device and export an evidence bundle before clearing local workspace data.

## Explicit web research

Web research is a separate, opt-in action. The browser build always shows a clear desktop-only blocked state. In the Windows app, the query must include `approved: true` for that specific request; changing the query clears the checkbox. Only the query is sent to Brave Search—workspace files and telemetry are not attached. Search returns at most five bounded results. Importing a result is a second explicit action and fetches only standard HTTPS text/HTML under the bounded response limits; imported web text still needs engineer/manufacturer review.

### Brave Search setup (Windows desktop)

1. Open **Web research → Set up search**, enter your Brave Search API key, and choose **Save encrypted credential**. `BRAVE_SEARCH_API_KEY` is also supported as a process-environment configuration.
2. The configuration path requires Windows `safeStorage` encryption. The key is stored as the encrypted `braveSearchApiKeyEncrypted` preference, bound to that Windows account/machine; PlantLens does not write a plaintext key to the workspace database.
3. Restart/reconfigure if `research-status` reports `configured: false`. A missing key, provider failure, malformed/oversized response, or unavailable network returns a blocked result rather than silently falling back to an online source.

The desktop preload surface is intentionally limited to `webResearch`, `researchImport`, `researchStatus`, and `researchConfigure`; renderer code cannot access Node or arbitrary network APIs. Research URLs are constrained to HTTPS, reject credentials, ports, IP literals, localhost/private DNS answers, excessive redirects, non-text content, and responses over the configured limits.

## Evidence boundary

Local retrieval is available without any API key. Online results are discoverability aids, not authoritative evidence. Before publishing an engineering mapping, cite the exact local excerpt or reviewed manufacturer source and record the human review decision. Simulated operational values and illustrative electrical templates must not be used for construction or commissioning.
