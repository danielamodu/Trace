# TRACE

Onchain incident reconstruction engine. **Something happened. TRACE reconstructs how it happened** — it starts from an onchain incident or significant market event and reconstructs the sequence of relevant actions using Nansen data, deterministic analysis, and an evidence timeline.

TRACE is *not* a Bubblemaps clone, a wallet explorer, or a generic analytics dashboard.

## Status: Phase 3F — Evidence Replay

Phases 1–3E are complete and locked. Phase 3F adds an event-replay mode around
the same authoritative contract: a deterministic cursor through observed events
(play/pause/step/scrub/keyboard), gap-discontinuity notes, and full sync with
the inspector, graph, and follow-money — replaying evidence, never simulating
chain state. See [`docs/phase-3f-replay.md`](docs/phase-3f-replay.md).

Prior phase reports live in `docs/`: reconnaissance, product spec, data foundation
(3A), reconstruction engine (3B), investigation contract (3C), product shell (3D),
investigation experience (3E).

See also [`docs/phase-1-nansen-reconnaissance.md`](docs/phase-1-nansen-reconnaissance.md)
and the endpoint reference in [`docs/nansen-endpoints.md`](docs/nansen-endpoints.md).

## Requirements

- Node.js **≥ 22.6** (24.x recommended). Node runs the `.ts` engine files directly
  via native type stripping.
- UI dependencies (`next`, `react`, `react-dom` + TS tooling) install via npm.
  The engine itself remains dependency-free: `npm test` uses only the standard
  library.

## Run the interface

```bash
npm install        # one-time: UI dependencies (engine needs none)
npm run dev        # local development server
npm run build      # production build (also type-checks)
npm start          # serve the production build
npm test           # engine + contract + adapter suite (no browser needed)
```

## Setup

```bash
cp .env.example .env
# then edit .env and set NANSEN_API_KEY (get one at https://app.nansen.ai/auth/agent-setup)
```

The API key is **server-side only**. It is read from `NANSEN_API_KEY`, never
logged, and never shipped to a client. `.env` is gitignored.

## Reproduce the reconnaissance

```bash
# Zero-credit connectivity + auth smoke test (POST /api/v1/search/general)
npm run smoke

# List the deliberate probe set and each probe's estimated credit cost
node scripts/recon.ts --list

# Run the default sweep (all probes ≤5 credits; ~20 credits total)
npm run recon

# Run a single probe by name
node scripts/recon.ts tgm-transfers
```

Each probe writes a sanitized, row-truncated fixture to `fixtures/`. Runtime
credit usage is captured from the `X-Nansen-Credits-*` response headers.

⚠️ `profiler/address/labels` costs **100 credits** (500 for premium) and is
**excluded** from the default sweep. Run it explicitly only when needed:
`node scripts/recon.ts profiler-labels`.

## Layout

```
src/nansen/client.ts   Server-side Nansen client (fetch, auth, error + credit meta)
src/nansen/types.ts    Typed request/response boundaries for the endpoints TRACE uses
scripts/smoke.ts       0-credit connectivity/auth test
scripts/recon.ts       Reproducible endpoint probe runner
fixtures/              Sanitized captured responses
docs/                  Phase-1 report + endpoint reference
```
