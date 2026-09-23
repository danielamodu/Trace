# Adding your own case

There are two ways to get a new incident into the library. Pick by intent:

| | Path A — save a live run | Path B — register a fixture case |
|---|---|---|
| **For** | your own runs, quick captures | curated, vetted, shipped-in-the-repo cases |
| **Effort** | zero code | a small builder + one registry line |
| **Stored** | `data/cases/` (gitignored) | fixtures + code, committed |
| **Completeness** | can be `complete` (live) | always `incomplete` (fixture-cache) |

Either way the result is the same artifact — a validated `InvestigationContract`
— and shows up in the same library UI and API.

## Path A — save a live run (no code)

Run a live reconstruction, then save it. The contract is validated and written to
`data/cases/<caseId>.json`, which the library merges in automatically (built-in
ids like `case_euler_2023` can never be shadowed).

Requires your own Nansen key in `NANSEN_API_KEY` (see the README) — a live run
spends credits.

**From the CLI:**

```bash
npm run trace -- reconstruct 0xADDRESS --from 2022-11-06 --to 2022-11-12 --save
```

**From the UI:** open `/reconstruct`, run a reconstruction, then click
**Save to library**.

**Over HTTP:** `POST /api/cases` with `{ "contract": <InvestigationContract> }`.
Returns `201 { caseId, url }`, or `409` if the id collides with a built-in, or
`400` for an invalid contract or unsafe caseId.

The store is a local trust boundary: files are re-validated with `assertContract`
on load and the caseId is constrained to a filesystem-safe charset (no path
traversal). Saving persists *your* run — it does not prove the rows came from
Nansen.

## Path B — register a fixture-backed case (code)

This is how the built-in Euler and FTX cases work, and how you ship a curated
case in the repo. A fixture case is deterministic and offline — no key, no
credits, no network — so it is safe for tests and CI.

**1. Capture fixtures.** Model a capture script on `scripts/capture-ftx.ts` /
`scripts/capture-euler-0313.ts`. Every fixture passes through `redact()` and
`sanitize` so no key or unusable row is ever written.

**2. Write a builder** at `src/investigations/<case>.ts` that exports a stable id
and a builder. Follow `src/investigations/euler.ts`:

```ts
export const MYCASE_CASE_ID = 'case_mycase_2024';

export function buildMyCaseContract(reconstructedAt?: string): InvestigationContract {
  // load captured fixtures → sanitize → normalize →
  //   reconstruct(input, subject, caseDesc, { reconstructedAt, ... }) →
  //   buildContract(result, { dataSource: 'fixture-cache', coverage, inputs })
  // buildContract already runs assertContract + deep-freeze.
}
```

The builder must be deterministic given `reconstructedAt`: same fixtures + same
timestamp → byte-identical contract. Set `dataSource: 'fixture-cache'`.

**3. Register it** in `src/investigations/registry.ts`:

```ts
import { MYCASE_CASE_ID, buildMyCaseContract } from './mycase.ts';

export const CASE_REGISTRY: readonly CaseRegistration[] = [
  { id: EULER_CASE_ID, buildContract: buildEulerContract, available: true },
  { id: FTX_CASE_ID,   buildContract: buildFtxContract,   available: true },
  { id: MYCASE_CASE_ID, buildContract: buildMyCaseContract, available: true },
];
```

That is the whole seam — the engine, contract, service, and UI are already
case-agnostic. A case not yet fully captured can ship with `available: false`
(listed but not openable) rather than claiming a reconstruction it can't back.

**4. On completeness.** A fixture case is `dataSource: 'fixture-cache'`, so by the
completeness rule it is **always `incomplete`** — that is intended. Cached
snapshots are point-in-time and revisable; only a live run can claim `complete`.
The `completenessReasons` say exactly which coverage is missing.

**5. Verify.** `npm run typecheck && npm test` — the contract test suite exercises
every registered case through the service.

See [architecture.md](architecture.md) for how these pieces fit together.
