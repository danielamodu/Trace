import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructFromAddress, type NansenLike } from '../src/investigations/live.ts';
import type { CallMeta } from '../src/nansen/types.ts';

/**
 * TRACE — item #1: token-level enrichment on the live path.
 *
 * After the subject's counterparties + transactions are fetched, the orchestrator
 * discovers the token addresses the subject actually touched (from data ALREADY
 * paid for — zero extra spend) and pulls token-scoped tgm/transfers (both
 * directions) + tgm/dex-trades for the top ones, folding only subject-relevant
 * rows into the SAME engine as transfers / swaps. Every test injects a scripted
 * client: no key, no network, no credits.
 *
 * TOK1  discovery + both-direction transfers + subject post-filter → real events.
 * TOK2  the credit budget bounds token activity as a hard stop.
 * TOK3  the injected-metadata defense reaches tgm rows too.
 * TOK4  off by default: no tgm call is ever made unless opted in.
 */

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const WINDOW = { from: '2022-11-11', to: '2022-11-30' };
const AT = '2026-09-23T00:00:00.000Z';
const HASH = (n: string) => '0x' + n.repeat(64).slice(0, 64);
const CP_ADDR = '0x' + 'aa'.repeat(20);
const FUNDER = '0x' + 'bb'.repeat(20);
const DEST = '0x' + 'cc'.repeat(20);
const TOKEN = '0x' + 'dd'.repeat(20);

function meta(over: Partial<CallMeta> = {}): CallMeta {
  return {
    status: 200,
    requestId: 'req_test',
    creditsCost: '1',
    creditsUsed: null,
    creditsRemaining: '100',
    rateLimitRemaining: null,
    retryAfter: null,
    ...over,
  };
}

/** Longest string anywhere in a JSON-ish value (mirrors the sanitization lock). */
function longestString(v: unknown): number {
  if (typeof v === 'string') return v.length;
  if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, longestString(x)), 0);
  if (v && typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).reduce<number>(
      (m, x) => Math.max(m, longestString(x)),
      0,
    );
  }
  return 0;
}

// Subject touches TOKEN in its counterparty aggregate and its one transaction,
// so token discovery ranks it first from data already paid for.
const cpRow = (): Record<string, unknown> => ({
  counterparty_address: CP_ADDR,
  counterparty_address_label: ['1inch: Router'],
  interaction_count: 42,
  total_volume_usd: 12_000_000,
  volume_in_usd: 12_000_000,
  volume_out_usd: 0,
  tokens_info: [
    { token_address: TOKEN, token_symbol: 'USDC', token_name: 'USD Coin', num_transfer: 5, total_token_amount: 12_000_000 },
  ],
});
const relRow = (): Record<string, unknown> => ({
  address: FUNDER,
  address_label: 'Token Millionaire',
  relation: 'First Funder',
  transaction_hash: HASH('a'),
  block_timestamp: '2022-11-10T00:00:00',
  order: 1,
  chain: 'ethereum',
});
const txReceived = (): Record<string, unknown> => ({
  chain: 'ethereum',
  method: 'received',
  source_type: 'transfer',
  volume_usd: 5_000_000,
  block_timestamp: '2022-11-12T08:13:47',
  transaction_hash: HASH('1'),
  tokens_sent: [],
  tokens_received: [
    { token_symbol: 'USDC', token_amount: 5_000_000, token_address: TOKEN, from_address: CP_ADDR, to_address: ADDR },
  ],
});

// tgm/transfers rows. The from_address-filtered call returns a subject-as-sender
// row (kept) plus an off-subject row (must be dropped by the defensive filter);
// the to_address-filtered call returns a subject-as-receiver row (kept).
const transferFrom = (): Record<string, unknown> => ({
  block_timestamp: '2022-11-13T00:00:00', transaction_hash: HASH('3'),
  from_address: ADDR, to_address: DEST, transfer_value_usd: 1_000_000,
});
const transferTo = (): Record<string, unknown> => ({
  block_timestamp: '2022-11-14T00:00:00', transaction_hash: HASH('4'),
  from_address: FUNDER, to_address: ADDR, transfer_value_usd: 2_000_000,
});
const transferOther = (): Record<string, unknown> => ({
  block_timestamp: '2022-11-15T00:00:00', transaction_hash: HASH('5'),
  from_address: DEST, to_address: FUNDER, transfer_value_usd: 500_000,
});

// tgm/dex-trades has no address filter, so the market-wide page mixes a subject
// trade (kept) with another trader's (dropped by the traderAddress post-filter).
const tradeBySubject = (): Record<string, unknown> => ({
  block_timestamp: '2022-11-16T00:00:00', transaction_hash: HASH('6'),
  trader_address: ADDR, action: 'BUY', token_address: TOKEN, token_name: 'USD Coin',
  token_amount: 3_000_000, traded_token_amount: 3_000_000, estimated_swap_price_usd: 1, estimated_value_usd: 3_000_000,
});
const tradeByOther = (): Record<string, unknown> => ({
  block_timestamp: '2022-11-17T00:00:00', transaction_hash: HASH('7'),
  trader_address: DEST, action: 'SELL', token_address: TOKEN, token_name: 'USD Coin',
  token_amount: 50, traded_token_amount: 50, estimated_swap_price_usd: 1, estimated_value_usd: 50,
});

interface TokCfg {
  fromRows?: unknown[];
  toRows?: unknown[];
  dexRows?: unknown[];
}

type Recorded = { path: string; tokenAddress: string | null; filterDir: string | null };

/** A scripted Nansen client: canned pages by endpoint + filter, records calls. */
function scriptedClient(cfg: TokCfg): NansenLike & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const paged = (rows: unknown[]) => ({ data: rows, pagination: { page: 1, per_page: 100, is_last_page: true } });
  const client = {
    async post(path: string, body?: {
      token_address?: string;
      filters?: { from_address?: unknown; to_address?: unknown };
    }) {
      const tokenAddress = body?.token_address ?? null;
      const filterDir = body?.filters?.from_address
        ? 'from_address'
        : body?.filters?.to_address
          ? 'to_address'
          : null;
      calls.push({ path, tokenAddress, filterDir });
      if (path.includes('counterparties')) return { data: paged([cpRow()]), meta: meta({ creditsCost: '5' }) };
      if (path.includes('related-wallets')) return { data: paged([relRow()]), meta: meta({ creditsCost: '1' }) };
      if (path.includes('tgm/transfers')) {
        return { data: paged(filterDir === 'from_address' ? (cfg.fromRows ?? []) : (cfg.toRows ?? [])), meta: meta({ creditsCost: '1' }) };
      }
      if (path.includes('tgm/dex-trades')) return { data: paged(cfg.dexRows ?? []), meta: meta({ creditsCost: '1' }) };
      return { data: paged([txReceived()]), meta: meta({ creditsCost: '1' }) }; // transactions
    },
    calls,
  };
  return client as unknown as NansenLike & { calls: Recorded[] };
}

const fullTokenCfg = (): TokCfg => ({
  fromRows: [transferFrom(), transferOther()],
  toRows: [transferTo()],
  dexRows: [tradeBySubject(), tradeByOther()],
});

test('TOK1: discovery + both-direction transfers + subject post-filter → real events', async () => {
  const client = scriptedClient(fullTokenCfg());
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
    budget: { fetchTokenActivity: true, maxTokens: 3, maxCredits: 100 },
  });

  // token discovered from already-paid-for data (no discovery call was made).
  assert.deepEqual(run.tokensDiscovered, [TOKEN]);

  // transfers are fetched in BOTH directions for the discovered token.
  const transferCalls = client.calls.filter((c) => c.path.includes('tgm/transfers'));
  assert.equal(transferCalls.length, 2);
  assert.deepEqual(transferCalls.map((c) => c.filterDir).sort(), ['from_address', 'to_address']);
  assert.ok(transferCalls.every((c) => c.tokenAddress === TOKEN));

  // dex-trades is one market-wide call (no address filter is supported).
  const dexCalls = client.calls.filter((c) => c.path.includes('tgm/dex-trades'));
  assert.equal(dexCalls.length, 1);
  assert.equal(dexCalls[0].filterDir, null);

  // subject post-filter keeps 2 transfers (from + to) and 1 swap; the off-subject
  // transfer and the other trader's swap are dropped (counted as skipped rows).
  assert.deepEqual(run.tokenActivity, { transfers: 2, swaps: 1 });
  assert.equal(run.rowsSkipped, 2);

  // credits: cp 5 + rel 1 + tx 1 + (2 transfers + 1 dex-trades) = 10.
  assert.equal(run.creditsSpent, 10);

  // the kept rows become real events; the dropped rows never reach the contract.
  const json = JSON.stringify(contract);
  assert.ok(json.includes(HASH('3')), 'subject-as-sender transfer is an event');
  assert.ok(json.includes(HASH('4')), 'subject-as-receiver transfer is an event');
  assert.ok(json.includes(HASH('6')), 'subject swap is an event');
  assert.ok(!json.includes(HASH('5')), 'off-subject transfer never reaches the contract');
  assert.ok(!json.includes(HASH('7')), "another trader's swap never reaches the contract");
  assert.ok(json.includes('tgm/transfers') && json.includes('tgm/dex-trades'), 'token events cite their tgm source');

  // token enrichment does not weaken the honesty guarantees.
  assert.ok(!json.includes('"HYPOTHESIS"'), 'no HYPOTHESIS is produced');
  const again = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client: scriptedClient(fullTokenCfg()), reconstructedAt: AT,
    budget: { fetchTokenActivity: true, maxTokens: 3, maxCredits: 100 },
  });
  assert.equal(json, JSON.stringify(again.contract), 'deterministic given inputs + reconstructedAt');
});

test('TOK2: the credit budget bounds token activity as a hard stop', async () => {
  // cp 5 + rel 1 + tx 1 = 7 spent before enrichment; a budget of 7 leaves nothing.
  const client = scriptedClient(fullTokenCfg());
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
    budget: { fetchTokenActivity: true, maxTokens: 3, maxCredits: 7 },
  });

  assert.equal(run.creditsSpent, 7);
  assert.equal(client.calls.filter((c) => c.path.includes('tgm/')).length, 0, 'no token call once the budget is reached');
  assert.deepEqual(run.tokenActivity, { transfers: 0, swaps: 0 });
  assert.match(run.stopReason, /token activity stopped before .*: credit budget reached/);
  // a budget of 9 pays both transfer directions but stops before dex-trades.
  const c2 = scriptedClient(fullTokenCfg());
  const { meta: run2 } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client: c2, reconstructedAt: AT,
    budget: { fetchTokenActivity: true, maxTokens: 3, maxCredits: 9 },
  });
  assert.equal(run2.creditsSpent, 9);
  assert.equal(c2.calls.filter((c) => c.path.includes('tgm/transfers')).length, 2);
  assert.equal(c2.calls.filter((c) => c.path.includes('tgm/dex-trades')).length, 0);
  assert.match(run2.stopReason, /dex-trades skipped .*: credit budget reached/);
  assert.equal(run2.tokenActivity.swaps, 0);
  assert.equal(contract.dataSource, 'live-nansen');
});

test('TOK3: the injected-metadata defense reaches tgm rows too', async () => {
  const poisoned = transferTo();
  poisoned.to_address_label = 'X'.repeat(200_030); // megabyte-scale injected label
  const client = scriptedClient({
    fromRows: [transferFrom()],
    toRows: [poisoned],
    dexRows: [tradeBySubject()],
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
    budget: { fetchTokenActivity: true, maxTokens: 3, maxCredits: 100 },
  });
  assert.ok(run.sanitization.labelsCleared >= 1, 'the oversized tgm label was cleared at capture time');
  assert.ok(longestString(contract) < 8192, 'no injected megabyte string reaches the served contract');
});

test('TOK4: off by default — no tgm call is ever made unless opted in', async () => {
  const client = scriptedClient(fullTokenCfg());
  const { meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
  });
  assert.equal(client.calls.filter((c) => c.path.includes('tgm/')).length, 0);
  assert.deepEqual(run.tokensDiscovered, []);
  assert.deepEqual(run.tokenActivity, { transfers: 0, swaps: 0 });
  assert.equal(run.creditsSpent, 7); // only cp + rel + tx
});

