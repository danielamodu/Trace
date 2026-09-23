/**
 * TRACE — Phase 3G live-capture tests.
 *
 * node:test + node:assert, zero new dependencies. Covers the genuinely new
 * surface exposed by the live exploit-day capture (fixtures/live/euler/):
 * real incident-day rows through the unchanged normalization path, plus the
 * cross-kind same-transaction case (the funding tx is both a RELATION evidence
 * tx and a FACT transfer row — dedupe must not collapse across kinds).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeRelationship,
  sourceMeta,
} from '../src/reconstruction/normalize.ts';
import { normalizeTransaction } from '../src/reconstruction/transaction.ts';
import { reconstruct } from '../src/reconstruction/engine.ts';
import type { CaseDescriptor, ReconstructionSubject } from '../src/reconstruction/engine.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE = join(HERE, '..', 'fixtures', 'live', 'euler', 'profiler-transactions-2023-03-13-p1.json');
const ATTACKER = '0xb66cd966670d962c227b3eaba30a872dbfb995db';
const FUNDING_TX = '0x298bde3f9e53f7a5d870f7f5d56ee2f5e41fa25e6eb5e74611ac97025405db55';

const liveFixture = (): any => JSON.parse(readFileSync(LIVE, 'utf8'));
const liveSource = (fx: any) =>
  sourceMeta(
    'profiler/address/transactions',
    { requestId: fx.response_meta.requestId, creditsCost: fx.response_meta.creditsCost },
    fx.captured_at,
    'fixtures/live/euler/profiler-transactions-2023-03-13-p1.json',
  );

test('LIVE-1: live exploit-day rows normalize deterministically as FACT', () => {
  const fx = liveFixture();
  const rows = fx.response_body.data;
  assert.equal(rows.length, 17);
  const a = rows.map((r: unknown) => normalizeTransaction(r, liveSource(fx)));
  const b = rows.map((r: unknown) => normalizeTransaction(r, liveSource(fx)));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  for (const rec of a) assert.equal(rec.provenanceKind, 'FACT');
  assert.equal(a[0].source.source, 'profiler/address/transactions');
  assert.equal(a[0].source.fixtureFile, 'fixtures/live/euler/profiler-transactions-2023-03-13-p1.json');
});

test('LIVE-2: live window covers 2023-03-13 including the funding transaction', () => {
  const fx = liveFixture();
  const rows = fx.response_body.data;
  const ts = rows.map((r: any) => r.block_timestamp as string).sort();
  assert.ok(ts[0].startsWith('2023-03-13'), `earliest ${ts[0]} on incident day`);
  assert.ok(ts[ts.length - 1] >= '2023-03-13', 'coverage reaches the incident day');
  const funding = rows.find((r: any) => r.transaction_hash === FUNDING_TX);
  assert.ok(funding, 'funding evidence tx present in live rows');
  assert.equal(funding.volume_usd, 177093899.14027768);
  // Real incident-day methods flow through the unchanged normalizer.
  const methods = new Set(rows.map((r: any) => r.method));
  assert.ok(methods.has('swapExactETHForTokens(uint256,address[],address,uint256)'));
  assert.ok(methods.has('withdraw()'));
});

test('LIVE-3: same tx as RELATION evidence and FACT row yields two events, not one', () => {
  const fx = liveFixture();
  const fundingRow = fx.response_body.data.find((r: any) => r.transaction_hash === FUNDING_TX);
  const rel = normalizeRelationship(
    {
      address: '0x036cec1a199234fc02f72d29e596a09440825f1c',
      address_label: '',
      relation: 'First Funder',
      transaction_hash: FUNDING_TX,
      block_timestamp: '2023-03-13T09:12:23Z',
      order: 1,
      chain: 'ethereum',
    },
    sourceMeta('profiler/address/related-wallets', { requestId: 'req_test', creditsCost: '1' }, '2026-09-21T20:01:55.676Z', 'discovery/0xb66cd966.json'),
  );
  const tx = normalizeTransaction(fundingRow, liveSource(fx));
  const subject: ReconstructionSubject = { address: ATTACKER, chain: 'ethereum' };
  const desc: CaseDescriptor = {
    id: 'case_test', name: 'Test', headline: 'Test.',
    window: { from: '2023-03-13', to: '2023-03-31' },
  };
  const { investigation, stats } = reconstruct(
    { relationships: [rel], transactions: [tx] },
    subject, desc, { reconstructedAt: '2026-09-21T00:00:00.000Z' },
  );
  assert.equal(stats.duplicatesSkipped, 0, 'cross-kind records never dedupe');
  assert.equal(stats.memberEvents, 2);
  const kinds = investigation.events.map((e) => e.type).sort();
  assert.deepEqual(kinds, ['funding', 'transfer']);
});

test('LIVE-4: expanded transaction set reconstructs deterministically with no hypotheses', () => {
  const fx = liveFixture();
  const txs = fx.response_body.data.map((r: unknown) => normalizeTransaction(r, liveSource(fx)));
  const subject: ReconstructionSubject = { address: ATTACKER, chain: 'ethereum' };
  const desc: CaseDescriptor = {
    id: 'case_test', name: 'Test', headline: 'Test.',
    window: { from: '2023-03-13', to: '2023-03-31' },
  };
  const opts = { reconstructedAt: '2026-09-21T00:00:00.000Z' };
  const a = reconstruct({ transactions: txs }, subject, desc, opts);
  const b = reconstruct({ transactions: txs }, subject, desc, opts);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.stats.memberEvents, 17);
  assert.ok(!JSON.stringify(a).includes('"HYPOTHESIS"'));
});
