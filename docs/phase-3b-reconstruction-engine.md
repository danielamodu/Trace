# TRACE — Phase 3B: Deterministic Reconstruction Engine

**Status:** Complete. Engine only — no frontend, graph UI, replay UI, API routes, or Phase 3C work.
**Date:** 2026-09-21
**Depends on:** [phase-1-nansen-reconnaissance.md](./phase-1-nansen-reconnaissance.md), [phase-2-product-system-spec.md](./phase-2-product-system-spec.md), [phase-3a-data-foundation.md](./phase-3a-data-foundation.md), `src/types/` (domain model, untouched), `src/reconstruction/` Phase 3A layer (untouched).
**API calls this phase:** **0** (zero live Nansen calls). All work reads existing sanitized fixtures.

---

## 1. Type / specification conflicts found (pre-implementation review)

| # | Conflict | Resolution (implemented) |
| --- | --- | --- |
| 1 | Phase 2 §7 orders by `(timestamp, txIndex, logIndex)`, but a grep over **all** fixtures confirms **no Nansen row carries `txIndex`/`logIndex`**. | Order by `(epochMs, txHash lexicographic, event-kind rank, source endpoint, canonical input order)`. Stable, documented, nothing invented. Recorded as a permanent data gap on every case. |
| 2 | Phase 3A has **no normalized form** for `profiler/address/transactions`, yet `contract-interaction` events require its `method` / `volume_usd`. | Gap-fill: `src/reconstruction/transaction.ts` adds `NormalizedTransaction` + `normalizeTransaction` under identical Phase 3A guarantees (FACT-only, explicit absence, UTC-stable timestamps). Phase 3A files untouched. |
| 3 | Spec defines primary both as rule-OR admission **and** `significance ≥ P`. A score threshold cannot preserve the OR-semantics (e.g. a relation-only dust event must be primary per the relation rule but scores low). | `primary` = meets ≥1 admission rule. `significance` = deterministic **ranking** score only (pure function, §4). Documented deviation, no double-gating. |
| 4 | Counterparty rows are window aggregates **without timestamps** — they cannot become timeline events without fabrication. | Counterparties feed **entities + undirected aggregate relationships only**, never events (§6). |
| 5 | `SourceRef` (domain type, locked) has **no `fixtureFile` slot**, but the brief requires each event to connect to its originating fixture. | Fixture file is cited in every provenance `statement` plus the case-level `sources[]`. Domain types untouched. |
| 6 | Some `EntityRole`s (`attacker`, `beneficiary`, `liquidity-source`) are interpretive. | Engine assigns only `subject` / `funder` / `counterparty` (FACT/RELATION). Burn address is `counterparty` with `admissionReason: burn-sink`. Never accuses. |
| 7 | Flow buckets are window aggregates without tx anchors. | Accepted as input for forward-compatibility but **explicitly not eventized**; counted in `stats.flowsSkipped` + a data gap. |

No material ambiguity blocked implementation, so per the brief no approval stop was taken.

---

## 2. Engine interface

`src/reconstruction/engine.ts` — pure functions, zero dependencies.

```ts
reconstruct(input, subject, caseDesc, options?): { investigation, stats }

input:   { transfers, swaps, counterparties, relationships, transactions, flows? }
         // already-normalized records (Provenanced<T>); flows accepted but skipped (§6)
subject: { address, chain, displayName?, labels? }   // case subject → role 'subject'
caseDesc:{ id, name, headline, window:{from,to} }     // authored (descriptive only)
options: { valueThresholdUsd? (=1_000_000), minGroupMembers? (=2),
           reconstructedAt? (= wall-clock; pass fixed for determinism) }
```

`EngineError` (field + record index) on any invalid input — fail loudly, never repair/guess.
`EngineStats`: inputsReceived, duplicatesSkipped, flowsSkipped, memberEvents, primaryEvents, collapsedEvents, groupsDerived, entitiesAssembled, relationshipsAssembled.

---

## 3. Event-admission rules

A record becomes a candidate event; it is **primary** iff it meets ≥1 meaningful rule. Otherwise it is retained with `primary:false`, `admissionRule:'below-threshold'` (collapsed, never dropped).

| Rule id | Condition | Applies to |
| --- | --- | --- |
| `value-threshold` | `valueUsd >= threshold` (**inclusive**; default `$1,000,000`). `null` USD never admits (absence ≠ zero). | transfers, swaps, transactions (`volume_usd`) |
| `nansen-relation` | Record carries a Nansen relation. Relation containing "funder" → `funding` event, else `entity-relationship`. | relationships |
| `method-of-interest` | Lowercased `method` contains `flashloan, flash_loan, swap, multicall, borrow, mint, deposit, withdraw, repay, liquidat, delegate, permit`. Plain movement methods (`received`, `sent`, `source_type: transfer`) → `transfer`, never contract-interaction. | transactions |
| `burn-sink` | Any endpoint movement touches `0x000…000`. | transfers, transactions, counterparties (entity admission) |
| `below-threshold` | No rule matched. Explicit reason for collapsed retention. | any |
| `derived-grouping` | DERIVED consolidation/dispersal groups (§5). Always primary. | groups |

Rule priority for `admissionRule` (first match wins, all matches reasoned): `nansen-relation` (relationships) / `burn-sink` → `method-of-interest` → `value-threshold` → `below-threshold`.

---

## 4. Deterministic ordering & significance

**Ordering** (members + groups, one stable sort): `epochMs → txHash (lexicographic; groups have none and sort after same-timestamp members via kind rank) → event-kind rank (funding 0 … dispersal 6) → source endpoint → canonical input order`. Inputs are canonical-sorted (`JSON.stringify` order) before dedupe, so **shuffled inputs yield byte-identical output** (tested). IDs `event_001…` assigned in final order.

**Significance** (ranking only): `round(10·log10(1+USD) + 25·relation + 20·method + 15·burn + 10·firstInWindow + 10·lastInWindow)`; `$1M` → 60. Pure function (`significanceScore`, exported, unit-tested).

**Dedupe:** exact-match keys (`transfer|tx|from|to|epoch`, `swap|…`, `relationship|address|relation|tx`, `transaction|tx|method|epoch`, `counterparty|address`). First in canonical order kept; rest counted in `stats.duplicatesSkipped` + a data gap. Never silent.

---

## 5. Entities, relationships, derived groupings

**Entities** (id `entity_<lowercase-address>`, sorted): subject (`case-subject`, FACT) · funder targets (`nansen-relation-target`, role `funder`, RELATION) · transfer/swap/tx participants · counterparties (`counterparty-above-threshold` if max volume ≥ threshold, else `counterparty-observed`; burn → `burn-sink`) · swap tokens (`swap-token`) · any residual event-referenced address (`referenced-by-event`, DERIVED closure — defensive; never triggered on hero data). Labels are FACT statements quoting the exact Nansen field.

**Relationships** (id `rel_###`, sorted by kind rank + endpoints): `funder` (directed, RELATION) · `related-wallet` (undirected, RELATION) · `transfer` (one per unique from→to pair, FACT, `netFlowUsd` DERIVED-sum when any member has USD) · `swap` (per trader→token pair, FACT) · `counterparty` (**undirected** window aggregate with in/out metrics + explicit "not a single transaction" statement, FACT) · `flow` (one DERIVED edge per group, representative endpoint = most-frequent counterparty with lexicographic tie-break, `net_flow_*` calculation).

**Derived groupings:** transfer-type member events (swaps excluded — documented) sharing a recipient (`capital-consolidation`) or sender (`capital-dispersal`) with ≥`minGroupMembers` (default 2) form a DERIVED group: timestamp = latest member, value = sum of available USD (`null` if all absent; partial sums record `members_with_usd`), `calculation: consolidation|dispersal`, `sourceEventIds` = all member ids (expandable — tested), `inputs.engine = trace-3b/1.0.0`. Members stay in `events[]`; member ↔ group ↔ flow-edge links are wired both ways.

---

## 6. Provenance behavior & evidence rules

- FACT/RELATION events: `sources:[{source, requestId?, capturedAt, txHash?}]` from the normalized `SourceMeta`; `statement` cites **endpoint + fixture file + captured-at + timestamp + tx hash + exact field semantics** (e.g. "(transfer_value_usd)"). No HYPOTHESIS records exist anywhere in the engine (asserted by test K1 over the full mixed-fixture output, including role names).
- DERIVED (groups, flow edges, summary metrics): `sourceEventIds` + named `calculation` + `inputs` snapshot. Recomputable, no hidden inputs.
- Summary band: FACT/DERIVED only (`steps_reconstructed`, `entities_involved`, `peak_value_moved_usd` when any USD exists — else omitted + data gap).
- Language: titles/statements are descriptive. Banned from event text: exploit/attack/stolen/drain/hack/voluntary/intent/causation/ownership language (test-enforced). Relations are quoted as *"Nansen reports X as 'R' … reported link, not proof of common control."*
- Case `status`: `reconstructed` iff ≥1 primary event, else `partial`. `dataGaps` always include the txIndex/logIndex note; conditional gaps for aggregates, pagination, missing USD, duplicates, skipped flows.
- `reconstructedAt` is the only non-deterministic default; determinism tests pass it fixed.

---

## 7. Euler reconstruction from discovery fixtures (observed, not claimed)

Input: 15 hero counterparty rows + 1 related-wallet row + 5 transaction rows (21 records), subject = attacker EOA, fixed `reconstructedAt`. Exact engine output (reproduced by `test/L1`):

- `stats`: inputsReceived 21, duplicatesSkipped 0, memberEvents 6, **primaryEvents 3, collapsedEvents 5**, groupsDerived 2, entitiesAssembled 19, relationshipsAssembled 20. Status `reconstructed`. Repeated run → byte-identical.
- Timeline: `event_001 funding` (First Funder, `2023-03-13T09:12:23Z`, RELATION) → five collapsed dust `transfer`s (03-28 → 03-31, row-level `volume_usd` $0.01–$1.74) → interleaved DERIVED `capital-dispersal` (03-28, 3 members) + `capital-consolidation` (03-31, 5 members).
- Entities: attacker (`subject`), First Funder (`funder`, RELATION), Balancer Vault + aWBTC_v2 + wstETH + burn + 14 others (`counterparty`).
- Summary: steps 3, entities 19, peak $1.74 — honestly dust, because the captured transaction sample holds only latest-first rows; exploit-day rows require pagination (recorded data gap, not worked around).
- 4 data gaps (ordering indexes, aggregates, pagination, 1 event without USD — the funding event, which carries no value by design).

---

## 8. Test results (exact)

`npm test` — **37 pass / 0 fail** (~0.6–0.8s): 17 Phase 3A (untouched, still green) + 20 Phase 3B (`test/reconstruction.test.ts`):

| # | Requirement | Test(s) | Result |
| --- | --- | --- | --- |
| A | Transaction normalization gap-fill | A1 hero row FACT + row-level volume; A2 missing optionals → null + reported; A3 malformed throws w/ field | pass |
| B | Deterministic ordering, absent indexes | B1 timestamp → txHash tie-break + `order` 1..n; B2 shuffled inputs → identical output, no invented indexes | pass |
| C | Threshold boundaries | C1 exactly $1M primary / $999,999.99 collapsed-but-retained; C2 null USD + burn-sink dust admits | pass |
| D | Null values | D1 no `value` key, no zero-fill, gap recorded | pass |
| E | Duplicate records | E1 collapse to 1, `duplicatesSkipped:1`, gap recorded | pass |
| F | Missing timestamps | F1 `EngineError` naming `timestamp.*` | pass |
| G | Provenance preservation | G1 funding event: RELATION, endpoint/requestId/txHash/fixture/relation all preserved | pass |
| H | Method admission | H1 `flashLoan(…)` → contract-interaction primary; `transfer(…)` stays transfer | pass |
| I | Expandable groupings | I1 consolidation + I2 dispersal: DERIVED, named calculation, all member ids resolve | pass |
| J | Aggregates ≠ events | J1 vault/burn entities + undirected edge w/ metrics; 0 events; `partial` | pass |
| K | No HYPOTHESIS / language | K1 full mixed-fixture scan: no HYPOTHESIS/attacker/beneficiary, banned words absent, roles ∈ {subject,funder,counterparty}, repeat deterministic | pass |
| L | Euler end-to-end | L1 funding-first, 4 canonical entities, funder edge, consolidation, `reconstructed`, ≥2 gaps | pass |
| M | Flows skipped | M1 counted, never eventized, gap recorded | pass |
| N | Significance purity | N1 deterministic, monotone, null→0, $1M→60 | pass |
| O | All-collapsed honesty | O1 single dust → collapsed, `partial`, no fabrication | pass |

---

## 9. Files created / modified

**Created**
- `src/reconstruction/transaction.ts` — `NormalizedTransaction`, `normalizeTransaction` (gap-fill).
- `src/reconstruction/engine.ts` — admission, ordering, significance, entities, relationships, groupings, `reconstruct`, `EngineError` (~870 lines, zero deps).
- `test/reconstruction.test.ts` — 20 tests (§8).
- `docs/phase-3b-reconstruction-engine.md` — this document.

**Modified**
- `src/reconstruction/index.ts` — barrel exports for the two new modules.
- `test/reconstruction.test.ts` — (new; listed above).

**Untouched:** `src/types/*`, `src/nansen/*`, Phase 3A reconstruction files, all fixtures, `package.json` (existing `npm test` covers the new suite).

## 10. Commands executed

| Command | Result |
| --- | --- |
| `npm test` (before test fix) | 2 failures — test-design issue (shared from/to pairs correctly triggered groupings); fixed tests, not engine |
| `npm test` (final) | ✅ **37 pass / 0 fail** |
| `node <tmp>/euler-stats.mjs` (read-only fixture stats) | §7 figures + `DETERMINISTIC true` |

## 11. Unresolved evidence limitations (for Phase 3C+)

1. Captured transaction sample is latest-first dust; exploit-day (03-13) rows need paginated live calls (~1 credit/page).
2. No `txIndex`/`logIndex` anywhere in Nansen rows — intra-block ordering stays at txHash granularity.
3. Per-token `price_usd`/`value_usd` null on transaction rows — values use row-level `volume_usd` only.
4. Counterparty edges are window aggregates; per-hop fund-flow between 03-13 → 03-31 is not individually evidenced in fixtures.
5. `SourceRef` cannot carry `fixtureFile` (domain type) — carried in statements instead.
6. Case `name`/`headline` are caller-authored; the engine does not vet them for causal language.

**STOP.** Phase 3C not started.
