# Nansen API — Endpoint Reference (TRACE-relevant subset)

Derived from the official OpenAPI 3.1 specs embedded in the Nansen docs
(`https://docs.nansen.ai/<path>.md`). Captured 2026-09-21. This is the documented
contract, not a record of live responses — runtime shapes are validated by
`scripts/recon.ts`.

- **Base URL:** `https://api.nansen.ai`
- **Auth:** header `apikey: <YOUR_API_KEY>` (lowercase canonical). Server-side only.
- **Method:** all data endpoints are `POST` with a JSON body.
- **Common envelope:** list endpoints return `{ data: [...], pagination: { page, per_page, is_last_page }, warnings?: [] }`.
- **Pagination:** `pagination: { page (1-based), per_page (max 1000, default 10) }`.
- **Dates:** `date: { from, to }` in `YYYY-MM-DD` or full ISO 8601; most endpoints cap the span at 366 days.
- **Sorting:** `order_by: [{ field, direction: "ASC"|"DESC" }]`.

## Response headers worth capturing
`X-Request-Id`, `X-Nansen-Credits-Cost`, `X-Nansen-Credits-Used`,
`X-Nansen-Credits-Remaining`, `RateLimit-*` / `X-RateLimit-*`, `Retry-After`,
`X-Nansen-RateLimit-Scope`.

## Endpoints

### POST /api/v1/tgm/transfers — Token Transfers (1 credit)
Top token transfers for a token; can include/exclude DEX & CEX, filter by
from/to address or label, value range. **Reconstruction: large transfers, capital movement.**
- Request*: `chain`, `token_address`, `date`; optional `filters` (`include_dex`, `include_cex`, `only_smart_money`, `from_address`, `to_address`, `transaction_hash`, `transfer_value_usd{min,max}`), `pagination`, `order_by`.
- Row: `block_timestamp, transaction_hash, from_address, to_address, from_address_label?, to_address_label?, transaction_type?, transfer_amount?, transfer_value_usd?`.

### POST /api/v1/tgm/dex-trades — DEX Trades (1 credit)
Individual DEX swaps for a token. **Reconstruction: buy/sell sequence, price at time.**
- Request*: `chain`, `token_address`, `date`; optional `only_smart_money`, `filters` (`action` BUY/SELL, `trader_address`, `estimated_value_usd{min,max}`, `block_timestamp{from,to}`).
- Row: `block_timestamp, transaction_hash, trader_address, trader_address_label?, action(BUY|SELL), token_amount, traded_token_amount, estimated_swap_price_usd, estimated_value_usd`.

### POST /api/v1/tgm/flows — Flows (1 credit)
Time-bucketed inflow/outflow for a token, optionally by cohort label. **Reconstruction: accumulation/distribution over time, CEX vs DEX split.**
- Request*: `chain`, `token_address`, `date`; optional `label` (`whale|public_figure|smart_money|top_100_holders|exchange`), `pagination`.
- Row: `date, bucket_end?, is_complete?, price_usd?, value_usd?, total_inflows_dex, total_outflows_dex, total_inflows_cex, total_outflows_cex, holders_count`.

### POST /api/v1/tgm/flow-intelligence — Flow Intelligence (1 credit)
Aggregated net/avg flow + wallet counts per cohort (public figure, top PnL, whale, smart trader, exchange, fresh wallets) over a timeframe. **Reconstruction: which cohort drove a move.**
- Request*: `chain`, `token_address`; optional `timeframe` (`5m|1h|6h|12h|1d|7d`).
- Row: `{cohort}_net_flow_usd, {cohort}_avg_flow_usd, {cohort}_wallet_count` for each cohort.

### POST /api/v1/tgm/who-bought-sold — Who Bought/Sold (1 credit)
Per-address bought/sold volume for a token in a window. **Reconstruction: identify the actors behind a move.**
- Request*: `chain`, `token_address`, `date`; optional `buy_or_sell` (BUY|SELL), label filters.
- Row: `address, address_label?, bought_token_volume, sold_token_volume, bought_volume_usd, sold_volume_usd, trade_volume_usd`.

### POST /api/v1/tgm/holders — Holders (5 credits; 150 if premium_labels=true)
Current holder list / entity-aggregated holdings with balance changes. **Reconstruction: holder composition snapshot (current, not historical).**
- Request*: `chain`, `token_address`; optional `aggregate_by_entity`, `label_type`, `premium_labels`, filters (`ownership_percentage`, `value_usd`, `balance_change_24h/7d/30d`).
- Row: `address?, address_label?, token_amount?, ownership_percentage?, value_usd?, balance_change_24h/7d/30d?`.
- ⚠️ Returns *current* holders; not a point-in-time historical snapshot (see backtesting `historical-top-holders`).

### POST /api/v1/smart-money/netflow — Smart Money Netflow (5 credits)
Aggregated Smart Money net flow per token across selected chains (1h/24h/7d/30d). **Reconstruction: smart-money accumulation/distribution.**
- Request*: `chains[]`; optional `filters` (`token_address`, `include_stablecoins`, `trader_count`, `market_cap_usd`).
- Row: `token_address, token_symbol, net_flow_1h_usd, net_flow_24h_usd, net_flow_7d_usd, net_flow_30d_usd, chain, trader_count`.

### POST /api/v1/smart-money/historical-holdings — Historical Holdings (25 credits)
Point-in-time Smart Money holdings over a date range. Chains limited to `arc, base, bnb, ethereum, monad, robinhood, solana`. **Reconstruction: smart-money holdings change through an event.**
- Request*: `date_range`, `chains[]`; optional filters + pagination.
- Row: `date, chain, token_address, token_symbol, smart_money_labels[], balance, value_usd, balance_24h_percent_change, holders_count, share_of_holdings_percent, market_cap_usd`.

### POST /api/v1/profiler/address/counterparties — Counterparties (5 credits)
Counterparties + interaction stats for an address/entity in a window. **Reconstruction: capital movement between entities.**
- Request*: `chain`, `date`; one of `address`/`entity_name`; optional `source_input`, `group_by` (wallet|entity), volume filters.
- Row: `counterparty_address, counterparty_address_label[], interaction_count, total_volume_usd, volume_in_usd, volume_out_usd, tokens_info[]`.
- Batch variant available: `/api/v1/profiler/address/counterparties` (batch page) for up to 10 addresses.

### POST /api/v1/profiler/address/related-wallets — Related Wallets (1 credit)
Wallets related to an address, with the linking evidence. **Reconstruction: cluster the actor, find sibling wallets.**
- Request*: `address`, `chain`; optional pagination/order.
- Row: `address, address_label?, relation, transaction_hash, block_timestamp, order, chain`.
- Note: each row carries a `transaction_hash` + `block_timestamp` — i.e. the evidence for the relation, which fits TRACE's evidence-timeline model directly.

### POST /api/v1/profiler/address/transactions — Address Transactions (1 credit)
Per-transaction history for an address with tokens sent/received. **Reconstruction: sequential wallet activity.**
- Request*: `address`, `chain`, `date`; optional `hide_spam_token`, filters (`token_symbol`, `counterparty_address`, `method`, `volume_usd`).
- Row: `chain, method, volume_usd, block_timestamp, transaction_hash, source_type, tokens_sent[], tokens_received[]`.

### POST /api/v1/profiler/address/labels — Address Labels (⚠️ 100 credits; premium 500)
Entity + behavioural labels for an address. **Reconstruction: entity context / attribution.**
- Request*: `address`, `chain`.
- Row: `label, category?, kind[]`.
- ⚠️ **Most expensive foundational endpoint by far.** On the Free plan (100 trial credits) a single call exhausts the trial balance. Labels also arrive inline on most other endpoints (`*_address_label`, `counterparty_address_label`) at no extra cost — prefer those; call this endpoint only when a dedicated label lookup is essential.

### POST /api/v1/search/general — Search (0 credits)
Resolve a token name / symbol / contract / entity name. **Use as a zero-cost connectivity + auth smoke test.**
- Request*: `search_query`; optional `result_type` (`token|entity|any`).

## Backtesting (point-in-time) endpoints — relevant for historical reconstruction
`/api/v1/tgm/historical-*` and `/api/v1/tgm/historical-top-holders` (25 credits),
`smart-money/historical-token-balances` (25), `profiler/address/historical-transactions` (5).
These avoid look-ahead bias and are the right tool for reconstructing a *past*
incident's holder composition and flows at the moment it happened.
