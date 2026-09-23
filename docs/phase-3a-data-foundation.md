# TRACE — Phase 3A: Data Foundation & Address Verification

**Status:** Complete. Data foundation only — no frontend, graph, significance scoring, or timeline grouping.
**Date:** 2026-09-21
**Depends on:** [phase-1-nansen-reconnaissance.md](./phase-1-nansen-reconnaissance.md), [phase-2-product-system-spec.md](./phase-2-product-system-spec.md), the `src/types/` domain model.
**API calls this phase:** **0** (zero live Nansen calls; 0 of the 10-credit budget used). All work reads existing sanitized fixtures.

---

## 1. Hero address verification (Task 1) — discrepancy found and resolved

The Phase 2 brief and the Phase 3A brief both listed three hero addresses. I cross-checked them against the **raw fixture bytes** (not the report prose). **None of the brief's addresses appear in any fixture.** The addresses the captured evidence actually supports are different. This was reported as a STOP before any implementation; the user then approved **Option A** — lock the fixture-validated set as canonical.

| Role | Brief's address (rejected) | **Canonical (locked, fixture-validated)** | Fixture evidence |
| --- | --- | --- | --- |
| Attacker EOA | `0xb6689fadab62de20eab9fc6202624fa0133095db` | **`0xb66cd966670d962c227b3eaba30a872dbfb995db`** | [entity-euler-exploiter.json](../fixtures/discovery/entity-euler-exploiter.json) line 19 — top counterparty of "Euler Exploiter"; `interaction_count` 108; `volume_in_usd` 378,408,892.15; label `jaydoteth.eth*`. Also [0xb66cd966.json](../fixtures/discovery/0xb66cd966.json) — 25 transactions in-window, `to_address_label: "jaydoteth.eth"`. |
| First Funder | `0x03634d3215836f4a5b6851b1268b2c4ce7b75f1c` | **`0x036cec1a199234fc02f72d29e596a09440825f1c`** | [0xb66cd966.json](../fixtures/discovery/0xb66cd966.json) `probes.related_wallets.sample[0]` — `relation: "First Funder"`, evidence tx `0x298bde3f…db55`, `block_timestamp 2023-03-13T09:12:23Z`. |
| Balancer Vault | `0xba13780f3552d07c1c55a84829305e8d8a32f2c8` | **`0xba12222222228d8ba445958a75a0704d566bf2c8`** | [entity-euler-exploiter.json](../fixtures/discovery/entity-euler-exploiter.json) line 115 — label `balancervault.eth`, `volume_in_usd` 354,997,693.42. Matches the canonical Balancer V2 Vault. |

**Verification method (reproducible):**
```bash
# Brief's addresses — 0 hits across all fixtures:
grep -rli "0xb6689fadab62de20eab9fc6202624fa0133095db\
|0x03634d3215836f4a5b6851b1268b2c4ce7b75f1c\
|0xba13780f3552d07c1c55a84829305e8d8a32f2c8" fixtures/   # → (no files)

# Canonical addresses — present in the hero fixtures:
grep -rli "0xb66cd966670d962c227b3eaba30a872dbfb995db\
|0x036cec1a199234fc02f72d29e596a09440825f1c\
|0xba12222222228d8ba445958a75a0704d566bf2c8" fixtures/
#  → fixtures/hero-event.json
#  → fixtures/discovery/0xb66cd966.json
#  → fixtures/discovery/entity-euler-exploiter.json
```

**Decision:** the fixture-validated addresses above are the **canonical source of truth** for TRACE's Euler incident. The brief's addresses are not used anywhere in implementation. The canonical set is asserted as constants in [test/normalize.test.ts](../test/normalize.test.ts) and exercised by the address-preservation tests.

---

## 2. Type review (Task 2)

Reviewed [src/types/](../src/types/) (domain model) and [src/nansen/types.ts](../src/nansen/types.ts) (wire types) + [client.ts](../src/nansen/client.ts).

**Finding: no conflicts, one genuine gap.** The two existing type layers are sound but sit at opposite ends:
- `src/nansen/types.ts` mirrors the **wire format** — partial, with index signatures so unmodelled fields survive. Correct for a client boundary, but it carries raw nulls/empties/`"88"`-strings straight through.
- `src/types/*` is the **domain model** (Investigation/TraceEvent/Entity/Relationship/Provenance) — the shape the UI renders after reconstruction.

Nothing translated between them. That intermediate **normalized contract** was the missing layer. Also noted (informational, not blocking — index signatures absorb them): the wire types omit some fields the fixtures actually return — `AddressCounterparty.tokens_info[]`, `TgmDexTrade.traded_token_address`, `TgmFlowBucket.total_inflows_count/token_amount/holders_count`. The normalized layer reads these explicitly, so no change to the wire types was required for Phase 3A.

**Resolution:** added `src/reconstruction/normalized-types.ts` as the single internal data contract between wire and domain. It **reuses** `ProvenanceKind` and `NansenSource` from `src/types/provenance.ts` rather than redefining them — one provenance vocabulary across the codebase. No types were duplicated.

---

## 3. Normalized schemas (Task 3)

All in [src/reconstruction/normalized-types.ts](../src/reconstruction/normalized-types.ts). Every normalized record is returned inside a `Provenanced<T>` wrapper:

```ts
interface Provenanced<T> {
  value: T;
  provenanceKind: 'FACT' | 'RELATION';   // normalized layer NEVER emits DERIVED/HYPOTHESIS
  source: SourceMeta;                      // endpoint, requestId, capturedAt, fixtureFile, creditsCost
  unavailableFields: string[];             // sorted; names every null/missing/"" source field
}
```

| Normalized type | Source endpoint | Provenance | Notes |
| --- | --- | --- | --- |
| `NormalizedTransfer` | `tgm/transfers` | FACT | from/to/tx/timestamp required; labels/type/amounts optional |
| `NormalizedSwap` | `tgm/dex-trades` | FACT | `action` validated BUY\|SELL; traded-token fields optional |
| `NormalizedCounterparty` | `profiler/address/counterparties` | FACT | `tokens_info[]` → `NormalizedTokenBreakdown[]`; `num_transfer` string→number |
| `NormalizedRelationship` | `profiler/address/related-wallets` | RELATION | Nansen link, **not** ownership proof; carries evidence `txHash` |
| `NormalizedFlowBucket` | `tgm/flows` | FACT | dex/cex split kept explicitly `null` |
| `NormalizedTimestamp` | (all) | — | `{ raw, iso, assumedUtc, epochMs }` |

**Timestamp normalization (determinism-critical):** `raw` is preserved verbatim. Some fixtures return naive timestamps (`2023-03-31T18:02:35`, no offset) while others carry `Z`. `Date.parse` interprets a naive string in **machine-local** time, which would make output non-deterministic across environments. The normalizer appends `Z` to naive inputs (Nansen documents UTC), sets `assumedUtc: true`, and computes `epochMs` — so output is identical regardless of host timezone. The assumption is recorded, never hidden.

**Normalization guarantees (all enforced in [normalize.ts](../src/reconstruction/normalize.ts)):**
- **Deterministic** — pure functions, no wall-clock/random; `unavailableFields` sorted; identical input → identical output (test #8).
- **Runtime-validated** — external rows are not trusted; `isObject` + `requireString` gate required fields.
- **Explicit absence** — `null`/`undefined`/`""` → `null` **and** the field name is pushed to `unavailableFields`. Nothing is guessed or zero-filled.
- **Anchors preserved** — timestamp raw string, tx hash, and addresses pass through byte-for-byte (no checksumming/lowercasing).
- **Source metadata preserved** — endpoint, `requestId`, `creditsCost`, `capturedAt`, `fixtureFile`.
- **No fabricated values, no causal claims** — the layer emits only FACT/RELATION. DERIVED and HYPOTHESIS are produced later by the (unbuilt) reconstruction engine. `RELATION` is explicitly documented as a Nansen-asserted link, not ownership/intent.

---

## 4. Fields that are unavailable in the fixtures

Represented explicitly (`null` + listed in `unavailableFields`), never inferred:

- **`tgm/flows` dex/cex split** — `total_inflows_dex`, `total_outflows_dex`, `total_inflows_cex`, `total_outflows_cex` are all `null` in the hero data. Per the fixture's own `warnings`, these are only populated when `label=exchange`; for other labels use `tgm/flow-intelligence`.
- **Counterparty labels** — some rows (burn address `0x000…`, `0xee009f…`) have `counterparty_address_label: null`.
- **Empty token metadata** — some `tokens_info[]` entries have `token_symbol: ""`, `token_name: ""`, and `total/in/out amount: null` (unrecognized tokens). Symbols/names → `null`; amounts stay `null`.
- **Related-wallet label** — `address_label: ""` for the First Funder row → `null`.
- **USD pricing on raw transactions** — `profiler/address/transactions` token entries carry `price_usd: null`, `value_usd: null` (only a row-level `volume_usd` is present). Not consumed by Phase 3A normalizers; noted for the engine phase.

---

## 5. Validation rules (Task 4) — test coverage

Tests in [test/normalize.test.ts](../test/normalize.test.ts), Node's built-in `node:test` + `node:assert` (zero deps). Run with `npm test`.

| # | Requirement | Test(s) |
| --- | --- | --- |
| 1 | Valid response normalization | transfer / swap / counterparty (hero) / relationship (hero) from real fixtures |
| 2 | Missing optional fields | synthetic transfer w/ no optionals; hero burn-row null label array |
| 3 | Null flow values | `tgm/flows` dex/cex splits assert `=== null` (not 0) + reported unavailable |
| 4 | Malformed records | non-object throws; missing required field throws w/ field name; bad swap action throws; unparseable timestamp throws |
| 5 | Timestamp preservation | Z-suffixed → `assumedUtc:false`; naive → `assumedUtc:true`, UTC-stable epoch |
| 6 | Address preservation | every hero counterparty address byte-for-byte equal to source |
| 7 | Provenance preservation | source endpoint/requestId/credits/fixture preserved; layer emits only FACT/RELATION |
| +8 | Determinism | identical input → identical serialized output |

---

## 6. Files created / modified

**Created**
- `src/reconstruction/normalized-types.ts` — normalized intermediate data contract.
- `src/reconstruction/normalize.ts` — deterministic, runtime-validated normalizers + `NormalizationError`.
- `src/reconstruction/index.ts` — module barrel.
- `test/normalize.test.ts` — 17 tests across all seven required categories (+ determinism).
- `docs/phase-3a-data-foundation.md` — this document.

**Modified**
- `package.json` — added `"test": "node --test \"test/**/*.test.ts\""`.

No changes to `src/nansen/*` or `src/types/*` (reused as-is). No dependencies added.

---

## 7. Commands executed & results

| Command | Result |
| --- | --- |
| `grep -rli <brief addresses> fixtures/` | **0 files** — brief addresses absent |
| `grep -rli <canonical addresses> fixtures/` | 3 files — hero-event.json + 2 discovery fixtures |
| `node --check src/reconstruction/*.ts` | ✅ all 3 pass |
| `node --input-type=module import('./src/reconstruction/index.ts')` | ✅ barrel resolves; 8 runtime exports |
| `npm test` | ✅ **17 pass / 0 fail** (~511ms) |

`npm test` output: `tests 17 · pass 17 · fail 0`.

---

## 8. Unresolved blockers / notes for Phase 3B

- **Naive timestamps (`profiler/address/transactions`)** are assumed UTC (`assumedUtc:true`). Confirmed consistent with Nansen's documented UTC convention; flagged so the engine/UI can surface it. No blocker.
- **`tgm/flows` cohort split unavailable** for non-exchange labels — if the reconstruction needs a CEX/DEX breakdown, it must use `tgm/flow-intelligence` (a live call, budgeted separately). Not needed for the core fund-flow trace.
- **Transaction-level USD pricing** (`price_usd`/`value_usd` null on token sub-entries) — the engine should rely on row-level `volume_usd` or the counterparties volumes, not per-token USD, when reconstructing values.
- **Fixtures are point-in-time and revisable** — `capturedAt` is preserved on every record; a re-capture may shift labels/prices.
- **Not started (correctly out of scope):** significance scoring, timeline grouping, entity admission, relationship/edge assembly into the domain `Investigation`, any UI. These are Phase 3B+.

**STOP.** Phase 3B not started. Awaiting review.
