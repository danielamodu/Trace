# TRACE

**Something happened onchain. TRACE reconstructs how it happened.** Starting from
an incident — an exploit, a drain, an unauthorized transfer — TRACE reconstructs
the sequence of relevant onchain actions from Nansen data into an evidence
timeline. It is **deterministic**: no LLM, no inference, no attribution. Every
claim it renders traces back to a specific source row.

TRACE is *not* a Bubblemaps clone, a wallet explorer, or a generic analytics
dashboard.

## One product, three surfaces

All three share one deterministic engine and one output type, the
**InvestigationContract**:

- **Curated case library** — vetted, fixture-backed reconstructions (the Euler
  and FTX incidents) you can open, replay, and inspect down to the evidence row.
  Offline; no key required.
- **Live tool (BYO-key)** — point it at any address + time window with your own
  Nansen key and get a contract back. `/reconstruct` in the UI,
  `POST /api/reconstruct` over HTTP, or `reconstruct` on the CLI.
- **Engine-as-API** — the same contract over HTTP (`/api/cases`), a CLI
  (`scripts/trace.ts`), and importable library modules.

A run from the live tool can be **saved into the library** with one click (or
`--save`), so your own reconstructions sit alongside the curated ones.

See [`docs/architecture.md`](docs/architecture.md) for how the pieces fit.

## Quickstart

```bash
npm install        # UI dependencies (the engine itself needs none)
npm run dev        # start the dev server, then open http://localhost:3000
```

The home page lists the curated cases — no API key needed to browse, open, or
replay them. To run your own reconstructions, add a Nansen key (below).

## The CLI

A thin command-line surface over the same engine (`scripts/trace.ts`):

```bash
# Offline — no key, no credits:
npm run trace -- list                    # every case in the library
npm run trace -- show case_euler_2023    # one case's full reconstruction

# Live — BYO-key, SPENDS CREDITS:
npm run trace -- reconstruct 0xADDRESS --from 2022-11-06 --to 2022-11-12 --save
```

`reconstruct` flags: `--chain` (default ethereum), `--max-credits` (default 12),
`--max-pages` (default 5), `--per-page`, `--no-counterparties`, `--no-related`,
`--save` (into the library), `--out <path>` (write the contract JSON). Run
`npm run trace -- help` for the full list.

## BYO-key & credits

```bash
cp .env.example .env
# then edit .env and set NANSEN_API_KEY (get one at https://app.nansen.ai/auth/agent-setup)
```

The API key is **server-side only**. It is read from `NANSEN_API_KEY`, never
logged, and never shipped to a client. `.env` is gitignored.

Live runs spend Nansen credits. TRACE runs under a **budget** — a credit ceiling
and page cap per run (defaults: 12 credits, 5 pages) — and reports exactly what
it spent. ⚠️ `profiler/address/labels` costs **100 credits** (500 for premium)
and is never called by a reconstruction; it exists only as an explicit recon
probe (below).

> **⚠️ No authentication.** The app's routes are unauthenticated by design, for
> local / self-hosted / hackathon use. **Do not expose this deployment publicly
> as-is:** a public `POST /api/reconstruct` would let anyone spend your Nansen
> credits, and `POST /api/cases` writes to your local store. Put it behind your
> own auth or proxy before putting it on the open internet.

## Add your own case

Two ways: save a live run (zero code, into `data/cases/`), or register a
fixture-backed case in the repo. See
[`docs/adding-a-case.md`](docs/adding-a-case.md).

## Reproduce the reconnaissance

```bash
# Zero-credit connectivity + auth smoke test (POST /api/v1/search/general)
npm run smoke

# List the deliberate probe set and each probe's estimated credit cost
node scripts/recon.ts --list

# Run the default sweep (all probes ≤5 credits)
npm run recon
```

Each probe writes a sanitized, row-truncated fixture to `fixtures/`. Runtime
credit usage is captured from the `X-Nansen-Credits-*` response headers.

## Development

```bash
npm test           # engine + contract + adapter suite (Node test runner, no browser)
npm run typecheck  # tsc --noEmit
npm run build      # production build (also type-checks)
npm run e2e        # Playwright end-to-end tests
```

Node.js **≥ 22.6** is required (24.x recommended): Node runs the `.ts` engine
files directly via native type stripping. The engine and its test suite are
dependency-free — `npm test` uses only the standard library.

## Project layout

```
src/reconstruction/   Deterministic engine: normalize → reconstruct
src/contract/         InvestigationContract: assemble, validate, completeness, service
src/investigations/   Case builders (euler, ftx), live orchestrator, registry, saved store
src/nansen/           Server-side Nansen client, types, sanitize
src/types/            Domain + provenance types
app/                  Next.js surfaces: library pages, /reconstruct, API routes
components/           UI (timeline, graph, evidence inspector, replay, forms)
lib/                  App adapter over the contract service + view helpers
scripts/              CLI (trace.ts), recon + capture scripts
docs/                 Architecture, add-a-case, phase reports, endpoint reference
fixtures/             Sanitized captured responses
```

## License

MIT — see [LICENSE](LICENSE).
