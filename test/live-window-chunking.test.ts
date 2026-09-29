import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructFromAddress, type NansenLike } from '../src/investigations/live.ts';
import type { CallMeta } from '../src/nansen/types.ts';

/**
 * TRACE — item #2: resumable / chunked transaction windows.
 *
 * A wide or high-activity window may never reach is_last_page inside one paged
 * query within budget, so the run is honestly `incomplete`. Item #2 lets the
 * caller split the window into contiguous sub-windows (budget.chunkDays); each
 * paginates on its own, the window is covered only when EVERY sub-window reached
 * is_last_page, and a run that stops short reports the earliest date range still
 * needing capture (`resumeWindow`) so a follow-up run continues instead of
 * restarting. Every test injects a scripted client: no key, no network, no credits.
 *
 * CHUNK1  a window split into sub-windows, each fully paginated → covered/complete;
 *         sub-windows are contiguous, non-overlapping, and the last is clamped.
 * CHUNK2  a sub-window that can't finish within maxPages → incomplete; resumeWindow
 *         points at that sub-window's start through the window end.
 * CHUNK3  the shared credit budget stops the run between chunks → the un-attempted
 *         tail is the resume window and spend stays bounded.
 * CHUNK4  chunkDays: 0 (the default) keeps the single-window path intact: one chunk
 *         entry spanning the whole window, one whole-window query, no resume.
 * CHUNK5  an uneven split clamps the final sub-window to a single day.
 */

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const AT = '2026-09-23T00:00:00.000Z';
const HASH = (n: string) => '0x' + n.repeat(64).slice(0, 64);
const CP = '0x' + 'aa'.repeat(20);
const FUNDER = '0x' + 'bb'.repeat(20);
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

// A funding relation (→ fundingEvidence) and a counterparty aggregate (→
// counterpartyAggregates) so a fully-paginated window can reach `complete`.
const cpRow = (): Record<string, unknown> => ({
  counterparty_address: CP,
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
  block_timestamp: '2022-11-01T00:00:00',
  order: 1,
  chain: 'ethereum',
});
const tx = (hashChar: string, ts: string): Record<string, unknown> => ({
  chain: 'ethereum',
  method: 'received',
  source_type: 'transfer',
  volume_usd: 1_000,
  block_timestamp: ts,
  transaction_hash: HASH(hashChar),
  tokens_sent: [],
  tokens_received: [
    { token_symbol: 'USDC', token_amount: 1000, token_address: TOKEN, from_address: CP, to_address: ADDR },
  ],
});

interface Page {
  rows: unknown[];
  isLast: boolean;
}
interface ChunkScript {
  cpRows?: unknown[];
  relRows?: unknown[];
  /** Transaction pages keyed by the sub-window's `from` date; default = one empty last page. */
  txByFrom: Record<string, Page[]>;
  txCost?: string;
}
type TxCall = { from: string; to: string; page: number };

/**
 * A scripted client that answers the transaction endpoint by the `date` range in
 * the request body, so each sub-window gets its own scripted pages. Records the
 * (from, to, page) of every transaction call for boundary assertions.
 */
function chunkClient(cfg: ChunkScript): NansenLike & { txCalls: TxCall[] } {
  const txCalls: TxCall[] = [];
  const nextIdx: Record<string, number> = {};
  const paged = (rows: unknown[], isLast: boolean, page: number) => ({
    data: rows,
    pagination: { page, per_page: 100, is_last_page: isLast },
  });
  const client = {
    async post(path: string, body?: { date?: { from?: string; to?: string }; pagination?: { page?: number } }) {
      if (path.includes('counterparties')) {
        return { data: paged(cfg.cpRows ?? [], true, 1), meta: meta({ creditsCost: '5' }) };
      }
      if (path.includes('related-wallets')) {
        return { data: paged(cfg.relRows ?? [], true, 1), meta: meta({ creditsCost: '1' }) };
      }
      const from = body?.date?.from ?? '';
      const to = body?.date?.to ?? '';
      const page = body?.pagination?.page ?? 1;
      txCalls.push({ from, to, page });
      const pages = cfg.txByFrom[from] ?? [{ rows: [], isLast: true }];
      const i = nextIdx[from] ?? 0;
      nextIdx[from] = i + 1;
      const p = pages[i] ?? { rows: [], isLast: true };
      return { data: paged(p.rows, p.isLast, page), meta: meta({ creditsCost: cfg.txCost ?? '1' }) };
    },
    txCalls,
  };
  return client as unknown as NansenLike & { txCalls: TxCall[] };
}

/** Unique (from,to) sub-windows seen, preserving first-seen order. */
function subWindows(calls: TxCall[]): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const out: Array<{ from: string; to: string }> = [];
  for (const c of calls) {
    const k = `${c.from}..${c.to}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ from: c.from, to: c.to });
    }
  }
  return out;
}

test('CHUNK1: a chunked window fully paginated per sub-window reaches complete', async () => {
  const client = chunkClient({
    cpRows: [cpRow()],
    relRows: [relRow()],
    txByFrom: {
      '2022-11-01': [{ rows: [tx('1', '2022-11-02T00:00:00')], isLast: true }],
      '2022-11-06': [{ rows: [tx('2', '2022-11-07T00:00:00')], isLast: true }],
    },
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: { from: '2022-11-01', to: '2022-11-10' }, client, reconstructedAt: AT,
    budget: { chunkDays: 5, maxCredits: 100 },
  });

  // two contiguous, non-overlapping 5-day sub-windows spanning [01, 10].
  assert.deepEqual(subWindows(client.txCalls), [
    { from: '2022-11-01', to: '2022-11-05' },
    { from: '2022-11-06', to: '2022-11-10' },
  ]);
  assert.equal(run.transactionChunks.length, 2);
  assert.ok(run.transactionChunks.every((c) => c.reachedLastPage), 'every sub-window reached is_last_page');
  assert.equal(run.reachedLastPage, true);
  assert.equal(run.resumeWindow, null, 'a fully-covered window has nothing to resume');
  assert.equal(contract.completeness, 'complete');
  assert.equal(contract.coverage.flags.transactionWindowCovered, true);

  // both sub-windows' transactions reach the contract.
  const json = JSON.stringify(contract);
  assert.ok(json.includes(HASH('1')) && json.includes(HASH('2')));

  // deterministic given inputs + reconstructedAt.
  const again = await reconstructFromAddress({
    address: ADDR, window: { from: '2022-11-01', to: '2022-11-10' },
    client: chunkClient({
      cpRows: [cpRow()], relRows: [relRow()],
      txByFrom: {
        '2022-11-01': [{ rows: [tx('1', '2022-11-02T00:00:00')], isLast: true }],
        '2022-11-06': [{ rows: [tx('2', '2022-11-07T00:00:00')], isLast: true }],
      },
    }),
    reconstructedAt: AT, budget: { chunkDays: 5, maxCredits: 100 },
  });
  assert.equal(json, JSON.stringify(again.contract), 'deterministic given inputs + reconstructedAt');
});

test('CHUNK2: a sub-window that never finishes → incomplete, with a resume boundary', async () => {
  // The first sub-window returns non-empty, never-last pages → it hits the page cap;
  // the second finishes. The window is a partial sample and resumes from the gap.
  const client = chunkClient({
    cpRows: [cpRow()],
    relRows: [relRow()],
    txByFrom: {
      '2022-11-01': [
        { rows: [tx('1', '2022-11-02T00:00:00')], isLast: false },
        { rows: [tx('2', '2022-11-03T00:00:00')], isLast: false },
      ],
      '2022-11-06': [{ rows: [tx('3', '2022-11-07T00:00:00')], isLast: true }],
    },
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: { from: '2022-11-01', to: '2022-11-10' }, client, reconstructedAt: AT,
    budget: { chunkDays: 5, maxPages: 2, maxCredits: 100 },
  });

  assert.equal(run.transactionChunks.length, 2);
  assert.equal(run.transactionChunks[0].reachedLastPage, false, 'first sub-window hit its page cap');
  assert.equal(run.transactionChunks[1].reachedLastPage, true, 'later sub-window still attempted and finished');
  assert.equal(run.reachedLastPage, false);
  assert.deepEqual(run.resumeWindow, { from: '2022-11-01', to: '2022-11-10' }, 'resume from the earliest gap onward');
  assert.equal(contract.completeness, 'incomplete');
  assert.equal(contract.coverage.flags.transactionWindowCovered, false);
  assert.ok(
    contract.coverage.reasons.some((r) => r.includes('transactionWindowCovered') && r.includes('resume from 2022-11-01')),
    'the coverage reason names the resume boundary',
  );
  assert.match(run.stopReason, /transactions\[2022-11-01\.\.2022-11-05\] stopped: page cap \(2\)/);
});

test('CHUNK3: the shared credit budget stops between chunks; the tail is the resume window', async () => {
  // cp 5 + rel 1 = 6 spent; a budget of 7 pays exactly one chunk page, then stops
  // before the second of three sub-windows.
  const client = chunkClient({
    cpRows: [cpRow()],
    relRows: [relRow()],
    txByFrom: {
      '2022-11-01': [{ rows: [tx('1', '2022-11-01T00:00:00')], isLast: true }],
      '2022-11-03': [{ rows: [tx('2', '2022-11-03T00:00:00')], isLast: true }],
      '2022-11-05': [{ rows: [tx('3', '2022-11-05T00:00:00')], isLast: true }],
    },
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: { from: '2022-11-01', to: '2022-11-06' }, client, reconstructedAt: AT,
    budget: { chunkDays: 2, maxCredits: 7 },
  });

  assert.equal(run.creditsSpent, 7, 'cp 5 + rel 1 + one chunk page = 7 (hard stop)');
  assert.equal(run.transactionChunks.length, 1, 'only the first sub-window was attempted');
  assert.equal(run.transactionChunks[0].reachedLastPage, true);
  assert.equal(run.reachedLastPage, false, 'the window is not covered — chunks remain');
  assert.deepEqual(run.resumeWindow, { from: '2022-11-03', to: '2022-11-06' }, 'resume from the first un-attempted chunk');
  assert.match(run.stopReason, /transactions stopped before chunk 2022-11-03\.\.2022-11-04: credit budget reached/);
  assert.equal(contract.completeness, 'incomplete');
  assert.equal(contract.dataSource, 'live-nansen');
});

test('CHUNK4: chunkDays 0 (default) keeps the single whole-window path intact', async () => {
  const client = chunkClient({
    cpRows: [cpRow()],
    relRows: [relRow()],
    txByFrom: { '2022-11-01': [{ rows: [tx('1', '2022-11-02T00:00:00')], isLast: true }] },
  });
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: { from: '2022-11-01', to: '2022-11-10' }, client, reconstructedAt: AT,
  });

  // one query over the whole window; a single chunk entry mirrors it.
  assert.deepEqual(subWindows(client.txCalls), [{ from: '2022-11-01', to: '2022-11-10' }]);
  assert.equal(run.transactionChunks.length, 1);
  assert.deepEqual(
    { from: run.transactionChunks[0].from, to: run.transactionChunks[0].to },
    { from: '2022-11-01', to: '2022-11-10' },
  );
  assert.equal(run.transactionChunks[0].reachedLastPage, true);
  assert.equal(run.resumeWindow, null);
  assert.equal(contract.completeness, 'complete');
});

test('CHUNK5: an uneven split clamps the final sub-window to the window end', async () => {
  const client = chunkClient({
    cpRows: [cpRow()],
    relRows: [relRow()],
    txByFrom: {}, // every sub-window returns an empty last page → all covered
  });
  const { meta: run } = await reconstructFromAddress({
    address: ADDR, window: { from: '2022-11-01', to: '2022-11-07' }, client, reconstructedAt: AT,
    budget: { chunkDays: 3, maxCredits: 100 },
  });

  // 7 days / 3 → [01..03], [04..06], [07..07] (final clamped to a single day).
  assert.deepEqual(subWindows(client.txCalls), [
    { from: '2022-11-01', to: '2022-11-03' },
    { from: '2022-11-04', to: '2022-11-06' },
    { from: '2022-11-07', to: '2022-11-07' },
  ]);
  assert.equal(run.reachedLastPage, true, 'all empty sub-windows count as covered');
  assert.equal(run.resumeWindow, null);
});
