# TRACE — Phase 3G: Euler Evidence Expansion (Live Capture)

**Status:** Complete. Capture + validation + comparison only — no UI, engine, contract, or completeness-rule changes; no Phase 3H work.
**Date:** 2026-09-22
**Depends on:** Phases 3A–3F (locked). InvestigationContract remains authoritative.
**Live calls this phase:** 2 (1×422 validation rejection at 0 cost + 1×200 capture at 1 credit).

---

## 1. Preflight summary

Endpoint `POST /api/v1/profiler/address/transactions` (shape proven by discovery fixtures), repo-canonical attacker read programmatically from `EULER_ATTACKER` (never retyped), window 2023-03-13→03-14, `per_page` 1000 initially, hard cap 5 calls. A multi-round address-confusion episode preceded capture: three distinct strings were presented conversationally as "canonical"; each verified at **zero** repo support while `0xb66cd9…` verified unanimous at all five precedence levels (lock, tests, implementation, fixtures, docs). Resolution: clipboard corruption; repository authoritative. No credits were spent on any unvalidated address.

## 2. Canonical address verification ($0)

`EULER_ATTACKER` imported from `src/investigations/euler.ts`:
`0xb66cd966670d962c227b3eaba30a872dbfb995db` — byte-identical in all five canonical test files and present in `hero-event.json`, `discovery/0xb66cd966.json`, `discovery/entity-euler-exploiter.json`. Verdict AGREE-PROCEED. The capture script imports this constant; the address never appears as a literal in capture code.

## 3. Calls and credit usage

| Step | Call | Result | Credits |
|---|---|---|---|
| 0 | `npm run smoke` (search/general) | 200 auth OK | 0 (remaining not reported) |
| 1 | transactions p1, `per_page: 1000` | **422** `value_out_of_range`: per_page max is **100** (Phase 1's ≤1000 figure does not apply here) | **0** (`creditsUsed: null`) |
| 2 | transactions p1, `per_page: 100` | **200, 17 rows, `is_last_page: true`** | **1** (`used: 1`, `remaining: 60`) |

Totals: **2 calls, 1 credit spent, 60 remaining.** Starting balance not reported by any response — not inferred. Error fixture preserved alongside the success fixture.

## 4. Raw fixture locations (new namespace, existing fixtures untouched)

- `fixtures/live/euler/profiler-transactions-2023-03-13-p1.json` (16.8KB — full response body, meta, request, pagination summary, captured_at)
- `fixtures/live/euler/profiler-transactions-2023-03-13-p1.error.json` (the 422 round)
- `fixtures/live/euler/manifest.json` (plan, per-call records, stop reason, totals)
- Capture code: `scripts/capture-euler-0313.ts` (budget cap + stop rules enforced in code). Key-leak grep over the namespace: 0 hits.

## 5. Pagination behavior

Verified from the response: default latest-first within the date filter; `pagination: {page, per_page, is_last_page}` present; `is_last_page: true` on page 1 with 17 rows → single page covers the window. No redundant requests made. Corrected limit: `per_page ≤ 100`.

## 6. Records captured and timestamp coverage

17 rows, `2023-03-13T09:12:23` → `2023-03-14T10:41:35`. Methods: `received`×11, `swapExactETHForTokens(…)`×2, `withdraw()`×2, `sent`×2. Row volumes present on 15 rows (max **$177,093,899.14** on the funding tx itself), null on 2 (preserved). Attacker address occurs in every row. **Zero overlap** with the discovery dust sample (disjoint windows, as expected).

## 7. Validation

Timestamps: 17/17 parseable. Hashes: 17/17 present hex. Duplicates: 0. Funding tx `0x298bde3f…db55` present (same hash as the First Funder RELATION evidence — two lenses, one observation; dedupe correctly keeps both, test LIVE-3). Nulls preserved exactly. All 17 normalize via the unchanged `normalizeTransaction` path as FACT with live source meta (endpoint/requestId/fixture file).

## 8. Reconstruction BEFORE vs AFTER (same engine, expanded inputs: +17 live tx rows)

| Field | BEFORE (fixtures only) | AFTER (+ live rows) |
|---|---|---|
| Events | 8 (3 primary) | **30 (12 primary)** — 22 new, all from live rows |
| Entities | 19 | **30** |
| Relationships | 20 | **37** |
| Status | reconstructed | reconstructed |
| Data gaps | 4 | 4 (pagination note now partly historic; texts unchanged — no engine edit) |
| Determinism | repeat-identical | repeat-identical |

New evidence includes the $177M funding movement as a primary transfer, an $8.8M `withdraw()`, swap-method rows, and 7 new DERIVED groupings over incident-day movements. Engine mapping audit: `withdraw()`/`swapExactETHForTokens` rows with `source_type: transfer` map to `transfer` (not contract-interaction) per the documented transfer-like rule — reviewed, **no bug found, no engine change made**.

## 9. Completeness BEFORE vs AFTER

BEFORE: `fixture-cache` / `incomplete` (dust-only transaction window). AFTER: a mixed build would be neither `fixture-cache` nor honestly `live-nansen`, and 03-15→03-27 plus the return period remain absent — so `transactionWindowCovered` cannot flip and the rule cannot be satisfied. **Completeness stays `reconstructed` / `incomplete` with an updated reason; the rule is unchanged.** The served Euler contract is untouched (still fixtures-only). Mixed-source handling is noted as a future-phase design question, not a change.

## 10. Tests, typecheck, build

`npm test` **79/75→79 pass** (75 existing + 4 `test/live-capture.test.ts`: live-row normalization determinism, window + funding + methods, cross-kind non-collapse, expanded-set determinism with no hypotheses). `tsc --noEmit` clean. `npm run build` succeeds.

## 11. Remaining evidence gaps

03-15→03-27 window still empty; multi-day return-period transactions uncaptured; counterparty aggregates still window-level; per-token USD still null on tx rows; pagination note persists for the discovery sample.

**STOP.** Phase 3H not started. No UI/graph/replay/contract changes made.
