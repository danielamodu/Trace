/**
 * TRACE — Phase 3E follow-the-money tests.
 *
 * node:test + node:assert, zero new dependencies. The algorithm is pure and
 * contract-only (lib/follow.ts); tests pin exact trails on the Euler fixture
 * contract plus synthetic edge cases (dead ends, entity isolation, group
 * exclusion, repeated-walk stability).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOLLOW_DEAD_END,
  canFollow,
  followFromEvent,
  focusAddressForEvent,
  walkTrail,
} from '../lib/follow.ts';
import { buildEulerContract } from '../src/investigations/index.ts';
import { reconstruct } from '../src/reconstruction/engine.ts';
import { normalizeTransfer, sourceMeta } from '../src/reconstruction/normalize.ts';
import type { SourceMeta } from '../src/reconstruction/normalized-types.ts';
import type { CaseDescriptor, EngineInput, ReconstructionSubject } from '../src/reconstruction/engine.ts';
import { buildContract } from '../src/contract/assemble.ts';
import { eulerCoverage } from '../src/investigations/index.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';
const ATTACKER = '0xb66cd966670d962c227b3eaba30a872dbfb995db';

const src = (source: Parameters<typeof sourceMeta>[0]): SourceMeta =>
  sourceMeta(source, { requestId: 'req_test', creditsCost: '1' }, '2026-09-21T00:00:00Z', 'test');
const SUBJECT: ReconstructionSubject = { address: ATTACKER, chain: 'ethereum' };
const CASE: CaseDescriptor = {
  id: 'case_test', name: 'Test', headline: 'Test.', window: { from: '2023-03-13', to: '2023-03-31' },
};
const txRow = (over: Record<string, unknown> = {}) => ({
  block_timestamp: '2023-03-13T10:00:00Z',
  transaction_hash: '0xtx1',
  from_address: '0xaaaa00000000000000000000000000000000000001',
  to_address: '0xbbbb00000000000000000000000000000000000002',
  transfer_value_usd: 2_000_000,
  ...over,
});

test('F1: follow selects the next chronological observed event for the entity', () => {
  const contract = buildEulerContract(FIXED_AT);
  const r = followFromEvent(contract, 'event_001');
  assert.equal(r?.kind, 'followed');
  if (r?.kind === 'followed') {
    assert.equal(r.step.entity, ATTACKER); // funding destination leads
    assert.equal(r.step.fromEventId, 'event_001');
    assert.equal(r.step.toEventId, 'event_002'); // earliest later event involving the subject
  }
  assert.equal(canFollow(contract, 'event_001'), true);
});

test('F2: full Euler trail is deterministic and ends in an explicit dead end', () => {
  const contract = buildEulerContract(FIXED_AT);
  const trail = walkTrail(contract, 'event_001');
  assert.deepEqual(
    trail.map((s) => s.toEventId),
    ['event_002', 'event_003', 'event_004', 'event_005', 'event_009'],
  );
  assert.ok(trail.every((s) => typeof s.entity === 'string' && s.entity.startsWith('0x')));
  const last = trail[trail.length - 1].toEventId;
  const end = followFromEvent(contract, last);
  assert.equal(end?.kind, 'dead-end');
  if (end?.kind === 'dead-end') {
    // 009 sends to the consolidation target, which never reappears observed.
    assert.equal(end.entity, '0xc66dfa84bc1b93df194bd964a41282da65d73c9a');
    assert.equal(FOLLOW_DEAD_END, 'No subsequent supported movement in captured evidence.');
  }
  assert.equal(canFollow(contract, last), false);
  // Repeated walks are identical (requirement 8).
  assert.equal(JSON.stringify(walkTrail(contract, 'event_001')), JSON.stringify(trail));
});

test('F3: follow never crosses entities and never lands on groups', () => {
  const XA = '0x111100000000000000000000000000000000000001';
  const XB = '0x111100000000000000000000000000000000000002';
  const YA = '0x2222000000000000000000000000000000000001';
  const YB = '0x2222000000000000000000000000000000000002';
  const input: EngineInput = {
    transfers: [
      normalizeTransfer(txRow({ transaction_hash: '0xaa01', from_address: XA, to_address: XB, block_timestamp: '2023-03-13T10:00:00Z' }), src('tgm/transfers')),
      normalizeTransfer(txRow({ transaction_hash: '0xaa02', from_address: XB, to_address: XA, block_timestamp: '2023-03-13T11:00:00Z' }), src('tgm/transfers')),
      normalizeTransfer(txRow({ transaction_hash: '0xaa03', from_address: YA, to_address: YB, block_timestamp: '2023-03-13T12:00:00Z' }), src('tgm/transfers')),
    ],
  };
  const contract = buildContract(reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT }), {
    dataSource: 'fixture-cache',
    coverage: {
      flags: { fundingEvidence: false, counterpartyAggregates: false, transactionWindowCovered: true },
      reasons: [
        'flags.fundingEvidence: none.',
        'flags.counterpartyAggregates: none.',
        'flags.transactionWindowCovered: test window covered.',
      ],
    },
    inputs: input,
  });
  const ids = new Map(contract.investigation.events.map((e) => [e.txHash, e.id]));
  // X-flow stays inside X addresses; Y-flow is never crossed.
  const r1 = followFromEvent(contract, ids.get('0xaa01')!);
  assert.equal(r1?.kind, 'followed');
  if (r1?.kind === 'followed') {
    assert.equal(r1.step.toEventId, ids.get('0xaa02'));
    assert.ok([XA, XB].includes(r1.step.entity));
  }
  const r2 = followFromEvent(contract, ids.get('0xaa02')!);
  assert.equal(r2?.kind, 'dead-end', 'X trail ends; Y events are a different entity and never crossed');
  // No follow target is ever a group event.
  for (const e of contract.investigation.events) {
    const r = followFromEvent(contract, e.id);
    if (r?.kind === 'followed') {
      const target = contract.investigation.events.find((x) => x.id === r.step.toEventId)!;
      assert.ok(target.type !== 'capital-consolidation' && target.type !== 'capital-dispersal');
    }
  }
});

test('F4: unknown event ids and empty contracts are handled without throwing', () => {
  const contract = buildEulerContract(FIXED_AT);
  assert.equal(followFromEvent(contract, 'event_999'), null);
  assert.equal(canFollow(contract, 'event_999'), false);
  assert.deepEqual(walkTrail(contract, 'event_999'), []);
});

test('F5: focus rule prefers the destination side deterministically', () => {
  const contract = buildEulerContract(FIXED_AT);
  const byId = new Map(contract.investigation.entities.map((en) => [en.id, en.address ?? en.id]));
  const funding = contract.investigation.events.find((e) => e.id === 'event_001')!;
  assert.equal(focusAddressForEvent(funding, byId), ATTACKER);
});
