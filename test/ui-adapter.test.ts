/**
 * TRACE — Phase 3D adapter tests (UI data layer).
 *
 * Exercises lib/cases.ts — the exact functions the pages and API routes call —
 * with node:test + node:assert (zero new dependencies). Route handlers are thin
 * wrappers over these functions; their HTTP behavior is verified manually
 * (curl) and recorded in docs/phase-3d-ui.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getCaseContract, getService, listCaseSummaries } from '../lib/cases.ts';
import { EULER_CASE_ID, FTX_CASE_ID } from '../src/investigations/index.ts';

test('U1: listing exposes every registered case with contract-consistent counts', () => {
  const listed = listCaseSummaries();
  assert.equal(listed.length, 2);
  const ids = listed.map((e) => e.caseId).sort();
  assert.deepEqual(ids, [EULER_CASE_ID, FTX_CASE_ID].sort());
  // Every listed summary must agree 1:1 with its own contract — no drift, and
  // the check is case-agnostic rather than Euler-specific.
  for (const entry of listed) {
    const contract = getCaseContract(entry.caseId)!;
    assert.ok(contract, `contract for ${entry.caseId}`);
    assert.equal(entry.available, true);
    assert.equal(entry.completeness, contract.completeness);
    assert.equal(entry.dataSource, contract.dataSource);
    assert.equal(entry.status, contract.investigation.status);
    assert.equal(entry.primaryEvents, contract.investigation.events.filter((e) => e.primary).length);
    assert.equal(entry.entities, contract.investigation.entities.length);
  }
});

test('U2: unknown case ids return null (pages map to 404, routes to 404 JSON)', () => {
  assert.equal(getCaseContract('case_nope'), null);
  assert.equal(getCaseContract(''), null);
  assert.deepEqual([...getService().caseIds], [EULER_CASE_ID, FTX_CASE_ID].sort());
});

test('U3: served timeline is deterministically ordered', () => {
  for (const caseId of [EULER_CASE_ID, FTX_CASE_ID]) {
    const contract = getCaseContract(caseId)!;
    const events = contract.investigation.events;
    assert.ok(events.length > 0);
    events.forEach((e, i) => assert.equal(e.order, i + 1));
    for (let i = 1; i < events.length; i++) {
      assert.ok(
        events[i].timestamp >= events[i - 1].timestamp,
        `event ${events[i].id} is out of chronological order`,
      );
    }
  }
});

test('U4: served contract is JSON-stable (routes + client props)', () => {
  const contract = getCaseContract(EULER_CASE_ID)!;
  const roundTripped = JSON.parse(JSON.stringify(contract));
  assert.equal(JSON.stringify(roundTripped), JSON.stringify(contract));
  const listed = JSON.parse(JSON.stringify(listCaseSummaries()));
  assert.equal(JSON.stringify(listed), JSON.stringify(listCaseSummaries()));
});

test('U5: summary metrics render 1:1 from the contract (no invented metrics)', () => {
  const contract = getCaseContract(EULER_CASE_ID)!;
  const keys = contract.investigation.summary.map((m) => m.key).sort();
  assert.deepEqual(keys, ['entities_involved', 'peak_value_moved_usd', 'steps_reconstructed']);
  for (const m of contract.investigation.summary) {
    assert.ok(m.provenance.kind === 'FACT' || m.provenance.kind === 'DERIVED');
  }
});
