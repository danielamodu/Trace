# TRACE — Phase 3D: Product Shell & Timeline-First Investigation UI

**Status:** Complete. UI shell only — no graph, replay, hypotheses, chatbot, auth, DB, or Phase 3E work.
**Date:** 2026-09-22
**Depends on:** [phase-2-product-system-spec.md](./phase-2-product-system-spec.md), [phase-3a-data-foundation.md](./phase-3a-data-foundation.md), [phase-3b-reconstruction-engine.md](./phase-3b-reconstruction-engine.md), [phase-3c-investigation-contract.md](./phase-3c-investigation-contract.md), `src/` + `lib/` + `app/` + `components/` as built.
**API calls this phase:** **0** (zero live Nansen calls; +0 credits).

---

## 1. UI architecture

Next.js 16 App Router (React 19), one hand-written stylesheet, zero UI dependencies beyond the approved set (`next`, `react`, `react-dom`; dev: `typescript`, `@types/*`). Server components read; client components interact; nothing bypasses the InvestigationContract.

```
app/
  layout.tsx              root shell + globals.css + metadata
  page.tsx                Command Center (case listing from the adapter)
  cases/[id]/page.tsx     server: getCaseContract(id) → notFound() → InvestigationView
  cases/[id]/not-found.tsx  unknown-case state (lists available cases)
  cases/[id]/error.tsx    render-failure boundary with retry
  api/cases/route.ts      GET → case summaries JSON
  api/cases/[id]/route.ts GET → full contract JSON, or 404 {error, knownCaseIds}
components/
  InvestigationView.tsx   'use client' orchestrator: selection, group expansion,
                          collapsed toggle; renders banner + summary + grid + gaps
  Timeline.tsx            chronological <ol>, EventCard per event, DERIVED group
                          expansion, collapsed-events toggle
  EvidenceInspector.tsx   selected event: classification, time, tx, method, value,
                          entities, provenance + sources, members, unavailable
                          fields, admission
  StatusBanner.tsx        persistent STATUS vs COMPLETENESS + limitation + reasons
  Provenance.tsx          fixed badge vocabulary: Observed / Reported relationship / Derived
  PendingLink.tsx         'use client' link with pending ("Opening…") indicator
  format.ts               display-only helpers (short addr, USD, UTC, labels)
lib/cases.ts              framework-free singleton adapter: listCaseSummaries(),
                          getCaseContract(id) → contract | null (node:test-covered)
```

## 2. Routes

| Route | Type | Behavior |
| --- | --- | --- |
| `/` | static | TRACE wordmark, thesis, one case card with timeline/evidence/source chips |
| `/cases/case_euler_2023` | dynamic SSR | full investigation (banner → summary → timeline + inspector → gaps) |
| `/cases/<unknown>` | dynamic | custom unknown-case page, **HTTP 404** (verified) |
| `/api/cases` | dynamic | `{"cases": [...]}` summary list |
| `/api/cases/<id>` | dynamic | full contract; unknown → 404 JSON `{error, caseId, knownCaseIds}` |

## 3. Data flow

`fixtures (disk)` → `loadEulerInputs()` → `reconstruct()` → `buildContract()` (validates + freezes) → process-singleton service → `lib/cases.ts` → server pages / route handlers → serialized props / JSON. Client components receive contract data only; all copy renders verbatim from contract fields (titles, headlines, statements, metrics, gaps). The only UI-authored strings are chrome labels ("TIMELINE", "EVIDENCE INSPECTOR", "Data gaps"), the prescribed limitation sentence, and navigation copy.

## 4. Design decisions (with reasons)

1. **H1 and headline come from the contract verbatim** (`investigation.name`, `investigation.headline`), not the brief's example strings. The contract is authoritative; display copy is not invented.
2. **No SSR skeleton for the case segment.** An `app/cases/[id]/loading.tsx` was built, then **removed** after verification showed it forces streamed-HTTP-200 on unknown cases (headers flush before `notFound()` resolves). Loading is instead a client-side pending indicator on case links (`PendingLink`, "Opening investigation…"). Renders take ~200ms server-side, so nothing of value was lost and 404s stay honest.
3. **STATUS vs COMPLETENESS are separate chips** (`timeline: reconstructed`, `evidence: incomplete`, `source: fixture-cache`) plus the persistent amber banner with the exact limitation sentence and an expandable reason list. Impossible to miss, one slim block.
4. **Provenance vocabulary is fixed**: Observed (neutral), Reported relationship (amber), Derived (cyan). DERIVED groups carry member expansion that never drops the Derived marking.
5. **Nulls render as "USD unavailable — not estimated"**; missing tx/method rows are omitted, never zero-filled. Counterparty edges are described as aggregates in their statements (engine-owned wording, rendered verbatim).
6. **No graph, replay, hypotheses, rankings, metrics theater.** Summary band renders the contract's three metrics 1:1 (test U5).
7. **Type-only engine/contract fixes for `tsc`**: four `as unknown as` casts, one dead comparison removal, explicit tsconfig `types`. Zero runtime change (49/49 suite green before and after).
8. **One bundler-compat line in `src/investigations/euler.ts`**: the fixture-dir URL is built from a runtime expression so Turbopack doesn't resolve it as a static asset. Resolved path identical (suite green).

## 5. Manual verification (exact results)

Automated: `npm test` **54/54 pass** (49 existing + 5 `test/ui-adapter.test.ts`: listing consistency, unknown→null, chronological order, JSON stability, metric fidelity). `npx tsc --noEmit` clean. `npm run build` succeeds (/, /_not-found static; /cases/[id] + APIs dynamic).

Live (`next start -p 3100`, curl), each verified against the running server:

| Check | Result |
| --- | --- |
| `GET /api/cases` | 200, Euler summary (`status: reconstructed`, `completeness: incomplete`, 3 primary, 19 entities) |
| `GET /api/cases/case_euler_2023` twice | 200, 46,044 bytes, **byte-identical** |
| `GET /api/cases/nope` | **404** `{error: unknown case, knownCaseIds: [case_euler_2023]}` |
| `GET /` | 200, TRACE wordmark, case name, evidence chip |
| `GET /cases/case_euler_2023` | 200, ~68KB; contains TIMELINE, EVIDENCE INSPECTOR, funding event, group expansion toggles, limitation sentence, USD-unavailable, gaps |
| `GET /cases/nope` | **404** with custom "Unknown case" content (after loading.tsx removal) |

Not verifiable headlessly in this environment (no browser automation available; recorded for human pass): click selection → inspector update, group expand/collapse, collapsed toggle, pending-link indicator, focus-visible rings, and browser console cleanliness. The handlers are trivial state setters over contract data, and SSR output proves every render path; interaction pass is checklist item M-1 below.

## 6. Manual checklist (human pass, ~5 min)

- [ ] M-1: `npm run dev`, open `/cases/case_euler_2023`; click events → inspector updates; expand a DERIVED group → member records list and select; toggle collapsed events; open case link → "Opening…" appears. Console: zero errors/warnings.
- [ ] M-2: keyboard-only run: Tab reaches every event/member/toggle in order; Enter/Space activate; focus ring visible throughout.
- [ ] M-3: narrow viewport (~375px): single column, inspector below timeline, no horizontal scroll, hashes wrap.
- [ ] M-4: confirm banner reads STATUS reconstructed / COMPLETENESS incomplete and the limitation sentence is visible without scrolling the timeline away (banner sits above it).

## 7. Known limitations

- First dynamic render compiles on demand (slow on constrained disks; subsequent hits fast; `start` otherwise boots in ~1s).
- Explorer links point at etherscan.io mainnet (static anchors, no fetching, no Nansen use).
- `next dev` was not exercised end-to-end here (install + build + `start` were); `dev` uses the same routes/adapter and is covered by M-1.
- Disk pressure during install (drive filled to 0 free mid-phase; recovered via npm-cache clean) — environment note, not a code issue.
- TypeScript 7 requires its `@typescript/typescript-win32-x64` optional package explicitly (installed as dev dep; an artifact of `--omit=optional`).

**STOP.** Phase 3E not started.
