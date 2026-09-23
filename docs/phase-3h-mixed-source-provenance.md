# TRACE — Phase 3H: Mixed-Source Evidence Integration

**Status:** Complete. Provenance integration only — no new features, replay/graph/UI redesigns, live calls (+0 credits), or completeness-rule changes.
**Date:** 2026-09-22
**Depends on:** Phases 3A–3G (locked). The served Euler case now reconstructs from discovery fixtures **plus** the 17 live incident-day rows.
**Live calls this phase:** **0**.

---

## 1. Why mixed-source support is required

Phase 3G captured 17 live exploit-day rows; the reconstruction already consumed them in testing (8→30 events). But the contract answered "where did this come from" only in free-text statements (fixture file cited in prose) — not machine-readably — and the envelope's single `dataSource` could not name two pools. The UI therefore could not label, filter-by, or verify source composition.

## 2. Source model (new, additive)

SOURCE (where) is now explicit and separate from PROVENANCE (what kind of claim):

- `SourceRef.origin?: 'fixture-cache' | 'live-nansen'` (`src/types/provenance.ts`, optional). Engine-set from the fixture namespace (`live/…` → live, else fixture); absent on pre-3H/authored references — never defaulted.
- `InvestigationContract.dataSources?: DataSource[]` (optional): sorted-unique pool enumeration, recomputed by rule (`collectOrigins`). The singular `dataSource` is preserved untouched as the conservative value the completeness rule consumes (mixed builds stay `fixture-cache`).
- `lib/sources.ts`: `eventOrigin()` (member events report their pool; DERIVED groups report the member union: fixture-only / live-only / **mixed** / unknown) and labels.

Result on Euler: `dataSources: ["fixture-cache", "live-nansen"]`; groups split 6 live-only, 1 fixture-only, 1 mixed.

## 3. Provenance model (unchanged)

FACT stays FACT, RELATION stays RELATION, DERIVED stays DERIVED — in both pools. No HYPOTHESIS channel exists. Flow/DERIVED edges remain excluded from follow targets and graph edges (unchanged rules, re-pinned by tests).

## 4. Contract changes (minimal, backward-compatible)

1. `SourceRef.origin?` (additive optional; old readers ignore it).
2. `InvestigationContract.dataSources?` (additive optional; old contracts without it still validate — pinned by test H9).
3. Engine `sourceRefFor` populates `origin` (metadata only; admission/ordering/grouping untouched — full suite green).
4. `buildContract` always sets `dataSources` via `collectOrigins`.
5. `validateContract` checks the field when present (valid values, sorted-unique, contains `dataSource`, equals recomputation) and ignores its absence.

## 5. Served case change (data, not design)

`loadEulerInputs` unions discovery rows with the 17 live rows (never replaces); coverage reason updated (03-13 covered, 03-15→03-27 + return period still absent → flag stays false); headline notes the live capture. Served Euler: **30 events / 12 primary / 30 entities / 37 relationships**, deterministic and frozen. UI additions only: per-event "Source:" line in the inspector (incl. mixed groups), per-edge source in graph connections, `sources:` chip in the context strip.

## 6. Completeness behavior (unchanged rule, unchanged verdict)

`complete` still requires `reconstructed` + `live-nansen` + all coverage flags. The mixed build declares `fixture-cache` (not fully live) with `transactionWindowCovered: false` → **`reconstructed` / `incomplete`**, reasons intact. Mixed-source handling as a first-class `dataSource` value is deferred, not smuggled in.

## 7. Test results

`npm test` — **87/87 pass**: 79 existing (timeline-pinned expectations updated to expanded truth after verifying each value; rules untouched) + 8 `test/mixed-source.test.ts` (single-pool builds, mixed enumeration, event-level preservation incl. the dual-lensed funding tx, mixed DERIVED composition, determinism, incomplete verdict, source×provenance independence across all four combos, pre-3H backward compat). `tsc --noEmit` clean. `npm run build` succeeds.

## 8. Verification (live `next start`, curl)

API lists the expanded case (12 primary, 30 entities, `fixture-cache`/`incomplete`); case page (~172KB) renders source labels (`live-nansen` edges, per-event source lines), `30 events`, context-strip sources, replay `1 / 30`, and all prior content. `Source: mixed` and gap notes render on selection (unit-pinned), correctly absent from the default SSR view. Human click/keyboard/console pass remains on the standing checklist (no automation available).

## 9. Limitations

- `origin` derives from the fixture-namespace convention; direct-API builds without fixture files record no origin (unknown, never guessed).
- `dataSource` on mixed builds is conservative by design — see §6 for the deferred first-class mixed value.
- Dense live neighborhoods make the graph busier; the textual connection list carries the same data.

**STOP.** Phase 3I not started. No live calls, no new capture, no AI.
