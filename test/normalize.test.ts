/**
 * TRACE — Phase 3A normalization tests.
 *
 * Uses Node's built-in test runner (node:test) + node:assert — zero dependencies.
 * Run with: npm test   (node --test test/)
 *
 * Tests exercise the real captured fixtures where possible (address/timestamp/
 * provenance preservation on the hero Euler data) plus targeted synthetic rows for
 * the edge cases (missing optional fields, null flows, malformed records).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalizeTransfer,
  normalizeSwap,
  normalizeCounterparty,
  normalizeRelationship,
  normalizeFlowBucket,
  normalizeTimestamp,
  sourceMeta,
  NormalizationError,
  type FixtureMeta,
} from '../src/reconstruction/normalize.ts';
import type { SourceMeta } from '../src/reconstruction/normalized-types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'fixtures');
const readFixture = (rel: string): any => JSON.parse(readFileSync(join(FIX, rel), 'utf8'));

// Canonical hero addresses (Option A — fixture-validated, locked Phase 3A).
const ATTACKER = '0xb66cd966670d962c227b3eaba30a872dbfb995db';
const FIRST_FUNDER = '0x036cec1a199234fc02f72d29e596a09440825f1c';
const BALANCER_VAULT = '0xba12222222228d8ba445958a75a0704d566bf2c8';

const src = (source: Parameters<typeof sourceMeta>[0], meta?: FixtureMeta, file = 'test'): SourceMeta =>
  sourceMeta(source, meta ?? { requestId: 'req_test', creditsCost: '1' }, '2026-09-21T00:00:00Z', file);

// ---------------------------------------------------------------------------
// 1. Valid response normalization (real fixtures)
// ---------------------------------------------------------------------------

test('valid transfer row normalizes from the real tgm-transfers fixture', () => {
  const fx = readFixture('tgm-transfers.json');
  const row = fx.response_sample.data[0];
  const out = normalizeTransfer(row, src('tgm/transfers', fx.response_meta, 'tgm-transfers.json'));
  assert.equal(out.provenanceKind, 'FACT');
  assert.equal(out.value.fromAddress, row.from_address);
  assert.equal(out.value.toAddress, row.to_address);
  assert.equal(out.value.txHash, row.transaction_hash);
  assert.equal(out.value.valueUsd, 722146184.4998494);
  assert.equal(out.value.transactionType, 'transfer');
  assert.deepEqual(out.unavailableFields, []); // all optional fields present
});

test('valid swap row normalizes from the real tgm-dex-trades fixture', () => {
  const fx = readFixture('tgm-dex-trades.json');
  const row = fx.response_sample.data[0];
  const out = normalizeSwap(row, src('tgm/dex-trades', fx.response_meta, 'tgm-dex-trades.json'));
  assert.equal(out.value.action, 'BUY');
  assert.equal(out.value.tokenName, 'USDC');
  assert.equal(out.value.tradedTokenName, 'PIN');
  assert.equal(out.value.valueUsd, 4215.022728004488);
  // trader_address_label is "" in the fixture → null + reported unavailable
  assert.equal(out.value.traderLabel, null);
  assert.ok(out.unavailableFields.includes('trader_address_label'));
});

test('valid counterparty rows normalize from the hero Euler fixture', () => {
  const fx = readFixture('discovery/entity-euler-exploiter.json');
  const rows = fx.sample;
  const s = src('profiler/address/counterparties', fx.meta, 'discovery/entity-euler-exploiter.json');
  const out = rows.map((r: unknown) => normalizeCounterparty(r, s));
  assert.equal(out[0].value.counterpartyAddress, ATTACKER);
  assert.equal(out[0].value.interactionCount, 108);
  assert.deepEqual(out[0].value.labels, ['jaydoteth.eth*']);
  // num_transfer arrives as a STRING in the fixture → coerced to number
  assert.equal(out[0].value.tokens[0].numTransfer, 88);
  assert.equal(typeof out[0].value.tokens[0].numTransfer, 'number');
  // Balancer Vault row
  const vault = out.find((c: any) => c.value.counterpartyAddress === BALANCER_VAULT);
  assert.ok(vault, 'Balancer Vault counterparty present');
  assert.deepEqual(vault.value.labels, ['balancervault.eth']);
});

test('valid relationship row normalizes as RELATION from the hero attacker fixture', () => {
  const fx = readFixture('discovery/0xb66cd966.json');
  const row = fx.probes.related_wallets.sample[0];
  const out = normalizeRelationship(row, src('profiler/address/related-wallets', fx.probes.related_wallets.meta, 'discovery/0xb66cd966.json'));
  assert.equal(out.provenanceKind, 'RELATION');
  assert.equal(out.value.address, FIRST_FUNDER);
  assert.equal(out.value.relation, 'First Funder');
  assert.equal(out.value.timestamp.raw, '2023-03-13T09:12:23Z');
});

// ---------------------------------------------------------------------------
// 2. Missing optional fields are reported, not guessed
// ---------------------------------------------------------------------------

test('missing optional fields become null and are named in unavailableFields', () => {
  const row = {
    block_timestamp: '2023-03-13T10:00:00Z',
    transaction_hash: '0xabc',
    from_address: '0x1',
    to_address: '0x2',
    // no labels, no type, no amounts
  };
  const out = normalizeTransfer(row, src('tgm/transfers'));
  assert.equal(out.value.fromLabel, null);
  assert.equal(out.value.amount, null);
  assert.equal(out.value.valueUsd, null);
  assert.deepEqual(
    out.unavailableFields,
    ['from_address_label', 'to_address_label', 'transaction_type', 'transfer_amount', 'transfer_value_usd'].sort(),
  );
});

test('counterparty with null label array reports the absence', () => {
  const fx = readFixture('discovery/entity-euler-exploiter.json');
  // the burn-address row has counterparty_address_label: null
  const burnRow = fx.sample.find((r: any) => r.counterparty_address === '0x0000000000000000000000000000000000000000');
  const out = normalizeCounterparty(burnRow, src('profiler/address/counterparties'));
  assert.deepEqual(out.value.labels, []);
  assert.ok(out.unavailableFields.includes('counterparty_address_label'));
  // and a tokens_info entry with "" symbol + null amounts stays explicit
  const emptyTok = out.value.tokens.find((t) => t.tokenSymbol === null);
  assert.ok(emptyTok, 'token with empty symbol preserved as null symbol');
  assert.equal(emptyTok!.totalTokenAmount, null);
});

// ---------------------------------------------------------------------------
// 3. Null flow values (dex/cex split) preserved as null, never zero-filled
// ---------------------------------------------------------------------------

test('null flow split values are preserved as null (not 0)', () => {
  const fx = readFixture('tgm-flows.json');
  const row = fx.response_sample.data[0];
  const out = normalizeFlowBucket(row, src('tgm/flows', fx.response_meta, 'tgm-flows.json'));
  assert.equal(out.value.inflowsDexUsd, null);
  assert.equal(out.value.outflowsDexUsd, null);
  assert.equal(out.value.inflowsCexUsd, null);
  assert.equal(out.value.outflowsCexUsd, null);
  assert.notEqual(out.value.valueUsd, null); // value_usd IS present
  for (const k of ['total_inflows_dex', 'total_outflows_dex', 'total_inflows_cex', 'total_outflows_cex']) {
    assert.ok(out.unavailableFields.includes(k), `${k} reported unavailable`);
  }
});

// ---------------------------------------------------------------------------
// 4. Malformed records throw NormalizationError with the offending field
// ---------------------------------------------------------------------------

test('malformed record: non-object throws', () => {
  assert.throws(() => normalizeTransfer(null, src('tgm/transfers')), NormalizationError);
  assert.throws(() => normalizeTransfer('nope', src('tgm/transfers')), NormalizationError);
});

test('malformed record: missing required field throws naming the field', () => {
  const row = { transaction_hash: '0xabc', from_address: '0x1', to_address: '0x2' }; // no block_timestamp
  assert.throws(
    () => normalizeTransfer(row, src('tgm/transfers')),
    (e: unknown) => e instanceof NormalizationError && e.field === 'block_timestamp',
  );
});

test('malformed record: bad swap action throws', () => {
  const row = {
    block_timestamp: '2025-01-07T23:59:59Z', transaction_hash: '0x1', trader_address: '0x2',
    action: 'MAYBE', token_address: '0x3',
  };
  assert.throws(
    () => normalizeSwap(row, src('tgm/dex-trades')),
    (e: unknown) => e instanceof NormalizationError && e.field === 'action',
  );
});

test('malformed record: unparseable timestamp throws', () => {
  assert.throws(
    () => normalizeTimestamp('not-a-date', 'block_timestamp'),
    (e: unknown) => e instanceof NormalizationError && e.field === 'block_timestamp',
  );
});

// ---------------------------------------------------------------------------
// 5. Timestamp preservation + deterministic UTC handling
// ---------------------------------------------------------------------------

test('timestamp: raw string preserved verbatim; Z-suffixed is not assumed-UTC', () => {
  const ts = normalizeTimestamp('2023-03-13T09:12:23Z', 'block_timestamp');
  assert.equal(ts.raw, '2023-03-13T09:12:23Z');
  assert.equal(ts.assumedUtc, false);
  assert.equal(ts.iso, '2023-03-13T09:12:23.000Z');
});

test('timestamp: naive (no TZ) is treated as UTC and flagged, deterministically', () => {
  // This is the discovery/transactions shape: "2023-03-31T18:02:35" (no Z)
  const ts = normalizeTimestamp('2023-03-31T18:02:35', 'block_timestamp');
  assert.equal(ts.raw, '2023-03-31T18:02:35');
  assert.equal(ts.assumedUtc, true);
  assert.equal(ts.iso, '2023-03-31T18:02:35.000Z'); // UTC regardless of machine TZ
  assert.equal(ts.epochMs, Date.parse('2023-03-31T18:02:35Z'));
});

// ---------------------------------------------------------------------------
// 6. Address preservation (no checksumming, no rewriting)
// ---------------------------------------------------------------------------

test('addresses are preserved byte-for-byte through normalization', () => {
  const fx = readFixture('discovery/entity-euler-exploiter.json');
  const s = src('profiler/address/counterparties', fx.meta);
  for (const row of fx.sample) {
    const out = normalizeCounterparty(row, s);
    assert.equal(out.value.counterpartyAddress, row.counterparty_address);
  }
});

// ---------------------------------------------------------------------------
// 7. Provenance + source metadata preservation
// ---------------------------------------------------------------------------

test('source metadata (endpoint, requestId, credits, fixture) is preserved', () => {
  const fx = readFixture('discovery/entity-euler-exploiter.json');
  const out = normalizeCounterparty(fx.sample[0], src('profiler/address/counterparties', fx.meta, 'discovery/entity-euler-exploiter.json'));
  assert.equal(out.source.source, 'profiler/address/counterparties');
  assert.equal(out.source.requestId, fx.meta.requestId);
  assert.equal(out.source.creditsCost, fx.meta.creditsCost);
  assert.equal(out.source.fixtureFile, 'discovery/entity-euler-exploiter.json');
});

test('normalized layer only emits FACT or RELATION (never DERIVED/HYPOTHESIS)', () => {
  const tf = readFixture('tgm-transfers.json');
  const rw = readFixture('discovery/0xb66cd966.json');
  const transfer = normalizeTransfer(tf.response_sample.data[0], src('tgm/transfers', tf.response_meta));
  const rel = normalizeRelationship(rw.probes.related_wallets.sample[0], src('profiler/address/related-wallets', rw.probes.related_wallets.meta));
  assert.equal(transfer.provenanceKind, 'FACT');
  assert.equal(rel.provenanceKind, 'RELATION');
  for (const k of [transfer.provenanceKind, rel.provenanceKind]) {
    assert.ok(k === 'FACT' || k === 'RELATION');
  }
});

// ---------------------------------------------------------------------------
// 8. Determinism: identical input → identical output
// ---------------------------------------------------------------------------

test('normalization is deterministic (stable output for identical input)', () => {
  const fx = readFixture('discovery/entity-euler-exploiter.json');
  const s = src('profiler/address/counterparties', fx.meta);
  const a = JSON.stringify(fx.sample.map((r: unknown) => normalizeCounterparty(r, s)));
  const b = JSON.stringify(fx.sample.map((r: unknown) => normalizeCounterparty(r, s)));
  assert.equal(a, b);
});
