/**
 * TRACE — Phase 3C investigation contract tests.
 *
 * Node's built-in test runner (node:test) + node:assert — zero dependencies.
 * Run with: npm test
 *
 * Covers: deterministic IDs, empty collections, duplicate records, evidence
 * references, status accuracy (fixture-incomplete vs synthetic-complete),
 * FACT/RELATION/DERIVED preservation, validation negatives, coverage, and the
 * read-only service.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTransfer,
  sourceMeta,
} from '../src/reconstruction/normalize.ts';
import type { SourceMeta } from '../src/reconstruction/normalized-types.ts';
import {
  reconstruct,
  type CaseDescriptor,
  type EngineInput,
  type ReconstructionSubject,
} from '../src/reconstruction/engine.ts';
import {
  aggregateUnavailableFields,
  CONTRACT_VERSION,
  UnknownCaseError,
  buildContract,
  validateContract,
  validateInvestigation,
  type CoverageReport,
} from '../src/contract/index.ts';
import { AVAILABLE_CASES, EULER_CASE_ID, EULER_HEADLINE, EULER_NAME, EULER_WINDOW, buildEulerContract, buildEulerService, eulerCoverage, loadEulerInputs } from '../src/investigations/index.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';

const src = (source: Parameters<typeof sourceMeta>[0]): SourceMeta =>
  sourceMeta(source, { requestId: 'req_test', creditsCost: '1' }, '2026-09-21T00:00:00Z', 'test');

const SUBJECT: ReconstructionSubject = {
  address: '0xb66cd966670d962c227b3eaba30a872dbfb995db',
  chain: 'ethereum',
};
const CASE: CaseDescriptor = {
  id: 'case_test',
  name: 'Test reconstruction',
  headline: 'Deterministic reconstruction of observed fixture records.',
  window: { from: '2023-03-13', to: '2023-03-31' },
};
const FULL_COVERAGE: CoverageReport = {
  flags: { fundingEvidence: true, counterpartyAggregates: true, transactionWindowCovered: true },
  reasons: [
    'flags.fundingEvidence: test funding row observed.',
    'flags.counterpartyAggregates: test aggregates observed.',
    'flags.transactionWindowCovered: test window fully covered.',
  ],
};

const txRow = (over: Record<string, unknown> = {}) => ({
  block_timestamp: '2023-03-13T10:00:00Z',
  transaction_hash: '0xtx1',
  from_address: '0xaaaa00000000000000000000000000000000000001',
  to_address: '0xbbbb00000000000000000000000000000000000002',
  ...over,
});

const clone = <T>(v: T): T => structuredClone(v);

// ---------------------------------------------------------------------------
// IDs: deterministic, stable, well-formed
// ---------------------------------------------------------------------------

test('C-IDS-1: repeated builds yield byte-identical contracts with sequential IDs', () => {
  const a = buildEulerContract(FIXED_AT);
  const b = buildEulerContract(FIXED_AT);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const ids = a.investigation.events.map((e) => e.id);
  assert.deepEqual(ids, ids.map((_, i) => `event_${String(i + 1).padStart(3, '0')}`));
  assert.deepEqual(a.investigation.events.map((e) => e.order), a.investigation.events.map((_, i) => i + 1));
  const relIds = a.investigation.relationships.map((r) => r.id);
  assert.equal(new Set(relIds).size, relIds.length);
  for (const id of relIds) assert.match(id, /^rel_\d+$/);
  const entIds = a.investigation.entities.map((e) => e.id);
  assert.equal(new Set(entIds).size, entIds.length);
  for (const id of entIds) assert.match(id, /^entity_/);
});

test('C-IDS-2: shuffled inputs yield identical IDs and contract JSON', () => {
  const a = buildEulerContract(FIXED_AT);
  const { input } = loadEulerInputs();
  const rev = <T>(arr: T[] | undefined): T[] | undefined =>
    arr === undefined ? undefined : [...arr].reverse();
  const reversed: EngineInput = {
    transfers: rev(input.transfers),
    swaps: rev(input.swaps),
    counterparties: rev(input.counterparties),
    relationships: rev(input.relationships),
    transactions: rev(input.transactions),
    flows: rev(input.flows),
  };
  const c = buildContract(
    reconstruct(
      reversed,
      SUBJECT,
      { id: EULER_CASE_ID, name: EULER_NAME, headline: EULER_HEADLINE, window: { ...EULER_WINDOW } },
      { reconstructedAt: FIXED_AT },
    ),
    { dataSource: 'fixture-cache', coverage: eulerCoverage(), inputs: reversed },
  );
  assert.equal(
    JSON.stringify(c.investigation.events.map((e) => e.id)),
    JSON.stringify(a.investigation.events.map((e) => e.id)),
  );
  assert.equal(JSON.stringify(c), JSON.stringify(a));
});

// ---------------------------------------------------------------------------
// Empty collections
// ---------------------------------------------------------------------------

test('C-EMPTY: empty input yields a valid partial, incomplete contract', () => {
  const result = reconstruct({}, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(result.investigation.events.length, 0);
  assert.equal(result.investigation.status, 'partial');
  const contract = buildContract(result, {
    dataSource: 'fixture-cache',
    coverage: {
      flags: { fundingEvidence: false, counterpartyAggregates: false, transactionWindowCovered: false },
      reasons: [
        'flags.fundingEvidence: no input records.',
        'flags.counterpartyAggregates: no input records.',
        'flags.transactionWindowCovered: no input records.',
      ],
    },
    inputs: {},
  });
  assert.equal(contract.completeness, 'incomplete');
  assert.ok(contract.completenessReasons.length >= 3);
  assert.deepEqual(validateContract(contract), []);
  assert.equal(contract.evidence.observedFacts, 0);
  assert.equal(contract.evidence.observedRelations, 0);
  assert.equal(contract.evidence.derivedValues, 0);
  assert.equal(contract.evidence.unavailableFields.length, 0);
});

// ---------------------------------------------------------------------------
// Duplicate records
// ---------------------------------------------------------------------------

test('C-DUPE: duplicates stay collapsed, counted, and validation-clean', () => {
  const row = txRow({ transaction_hash: '0xd11e', transfer_value_usd: 2_000_000 });
  const input: EngineInput = {
    transfers: [normalizeTransfer(row, src('tgm/transfers')), normalizeTransfer(row, src('tgm/transfers'))],
  };
  const contract = buildContract(reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT }), {
    dataSource: 'fixture-cache',
    coverage: FULL_COVERAGE,
    inputs: input,
  });
  assert.equal(contract.evidence.duplicatesSkipped, 1);
  assert.equal(contract.investigation.events.length, 1);
  assert.deepEqual(validateContract(contract), []);
});

// ---------------------------------------------------------------------------
// Evidence references
// ---------------------------------------------------------------------------

test('C-EVIDENCE: every member event anchors to endpoint, fixture, time, and tx', () => {
  const contract = buildEulerContract(FIXED_AT);
  const eventIds = new Set(contract.investigation.events.map((e) => e.id));
  for (const e of contract.investigation.events) {
    if (e.type === 'capital-consolidation' || e.type === 'capital-dispersal') {
      assert.equal(e.provenance.kind, 'DERIVED');
      if (e.provenance.kind === 'DERIVED') {
        assert.ok(e.provenance.sourceEventIds.length >= 2, 'groups stay expandable');
        for (const id of e.provenance.sourceEventIds) {
          assert.ok(eventIds.has(id), `member ${id} resolves`);
        }
      }
      continue;
    }
    assert.ok(e.txHash, `member ${e.id} carries its transaction hash`);
    assert.ok(e.provenance.kind === 'FACT' || e.provenance.kind === 'RELATION');
    if (e.provenance.kind === 'FACT' || e.provenance.kind === 'RELATION') {
      assert.ok(e.provenance.sources.length >= 1);
      assert.ok(e.provenance.sources[0].source.length > 0, 'endpoint recorded');
      assert.ok(e.provenance.sources[0].capturedAt.length > 0, 'capture time recorded');
      assert.ok(
        /\.json/.test(e.provenance.statement),
        `member ${e.id} statement cites its fixture file`,
      );
    }
  }
  const vaultEdge = contract.investigation.relationships.find((r) => r.kind === 'counterparty');
  assert.ok(vaultEdge && vaultEdge.metrics && typeof vaultEdge.metrics.interactionCount === 'number');
});

// ---------------------------------------------------------------------------
// Status accuracy: fixture-incomplete vs synthetic-complete
// ---------------------------------------------------------------------------

test('C-STATUS-EULER: fixture case is incomplete with dust/pagination reasons', () => {
  const contract = buildEulerContract(FIXED_AT);
  assert.equal(contract.dataSource, 'fixture-cache');
  assert.equal(contract.contractVersion, CONTRACT_VERSION);
  assert.equal(contract.caseId, EULER_CASE_ID);
  assert.equal(contract.completeness, 'incomplete');
  const joined = contract.completenessReasons.join(' ').toLowerCase();
  assert.ok(joined.includes('dust'), 'dust limitation exposed');
  assert.ok(joined.includes('pagination') || joined.includes('live capture'), 'pagination limitation exposed');
  assert.ok(!joined.includes('complete exploit'), 'never labeled a complete exploit reconstruction');
  assert.deepEqual(validateContract(contract), []);
});

test('C-STATUS-COMPLETE: live + full coverage validates as complete', () => {
  // Declared live source requires live-convention inputs (origins derive from
  // the fixture namespace, so the declaration must match the evidence).
  const liveSrc = sourceMeta(
    'tgm/transfers',
    { requestId: 'req_live', creditsCost: '1' },
    '2026-09-22T00:00:00Z',
    'live/test-synth.json',
  );
  const input: EngineInput = {
    transfers: [
      normalizeTransfer(txRow({ transaction_hash: '0xc1', transfer_value_usd: 5_000_000, from_address: '0x00000000000000000000000000000000000000c1', to_address: '0x00000000000000000000000000000000000000c2' }), liveSrc),
      normalizeTransfer(txRow({ transaction_hash: '0xc2', transfer_value_usd: 6_000_000, from_address: '0x00000000000000000000000000000000000000c3', to_address: '0x00000000000000000000000000000000000000c4' }), liveSrc),
    ],
  };
  const contract = buildContract(reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT }), {
    dataSource: 'live-nansen',
    coverage: FULL_COVERAGE,
    inputs: input,
  });
  assert.equal(contract.completeness, 'complete');
  assert.deepEqual(validateContract(contract), []);
});

// ---------------------------------------------------------------------------
// Provenance preservation: FACT/RELATION/DERIVED counts, no hypotheses
// ---------------------------------------------------------------------------

test('C-PROV: Euler evidence counts are exact and hypotheses absent', () => {
  const contract = buildEulerContract(FIXED_AT);
  assert.equal(contract.evidence.observedFacts, 79);
  assert.equal(contract.evidence.observedRelations, 3);
  assert.equal(contract.evidence.derivedValues, 14);
  assert.equal(contract.evidence.derivedGroupings, 7);
  assert.equal(contract.evidence.derivedFlowEdges, 7);
  assert.equal(contract.evidence.primaryEvents, 12);
  assert.equal(contract.evidence.collapsedEvents, 18);
  assert.equal(contract.evidence.eventsMissingUsd, 3);
  assert.ok(contract.evidence.unavailableFields.includes('tokens_sent'));
  assert.ok(contract.evidence.unavailableFields.includes('address_label'));
  assert.ok(contract.evidence.unavailableFields.includes('counterparty_address_label'));
  assert.deepEqual(
    contract.evidence.unavailableFields,
    [...contract.evidence.unavailableFields].sort(),
    'unavailable fields sorted',
  );
  assert.ok(contract.evidence.limitations.length >= 5);
  const json = JSON.stringify(contract);
  assert.ok(!json.includes('"HYPOTHESIS"'), 'no hypotheses in the default contract');
  assert.ok(!json.includes('"attacker"'), 'no attacker role');
  for (const en of contract.investigation.entities) {
    assert.ok(en.role === 'subject' || en.role === 'funder' || en.role === 'counterparty');
  }
});

// ---------------------------------------------------------------------------
// Validation negatives
// ---------------------------------------------------------------------------

test('C-VALID-NEG: corruption is reported with paths, not silently served', () => {
  const base = buildEulerContract(FIXED_AT);
  const dangling = clone(base);
  (dangling.investigation.relationships[0].evidenceEventIds as string[]).push('event_999');
  assert.match(validateContract(dangling).join(' | '), /dangles/);

  const hyp = clone(base);
  (hyp.investigation.events[0].provenance as { kind: string }).kind = 'HYPOTHESIS';
  assert.match(validateContract(hyp).join(' | '), /HYPOTHESIS/);

  const badId = clone(base);
  badId.investigation.events[0].id = 'evt1';
  assert.match(validateContract(badId).join(' | '), /event_###/);

  const flipped = clone(base);
  (flipped as { completeness: string }).completeness = 'complete';
  assert.match(validateContract(flipped).join(' | '), /contradicts/);

  const badRule = clone(base);
  badRule.investigation.events[0].admissionRule = 'vibes' as never;
  assert.match(validateContract(badRule).join(' | '), /admissionRule/);

  const badRole = clone(base);
  badRole.investigation.entities[0].role = 'attacker' as never;
  assert.match(validateContract(badRole).join(' | '), /role/);
});

test('C-VALID-INVESTIGATION: standalone case validation passes on Euler', () => {
  const contract = buildEulerContract(FIXED_AT);
  assert.deepEqual(validateInvestigation(contract.investigation), []);
  assert.deepEqual(validateInvestigation(null), ['investigation must be an object']);
});

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

test('C-COVERAGE: Euler coverage flags carry explicit reasons', () => {
  const cov = eulerCoverage();
  assert.equal(cov.flags.fundingEvidence, true);
  assert.equal(cov.flags.counterpartyAggregates, true);
  assert.equal(cov.flags.transactionWindowCovered, false);
  assert.ok(cov.reasons.some((r) => r.includes('transactionWindowCovered')));
});

// ---------------------------------------------------------------------------
// Read-only service
// ---------------------------------------------------------------------------

test('C-SERVICE: registry serves one frozen Euler case; unknown ids throw', () => {
  const service = buildEulerService(FIXED_AT);
  assert.deepEqual(service.caseIds, [EULER_CASE_ID]);
  assert.equal(service.hasCase(EULER_CASE_ID), true);
  assert.equal(service.hasCase('case_nope'), false);
  const listed = service.listCases();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].caseId, EULER_CASE_ID);
  assert.equal(listed[0].available, true);
  assert.equal(listed[0].completeness, 'incomplete');
  const contract = service.getContract(EULER_CASE_ID);
  assert.ok(Object.isFrozen(contract), 'contract frozen');
  assert.ok(Object.isFrozen(contract.investigation), 'investigation frozen');
  assert.ok(Object.isFrozen(contract.investigation.events), 'events frozen');
  assert.ok(Object.isFrozen(contract.investigation.events[0]), 'event frozen');
  assert.ok(Object.isFrozen(listed), 'listing frozen');
  assert.throws(() => service.getContract('case_nope'), UnknownCaseError);
  assert.throws(() => {
    (contract as unknown as Record<string, unknown>).caseId = 'mutated';
  }, TypeError);
  assert.equal(AVAILABLE_CASES.length, 1);
  assert.equal(AVAILABLE_CASES[0].available, true);
});
