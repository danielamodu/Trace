# TRACE — Phase 1: Nansen API Reconnaissance

**Status:** Reconnaissance complete. **Authenticated test passed** — 10 endpoints returned live `200`s; blocker cleared. See §12 for authenticated results.
**Date:** 2026-09-21 (updated same day after authenticated run)
**Scope:** Validate which Nansen endpoints and data structures can support TRACE's first reliable onchain-incident reconstruction. No frontend, no graph UI, no fabricated data.

---

## 1. Repository findings

The working directory `C:\Users\USER\Desktop\Trace` was **empty** at the start of Phase 1 (no files, not a git repository).

| Aspect | Finding |
| --- | --- |
| Framework / language | None present. Node.js **v24.12.0**, npm 11.19.0, and Python 3.13 are available on the machine. |
| Existing dependencies | None. |
| Environment config | None. No `NANSEN_API_KEY` (or variants) set in the environment. |
| Source structure | None. |
| Existing Nansen integration | None. |
| Risks / conflicts | No API key present → cannot make an authenticated call yet (see §11 and Blockers). A user-global `rtk` shell wrapper prints a harmless banner; no impact on the project. |

**Decision:** scaffold a minimal, zero-dependency Node + TypeScript foundation (Node 24 runs `.ts` directly via native type stripping, so no build toolchain / no added dependencies). This keeps experiments reproducible and satisfies "server-side only, no secret to the client, no unnecessary dependencies."

### Files created
```
Trace/
├─ .env.example              # NANSEN_API_KEY placeholder (real .env is gitignored)
├─ .gitignore                # ignores .env, node_modules, raw fixtures
├─ package.json              # type:module, engines node>=22.6, npm run smoke|recon
├─ README.md                 # setup + how to reproduce recon
├─ src/nansen/
│  ├─ client.ts              # server-side client; apikey from env; never logged
│  └─ types.ts               # typed request/response boundaries (12 endpoints)
├─ scripts/
│  ├─ smoke.ts               # 0-credit connectivity/auth test (search/general)
│  └─ recon.ts               # reproducible probe runner → fixtures/
├─ fixtures/
│  └─ _live-auth-probe.json  # REAL captured 401 responses (no key used)
└─ docs/
   ├─ nansen-endpoints.md    # sanitized endpoint reference (from OpenAPI specs)
   └─ phase-1-nansen-reconnaissance.md  # this report
```

---

## 2. Tested endpoints

### 2a. Live requests actually executed (no key available)
Two real requests were sent to `https://api.nansen.ai` to confirm reachability and the exact auth-failure contract. **No key was used — these document the exact failure, not a fabricated success.**

| Request | Result | Evidence |
| --- | --- | --- |
| `POST /api/v1/search/general` (no `apikey` header) | **401** `unauthenticated` — full structured error envelope, `doc_url` present, rate-limit headers present, `x-request-id` present | `fixtures/_live-auth-probe.json` |
| `POST /api/v1/search/general` (bogus `apikey`) | **401** — minimal `{"message":"Invalid API key…"}` body (NOT the full envelope) | `fixtures/_live-auth-probe.json` |

**What this proves without a key:**
- The base URL and path are valid (a `401`, not `404` — the endpoint exists and routes).
- Auth is via the `apikey` header exactly as documented.
- The missing-key error matches the documented envelope byte-for-byte (`code: "unauthenticated"`, `doc_url`, `request_id`).
- Rate-limit headers (`ratelimit-limit/remaining/reset`) and `x-request-id` are returned even on failure — TRACE can rely on them for throttling and support.
- **Finding:** invalid-key vs missing-key produce **different body shapes**. The client tolerates both (`NansenApiError` captures the raw body regardless of shape).
- The API is fronted by Cloudflare (`cf-cache-status: DYNAMIC`).

### 2b. Endpoints characterized from the official OpenAPI specs
Full request/response schemas were extracted from the OpenAPI 3.1 documents embedded in each doc page and recorded in `docs/nansen-endpoints.md`. The probe runner (`scripts/recon.ts`) has a ready, deterministic body for each and will validate the live shape the moment a key exists:

`tgm/transfers`, `tgm/dex-trades`, `tgm/flows`, `tgm/flow-intelligence`,
`tgm/who-bought-sold`, `tgm/holders`, `smart-money/netflow`,
`smart-money/historical-holdings`, `profiler/address/counterparties`,
`profiler/address/related-wallets`, `profiler/address/transactions`,
`profiler/address/labels`, `search/general`.

---

## 3. Actual request schemas

Base URL `https://api.nansen.ai`; every data endpoint is `POST` with `apikey` header + JSON body. Common building blocks: `date:{from,to}` (≤366 days), `pagination:{page,per_page≤1000}`, `order_by:[{field,direction}]`. Full per-endpoint schemas live in [`docs/nansen-endpoints.md`](./nansen-endpoints.md). Representative examples:

```jsonc
// POST /api/v1/tgm/transfers   (required: chain, token_address, date)
{
  "chain": "ethereum",
  "token_address": "0x…",
  "date": { "from": "2025-01-06", "to": "2025-01-07" },
  "filters": { "include_cex": true, "transfer_value_usd": { "min": 100000 } },
  "pagination": { "page": 1, "per_page": 100 }
}

// POST /api/v1/profiler/address/related-wallets   (required: address, chain)
{ "address": "0x…", "chain": "ethereum", "pagination": { "page": 1, "per_page": 50 } }

// POST /api/v1/profiler/address/counterparties   (required: chain, date; address or entity_name)
{ "address": "0x…", "chain": "ethereum", "date": { "from": "2025-01-01", "to": "2025-01-08" }, "group_by": "entity" }
```

---

## 4. Sanitized response examples

Live successful responses require a key (blocker). The documented row shapes (from the OpenAPI specs) are recorded in `docs/nansen-endpoints.md`. Real captured responses so far are the two 401s in `fixtures/_live-auth-probe.json`, e.g.:

```json
{
  "error": "Unauthorized",
  "message": "API key required. This endpoint does not support paid access.",
  "code": "unauthenticated",
  "status": 401,
  "request_id": "…",
  "doc_url": "https://docs.nansen.ai/getting-started/error-handling#unauthenticated"
}
```

Once a key is added, `npm run recon` writes one sanitized, row-truncated fixture per endpoint to `fixtures/` automatically.

---

## 5. Data availability

Historical coverage (from Nansen's `data-coverage` page): each chain indexed from genesis / onboarding.

| Chain | Data from | | Chain | Data from |
| --- | --- | --- | --- | --- |
| Ethereum | 2015-07-30 | | Base | 2023-06-15 |
| Tron | 2018-06-25 | | Arbitrum | 2021-05-29 |
| Solana | 2020-03-17 | | Optimism | 2021-11-11 |
| BNB | 2020-08-29 | | Polygon | 2020-05-30 |

- **Ethereum has the deepest history (10+ years) and the richest labels** → the natural home for TRACE's first case.
- Live data is near real-time (seconds–minutes); current-day may be served from a ≤5-min cache.
- Historical (fully-past) ranges are point-in-time but **not immutable** — may be revised for backfills, label-history updates, price fixes. TRACE must record `captured_at` + `request_id` per fixture (the recon runner does).
- Hyperliquid perps: separate dataset, reliable from May 2025. Polymarket: from Nov 2022.

### Feasibility by event type (Task 4)

| Event type | Supported? | Primary endpoints |
| --- | --- | --- |
| Accumulation | ✅ | `tgm/flows`, `tgm/who-bought-sold` (BUY), `smart-money/netflow` |
| Distribution | ✅ | `tgm/flows`, `tgm/who-bought-sold` (SELL), `smart-money/netflow` |
| Large transfers | ✅ | `tgm/transfers` (+ `transfer_value_usd` filter) |
| Smart Money activity | ✅ | `smart-money/netflow`, `smart-money/historical-holdings`, `tgm/dex-trades?only_smart_money` |
| Capital movement between entities | ✅ | `profiler/address/counterparties` (`group_by:entity`) |
| Holder composition changes | ⚠️ Partial | `tgm/holders` = **current** snapshot; point-in-time needs `backtesting/historical-top-holders` |
| Sequential wallet activity | ✅ | `profiler/address/transactions`, `profiler/address/related-wallets` |

### Facts vs. calculation vs. hypothesis vs. unavailable

- **Facts returned by Nansen:** transfers, DEX trades, balances, per-address volumes, counterparties + interaction counts, related-wallet links (each with `transaction_hash` + `block_timestamp`), entity/behavioural labels, cohort net-flows.
- **Values TRACE calculates:** ordering/merging events into one timeline, cumulative flow curves, deltas between snapshots, cohort roll-ups TRACE derives itself.
- **Hypotheses only (must be flagged, never asserted):** *why* an actor moved funds, intent, "coordination," attribution beyond what a Nansen label states. `related-wallets` gives a *relation* + evidence tx, not proof of common ownership.
- **Unavailable / out of scope:** off-chain identity, private mempool intent, causation. The product must not present these as facts.

---

## 6. Credit usage

**Plans:** Free = 100 one-time trial credits then daily top-up to 10; Pro = 2,000 credits (monthly top-up to a 2,000 floor), $49–69/mo.
**Rate limits:** Free 15 req/s (300/min); Pro 75 req/s (1,500/min); some endpoints have tighter per-minute caps.

**Credit cost of TRACE-relevant endpoints (Free = Pro unless noted):**

| Cost | Endpoints |
| --- | --- |
| **0** | `search/general`, `search/entity-name`, `account` |
| **1** | `tgm/transfers`, `tgm/dex-trades`, `tgm/flows`, `tgm/flow-intelligence`, `tgm/who-bought-sold`, `profiler/address/transactions`, `profiler/address/related-wallets` |
| **5** | `tgm/holders`, `smart-money/netflow`, `smart-money/holdings`, `profiler/address/counterparties` |
| **25** | `smart-money/historical-token-balances`, `tgm/historical-top-holders` |
| **100** | `profiler/address/labels` (common labels) |
| **500** | `profiler/address/premium-labels` |

**Key credit findings:**
- **`address/labels` (100 credits) is the budget landmine.** A single call empties the Free trial balance. **Mitigation TRACE will use:** labels arrive inline on most endpoints (`from_address_label`, `counterparty_address_label`, etc.) at no extra cost — prefer those; call the dedicated labels endpoint only when unavoidable. The recon runner **excludes** it from the default sweep.
- The default recon sweep (`npm run recon`) costs an estimated **~20 credits** (all probes ≤5 credits), well within a Free trial and negligible on Pro.
- Credits are observable at runtime via `X-Nansen-Credits-Cost/Used/Remaining` response headers — the client captures all three into `meta`.
- No exploratory brute-forcing: probes are a fixed, deliberate list with `per_page:3`.

---

## 7. Candidate hero events

TRACE's thesis is "something happened — reconstruct how." The best hero event has a **fixed public starting point** (a known address / token / timestamp) so the reconstruction is reproducible and label-rich. Candidate classes, each mapped to the data:

| # | Candidate class | Why it fits | Endpoints | Risk |
| --- | --- | --- | --- | --- |
| A | **Exploit / hack fund-flow trace** (Ethereum) — start from a publicly-known attacker address, follow funds attacker → DEX swaps → intermediaries → CEX-deposit / bridge | Clear timeframe, multi-step, label-rich (CEX/bridge labels), maps 1:1 to an evidence timeline; attacker address is public fact | `profiler/address/transactions`, `tgm/transfers`, `tgm/dex-trades`, `profiler/address/counterparties`, `related-wallets`, inline labels | Some hops route through mixers → chain breaks (acceptable; TRACE shows the break honestly) |
| B | **Token distribution / unlock dump** | Clean accumulation→distribution arc; visually clear | `tgm/flows`, `tgm/who-bought-sold`, `smart-money/netflow` | Less "incident," more "trend"; weaker narrative |
| C | **Stablecoin depeg** (e.g. a past USDC/DAI wobble) | Strong CEX/DEX in-vs-out story on a known day | `tgm/flows` (cex/dex split), `tgm/dex-trades`, `smart-money/netflow` | Aggregate, fewer distinct "actors" to name |
| D | **Smart-money pre-positioning before a listing/announcement** | Named smart-money actors; compelling | `smart-money/netflow`, `smart-money/historical-holdings`, `tgm/who-bought-sold` | Borders on implying intent → must stay descriptive |

---

## 8. Selected event and justification

**Recommended: Candidate A — an exploit / hack fund-flow trace on Ethereum**, starting from a single publicly-known attacker address within a bounded (few-day) window.

Why (data quality + demonstrability, not chart aesthetics):
1. **Fixed, reproducible entry point** — one public address + a known date range makes every query deterministic and re-runnable.
2. **Genuinely sequential & multi-step** — `profiler/address/transactions` + `tgm/transfers` yield an ordered chain of hops; `related-wallets` and `counterparties` expand the cluster. This is exactly an evidence timeline.
3. **Label-rich on Ethereum** — destination CEX/bridge entities are labelled inline (no 100-credit label calls needed).
4. **Cheap to reconstruct** — the core path uses 1–5 credit endpoints.
5. **Matches the product thesis** — "reconstruct how it happened" is literally following stolen/moved funds hop by hop, with the chain break shown honestly where a mixer intervenes.

**Not yet fixed:** the *specific* incident (exact attacker address, token, exact dates). Selecting the concrete case requires **one key-backed dry run** to confirm the chosen address actually returns rich, unbroken, label-bearing data in the window — I will not hard-code an incident's addresses/amounts from memory, as that risks fabricated specifics. This is the one human-approval item in §11.

---

## 9. Known limitations

- ~~No successful authenticated call yet~~ **Resolved 2026-09-21** — 10 endpoints returned live `200`s (§12). The documented shapes in §3–§5 are now confirmed against real responses.
- **`tgm/flows` does not support stablecoins** — returns `422 invalid_field_value` (confirmed live with USDC). Use a non-stablecoin token (recon uses WETH).
- **`tgm/flows` CEX/DEX split can be null** — for WETH in the tested window, `total_inflows_dex/cex` and `total_outflows_dex/cex` came back `null` while `total_inflows_count`/`total_outflows_count` were populated. The DEX/CEX breakdown is not guaranteed present; TRACE must handle nulls.
- `tgm/holders` is a **current** snapshot; historical holder composition needs the 25-credit backtesting endpoint.
- Historical data is **point-in-time but revisable** — fixtures must record `captured_at` + `request_id` (the runner does).
- `related-wallets` returns a *relation*, not proof of common ownership — treat as a hypothesis with evidence, never as fact.
- Cross-chain hops and mixer interactions can break a trace; the product must depict breaks, not paper over them.
- `smart-money/historical-holdings` covers only 7 chains (`arc, base, bnb, ethereum, monad, robinhood, solana`).
- Redistribution restrictions apply to Nansen data (docs: Data Redistribution Guidelines) — must be reviewed before anything is shown publicly (§11).

---

## 10. Recommended next architecture decisions

1. **Keep the key strictly server-side.** All Nansen calls go through the Node client / a thin API route; the browser never sees the key or calls Nansen directly. (Enforced already: `client.ts` reads `process.env`, redacts, no client bundle.)
2. **Introduce a response cache + fixture layer.** Cache by `(path, body-hash)` to avoid re-spending credits during development and to make demos reproducible offline. Fixtures already have the right shape.
3. **Model a normalized `Event` type** (`timestamp, kind, from, to, token, value_usd, tx_hash, source_endpoint, labels[]`) that every endpoint maps into — the timeline is TRACE-owned, endpoints are just sources.
4. **A provenance flag on every rendered fact** — `fact | derived | hypothesis` — enforced at the type level, so the UI can never silently present a hypothesis as a fact.
5. **Central rate-limit + credit governor** — honor `Retry-After`, self-throttle on the smaller of `RateLimit-Remaining`/`X-RateLimit-Remaining`, and refuse to auto-call the 100/500-credit label endpoints without an explicit opt-in.
6. **Prefer inline labels; gate the labels endpoint** behind an explicit, budgeted call.

---

## 11. Questions requiring human approval

1. **API key + plan.** Please provide a `NANSEN_API_KEY` (add to `.env`, never commit) and confirm the plan (Free vs Pro). This unblocks live validation. Free's 100-credit trial is enough for the full recon sweep **if** we avoid the labels endpoint.
2. **Hero incident selection.** Approve Candidate A (exploit fund-flow trace on Ethereum) as the class, and either (a) name a specific incident/attacker address you want traced, or (b) authorize me to run one key-backed dry run to pick a concrete case that returns clean, label-rich data. Budget: ≤50 credits.
3. **Data redistribution.** Before any Nansen-derived data is shown in a public-facing product, confirm we've reviewed and comply with Nansen's Data Redistribution Guidelines. Do not treat Phase-2 UI as public until this is cleared.
4. **Credit budget ceiling** for Phase 2 development (recommend capping automated recon at a fixed monthly credit budget, with the label endpoints requiring manual opt-in).

---

## Validation — commands executed and results

| Command | Result |
| --- | --- |
| Repo inspection (`ls`, `find`, `git status`) | Empty dir, not a git repo |
| Env check for `NANSEN_API_KEY` (+variants) | All **unset** |
| `node --version` / `python --version` | Node v24.12.0 / Python 3.13.14 |
| Fetched official docs (auth, rate-limits, credits, errors, data-coverage, chains, 13 endpoint OpenAPI specs) | ✅ captured & parsed |
| `node scripts/recon.ts --list` | ✅ lists 12 probes with credit costs |
| `node scripts/smoke.ts` (no key) | ✅ exits 2 with documented BLOCKED message (no fabrication) |
| `curl POST /api/v1/search/general` (no key) | **401** `unauthenticated` (full envelope) — real, saved |
| `curl POST /api/v1/search/general` (bogus key) | **401** minimal `{message}` — real, saved |

**Unauthenticated API calls made:** 2 live (both → 401). See §12 for the authenticated run.

---

## 12. Authenticated reconnaissance results (2026-09-21)

A key was added to `.env` (present, length verified, value never printed or logged; `.env` gitignored). A controlled authenticated run followed, capped well under the 50-credit ceiling.

**Authentication status:** ✅ **PASS.** `POST /api/v1/search/general` → `200`, `X-Nansen-Credits-Cost: 0`.

### Endpoints tested live (one deterministic call each, `per_page: 3`)

| Endpoint | Status | Credits (used) | Rows | Notes |
| --- | --- | --- | --- | --- |
| `search/general` | 200 | 0 | — | keys: `tokens, entities, total_results` (not the list envelope) |
| `tgm/transfers` | 200 | 1 | 3 | large transfers w/ inline from/to labels |
| `tgm/dex-trades` | 200 | 1 | 3 | both swap sides + `estimated_value_usd`, BUY/SELL |
| `tgm/flows` | **422** then 200 | 1 | 3 | **rejects stablecoins**; re-ran with WETH → 200 |
| `tgm/flow-intelligence` | 200 | 1 | 1 | per-cohort net/avg flow + wallet counts |
| `tgm/who-bought-sold` | 200 | 1 | 3 | per-address bought/sold USD, inline labels |
| `tgm/holders` | 200 | 5 | 3 | current holders + balance-change fields |
| `smart-money/netflow` | 200 | 5 | 3 | 1h/24h/7d/30d net flow, trader_count |
| `profiler/related-wallets` | 200 | 1 | 3 | relation + evidence tx (see below) |
| `profiler/counterparties` | 200 | 5 | 3 | entity volumes + `tokens_info[]` |
| `profiler/transactions` | 200 | 1 | 3 | tokens_sent/received, method, source_type |

`profiler/address/labels` (100 credits) was **not called**, per instruction. Fixtures for every probe are in `fixtures/` (row-truncated, key-redacted).

### Credits used
Balance moved **100 → 78 = 22 credits** this run (21 in the sweep + 1 for the WETH flows re-run). Observed via `X-Nansen-Credits-Remaining`. Well under the 50 ceiling. The 100-credit starting balance indicates a **Free / trial** plan.

### Confirmed real response schemas (representative, from live fixtures)

```jsonc
// tgm/transfers — data[]
{ "block_timestamp":"2025-01-06T02:41:35Z", "transaction_hash":"0x…",
  "from_address":"0x28c6…", "to_address":"0xf977…",
  "from_address_label":"Token Billionaire", "to_address_label":"Token Millionaire",
  "transaction_type":"transfer", "transfer_amount":722089988.4, "transfer_value_usd":722146184.5 }

// tgm/dex-trades — data[]  (both sides of the swap present)
{ "block_timestamp":"2025-01-07T23:59:59Z", "trader_address":"0x5de0…",
  "action":"BUY", "token_name":"USDC", "token_amount":4302.9,
  "traded_token_name":"PIN", "traded_token_amount":2003,
  "estimated_swap_price_usd":0.9796, "estimated_value_usd":4215.0 }

// smart-money/netflow — data[]
{ "token_symbol":"UNI", "net_flow_1h_usd":0, "net_flow_24h_usd":98910.5,
  "net_flow_7d_usd":-62934.1, "net_flow_30d_usd":-43524.5,
  "chain":"ethereum", "trader_count":18, "token_age_days":2198, "market_cap_usd":5.45e9 }

// profiler/related-wallets — data[]  (relation + the evidence tx)
{ "address":"0x0079…", "address_label":"High Activity", "relation":"First Funder",
  "transaction_hash":"0x7671…", "block_timestamp":"2021-04-22T06:34:00Z", "order":1, "chain":"ethereum" }

// tgm/flows (WETH) — data[]  (⚠ dex/cex split was null in this window)
{ "date":"2025-01-07T23:00:00Z", "bucket_end":"2025-01-08T00:00:00Z", "is_complete":true,
  "price_usd":3386.0, "value_usd":5.65e9, "holders_count":100,
  "total_inflows_count":2658.4, "total_outflows_count":-723.2,
  "total_inflows_dex":null, "total_outflows_dex":null, "total_inflows_cex":null, "total_outflows_cex":null }
```

### Key data findings (real evidence)
1. **Inline labels are free and rich.** Live rows carried `from_address_label`/`to_address_label` (e.g. "Token Billionaire"), `trader_address_label`, `counterparty_address_label:["High Balance"]`, and ENS entities ("yonseiuniversity.eth") at **0 extra credits**. This confirms TRACE can avoid the 100-credit `labels` endpoint for most needs.
2. **`related-wallets` is a ready-made evidence layer.** Relations observed: **"First Funder", "Deployed Contract", "Previous Multisig Signer of"** — each with a linking `transaction_hash` + `block_timestamp`. This maps directly onto TRACE's evidence timeline and is a *relation*, not proof of common ownership (keep as hypothesis-with-evidence).
3. **Deep history is queryable.** `related-wallets` returned a 2021-04 evidence tx; transfers/dex-trades returned the requested Jan-2025 window. Live-verified that the documented Ethereum coverage is reachable.
4. **`tgm/flows` rejects stablecoins** (`422 invalid_field_value`) — real constraint, now handled in the runner.
5. **`tgm/flows` DEX/CEX split may be null** — the cohort split fields returned `null` for WETH in-window even though count fields were populated. TRACE must not assume the breakdown is present.
6. **`counterparties` gives entity-level capital movement** — Binance 14 → a counterparty with `interaction_count: 720`, `volume_in_usd ≈ $1.27B`, and a 20-entry `tokens_info[]` (per-token in/out amounts). Strong fit for "capital movement between entities."
7. **Credit meta is reliable at runtime** — `X-Nansen-Credits-Cost/Used/Remaining` present and decremented exactly as documented.

### Category coverage (all five requested categories exercised live)
| Category | Endpoint(s) proven | Result |
| --- | --- | --- |
| Token flows | `tgm/flows`, `tgm/flow-intelligence` | ✅ (flows needs non-stablecoin) |
| Transfers | `tgm/transfers` | ✅ |
| DEX trades | `tgm/dex-trades` | ✅ |
| Smart Money activity | `smart-money/netflow` | ✅ |
| Wallet relationships | `profiler/related-wallets`, `profiler/counterparties` | ✅ |

### Hero event — still recommend Candidate A, now with live support
The authenticated run confirms the building blocks for **Candidate A (Ethereum exploit fund-flow trace)** are real and cheap: transfers + dex-trades + counterparties + related-wallets, all label-bearing inline, over deep history. A concrete incident (specific attacker address + window) is still **not** hard-coded — that selection needs your approval (§11 item 2). No hero event has been fabricated.

### Validation (authenticated)
| Command | Result |
| --- | --- |
| `.env` key presence check (value not printed) | PRESENT (length 36), `.env` gitignored ✅ |
| `npm run smoke` | 200, 0 credits ✅ |
| `npm run recon` (default sweep) | 10×200 + 1×422 (stablecoin) ✅, 21 credits |
| `node --env-file-if-exists=.env scripts/recon.ts tgm-flows` (WETH) | 200 ✅, 1 credit |

**Authenticated API calls made:** 12 (10 unique 200s, 1 expected 422, plus the smoke 200). **Credits used this run: 22 / 100.** No `labels` call. No fabricated data.

---

## Hero Incident Discovery (Phase 1B, 2026-09-21)

Goal: identify TRACE's first real hero investigation, validated against **live Nansen data only** (external info used solely to name candidates, never as evidence). Budget cap: 30 additional credits. `profiler/address/labels` (100 cr) not used — inline labels are free.

### How candidates were found (0 credits)
Nansen's own `POST /api/v1/search/general` (0 cr) labels exploiter clusters as first-class entities (tag `Exploit`/`Attack`/`Blacklist`). Free searches surfaced e.g. `Euler Exploiter`, `Wintermute Exploiter`, `FTX Exploiter`, `Nomad Bridge Exploiter`, `KyberSwap`, `Yearn Exploiter 2023/2025`. This means the *candidate* is discovered from Nansen, not from a news article.

### Candidates tested (live)
Each was probed with `profiler/address/counterparties` using **`entity_name`** (fully reproducible, no guessed address; 5 cr each), `group_by: entity`.

#### Candidate A — Euler Finance exploit + fund return
```
Incident:              Euler Finance exploit and multi-day fund return
Starting entity:       Nansen entity "Euler Exploiter"; attacker EOA 0xb66cd9…95db (label jaydoteth.eth)
Time window:           2023-03-13 → 2023-03-31
Key entities:          balancervault.eth ($355M), aWBTC_v2 ($373M), wstETH ($119M), WETH (wraps.eth),
                       0x000…000 burn ($150M out), attacker EOA ($378M in=out)
Major transfers:       FACT — 15 entity counterparties, volumes up to $378M, interaction_count 108
DEX activity:          FACT — swap methods present in EOA tx history (swapExactTokensForETH…)
Smart Money/entity:    FACT — Balancer, Euler, aToken labels inline (free)
Related-wallet evidence: RELATION — "First Funder" 0x036cec…5f1c, funding tx 2023-03-13T09:12:23Z (just before exploit)
Meaningful chronological steps: ~6+ (fund → flashloan → exploit/mint → drain → partial swaps → multi-day returns)
Nansen endpoints required: counterparties, transactions, related-wallets (+ optional transfers/dex-trades)
Estimated credits (full): ~9
Data gaps:             transactions default-order returns latest first → must paginate to reach 03-13 rows
Can TRACE reconstruct a coherent sequence? YES
```

#### Candidate B — FTX Exploiter (Nov 2022 drain)
```
Incident:              FTX post-collapse wallet drain
Starting entity:       Nansen entity "FTX Exploiter"
Time window:           2022-11-11 → 2022-11-30
Key entities:          23 counterparties; UniswapV2 ($40M out), multiple Token Millionaire/High Balance wallets,
                       top counterparty $285M in=out, 0x000…000 burn ($76M)
Major transfers:       FACT — rich, high count
DEX activity:          FACT — heavy (UniswapV2 edges; drainer swapped stolen tokens → ETH)
Smart Money/entity:    FACT — some labels, many "High Activity/High Balance" generic
Related-wallet evidence: not deep-probed (candidate not selected)
Meaningful chronological steps: many, but fan-out is chaotic
Nansen endpoints required: counterparties, transactions, dex-trades, related-wallets
Estimated credits (full): ~12
Data gaps:             attribution is publicly contested (insider vs external) — attribution murk
Can TRACE reconstruct a coherent sequence? YES, but noisier and attribution-sensitive
```

#### Candidate C — Wintermute Exploiter (Sept 2022 Profanity vanity-address)
```
Incident:              Wintermute vanity-address compromise
Starting entity:       Nansen entity "Wintermute Exploiter"
Time window:           2022-09-20 → 2022-09-30
Key entities:          only 7 counterparties; $162M received from one contract, $162M out to 0xe74b28…4705
Major transfers:       FACT — 2 dominant edges (~$162M each)
DEX activity:          minimal in-window
Smart Money/entity:    sparse — mostly "High Activity" / "ETH Millionaire" generic labels
Related-wallet evidence: not deep-probed
Meaningful chronological steps: ~2 (in, out) — too shallow
Nansen endpoints required: counterparties, transactions
Estimated credits (full): ~7
Data gaps:             too few distinct entities/steps for a compelling multi-step story
Can TRACE reconstruct a coherent sequence? WEAK — story is essentially one hop
```

### Selection scoring (A–G)
| Criterion | Euler (A) | FTX (B) | Wintermute (C) |
| --- | --- | --- | --- |
| A Data completeness | ★★★ | ★★★ | ★★ |
| B Chronological reconstructability | ★★★ | ★★ | ★★ |
| C Meaningful evidence transitions | ★★★ | ★★★ | ★ |
| D Entity/relationship richness | ★★★ | ★★ | ★ |
| E Visual demonstrability | ★★★ | ★★ | ★★ |
| F Reproducibility | ★★★ | ★★★ | ★★★ |
| G Low API cost | ★★★ | ★★ | ★★★ |

### Selected hero incident: **Candidate A — Euler Finance exploit and fund return**
Why it is reconstructable (on data, not coolness):
- **Single identifiable start** — one attacker EOA (`0xb66cd9…95db`, Nansen label `jaydoteth.eth`) plus a `First Funder` relation with an exact pre-exploit timestamp (`2023-03-13T09:12:23Z`). Clean entry point.
- **Genuinely sequential, multi-step** — fund → Balancer flashloan → exploit/mint → drain → partial swaps → **multi-day returns** (a rare, visually clear arc that is on-thesis: "how it happened").
- **Label-rich for free** — Balancer, Euler aTokens, wstETH, WETH, ENS names all arrive inline; no 100-credit `labels` call.
- **Cheap + reproducible** — full reconstruction ≈ **9 credits** from three endpoints with fixed request bodies (see `fixtures/hero-event.json`).
- FTX is a strong runner-up but its attribution is publicly contested, which clashes with TRACE's "we do not assert causation" rule; Wintermute is too shallow (≈2 hops).

### Exact investigation window & required addresses/entities
- **Window:** `2023-03-13` → `2023-03-31` (UTC), Ethereum.
- **Entity:** `Euler Exploiter` (for entity-level counterparties).
- **Attacker EOA:** `0xb66cd966670d962c227b3eaba30a872dbfb995db`.
- **First Funder:** `0x036cec1a199234fc02f72d29e596a09440825f1c` (funding tx `2023-03-13T09:12:23Z`).
- **Balancer Vault:** `0xba12222222228d8ba445958a75a0704d566bf2c8`.

### Proposed first TRACE investigation sequence
1. **T-0 funding** — `related-wallets` → "First Funder" edge (RELATION) with funding tx just before the exploit.
2. **Flashloan** — `counterparties` edge to `balancervault.eth` ($355M) (FACT); "loan taken for the attack" is HYPOTHESIS.
3. **Exploit / mint & drain** — `transactions` (paginated to 03-13) shows the exploit-day methods and token movements (FACT).
4. **Asset conversion** — swap methods + aToken/wstETH/WETH edges (FACT).
5. **Dispersal** — outflow edges incl. burn `0x000…000` ($150M) (FACT).
6. **Multi-day return** — later `transactions` (03-24 → 03-31) show funds flowing back toward Euler (FACT); framing as "voluntary return" is HYPOTHESIS.

### Evidence classification for this incident
- **FACT:** all counterparty addresses, Nansen labels, `interaction_count`, volumes, tx timestamps, tx methods.
- **DERIVED:** the ordered timeline, cumulative/net USD per hop, the step count — computed by TRACE from FACTs.
- **RELATION:** the `First Funder` link and each counterparty edge (returned by Nansen; a relation, not proof of common control).
- **HYPOTHESIS:** intent, that the flashloan was "for" the attack, that the returns were "voluntary." TRACE renders these as hypotheses only.

### Known limitations
- `transactions` default ordering returns latest-first; exploit-day (03-13) rows require pagination (`is_last_page=false` observed).
- Historical data is point-in-time but revisable (labels/prices can be backfilled) — fixtures record `captured_at` + `request_id`.
- Entity clustering under "Euler Exploiter" aggregates multiple addresses; edges are relations, not ownership proof.
- Deep on-chain internal calls (contract-level exploit mechanics) are summarized by `method`, not fully decoded — TRACE shows the fund-flow, not the bytecode-level exploit logic.

### Credits consumed in discovery
| Call | Credits |
| --- | --- |
| Free entity searches ×5 (`search/general`) | 0 |
| `counterparties` entity_name — Euler | 5 |
| `counterparties` entity_name — Wintermute | 5 |
| `counterparties` entity_name — FTX | 5 |
| `transactions` — Euler EOA | 1 |
| `related-wallets` — Euler EOA | 1 |
| **Total this phase** | **17** (≤30 cap) |

Reproduction data saved to [`fixtures/hero-event.json`](../fixtures/hero-event.json); raw discovery fixtures in `fixtures/discovery/`.

---

## Phase 2 recommendation

Proceed to Phase 2 **only after** a key is provided and one key-backed recon sweep validates the live response shapes and confirms a concrete hero incident (Candidate A). Phase 2 should then build: (1) the server-side call + cache/fixture layer, (2) the normalized `Event` model with provenance flags, and (3) a first read-only reconstruction of the selected incident — **not** the graph UI yet. Do not begin Phase 2 automatically.
