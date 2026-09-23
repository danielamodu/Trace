# TRACE — Phase 3J: Second Case (FTX) + Metadata-Injection Defense

**Status:** Complete. First case added beyond Euler; registry now serves two cases.
**Date:** 2026-09-23
**Depends on:** Phases 3A–3I (locked). Euler case unchanged (30 events / 12 primary / 30 entities / 37 relationships, mixed-source, `reconstructed`/`incomplete`).
**Live calls this phase:** **3** (drain-window transactions, 1 credit each → **55 credits remaining**). Counterparties fixture reused from a prior 5-credit spend (2026-09-21). No `profiler/address/labels` call (100 credits — avoided).

---

## 1. The case

`case_ftx_2022` — "FTX unauthorized transfers and laundering", ethereum, window `2022-11-11 → 2022-11-30`. Subject `0x59abf383…fd32b`. Built exactly like Euler (`src/investigations/ftx.ts` mirrors `euler.ts`): fixtures on disk → `loadFtxInputs()` → `reconstruct()` → `buildFtxContract()` → `CASE_REGISTRY`. No new engine code — the case is data + a loader.

Served contract: **327 events** (300 FACT + 3 RELATION + 24 DERIVED), 303 observed, **54 primary**, **95 entities** (94 counterparty + 1 subject), **117 relationships**, peak single observed movement **$5,226,209.18**. `status: reconstructed`, `completeness: incomplete`. The completeness rule (`complete` iff reconstructed + live-nansen + all coverage flags) holds unchanged — fixture-cache is structurally always `incomplete`, so no fixture case can ever style itself "complete".

## 2. Inputs and why a live capture was needed

Three sources feed the loader:
- `discovery/entity-ftx-exploiter.json` — counterparty aggregates (pre-existing, reused).
- `discovery/ftx-related-wallets.json` — related wallets incl. the First Funder (3 rows).
- `live/ftx/manifest.json` → 3 captured transaction pages.

Only transactions produce **timeline events**; counterparties and related-wallets become entities + undirected aggregate relationships, never events. So a reconstruction with a real timeline required capturing transactions live — the flagship value of the case could not come from the aggregate fixtures alone.

## 3. Live capture (`scripts/capture-ftx.ts`)

`profiler/address/transactions`, `hide_spam_token: true`, `per_page: 100`, hard `MAX_CALLS: 3`. 3 pages, 300 rows, 3 credits (57 → 55). Captured span `2022-11-12T08:13:47 → 2022-11-13T18:50:47`, latest-first; `is_last_page` never true — this is an honest **partial** window, and the contract says so (coverage flag `transactionWindowCovered: false`, plus a gaps-panel line). The subject address is imported programmatically from `ftx.ts`, never retyped, and the manifest records `requestId`/credits/timestamps per page for auditability.

## 4. Metadata-injection defense (the real find)

One captured transaction carried a **FOLLOWME scam airdrop** whose four token entries each embedded a **200,030-character `to_address_label`** — a metadata-injection payload. `hide_spam_token: true` does **not** strip it. Unmitigated it blew p1 to 873 KB and the contract to 1.2 MB.

Fix: a shared, deterministic sanitizer `scripts/sanitize-tokens.ts` — `sanitizeRows()` clears oversized `token_symbol`/`token_name` and both row- and token-level `from_address_label`/`to_address_label` (caps 40/80/96) **in place**, recording cleared counts. Applied at capture time and re-applied once (0 credits) via `scripts/resanitize-ftx.ts` to the already-written fixtures — cleared **4 labels** (all p1); p1 → 94.5 KB, contract → ~650 KB. Real transfer anchors (hashes, values, timestamps, addresses) are never touched.

Regression lock: `test/ftx.test.ts` **FTX3** asserts the longest string in the served contract is `< 8192`, so the 200 KB label can never re-enter the contract.

## 5. Honest role assignment (a coincidence worth documenting)

The First Funder `0x2faf…6ad2` is *also* a ~$219M counterparty. The engine assigns one role by rank, and `counterparty` outranks `funder` — so entity roles are 94 counterparty + 1 subject + **0 funder**, even though funding evidence exists. The funding is carried faithfully as a **relationship edge** (`nansenRelation: 'First Funder'`), not erased. `FTX2` asserts the relationship + both addresses' presence rather than a funder-role entity, and a code comment explains the coincidence. No label was invented to paper over it.

## 6. Registration + adapter

`registry.ts` appends `{ id: FTX_CASE_ID, buildContract: buildFtxContract, available: true }`; `index.ts` re-exports `./ftx.ts`. The UI adapter (`lib/cases.ts`) and pages are case-agnostic — no per-case code. `app/page.tsx` footer fixed to pluralize ("2 cases available in this build").

## 7. Dev-server fix (`next.config.mjs`)

Dev returned 404 on **every** route (both cases, `/api/cases`) because a `pnpm-workspace.yaml` in `C:\Users\USER` hijacked Turbopack's root inference, resolving `app/` outside the repo. Prod build was unaffected. Fixed by pinning `turbopack.root` to the repo dir (derived from `import.meta.url`). All routes 200 after restart.

## 8. Tests, typecheck, build, e2e

- `test/ftx.test.ts` (new, **FTX1–FTX5**): reconstructed + incomplete + fixture-cache with primary events/entities/rels; funding evidence + descriptive-only roles + funder/subject present; sanitization guard (`< 8192`); byte-identical rebuild + no `"HYPOTHESIS"`; every false coverage flag carries a matching reason.
- `test/generality.test.ts` (GEN4) and `test/ui-adapter.test.ts` (U1–U3) generalized from Euler-only to both cases (case-agnostic assertions).
- **`npm test` 98/98 pass. `tsc --noEmit` clean. `npm run build` succeeds. `npm run e2e` 11/11 pass** (added an e2e that opens the FTX case from the Command Center).
- Browser check: Command Center lists both cases; FTX page renders header, 327-event timeline, replay, inspector, graph, and gaps panel with no console/hydration errors; sanitized labels display normally.

## 9. Limitations

- Transaction window is a **partial** drain-window sample (3 pages, latest-first, `is_last_page=false`); full coverage needs pagination/live capture — surfaced, never hidden.
- 39 events have no source USD value; not estimated or zero-filled.
- Raw unsanitized recon (`fixtures/raw/0x59abf383.json`, 986 KB, contains the 200 KB label) is retained out-of-tree under gitignored `fixtures/raw/` for provenance; it is **not** read by the loader.
- HYPOTHESIS channel remains unproduced — intent/attribution/causation stay out of scope.

**STOP.** Two cases served, both honest and deterministic. HYPOTHESIS not started.
