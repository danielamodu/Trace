/**
 * TRACE — FTX second-case tests (Phase 3J).
 *
 * Node's built-in test runner (node:test) + node:assert — zero dependencies.
 * Proves the FTX case is a real, honest, deterministic reconstruction from the
 * captured fixtures, and locks in the token-metadata sanitization: a scam
 * airdrop injected a 200 KB address label, and the served contract must never
 * carry a pathological string again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FTX_CASE_ID,
  FTX_SUBJECT,
  FTX_FIRST_FUNDER,
  buildFtxContract,
  ftxCoverage,
} from '../src/investigations/index.ts';

const FIXED_AT = '2026-09-23T00:00:00.000Z';

/** Longest legitimate string in the contract is an evidence-tx list (~3 KB). */
const MAX_REASONABLE_STRING = 8192;

function longestString(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce<number>((m, v) => Math.max(m, longestString(v)), 0);
  if (value && typeof value === 'object') {
    return Object.values(value).reduce<number>((m, v) => Math.max(m, longestString(v)), 0);
  }
  return 0;
}

test('FTX1: builds a reconstructed-but-incomplete fixture-cache contract', () => {
  const c = buildFtxContract(FIXED_AT);
  assert.equal(c.caseId, FTX_CASE_ID);
  assert.equal(c.investigation.status, 'reconstructed');
  assert.equal(c.dataSource, 'fixture-cache');
  // Fixture-cache is structurally incomplete by rule — never a fake "complete".
  assert.equal(c.completeness, 'incomplete');
  assert.ok(c.investigation.events.length > 0, 'timeline has events');
  assert.ok(c.investigation.events.some((e) => e.primary), 'has primary events');
  assert.ok(c.investigation.entities.length > 0, 'has entities');
  assert.ok(c.investigation.relationships.length > 0, 'has relationships');
});

test('FTX2: funding evidence is present and entity roles stay descriptive', () => {
  const c = buildFtxContract(FIXED_AT);
  assert.equal(ftxCoverage().flags.fundingEvidence, true);
  // Every entity role is descriptive-only (no attacker/beneficiary labels).
  for (const e of c.investigation.entities) {
    assert.ok(['subject', 'funder', 'counterparty'].includes(e.role), `role ${e.role} is descriptive`);
  }
  // The funding link is carried as a reported relationship edge. (Its entity is
  // classified 'counterparty' here because the First Funder is also a $219M
  // counterparty — the stronger observed signal; the engine picks one role.)
  const funding = c.investigation.relationships.filter((r) => r.nansenRelation === 'First Funder');
  assert.ok(funding.length >= 1, 'a First Funder relationship exists');
  const serialized = JSON.stringify(c).toLowerCase();
  assert.ok(serialized.includes(FTX_FIRST_FUNDER.toLowerCase()), 'First Funder appears in the contract');
  assert.ok(serialized.includes(FTX_SUBJECT.toLowerCase()), 'subject appears in the contract');
});

test('FTX3: token-metadata sanitization holds — no pathological strings served', () => {
  const c = buildFtxContract(FIXED_AT);
  const max = longestString(c);
  assert.ok(
    max < MAX_REASONABLE_STRING,
    `longest contract string is ${max}; the 200 KB label injection must stay neutralized`,
  );
});

test('FTX4: the reconstruction is deterministic (byte-identical rebuild)', () => {
  const a = JSON.stringify(buildFtxContract(FIXED_AT));
  const b = JSON.stringify(buildFtxContract(FIXED_AT));
  assert.equal(a, b, 'byte-identical rebuild');
  assert.ok(!a.includes('"HYPOTHESIS"'), 'no HYPOTHESIS records — channel remains unproduced');
});

test('FTX5: coverage flags each carry a matching reason', () => {
  const cov = ftxCoverage();
  for (const [flag, value] of Object.entries(cov.flags)) {
    if (value === false) {
      assert.ok(
        cov.reasons.some((r) => r.includes(`flags.${flag}`)),
        `false flag ${flag} has a reason`,
      );
    }
  }
  assert.ok(cov.reasons.length >= 3, 'coverage explains itself');
});

