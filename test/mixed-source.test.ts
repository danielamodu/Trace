/**
 * TRACE — Phase 3H mixed-source tests.
 *
 * node:test + node:assert, zero new dependencies, zero live calls. Pins the
 * mixed-source model: pool enumeration per build, event-level origin
 * preservation, DERIVED composition, determinism, unchanged completeness,
 * source/provenance separation, and backward compatibility of old contracts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTransaction } from '../src/reconstruction/transaction.ts';
import { reconstruct } from '../src/reconstruction/engine.ts';
import { normalizeCounterparty, normalizeRelationship, sourceMeta } from '../src/reconstruction/normalize.ts';
import type { CaseDescriptor, EngineInput, ReconstructionSubject } from '../src/reconstruction/engine.ts';
import { buildContract } from '../src/contract/assemble.ts';
import { collectOrigins } from '../src/contract/completeness.ts';
import { validateContract } from '../src/contract/validate.ts';
import { buildEulerContract, eulerCoverage, loadEulerInputs } from '../src/investigations/index.ts';
import { eventOrigin } from '../lib/sources.ts';
import type { CoverageReport } from '../src/contract/types.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';
const HERE = dirname(fileURLToPath(import.meta.url));
const SUBJECT: ReconstructionSubject = {
  address: '0xb66cd966670d962c227b3eaba30a872dbfb995db',
  chain: 'ethereum',
};
const CASE: CaseDescriptor = {
  id: 'case_test', name: 'Test', headline: 'Test.', window: { from: '2023-03-13', to: '2023-03-31' },
};
const FULL: CoverageReport = {
  flags: { fundingEvidence: true, counterpartyAggregates: true, transactionWindowCovered: true },
  reasons: [
    'flags.fundingEvidence: test.',
    'flags.counterpartyAggregates: test.',
    'flags.transactionWindowCovered: test.',
  ],
};

const liveRows = (): any[] => {
  const fx = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'live', 'euler', 'profiler-transactions-2023-03-13-p1.json'), 'utf8'));
  return fx.response_body.data.map((r: unknown) =>
    normalizeTransaction(
      r,
      sourceMeta('profiler/address/transactions', fx.response_meta, fx.captured_at, 'live/euler/profiler-transactions-2023-03-13-p1.json'),
    ),
  );
};

test('H1: fixture-only build enumerates a single pool', () => {
  const fx = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'discovery', '0xb66cd966.json'), 'utf8'));
  const s = sourceMeta('profiler/address/transactions', fx.probes.transactions.meta, fx.captured_at, 'discovery/0xb66cd966.json');
  const input: EngineInput = {
    transactions: fx.probes.transactions.sample.map((r: unknown) => normalizeTransaction(r, s)),
  };
  const contract = buildContract(reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT }), {
    dataSource: 'fixture-cache', coverage: FULL, inputs: input,
  });
  assert.deepEqual(contract.dataSources, ['fixture-cache']);
  assert.deepEqual(collectOrigins(contract.investigation), ['fixture-cache']);
});

test('H2: live-only build enumerates a single pool', () => {
  const input: EngineInput = { transactions: liveRows() };
  const contract = buildContract(reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT }), {
    dataSource: 'live-nansen', coverage: FULL, inputs: input,
  });
  assert.deepEqual(contract.dataSources, ['live-nansen']);
  for (const e of contract.investigation.events) {
    if (e.provenance.kind === 'FACT' || e.provenance.kind === 'RELATION') {
      assert.ok(e.provenance.sources.every((s) => s.origin === 'live-nansen'));
    }
  }
});

test('H3: expanded Euler build is mixed and repeat-stable', () => {
  const a = buildEulerContract(FIXED_AT);
  assert.deepEqual(a.dataSources, ['fixture-cache', 'live-nansen']);
  assert.deepEqual(collectOrigins(a.investigation), ['fixture-cache', 'live-nansen']);
  assert.equal(JSON.stringify(buildEulerContract(FIXED_AT)), JSON.stringify(a));
  // Served inputs are the union, never a replacement.
  const { input } = loadEulerInputs();
  assert.equal(input.transactions!.length, 5 + 17);
});

test('H4: event-level source preservation across pools', () => {
  const contract = buildEulerContract(FIXED_AT);
  const funding = contract.investigation.events.find((e) => e.type === 'funding')!;
  assert.equal(eventOrigin(contract, funding.id), 'fixture-cache');
  const liveTransfer = contract.investigation.events.find(
    (e) => e.txHash === '0xdae809e4a1ddf77c39d44a4acfe6165bedbc19a385c4b241242cc9bd582a80b9',
  )!;
  assert.equal(eventOrigin(contract, liveTransfer.id), 'live-nansen');
  // Same funding tx observed twice: RELATION (fixture) + FACT transfer (live).
  const fundingTxTransfer = contract.investigation.events.find(
    (e) => e.txHash === '0x298bde3f9e53f7a5d870f7f5d56ee2f5e41fa25e6eb5e74611ac97025405db55' && e.type === 'transfer',
  )!;
  assert.equal(eventOrigin(contract, fundingTxTransfer.id), 'live-nansen');
});

test('H5: DERIVED groups expose member-pool composition honestly', () => {
  const contract = buildEulerContract(FIXED_AT);
  const groups = contract.investigation.events.filter(
    (e) => e.type === 'capital-consolidation' || e.type === 'capital-dispersal',
  );
  assert.ok(groups.length >= 2);
  const origins = groups.map((g) => eventOrigin(contract, g.id));
  assert.ok(origins.includes('mixed'), `at least one mixed group, got ${JSON.stringify(origins)}`);
  for (const g of groups) {
    assert.ok(['fixture-cache', 'live-nansen', 'mixed'].includes(eventOrigin(contract, g.id)));
    assert.equal(g.provenance.kind, 'DERIVED');
  }
  assert.equal(eventOrigin(contract, 'event_999'), 'unknown');
});

test('H6/H7: completeness stays incomplete on the expanded build', () => {
  const contract = buildEulerContract(FIXED_AT);
  assert.equal(contract.dataSource, 'fixture-cache');
  assert.equal(contract.completeness, 'incomplete');
  assert.ok(contract.completenessReasons.length > 0);
  assert.deepEqual(validateContract(contract), []);
});

test('H8: source and provenance remain independent axes', () => {
  const contract = buildEulerContract(FIXED_AT);
  const seen = new Set<string>();
  for (const e of contract.investigation.events) {
    seen.add(`${e.provenance.kind}+${eventOrigin(contract, e.id)}`);
  }
  for (const combo of ['FACT+fixture-cache', 'FACT+live-nansen', 'RELATION+fixture-cache', 'DERIVED+mixed']) {
    assert.ok(seen.has(combo), `combination present: ${combo} (seen: ${[...seen].join(', ')})`);
  }
  assert.ok(!JSON.stringify(contract).includes('"HYPOTHESIS"'));
});

test('H9: pre-3H contracts without the new fields still validate', () => {
  const contract = buildEulerContract(FIXED_AT);
  const clone = structuredClone(contract) as Record<string, unknown>;
  delete clone.dataSources;
  const strip = (o: unknown): void => {
    if (Array.isArray(o)) {
      for (const v of o) strip(v);
      return;
    }
    if (typeof o === 'object' && o !== null) {
      const r = o as Record<string, unknown>;
      delete r.origin;
      for (const v of Object.values(r)) strip(v);
    }
  };
  strip((clone.investigation as Record<string, unknown>));
  assert.deepEqual(validateContract(clone), []);
});
