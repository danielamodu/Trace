# TRACE — Architecture

TRACE reconstructs what happened on-chain during an incident from Nansen data,
and does it **deterministically** — no LLM, no inference, no attribution. Every
rendered claim traces back to a source row. This document maps the pieces and
the seams between them.

## One engine, one artifact, three surfaces

TRACE is a single product exposed three ways, all sharing one deterministic
engine and one output type — the **InvestigationContract**.

- **Curated case library** — vetted, fixture-backed reconstructions (Euler, FTX)
  served as read-only pages and JSON.
- **Self-serve live tool** — bring your own Nansen key, point it at an address +
  window, get a contract back.
- **Engine-as-API** — the same contract over HTTP, a CLI, and importable modules.

The contract is the universal artifact: whatever surface produced it, a contract
validates against the same schema and renders through the same UI.

## The pipeline

```
fetch/load → sanitize → normalize → reconstruct → buildContract → InvestigationContract
```

1. **Fetch / load** — Live runs call Nansen through `NansenClient`
   (`src/nansen/client.ts`). Curated cases load captured fixtures. Same
   downstream either way.
2. **Sanitize** (`src/nansen/sanitize.ts`) — strip/redact, drop unusable rows,
   count what was cleared.
3. **Normalize** (`src/reconstruction/normalize.ts`) — raw Nansen shapes → the
   engine's normalized row types.
4. **Reconstruct** (`src/reconstruction/engine.ts`,
   `reconstruct(input, subject, caseDesc, options)`) — build the timeline,
   entities, and relationships. Pure and deterministic given its inputs; returns
   `{ investigation, stats }`.
5. **Assemble** (`src/contract/assemble.ts`, `buildContract(result, options)`) —
   wrap the investigation with data-source, coverage, completeness, and evidence,
   then `assertContract` + deep-freeze.

Determinism is the invariant: same inputs (including a fixed `reconstructedAt`) →
byte-identical contract. That is what lets fixtures stand in for live calls in
the library and the tests.

## Provenance

Every claim carries a provenance category (`src/types/provenance.ts`):

- **FACT** — a field Nansen returned directly.
- **DERIVED** — computed deterministically by TRACE from FACTs (a named rule, no
  inference).
- **RELATION** — a relationship Nansen returned (e.g. "First Funder").
- **HYPOTHESIS** — interpretation. **TRACE never produces one.** The type exists
  so the boundary is nameable, but neither the engine nor any builder emits a
  HYPOTHESIS, and the summary band is FACT/DERIVED only.

The UI lets a reviewer walk claim → event → evidence row. Nothing is presented as
more certain than its provenance allows.

## Completeness

A contract is `complete` only when **all three** hold:

- `investigation.status === 'reconstructed'`, and
- `dataSource === 'live-nansen'`, and
- every coverage flag is true.

Otherwise it is `incomplete`, with machine-readable `completenessReasons`.
Consequence: **a fixture-backed case is structurally always `incomplete`** (its
dataSource is `fixture-cache`). Only a full live run can legitimately reach
`complete`. This keeps the curated library honest — it never claims a
completeness it cannot prove. (`src/contract/completeness.ts`.)

## The service seam

The UI and API never touch the engine or fixtures directly — they go through a
read-only service.

- `createContractService(contracts, availableIds)` (`src/contract/service.ts`) —
  deep-frozen `listCases()` / `getContract()` / `hasCase()`. Strictly read-only:
  no network, no mutation.
- `CASE_REGISTRY` (`src/investigations/registry.ts`) — binds each case id to a
  fixture-backed builder + an `available` flag. Adding a curated case is one
  entry here.
- `buildTraceService()` — builds the built-ins (memoized, so fixtures are read
  once per process) and merges saved live runs from the store, with built-in ids
  authoritative (a saved file can never shadow Euler/FTX).
- `lib/cases.ts` — the app adapter. Caches the service keyed on a **filesystem
  signature** of the saved-cases store (see the note at the end).

## Surfaces in detail

**Library (read-only)**
- `app/page.tsx` — case listing. `app/cases/[id]/page.tsx` — one reconstruction.
- `GET /api/cases` (`app/api/cases/route.ts`) and `GET /api/cases/[id]`
  (`app/api/cases/[id]/route.ts`).

**Live tool (BYO-key)**
- `app/reconstruct/page.tsx` + `components/ReconstructForm.tsx` — the form.
- `POST /api/reconstruct` (`app/api/reconstruct/route.ts`) — runs
  `reconstructFromAddress` (`src/investigations/live.ts`) and returns
  `{ contract, meta }`. The key is used server-side only and never logged or
  persisted.
- **Save-as-case** — `POST /api/cases` (`src/investigations/save-route.ts`)
  validates and writes the contract to the local store (`data/cases/`,
  gitignored). Built-in ids are rejected (409).

**Engine-as-API**
- The CLI (`scripts/trace.ts`): `list` / `show` (offline) and `reconstruct`
  (BYO-key). See the README for usage.
- The library modules are importable directly — `buildTraceService`,
  `reconstructFromAddress`, `buildContract`.

## Security posture

- **BYO-key.** The Nansen key is server-side only: read from `NANSEN_API_KEY`
  (or supplied per-request for a live run), never logged, never sent to a client.
  `.env` is gitignored.
- **No auth on the app.** The routes are unauthenticated. That is fine for local
  / self-hosted / hackathon use, but **do not expose this deployment publicly
  as-is** — a public `POST /api/reconstruct` lets anyone spend your Nansen
  credits, and `POST /api/cases` writes to your store. Put it behind your own
  auth/proxy first.
- **Local store trust model.** Saved cases are your own runs. The store
  re-validates every file with `assertContract` on load and constrains the
  caseId to a filesystem-safe charset (no path traversal). It does not — and
  cannot — prove the rows truly came from Nansen.

## Why the filesystem signature

Next.js can run route handlers and RSC pages as **separate module instances**. An
in-memory singleton reset in the writer (the save route) does not necessarily
reach the reader (a page). So `lib/cases.ts` invalidates its cached service by
comparing a cheap signature of the store on disk (sorted filename + mtime +
size). The shared filesystem is the invalidation signal, so any reader picks up a
newly saved case on its next render, in any instance, without a server restart.
