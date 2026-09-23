import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconstructFromAddress,
  type NansenLike,
} from '../src/investigations/live.ts';
import type { CallMeta } from '../src/nansen/types.ts';

/**
 * TRACE — live reconstruction orchestrator (Phase 3K).
 *
 * The orchestrator does network I/O, so every test injects a scripted client:
 * no Nansen key, no network, no credits. The scripted client returns canned
 * Nansen-shaped pages and records each call, letting us assert the full
 * fetch → sanitize → normalize → reconstruct → assemble pipeline deterministically.
 *
 * LIVE1  a fully-covered run reaches completeness:'complete' — the payoff a
 *        fixture-cache case can never reach — with dataSource/dataSources live.
 * LIVE2  a run that never hits is_last_page is honestly incomplete, and both
 *        coverage.reasons and completenessReasons name the false flag.
 * LIVE3  the credit budget is a hard stop: spend is bounded and surfaced.
 * LIVE4  metadata-injection defense holds on the live path (200 KB label → gone).
 * LIVE5  malformed rows are skipped (not fatal); bad params reject up front.
 * LIVE6  same inputs + fixed clock → byte-identical contract, and no HYPOTHESIS.
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

/** Longest string anywhere in a JSON-ish value (mirrors the FTX sanitization lock). */
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

const txSent = (): Record<string, unknown> => ({
  chain: 'ethereum',
  method: 'sent',
  source_type: 'transfer',
  volume_usd: 3_200_000,
  block_timestamp: '2022-11-12T09:00:00',
  transaction_hash: HASH('2'),
  tokens_sent: [
    { token_symbol: 'USDC', token_amount: 3_200_000, token_address: TOKEN, from_address: ADDR, to_address: DEST },
  ],
  tokens_received: [],
});

interface ScriptCfg {
  cpRows?: unknown[];
  relRows?: unknown[];
  txPages: Array<{ rows: unknown[]; isLast: boolean }>;
  cpCost?: string;
  relCost?: string;
  txCost?: string;
  creditsRemaining?: string;
}

/** A scripted Nansen client: canned pages by endpoint, records calls, no network. */
function scriptedClient(cfg: ScriptCfg): NansenLike & { calls: Array<{ path: string; page: number | null }> } {
  const calls: Array<{ path: string; page: number | null }> = [];
  let txIdx = 0;
  const paged = (rows: unknown[], isLast: boolean, page: number) => ({
    data: rows,
    pagination: { page, per_page: 100, is_last_page: isLast },
  });
  const client = {
    async post(path: string, body?: { pagination?: { page?: number } }) {
      const page = body?.pagination?.page ?? null;
      calls.push({ path, page });
      if (path.includes('counterparties')) {
        return { data: paged(cfg.cpRows ?? [], true, 1), meta: meta({ creditsCost: cfg.cpCost ?? '5', creditsRemaining: cfg.creditsRemaining ?? '100' }) };
      }
      if (path.includes('related-wallets')) {
        return { data: paged(cfg.relRows ?? [], true, 1), meta: meta({ creditsCost: cfg.relCost ?? '1', creditsRemaining: cfg.creditsRemaining ?? '100' }) };
      }
      const p = cfg.txPages[txIdx] ?? { rows: [], isLast: true };
      txIdx += 1;
      return { data: paged(p.rows, p.isLast, page ?? txIdx), meta: meta({ creditsCost: cfg.txCost ?? '1', creditsRemaining: cfg.creditsRemaining ?? '100' }) };
    },
    calls,
  };
  return client as unknown as NansenLike & { calls: Array<{ path: string; page: number | null }> };
}

const fullRunCfg = (): ScriptCfg => ({
  cpRows: [cpRow()],
  relRows: [relRow()],
  txPages: [{ rows: [txReceived(), txSent()], isLast: true }],
});

test('LIVE1: a fully-covered live run reaches completeness:complete', async () => {
  const client = scriptedClient(fullRunCfg());
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
  });

  assert.equal(contract.dataSource, 'live-nansen');
  assert.ok((contract.dataSources ?? []).includes('live-nansen'), 'dataSources enumerates the live pool');
  assert.equal(contract.investigation.status, 'reconstructed');
  assert.equal(contract.completeness, 'complete');
  assert.deepEqual(contract.completenessReasons, [], 'a complete contract carries no unmet-reason');
  assert.deepEqual(contract.coverage.flags, {
    fundingEvidence: true, counterpartyAggregates: true, transactionWindowCovered: true,
  });

  // three endpoints hit once each; credits summed from the (5,1,1) cost headers.
  assert.equal(run.calls.length, 3);
  assert.equal(run.creditsSpent, 7);
  assert.equal(run.transactionPagesFetched, 1);
  assert.equal(run.reachedLastPage, true);
  assert.equal(run.creditsRemaining, '100');
});

test('LIVE2: a run that never hits is_last_page is honestly incomplete', async () => {
  // Every page reports is_last_page:false and is non-empty → the loop is capped.
  const client = scriptedClient({
    cpRows: [cpRow()],
    relRows: [relRow()],
    txPages: Array.from({ length: 10 }, () => ({ rows: [txReceived()], isLast: false })),
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
    budget: { maxPages: 3, maxCredits: 100 },
  });

  assert.equal(run.reachedLastPage, false);
  assert.equal(run.transactionPagesFetched, 3, 'stopped at the page cap');
  assert.equal(contract.coverage.flags.transactionWindowCovered, false);
  assert.equal(contract.completeness, 'incomplete');
  // The false flag must be explained in BOTH places, keyed by the flag name.
  assert.ok(contract.coverage.reasons.some((r) => r.includes('transactionWindowCovered')));
  assert.ok(contract.completenessReasons.some((r) => r.includes('transactionWindowCovered')));
});

test('LIVE3: the credit budget is a hard stop that is surfaced in meta', async () => {
  const client = scriptedClient(fullRunCfg()); // cp=5, rel=1 → 6 spent before tx
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
    budget: { maxCredits: 6 },
  });

  assert.equal(run.creditsSpent, 6);
  assert.equal(run.calls.length, 2, 'transactions never fetched once the budget is reached');
  assert.equal(run.transactionPagesFetched, 0);
  assert.match(run.stopReason, /credit budget reached/);
  assert.equal(contract.coverage.flags.transactionWindowCovered, false);
  assert.equal(contract.completeness, 'incomplete');
});

test('LIVE4: metadata-injection defense holds on the live path', async () => {
  const poisoned = txReceived();
  (poisoned.tokens_received as Array<Record<string, unknown>>)[0].to_address_label = 'X'.repeat(200_030);
  const client = scriptedClient({
    cpRows: [cpRow()], relRows: [relRow()],
    txPages: [{ rows: [poisoned, txSent()], isLast: true }],
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
  });

  assert.ok(run.sanitization.labelsCleared >= 1, 'the oversized label was cleared at capture time');
  assert.ok(longestString(contract) < 8192, 'no injected megabyte string reaches the served contract');
});

test('LIVE5: malformed rows are skipped, and bad params reject up front', async () => {
  const badTx = txReceived();
  delete badTx.transaction_hash; // required by normalizeTransaction → row skipped
  const client = scriptedClient({
    cpRows: [cpRow()], relRows: [relRow()],
    txPages: [{ rows: [badTx, txSent()], isLast: true }],
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client, reconstructedAt: AT,
  });
  assert.equal(run.rowsSkipped, 1, 'the malformed row is dropped, not fatal');
  assert.equal(contract.investigation.status, 'reconstructed', 'the good row still reconstructs');

  await assert.rejects(
    () => reconstructFromAddress({ address: 'not-an-address', window: WINDOW, client }),
    /invalid address/,
  );
  await assert.rejects(
    () => reconstructFromAddress({ address: ADDR, window: { from: '2022-12-01', to: '2022-11-01' }, client }),
    /after window\.to/,
  );
});

test('LIVE6: same inputs + fixed clock → byte-identical contract, no HYPOTHESIS', async () => {
  const a = await reconstructFromAddress({ address: ADDR, window: WINDOW, client: scriptedClient(fullRunCfg()), reconstructedAt: AT });
  const b = await reconstructFromAddress({ address: ADDR, window: WINDOW, client: scriptedClient(fullRunCfg()), reconstructedAt: AT });
  const ja = JSON.stringify(a.contract);
  assert.equal(ja, JSON.stringify(b.contract), 'deterministic given inputs + reconstructedAt');
  assert.ok(!ja.includes('"HYPOTHESIS"'), 'the live contract produces no HYPOTHESIS records');
});
