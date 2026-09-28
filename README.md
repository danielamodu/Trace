# TRACE

**Something happened on a blockchain — a hack, a drained fund, a suspicious flow of money. TRACE reconstructs exactly how it happened, step by step, into a single evidence file you can read, replay, and independently verify.**

A blockchain records every transaction in public, but only as anonymous
addresses (long strings like `0x1f9e…c4a2`) and raw numbers. Staring at that,
you can't tell who did what, or follow money from where it started to where it
ended up. TRACE turns that raw activity into a plain, ordered account of the
incident — and it does so **deterministically**: no AI, no language model, no
guesswork. Every single claim it shows is tagged with where it came from, so you
trust the evidence trail rather than having to trust TRACE.

The engine that makes the trail human-readable is **Nansen**. TRACE cannot do
its job without it — see [How Nansen makes it work](#how-nansen-makes-it-work).

## The problem

Reconstructing a blockchain incident by hand is slow and error-prone:

- The raw data is anonymous. An address is just a number; a plain block explorer
  won't tell you it belongs to an exchange, an attacker, or the victim.
- "Follow the money" means manually chasing transfers across dozens of
  addresses, any of which can be a dead end.
- Write-ups are usually screenshots and prose. You have to *trust the author* —
  there's no way to independently re-check that the numbers are right.

## What TRACE does

You point TRACE at an address and a date range. It gathers the relevant on-chain
evidence, works out the sequence of events, and produces one structured object
called an **InvestigationContract**: an ordered timeline of what happened, the
actors involved, how value moved between them, and a plain-language summary —
with **every fact carrying a pointer back to its source**.

Because the whole process is rule-based and deterministic, the same input always
produces the same result, and that result can be re-checked by anyone with a
cryptographic fingerprint. A TRACE case is evidence you can audit, not a
screenshot you have to believe.

## How Nansen makes it work

Nansen is a blockchain-analytics provider. It is not an optional data source for
TRACE — it is the reason the trail is readable at all. Concretely, it
contributes three things:

- **It puts names to anonymous addresses.** Nansen resolves a bare address into
  a labeled actor — for example "Uniswap V2", "FTX Exploiter", or "Balancer
  Vault". Without those labels the timeline would be an unreadable list of hex
  strings; with them it reads like an account of known parties.
- **It asserts relationships a plain block explorer can't.** Nansen reports
  links such as **"First Funder"** (which address originally funded a wallet) and
  **"Deployed Contract"** (which wallet deployed a contract). These reported
  links are the backbone of follow-the-money reasoning — they tell you where to
  look next.
- **It provides pre-aggregated intelligence.** Nansen returns figures like the
  total USD volume moved between two parties over a window, so TRACE doesn't have
  to crawl and sum thousands of individual transfers itself.

Inside a TRACE contract, each of these is tagged explicitly: a named actor or a
reported link becomes a **RELATION** or a sourced **FACT**, always citing the
exact Nansen endpoint it came from. Every case even has a dedicated **"What
Nansen resolved"** panel that adds it all up — how many addresses Nansen named,
which relationships it asserted, how much counterparty volume it priced, and
which Nansen endpoints backed the evidence. Nansen's contribution is never
hidden in a black box; it's itemized and auditable throughout the case.

## The three surfaces

TRACE is **one product with three ways in**, all producing and sharing the same
InvestigationContract.

### 1. The curated case library

Pre-built investigations of real incidents you can browse and replay — no Nansen
key required, nothing to spend. It ships with two built-in reference cases,
constructed from real captured Nansen data: the **Euler Finance** exploit and
the November 2022 **FTX** unauthorized-transfer incident. Any live
reconstruction that has been saved into the library appears here alongside them.

In the web app, the home page (`/`) lists the cases, and each opens into a
workspace (`/cases/<id>`) with the full timeline, the evidence behind each
event, a follow-the-money view, and the "What Nansen resolved" panel.

From the command line, the same cases are read-only and free to explore:

```bash
npm run trace -- list
```

```bash
npm run trace -- show case_euler_2023
```

The CLI's read-only commands never touch the network or spend anything: `list`,
`show`, `timeline`, `follow`, `entities`, `search`, `stats`, `diff`, `export`,
and `verify`. Run `npm run trace -- help` for the full list.

### 2. The live reconstruction tool (bring your own key)

Point TRACE at any address and time window with your own Nansen key, and it
builds a fresh investigation live from Nansen data. This is the only surface that
spends Nansen **credits** (Nansen's paid usage units), so it always runs under a
**budget** — a ceiling on credits and pages per run — and reports exactly what it
spent. It refuses to run if no key is available, and no calls are made until you
start a run.

In the web app, use the `/reconstruct` page. From the command line:

```bash
npm run trace -- reconstruct 0xADDRESS --from 2022-11-06 --to 2022-11-12 --save
```

`reconstruct` requires `--from` and `--to` (`YYYY-MM-DD`). Useful options:
`--chain` (default `ethereum`), `--max-credits` (default 12), `--max-pages`
(default 5), `--per-page`, `--no-counterparties`, `--no-related`, `--name`,
`--headline`, `--save` (add the result to the library), and `--out <path>` (also
write the contract JSON to a file).

### 3. The engine, as an API

The same reconstruction is available programmatically:

- **HTTP.** `POST /api/reconstruct` runs a live reconstruction and returns the
  contract plus an accounting of what it spent. `GET /api/cases/<id>` returns a
  stored case's full contract as JSON. `POST /api/cases` saves a finished
  reconstruction into the local library. `GET /api/reconstruct` reports only the
  credential posture — whether a server key is enabled and whether you must bring
  your own — and never the key itself.
- **Library.** The engine and contract layer are importable TypeScript modules
  with no framework dependency (`src/investigations/live.ts` exposes
  `reconstructFromAddress`; `src/contract/` holds the contract, validation, and
  verifier).
- **CLI.** `scripts/trace.ts`, described above.

## The InvestigationContract

Everything TRACE produces is one object, the InvestigationContract. It holds the
investigation itself — name, chain, time window, an ordered list of events, the
actors, the relationships between them, and a summary — wrapped in an envelope
that records where the data came from (`fixture-cache` vs `live-nansen`) and how
complete the reconstruction is.

The heart of it is **provenance** — every claim is tagged by how TRACE knows it:

- **FACT** — something Nansen returned directly (a field in a response), carrying
  a citation to the exact source it came from.
- **RELATION** — a relationship Nansen asserts, such as "First Funder", also
  sourced back to Nansen.
- **DERIVED** — something TRACE computed itself from other facts (for example, a
  net flow), recorded together with the named calculation and its inputs, so the
  math is reproducible.

There is a fourth category, **HYPOTHESIS** (an interpretation that isn't directly
proven), and TRACE deliberately **forbids it inside a contract** — validation
rejects any contract that contains one. That is the point: nothing is presented
as truth without provenance, and nothing interpretive is smuggled in as fact.

## Verify it yourself

A TRACE contract is a portable file: hand someone the JSON and they can re-derive
its verdict on their own machine — **offline, with zero credits and no network**.
Verification recomputes the completeness verdict and evidence counts from the
file itself, confirms the file contains no HYPOTHESIS, and produces a
**SHA-256 fingerprint** of the contract's content. Change one byte of meaning and
the fingerprint changes.

```bash
npm run trace -- verify case_euler_2023
```

`verify` also works on any contract file you were handed:

```bash
npm run trace -- verify ./some-case.json
```

The web app's `/verify` page runs the identical check in your browser — drop a
file in, nothing is uploaded. Because the fingerprint is computed the same way
everywhere, the CLI, the `/verify` page, and a case's own page all produce the
**identical fingerprint** for the same contract. Results are reproducible and
tamper-evident, not a screenshot you have to take on faith.

## Getting started

**Requirements:** Node.js **22.6 or newer** — TRACE runs its TypeScript engine
files directly using Node's built-in type stripping, so the engine needs no build
step — plus npm.

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000>. Browsing, opening, and replaying the curated
cases needs **no API key**.

### Enabling the live surface

Running your own reconstructions needs a Nansen API key. Copy the example
environment file:

```bash
cp .env.example .env
```

Then set `NANSEN_API_KEY` in `.env`. This key is **server-side only** — it is
never sent to the browser, logged, or written into a contract. (In the web form
you can instead paste a key that is used for a single request and never stored.)

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run e2e
```

`npm test` runs the engine, contract, and adapter suite on Node's built-in test
runner — no browser, no dependencies. `npm run e2e` runs the Playwright
end-to-end tests, and `npm run build` produces the production build.

## A note on security

The two HTTP routes that cost something — `POST /api/reconstruct` (spends Nansen
credits) and `POST /api/cases` (writes to the server's disk) — sit behind a set
of gates you turn on with environment variables before exposing the app:

- **`TRACE_API_TOKEN`** — a shared secret. When set, both routes require it in an
  `Authorization: Bearer <token>` header (or `x-trace-token`). In production, if
  it is **not** set, the reconstruct route refuses every request rather than spend
  credits for an anonymous caller — it fails closed.
- **`TRACE_RATE_LIMIT_PER_MIN`** — how many requests one IP may make per minute
  (default 5); bursts past it get a `429`.
- **`TRACE_CREDIT_BUDGET`** — a ceiling on the total credits the running server
  may spend. A run is refused *before* spending anything if it would exceed what
  is left (no cap locally; a conservative default in production). Send
  `{"dryRun": true}` to `POST /api/reconstruct` for a cost estimate that spends
  nothing and needs no key.
- **`TRACE_ALLOW_SAVE`** — the save-to-disk route is disabled in production unless
  you set this. `TRACE_ALLOW_SERVER_KEY` similarly controls whether the server's
  own key may be used, so a deployment never silently spends the owner's credits
  for anonymous callers.

These controls are in-memory and per-process: they suit a single-instance
deployment (they reset on restart and are not shared across replicas), so for a
multi-instance host put a shared store or your own gateway in front. The API
token is never logged.

## Project layout

```
app/                 Next.js pages and HTTP routes: the library, /reconstruct, /verify, app/api/*
components/          UI: the app shell and the case workspace (timeline, evidence, replay)
lib/                 App-side helpers: case adapter, follow-the-money, the Nansen-authority summary
src/contract/        The InvestigationContract: assembly, validation, completeness, verification
src/investigations/  Case builders (Euler, FTX), the live orchestrator, the case registry
src/nansen/          Server-side Nansen API client, response types, sanitizer
src/reconstruction/  The deterministic engine: normalize → reconstruct
src/types/           Domain and provenance types
scripts/             The CLI (trace.ts) and the Nansen reconnaissance scripts
docs/                Architecture notes and how to add a case
fixtures/            Sanitized captured Nansen responses used by the built-in cases
```

See [`docs/architecture.md`](docs/architecture.md) for how the pieces fit and
[`docs/adding-a-case.md`](docs/adding-a-case.md) to add your own.

## License

MIT — see [LICENSE](LICENSE).

