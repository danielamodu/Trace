import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runReconstruct,
  parseReconstructRequest,
  SERVER_MAX_CREDITS,
  SERVER_MAX_PAGES,
  SERVER_MAX_TOKENS,
  SERVER_MAX_CHUNK_DAYS,
} from '../src/investigations/live-route.ts';
import type { NansenLike } from '../src/investigations/live.ts';
import { NansenApiError } from '../src/nansen/client.ts';
import type { CallMeta } from '../src/nansen/types.ts';

/**
 * TRACE — /api/reconstruct route logic (Phase 3K, step 2).
 *
 * Exercises runReconstruct with an injected client (no next/*, no network, no
 * key, no credits): key authorization, param + budget validation, error→status
 * mapping, and the invariant that a caller-supplied key never appears anywhere
 * in the response payload.
 */

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const WINDOW = { from: '2022-11-11', to: '2022-11-30' };
const AT = '2026-09-23T00:00:00.000Z';
const HASH = (n: string) => '0x' + n.repeat(64).slice(0, 64);
const CP = '0x' + 'aa'.repeat(20);
const FUNDER = '0x' + 'bb'.repeat(20);
const TOKEN = '0x' + 'dd'.repeat(20);

function meta(over: Partial<CallMeta> = {}): CallMeta {
  return { status: 200, requestId: 'req', creditsCost: '1', creditsUsed: null, creditsRemaining: '100', rateLimitRemaining: null, retryAfter: null, ...over };
}
const cpRow = () => ({ counterparty_address: CP, counterparty_address_label: ['1inch: Router'], interaction_count: 42, total_volume_usd: 12_000_000, volume_in_usd: 12_000_000, volume_out_usd: 0, tokens_info: [{ token_address: TOKEN, token_symbol: 'USDC', token_name: 'USD Coin', num_transfer: 5, total_token_amount: 12_000_000 }] });
const relRow = () => ({ address: FUNDER, address_label: 'Token Millionaire', relation: 'First Funder', transaction_hash: HASH('a'), block_timestamp: '2022-11-10T00:00:00', order: 1, chain: 'ethereum' });
const txRow = () => ({ chain: 'ethereum', method: 'received', source_type: 'transfer', volume_usd: 5_000_000, block_timestamp: '2022-11-12T08:13:47', transaction_hash: HASH('1'), tokens_sent: [], tokens_received: [{ token_symbol: 'USDC', token_amount: 5_000_000, token_address: TOKEN, from_address: CP, to_address: ADDR }] });

const paged = (rows: unknown[], isLast: boolean, page: number) => ({ data: rows, pagination: { page, per_page: 100, is_last_page: isLast } });
function scriptedClient(): NansenLike {
  return {
    async post(path: string) {
      if (path.includes('counterparties')) return { data: paged([cpRow()], true, 1), meta: meta({ creditsCost: '5' }) };
      if (path.includes('related-wallets')) return { data: paged([relRow()], true, 1), meta: meta({ creditsCost: '1' }) };
      return { data: paged([txRow()], true, 1), meta: meta({ creditsCost: '1' }) };
    },
  } as unknown as NansenLike;
}
function throwingClient(status: number): NansenLike {
  return { async post() { throw new NansenApiError(`${status} upstream`, status, null, meta({ status })); } } as unknown as NansenLike;
}

test('ROUTE1: a valid request with an injected client returns 200 + the live contract', async () => {
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW, chain: 'ethereum' },
    { allowServerKey: false, hasServerKey: false, client: scriptedClient(), reconstructedAt: AT },
  );
  assert.equal(status, 200);
  const b = body as { contract: { dataSource: string; completeness: string }; meta: { creditsSpent: number } };
  assert.equal(b.contract.dataSource, 'live-nansen');
  assert.equal(b.contract.completeness, 'complete');
  assert.equal(b.meta.creditsSpent, 7);
});

test('ROUTE2: no key anywhere → 400 with a BYO-key prompt', async () => {
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW },
    { allowServerKey: false, hasServerKey: false },
  );
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /no Nansen API key/i);
  assert.match((body as { detail: string }).detail, /Provide your own/i);
});

test('ROUTE2b: server key present but disabled → 400 naming the enable flag', async () => {
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW },
    { allowServerKey: false, hasServerKey: true },
  );
  assert.equal(status, 400);
  assert.match((body as { detail: string }).detail, /TRACE_ALLOW_SERVER_KEY/);
});

test('ROUTE3: an invalid address reaches the orchestrator and maps to 400', async () => {
  const { status, body } = await runReconstruct(
    { address: 'not-an-address', window: WINDOW },
    { allowServerKey: false, hasServerKey: false, client: scriptedClient() },
  );
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /invalid address/i);
});

test('ROUTE4: from > to maps to 400 with the window reason', async () => {
  const { status, body } = await runReconstruct(
    { address: ADDR, window: { from: '2022-12-01', to: '2022-11-01' } },
    { allowServerKey: false, hasServerKey: false, client: scriptedClient() },
  );
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /after window\.to/);
});

test('ROUTE5: budget is clamped to server maxima', () => {
  const parsed = parseReconstructRequest({
    address: ADDR, window: WINDOW, budget: { maxCredits: 9999, maxPages: 9999 },
  });
  assert.equal(parsed.budget.maxCredits, SERVER_MAX_CREDITS);
  assert.equal(parsed.budget.maxPages, SERVER_MAX_PAGES);
});

test('ROUTE6: upstream Nansen errors map by status (429 verbatim, 5xx → 502)', async () => {
  const rate = await runReconstruct(
    { address: ADDR, window: WINDOW },
    { allowServerKey: false, hasServerKey: false, client: throwingClient(429) },
  );
  assert.equal(rate.status, 429);
  assert.equal((rate.body as { nansenStatus: number }).nansenStatus, 429);

  const server = await runReconstruct(
    { address: ADDR, window: WINDOW },
    { allowServerKey: false, hasServerKey: false, client: throwingClient(500) },
  );
  assert.equal(server.status, 502);
  assert.equal((server.body as { nansenStatus: number }).nansenStatus, 500);
});

test('ROUTE7: a non-object body → 400 without throwing', async () => {
  const { status, body } = await runReconstruct('nope', { allowServerKey: false, hasServerKey: false });
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /must be a JSON object/);

  const noWindow = await runReconstruct({ address: ADDR }, { allowServerKey: false, hasServerKey: false });
  assert.equal(noWindow.status, 400);
  assert.match((noWindow.body as { error: string }).error, /"window"/);
});

test('ROUTE8: a caller-supplied key never appears in the response payload', async () => {
  const SECRET = 'nansen_live_SECRET_0123456789';
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW, apiKey: SECRET },
    { allowServerKey: false, hasServerKey: false, client: scriptedClient(), reconstructedAt: AT },
  );
  assert.equal(status, 200);
  assert.ok(!JSON.stringify(body).includes(SECRET), 'the BYO key must not be echoed anywhere in the response');
});

test('ROUTE9: a dry-run returns a cost estimate with no key, no client, no spend', async () => {
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW, dryRun: true, budget: { maxPages: 5 } },
    { allowServerKey: false, hasServerKey: false }, // no key, no injected client
  );
  assert.equal(status, 200);
  const b = body as { dryRun: boolean; estimate: { worstCaseCredits: number } };
  assert.equal(b.dryRun, true);
  assert.equal(b.estimate.worstCaseCredits, 11); // 5 + 1 + 5
});

test('ROUTE10: guardSpend can short-circuit a run before any spend', async () => {
  let ran = false;
  const refusal = { status: 429, body: { error: 'deploy credit budget exhausted' } };
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW },
    {
      allowServerKey: false,
      hasServerKey: false,
      client: { async post() { ran = true; throw new Error('should not be called'); } } as unknown as NansenLike,
      guardSpend: () => refusal,
    },
  );
  assert.equal(status, 429);
  assert.equal((body as { error: string }).error, 'deploy credit budget exhausted');
  assert.equal(ran, false, 'the orchestrator must not be called once guardSpend refuses');
});

test('ROUTE11: token activity is opt-in, maxTokens is clamped, and the dry-run prices it', () => {
  // fetchTokenActivity passes through as a boolean; maxTokens is clamped to the ceiling.
  const parsed = parseReconstructRequest({
    address: ADDR, window: WINDOW, budget: { fetchTokenActivity: true, maxTokens: 9999 },
  });
  assert.equal(parsed.budget.fetchTokenActivity, true);
  assert.equal(parsed.budget.maxTokens, SERVER_MAX_TOKENS);

  // a bad maxTokens is a 400, not a silent default.
  assert.throws(
    () => parseReconstructRequest({ address: ADDR, window: WINDOW, budget: { maxTokens: -1 } }),
    /maxTokens/,
  );
});

test('ROUTE12: a dry-run reflects opt-in token activity without spending', async () => {
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW, dryRun: true, budget: { fetchTokenActivity: true, maxTokens: 3, maxPages: 5 } },
    { allowServerKey: false, hasServerKey: false }, // no key, no injected client
  );
  assert.equal(status, 200);
  const b = body as { dryRun: boolean; estimate: { worstCaseCredits: number; breakdown: { tokenActivity: number } } };
  assert.equal(b.dryRun, true);
  assert.equal(b.estimate.breakdown.tokenActivity, 9); // 3 tokens × (2 transfers + 1 dex)
  // 5 + 1 + 5 + 9 = 20, clamped to the default maxCredits (12) since none was given.
  assert.equal(b.estimate.worstCaseCredits, 12);
});

test('ROUTE13: window chunking is clamped to the server ceiling and priced by the dry-run', async () => {
  const parsed = parseReconstructRequest({
    address: ADDR, window: WINDOW, budget: { chunkDays: 99999 },
  });
  assert.equal(parsed.budget.chunkDays, SERVER_MAX_CHUNK_DAYS);

  // a negative chunkDays is a 400, not a silent default.
  assert.throws(
    () => parseReconstructRequest({ address: ADDR, window: WINDOW, budget: { chunkDays: -1 } }),
    /chunkDays/,
  );

  // the dry-run reflects the chunked worst case (tx phase can use the whole ceiling).
  const { status, body } = await runReconstruct(
    { address: ADDR, window: WINDOW, dryRun: true, budget: { chunkDays: 5, maxPages: 2, maxCredits: 20 } },
    { allowServerKey: false, hasServerKey: false }, // no key, no injected client
  );
  assert.equal(status, 200);
  const b = body as { estimate: { worstCaseCredits: number; breakdown: { transactionPages: number } } };
  assert.equal(b.estimate.breakdown.transactionPages, 14); // 20 − (cp 5 + rel 1)
  assert.equal(b.estimate.worstCaseCredits, 20);
});
