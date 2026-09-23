/**
 * TRACE — Phase 3B reconstruction engine tests.
 *
 * Node's built-in test runner (node:test) + node:assert — zero dependencies.
 * Run with: npm test
 *
 * Covers: transaction normalization gap-fill, deterministic ordering, value
 * threshold boundaries, null values, duplicate records, missing timestamps,
 * provenance preservation, no-HYPOTHESIS enforcement, derived groupings, and
 * deterministic repeated output (incl. the hero Euler fixtures).
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
  sourceMeta,
  NormalizationError,
} from '../src/reconstruction/normalize.ts';
import type { SourceMeta } from '../src/reconstruction/normalized-types.ts';
import { normalizeTransaction } from '../src/reconstruction/transaction.ts';
import {
  reconstruct,
  significanceScore,
  EngineError,
  DEFAULT_VALUE_THRESHOLD_USD,
  type EngineInput,
  type ReconstructionSubject,
  type CaseDescriptor,
} from '../src/reconstruction/engine.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'fixtures');
const readFixture = (rel: string): any => JSON.parse(readFileSync(join(FIX, rel), 'utf8'));

// Canonical hero addresses (fixture-validated, locked Phase 3A).
const ATTACKER = '0xb66cd966670d962c227b3eaba30a872dbfb995db';
const FIRST_FUNDER = '0x036cec1a199234fc02f72d29e596a09440825f1c';
const BALANCER_VAULT = '0xba12222222228d8ba445958a75a0704d566bf2c8';
const BURN = '0x0000000000000000000000000000000000000000';

const FIXED_AT = '2026-09-21T00:00:00.000Z';

const src = (
  source: Parameters<typeof sourceMeta>[0],
  file = 'test',
): SourceMeta =>
  sourceMeta(source, { requestId: 'req_test', creditsCost: '1' }, '2026-09-21T00:00:00Z', file);

const SUBJECT: ReconstructionSubject = { address: ATTACKER, chain: 'ethereum' };
const CASE: CaseDescriptor = {
  id: 'case_test',
  name: 'Test reconstruction',
  headline: 'Deterministic reconstruction of observed fixture records.',
  window: { from: '2023-03-13', to: '2023-03-31' },
};

const txRow = (over: Record<string, unknown> = {}) => ({
  block_timestamp: '2023-03-13T10:00:00Z',
  transaction_hash: '0xtx1',
  from_address: '0xaaaa00000000000000000000000000000000000001',
  to_address: '0xbbbb00000000000000000000000000000000000002',
  ...over,
});

// ---------------------------------------------------------------------------
// A. Transaction normalization gap-fill (profiler/address/transactions)
// ---------------------------------------------------------------------------

test('A1: hero transaction row normalizes as FACT with row-level volume', () => {
  const fx = readFixture('discovery/0xb66cd966.json');
  const row = fx.probes.transactions.sample[0];
  const out = normalizeTransaction(
    row,
    src('profiler/address/transactions', 'discovery/0xb66cd966.json'),
  );
  assert.equal(out.provenanceKind, 'FACT');
  assert.equal(out.value.method, 'received');
  assert.equal(out.value.txHash, row.transaction_hash);
  assert.equal(out.value.volumeUsd, row.volume_usd);
  assert.equal(out.value.tokensReceived.length, 1);
  assert.equal(out.value.tokensSent.length, 0);
  assert.equal(out.value.timestamp.raw, '2023-03-31T18:02:35'); // naive → assumedUtc
  assert.equal(out.value.timestamp.assumedUtc, true);
});

test('A2: transaction missing optionals becomes null and is reported', () => {
  const out = normalizeTransaction(
    {
      block_timestamp: '2023-03-13T10:00:00Z',
      transaction_hash: '0xabc',
      chain: 'ethereum',
      method: 'received',
    },
    src('profiler/address/transactions'),
  );
  assert.equal(out.value.sourceType, null);
  assert.equal(out.value.volumeUsd, null);
  assert.deepEqual(out.value.tokensSent, []);
  assert.ok(out.unavailableFields.includes('source_type'));
  assert.ok(out.unavailableFields.includes('volume_usd'));
});

test('A3: malformed transaction rows throw naming the field', () => {
  assert.throws(
    () => normalizeTransaction({ transaction_hash: '0x1', chain: 'e', method: 'm' }, src('profiler/address/transactions')),
    (e: unknown) => e instanceof NormalizationError && e.field === 'block_timestamp',
  );
  assert.throws(
    () =>
      normalizeTransaction(
        { block_timestamp: '2023-03-13T10:00:00Z', transaction_hash: '0x1', chain: 'e' },
        src('profiler/address/transactions'),
      ),
    (e: unknown) => e instanceof NormalizationError && e.field === 'method',
  );
});

// ---------------------------------------------------------------------------
// B. Deterministic ordering
// ---------------------------------------------------------------------------

test('B1: events order by timestamp, then txHash on ties', () => {
  // Distinct from/to pairs so no consolidation/dispersal grouping interferes.
  const input: EngineInput = {
    transfers: [
      normalizeTransfer(txRow({ transaction_hash: '0xccc', block_timestamp: '2023-03-13T10:00:00Z', from_address: '0x00000000000000000000000000000000000000c1', to_address: '0x00000000000000000000000000000000000000c2' }), src('tgm/transfers')),
      normalizeTransfer(txRow({ transaction_hash: '0xaaa', block_timestamp: '2023-03-13T10:00:00Z', from_address: '0x00000000000000000000000000000000000000a1', to_address: '0x00000000000000000000000000000000000000a2' }), src('tgm/transfers')),
      normalizeTransfer(txRow({ transaction_hash: '0xbbb', block_timestamp: '2023-03-13T09:00:00Z', from_address: '0x00000000000000000000000000000000000000b1', to_address: '0x00000000000000000000000000000000000000b2' }), src('tgm/transfers')),
    ],
  };
  const { investigation } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const hashes = investigation.events.map((e) => e.txHash);
  // 09:00 first, then same-timestamp ties in lexicographic txHash order.
  assert.deepEqual(hashes, ['0xbbb', '0xaaa', '0xccc']);
  assert.deepEqual(investigation.events.map((e) => e.order), [1, 2, 3]);
});

test('B2: absent txIndex/logIndex never invented; stable across input shuffles', () => {
  const mk = (): EngineInput => ({
    transfers: [
      normalizeTransfer(txRow({ transaction_hash: '0x002', from_address: '0x0000000000000000000000000000000000000021', to_address: '0x0000000000000000000000000000000000000022' }), src('tgm/transfers')),
      normalizeTransfer(txRow({ transaction_hash: '0x001', from_address: '0x0000000000000000000000000000000000000011', to_address: '0x0000000000000000000000000000000000000012' }), src('tgm/transfers')),
    ],
  });
  const a = reconstruct(mk(), SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const rev: EngineInput = { transfers: [...mk().transfers!].reverse() };
  const b = reconstruct(rev, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(JSON.stringify(a.investigation), JSON.stringify(b.investigation));
  assert.deepEqual(
    a.investigation.events.map((e) => e.txHash),
    ['0x001', '0x002'],
  );
});

// ---------------------------------------------------------------------------
// C. Threshold boundaries ($1M inclusive; null never admits)
// ---------------------------------------------------------------------------

test('C1: exactly $1M admits (inclusive); $1 below collapses but is retained', () => {
  assert.equal(DEFAULT_VALUE_THRESHOLD_USD, 1_000_000);
  const input: EngineInput = {
    transfers: [
      normalizeTransfer(txRow({ transaction_hash: '0xat', transfer_value_usd: 1_000_000 }), src('tgm/transfers')),
      normalizeTransfer(txRow({ transaction_hash: '0xbelow', transfer_value_usd: 999_999.99 }), src('tgm/transfers')),
    ],
  };
  const { investigation, stats } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const at = investigation.events.find((e) => e.txHash === '0xat')!;
  const below = investigation.events.find((e) => e.txHash === '0xbelow')!;
  assert.equal(at.primary, true);
  assert.equal(at.admissionRule, 'value-threshold');
  assert.equal(below.primary, false);
  assert.equal(below.admissionRule, 'below-threshold');
  // Nothing silently dropped: both events present.
  assert.equal(stats.memberEvents, 2);
  assert.equal(stats.collapsedEvents, 1);
});

test('C2: null USD admits only via another rule; burn-sink admits dust', () => {
  const input: EngineInput = {
    transfers: [
      normalizeTransfer(txRow({ transaction_hash: '0xdust' /* no value */ }), src('tgm/transfers')),
      normalizeTransfer(
        txRow({ transaction_hash: '0xb1', to_address: BURN, transfer_value_usd: 5 }),
        src('tgm/transfers'),
      ),
    ],
  };
  const { investigation } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const dust = investigation.events.find((e) => e.txHash === '0xdust')!;
  const burn = investigation.events.find((e) => e.txHash === '0xb1')!;
  assert.equal(dust.primary, false);
  assert.equal(burn.primary, true);
  assert.equal(burn.admissionRule, 'burn-sink');
});

// ---------------------------------------------------------------------------
// D. Null values are never fabricated
// ---------------------------------------------------------------------------

test('D1: missing USD leaves the event value absent (no zero-fill)', () => {
  const input: EngineInput = {
    transfers: [normalizeTransfer(txRow({ transaction_hash: '0xnovalue' }), src('tgm/transfers'))],
  };
  const { investigation } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const ev = investigation.events[0];
  assert.ok(!('value' in ev), 'event must not carry a value object when USD is unavailable');
  assert.ok(
    investigation.dataGaps.some((g) => g.includes('no USD value')),
    'missing USD recorded as a data gap',
  );
});

// ---------------------------------------------------------------------------
// E. Duplicate records collapse deterministically and are counted
// ---------------------------------------------------------------------------

test('E1: exact duplicates collapse to one event and are counted', () => {
  const row = txRow({ transaction_hash: '0xdupe', transfer_value_usd: 2_000_000 });
  const input: EngineInput = {
    transfers: [normalizeTransfer(row, src('tgm/transfers')), normalizeTransfer(row, src('tgm/transfers'))],
  };
  const { investigation, stats } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(stats.duplicatesSkipped, 1);
  assert.equal(stats.memberEvents, 1);
  assert.equal(investigation.events.length, 1);
  assert.ok(investigation.dataGaps.some((g) => g.includes('duplicate')));
});

// ---------------------------------------------------------------------------
// F. Missing timestamps fail loudly (never defaulted)
// ---------------------------------------------------------------------------

test('F1: record with missing timestamp throws EngineError naming the field', () => {
  const good = normalizeTransfer(txRow({ transaction_hash: '0xok' }), src('tgm/transfers'));
  const bad = {
    ...good,
    value: { ...good.value, timestamp: undefined },
  } as unknown as typeof good;
  assert.throws(
    () => reconstruct({ transfers: [bad] }, SUBJECT, CASE, { reconstructedAt: FIXED_AT }),
    (e: unknown) => e instanceof EngineError && /timestamp/.test(e.field),
  );
});

// ---------------------------------------------------------------------------
// G. Provenance preservation on hero data
// ---------------------------------------------------------------------------

test('G1: First Funder becomes a funding event with full evidence trail', () => {
  const fx = readFixture('discovery/0xb66cd966.json');
  const row = fx.probes.related_wallets.sample[0];
  const rel = normalizeRelationship(
    row,
    sourceMeta(
      'profiler/address/related-wallets',
      fx.probes.related_wallets.meta,
      fx.probes.related_wallets.meta?.capturedAt ?? '2026-09-21T20:01:55.676Z',
      'discovery/0xb66cd966.json',
    ),
  );
  const { investigation } = reconstruct({ relationships: [rel] }, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(investigation.events.length, 1);
  const ev = investigation.events[0];
  assert.equal(ev.type, 'funding');
  assert.equal(ev.provenance.kind, 'RELATION');
  assert.equal(ev.admissionRule, 'nansen-relation');
  assert.equal(ev.primary, true);
  const prov = ev.provenance;
  assert.ok(prov.kind === 'RELATION');
  if (prov.kind === 'RELATION') {
    assert.equal(prov.sources[0].source, 'profiler/address/related-wallets');
    assert.equal(prov.sources[0].requestId, fx.probes.related_wallets.meta.requestId);
    assert.equal(prov.sources[0].txHash, row.transaction_hash);
    assert.ok(prov.statement.includes('discovery/0xb66cd966.json'), 'fixture file cited in statement');
    assert.ok(prov.statement.includes('First Funder'), 'Nansen relation quoted');
    assert.ok(prov.statement.includes('not proof of common control'), 'no ownership claim');
  }
  assert.equal(ev.timestamp, '2023-03-13T09:12:23.000Z');
});

// ---------------------------------------------------------------------------
// H. Method-of-interest admission + transfer-like methods
// ---------------------------------------------------------------------------

test('H1: flashloan method admits a contract-interaction; plain transfer() stays a transfer', () => {
  const s = src('profiler/address/transactions');
  const input: EngineInput = {
    transactions: [
      normalizeTransaction(
        {
          block_timestamp: '2023-03-13T11:00:00Z',
          transaction_hash: '0xflash',
          chain: 'ethereum',
          method: 'flashLoan(address[],uint256[])',
          source_type: 'contract',
          volume_usd: 10,
        },
        s,
      ),
      normalizeTransaction(
        {
          block_timestamp: '2023-03-13T12:00:00Z',
          transaction_hash: '0xerc20',
          chain: 'ethereum',
          method: 'transfer(address,uint256)',
          source_type: 'transfer',
          volume_usd: 10,
        },
        s,
      ),
    ],
  };
  const { investigation } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const flash = investigation.events.find((e) => e.txHash === '0xflash')!;
  const erc20 = investigation.events.find((e) => e.txHash === '0xerc20')!;
  assert.equal(flash.type, 'contract-interaction');
  assert.equal(flash.admissionRule, 'method-of-interest');
  assert.equal(flash.primary, true);
  assert.equal(erc20.type, 'transfer');
  assert.equal(erc20.primary, false);
});

// ---------------------------------------------------------------------------
// I. Derived groupings remain expandable
// ---------------------------------------------------------------------------

test('I1: shared recipient derives a DERIVED consolidation expandable to members', () => {
  const target = '0xcccc00000000000000000000000000000000000003';
  const input: EngineInput = {
    transfers: [1, 2, 3].map((i) =>
      normalizeTransfer(
        txRow({
          transaction_hash: `0xg${i}`,
          from_address: `0x00000000000000000000000${i}0000000000000000${i}`,
          to_address: target,
          block_timestamp: `2023-03-1${i}T10:00:00Z`,
          transfer_value_usd: 100,
        }),
        src('tgm/transfers'),
      ),
    ),
  };
  const { investigation, stats } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(stats.groupsDerived, 1);
  const group = investigation.events.find((e) => e.type === 'capital-consolidation')!;
  assert.equal(group.provenance.kind, 'DERIVED');
  assert.equal(group.admissionRule, 'derived-grouping');
  if (group.provenance.kind === 'DERIVED') {
    assert.equal(group.provenance.calculation, 'consolidation');
    assert.equal(group.provenance.sourceEventIds.length, 3);
    for (const id of group.provenance.sourceEventIds) {
      assert.ok(
        investigation.events.some((e) => e.id === id),
        `member ${id} resolves to a timeline event`,
      );
    }
  }
});

test('I2: shared sender derives a DERIVED dispersal', () => {
  const sender = '0xdddd00000000000000000000000000000000000004';
  const input: EngineInput = {
    transfers: [1, 2, 3].map((i) =>
      normalizeTransfer(
        txRow({
          transaction_hash: `0xd${i}`,
          from_address: sender,
          to_address: `0x00000000000000000000000${i}111111111111111${i}`,
          transfer_value_usd: 50,
        }),
        src('tgm/transfers'),
      ),
    ),
  };
  const { investigation } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const group = investigation.events.find((e) => e.type === 'capital-dispersal')!;
  assert.equal(group.provenance.kind, 'DERIVED');
  if (group.provenance.kind === 'DERIVED') {
    assert.equal(group.provenance.calculation, 'dispersal');
    assert.equal(group.provenance.sourceEventIds.length, 3);
  }
});

// ---------------------------------------------------------------------------
// J. Counterparties feed entities/relationships, never events
// ---------------------------------------------------------------------------

test('J1: hero counterparty rows admit entities + aggregate edges, not events', () => {
  const fx = readFixture('discovery/entity-euler-exploiter.json');
  const s = sourceMeta(
    'profiler/address/counterparties',
    fx.meta,
    fx.captured_at,
    'discovery/entity-euler-exploiter.json',
  );
  const cps = fx.sample.map((r: unknown) => normalizeCounterparty(r, s));
  const { investigation } = reconstruct({ counterparties: cps }, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(investigation.events.length, 0, 'aggregates must not become events');
  assert.equal(investigation.status, 'partial');
  const vault = investigation.entities.find((e) => e.address === BALANCER_VAULT)!;
  assert.ok(vault, 'Balancer Vault entity admitted');
  assert.ok(vault.admissionReason.includes('counterparty-above-threshold'));
  assert.deepEqual(vault.labels.map((l) => l.label), ['balancervault.eth']);
  const burnEnt = investigation.entities.find((e) => e.address === BURN)!;
  assert.ok(burnEnt.admissionReason.includes('burn-sink'));
  assert.equal(burnEnt.role, 'counterparty', 'burn is counterparty, never an interpretive role');
  const edge = investigation.relationships.find(
    (r) => r.kind === 'counterparty' && r.toEntityId === vault.id,
  )!;
  assert.ok(edge, 'aggregate counterparty edge present');
  assert.equal(edge.directed, false);
  assert.equal(edge.metrics?.interactionCount, 4);
});

// ---------------------------------------------------------------------------
// K. No HYPOTHESIS; roles and language stay descriptive
// ---------------------------------------------------------------------------

const BANNED = ['exploit', 'stolen', 'drain', 'hack', 'voluntary', 'intent', 'attacker'];

test('K1: engine output contains no HYPOTHESIS and no loaded language', () => {
  const fxT = readFixture('tgm-transfers.json');
  const fxS = readFixture('tgm-dex-trades.json');
  const fxC = readFixture('discovery/entity-euler-exploiter.json');
  const fxR = readFixture('discovery/0xb66cd966.json');
  const input: EngineInput = {
    transfers: fxT.response_sample.data.map((r: unknown) =>
      normalizeTransfer(r, sourceMeta('tgm/transfers', fxT.response_meta, fxT.captured_at, 'tgm-transfers.json')),
    ),
    swaps: fxS.response_sample.data.map((r: unknown) =>
      normalizeSwap(r, sourceMeta('tgm/dex-trades', fxS.response_meta, fxS.captured_at, 'tgm-dex-trades.json')),
    ),
    counterparties: fxC.sample.map((r: unknown) =>
      normalizeCounterparty(r, sourceMeta('profiler/address/counterparties', fxC.meta, fxC.captured_at, 'discovery/entity-euler-exploiter.json')),
    ),
    relationships: fxR.probes.related_wallets.sample.map((r: unknown) =>
      normalizeRelationship(
        r,
        sourceMeta('profiler/address/related-wallets', fxR.probes.related_wallets.meta, fxR.captured_at, 'discovery/0xb66cd966.json'),
      ),
    ),
    transactions: fxR.probes.transactions.sample.map((r: unknown) =>
      normalizeTransaction(
        r,
        sourceMeta('profiler/address/transactions', fxR.probes.transactions.meta, fxR.captured_at, 'discovery/0xb66cd966.json'),
      ),
    ),
  };
  const { investigation } = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const json = JSON.stringify(investigation);
  assert.ok(!json.includes('"HYPOTHESIS"'), 'no HYPOTHESIS records');
  assert.ok(!json.includes('"attacker"'), 'no attacker role');
  assert.ok(!json.includes('"beneficiary"'), 'no beneficiary role');
  for (const ev of investigation.events) {
    const text = `${ev.title} ${ev.provenance.kind === 'FACT' || ev.provenance.kind === 'RELATION' ? ev.provenance.statement : ''}`.toLowerCase();
    for (const w of BANNED) {
      assert.ok(!text.includes(w), `event ${ev.id} must not contain "${w}"`);
    }
  }
  for (const ent of investigation.entities) {
    assert.ok(
      ent.role === 'subject' || ent.role === 'funder' || ent.role === 'counterparty',
      `entity ${ent.id} role is descriptive-only`,
    );
  }
  // Deterministic repeated output on the mixed input.
  const again = reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(JSON.stringify(again.investigation), json);
});

// ---------------------------------------------------------------------------
// L. Euler end-to-end from discovery fixtures
// ---------------------------------------------------------------------------

test('L1: hero Euler reconstruction assembles the documented arc', () => {
  const fxC = readFixture('discovery/entity-euler-exploiter.json');
  const fxR = readFixture('discovery/0xb66cd966.json');
  const sC = sourceMeta('profiler/address/counterparties', fxC.meta, fxC.captured_at, 'discovery/entity-euler-exploiter.json');
  const sR = sourceMeta('profiler/address/related-wallets', fxR.probes.related_wallets.meta, fxR.captured_at, 'discovery/0xb66cd966.json');
  const sT = sourceMeta('profiler/address/transactions', fxR.probes.transactions.meta, fxR.captured_at, 'discovery/0xb66cd966.json');
  const input: EngineInput = {
    counterparties: fxC.sample.map((r: unknown) => normalizeCounterparty(r, sC)),
    relationships: fxR.probes.related_wallets.sample.map((r: unknown) => normalizeRelationship(r, sR)),
    transactions: fxR.probes.transactions.sample.map((r: unknown) => normalizeTransaction(r, sT)),
  };
  const eulerCase: CaseDescriptor = {
    id: 'case_euler_2023',
    name: 'Euler Finance exploit and fund return',
    headline: 'Observed on-chain movements around the Euler incident, 2023-03-13 → 2023-03-31.',
    window: { from: '2023-03-13', to: '2023-03-31' },
  };
  const { investigation, stats } = reconstruct(input, SUBJECT, eulerCase, { reconstructedAt: FIXED_AT });
  // T-0 funding first.
  const first = investigation.events[0];
  assert.equal(first.type, 'funding');
  assert.equal(first.timestamp, '2023-03-13T09:12:23.000Z');
  // Core entities present.
  for (const addr of [ATTACKER, FIRST_FUNDER, BALANCER_VAULT, BURN]) {
    assert.ok(
      investigation.entities.some((e) => e.address === addr),
      `entity ${addr} admitted`,
    );
  }
  const funder = investigation.entities.find((e) => e.address === FIRST_FUNDER)!;
  assert.equal(funder.role, 'funder');
  const subjectEnt = investigation.entities.find((e) => e.address === ATTACKER)!;
  assert.equal(subjectEnt.role, 'subject');
  // Funder edge + consolidation grouping over the dust transfers to the subject.
  assert.ok(investigation.relationships.some((r) => r.kind === 'funder'), 'funder edge present');
  assert.ok(
    investigation.events.some((e) => e.type === 'capital-consolidation'),
    'consolidation grouping derived',
  );
  assert.equal(investigation.status, 'reconstructed');
  assert.ok(stats.groupsDerived >= 1);
  assert.ok(investigation.dataGaps.length >= 2, 'honest gaps recorded');
});

// ---------------------------------------------------------------------------
// M. Flows are accepted but explicitly not eventized
// ---------------------------------------------------------------------------

test('M1: flow buckets are counted as skipped, never events', () => {
  const fx = readFixture('tgm-flows.json');
  const flows = fx.response_sample.data.map((r: unknown) =>
    normalizeFlowBucket(r, sourceMeta('tgm/flows', fx.response_meta, fx.captured_at, 'tgm-flows.json')),
  );
  const withFlows = reconstruct(
    { transfers: [normalizeTransfer(txRow({ transfer_value_usd: 2_000_000 }), src('tgm/transfers'))], flows },
    SUBJECT,
    CASE,
    { reconstructedAt: FIXED_AT },
  );
  assert.equal(withFlows.stats.flowsSkipped, flows.length);
  assert.equal(withFlows.stats.memberEvents, 1);
  assert.ok(withFlows.investigation.dataGaps.some((g) => g.includes('not eventized')));
});

// ---------------------------------------------------------------------------
// N. Significance is a pure deterministic function
// ---------------------------------------------------------------------------

test('N1: significanceScore is deterministic and monotone in value', () => {
  const base = { hasRelation: false, methodOfInterest: false, burnSink: false, firstInWindow: false, lastInWindow: false };
  assert.equal(significanceScore({ ...base, valueUsd: null }), 0);
  assert.equal(significanceScore({ ...base, valueUsd: 1_000_000 }), 60);
  assert.ok(significanceScore({ ...base, valueUsd: 2_000_000 }) > significanceScore({ ...base, valueUsd: 1_000_000 }));
  assert.equal(
    significanceScore({ ...base, valueUsd: 1, hasRelation: true }),
    significanceScore({ ...base, valueUsd: 1, hasRelation: true }),
  );
});

// ---------------------------------------------------------------------------
// O. All-collapsed input yields partial status without fabrication
// ---------------------------------------------------------------------------

test('O1: single dust transfer stays collapsed and the case reports partial', () => {
  const { investigation, stats } = reconstruct(
    { transfers: [normalizeTransfer(txRow({ transfer_value_usd: 0.5 }), src('tgm/transfers'))] },
    SUBJECT,
    CASE,
    { reconstructedAt: FIXED_AT },
  );
  assert.equal(investigation.events.length, 1);
  assert.equal(investigation.events[0].primary, false);
  assert.equal(investigation.status, 'partial');
  assert.equal(stats.primaryEvents, 0);
});
