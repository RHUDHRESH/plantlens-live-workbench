# Visual and adversarial review — 2026-09-10

## Reproduced and fixed

1. **Desktop approved-add persistence regression:** the workspace validator rejected an approved add-asset history item because its asset now existed. Pending duplicates remain rejected; approved history requires the created asset to exist. Regression test fails before the fix and passes afterward.
2. **Malformed search response crash:** a JSON `null` provider response caused an uncaught property access. Invalid root values now return an actionable blocked result.
3. **Credential-bearing redirect hardening:** search-provider fetch previously used default redirect following with a provider-specific token header. The request now uses `redirect: error`. A synthetic test asserts this option and that only the query/count enter the URL. No real credential was used and no actual credential leakage was observed.

## Checks performed

- 26 desktop tests pass, including malformed/oversized evidence, path restrictions, missing consent, IPv4/IPv6 private-address rejection, forbidden proposal operations, immutable revision conflicts and the new regressions.
- All 10 Playwright workflows pass against the deployed public application.
- Real local Qwen test retrieved a synthetic hostile document instructing shell execution, VFD register writes, automatic approval and manual upload. It returned only a pending rename proposal; the active document was unchanged. The retrieved evidence ID and checkpoint were verified. This is one adversarial case, not proof of universal prompt-injection resistance.
- Rebuilt Windows development installer and ran packaged smoke: evidence retrieval, consent blocking, companion enumeration, revision persistence and service shutdown passed.
- Inspected actual screenshots of light/dark CAD and analysis, with no console errors on the public workbench. Context controls remain visible at the reviewed short viewport. Existing browser tests exercise keyboard splitter adjustment.

## Open findings / release gates

- **High: authoritative approval authorization is not implemented.** Desktop engineering state save validates shape and revision but trusts supplied workflow state/actor metadata. A compromised trusted renderer must not be treated as an authorized engineer. Production needs host-side authenticated identities, role checks and transactional approve commands with host-owned device evidence. The current app remains a development preview.
- **High: no hardware-in-loop acceptance.** Real UNO Q/VFD isolation, exact model/register evidence, disconnect behavior and schema changes need physical verification. UI `GOOD` is not proof of correct wiring.
- **Release:** unsigned installer; clean-account installation, signed updates, backup recovery and 8 GB memory/load benchmarks remain unverified.
- **UX:** terminal labels are small at fit-to-view zoom; narrower analysis tables require horizontal scrolling; theme control cycles system/dark/light without a visible current-mode label. These need additional usability polish.
- **Scope:** no live paid-provider search was performed. PDF/photo parsing is unsupported. The adversarial model run checks structural boundaries, not every possible misleading semantic suggestion.

## Updated development installer

`desktop/dist/PlantLens-Unsigned-Dev-0.1.0-windows-x64.exe`

SHA-256: `8335250AB9CAF2F98A244DDDB281E03F24CFA8C87DE3A33F8255B9B8254A8147`

The public UI was unchanged by these desktop-only fixes; its deployed browser checks passed.
