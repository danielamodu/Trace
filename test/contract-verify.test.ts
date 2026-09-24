/**
 * TRACE — Pillar ④ artifact self-verification tests.
 *
 * node:test + node:assert, zero deps. Proves the contract is a portable,
 * self-checking artifact: a deterministic, format-independent fingerprint, and
 * an offline re-derivation of its verdict that catches tampering.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildEulerContract } from '../src/investigations/index.ts';
import { canonicalJson, fingerprintContract, verifyContract } from '../src/contract/verify.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';

/** Recursively rebuild an object with keys inserted in reverse order. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).reverse()) {
      out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

test('canonicalJson sorts object keys and preserves array order', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  assert.equal(canonicalJson({ z: [{ y: 1, x: 2 }] }), '{"z":[{"x":2,"y":1}]}');
});

test('fingerprint is deterministic and format-independent', async () => {
  const c = buildEulerContract(FIXED_AT);
  const a = await fingerprintContract(c);
  const b = await fingerprintContract(c);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/); // SHA-256 hex
  // Whitespace + key order must not change the fingerprint.
  assert.equal(await fingerprintContract(JSON.parse(JSON.stringify(c))), a);
  assert.equal(await fingerprintContract(reverseKeys(c)), a);
});

test('fingerprint changes when any content changes', async () => {
  const c = buildEulerContract(FIXED_AT);
  const base = await fingerprintContract(c);
  const mutated = structuredClone(c);
  mutated.investigation.headline += ' ';
  assert.notEqual(await fingerprintContract(mutated), base);
});

test('a real contract verifies: all checks pass, verdict re-derived', async () => {
  const c = buildEulerContract(FIXED_AT);
  const res = await verifyContract(c);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.equal(res.checks.length, 4);
  assert.ok(res.checks.every((k) => k.ok));
  assert.match(res.fingerprint, /^[0-9a-f]{64}$/);
  // Euler is a fixture-cache case: honestly incomplete, and re-derived as such.
  assert.equal(res.recomputed.completeness, 'incomplete');
});

test('tampering with the verdict is caught', async () => {
  const c = structuredClone(buildEulerContract(FIXED_AT));
  c.completeness = 'complete'; // a fixture-cache case can never be complete
  const res = await verifyContract(c);
  assert.equal(res.ok, false);
  assert.equal(res.checks.find((k) => k.id === 'verdict')?.ok, false);
  assert.ok(res.errors.length > 0);
});

test('tampering with evidence counts is caught', async () => {
  const c = structuredClone(buildEulerContract(FIXED_AT));
  c.evidence.observedFacts += 1;
  const res = await verifyContract(c);
  assert.equal(res.ok, false);
  assert.equal(res.checks.find((k) => k.id === 'counts')?.ok, false);
});

test('an injected HYPOTHESIS is caught', async () => {
  const c = structuredClone(buildEulerContract(FIXED_AT));
  // @ts-expect-error — deliberately smuggling an interpretive claim into a FACT slot
  c.investigation.events[0].provenance = { kind: 'HYPOTHESIS', statement: 'guess', supportingEventIds: [], confidence: 'low' };
  const res = await verifyContract(c);
  assert.equal(res.ok, false);
  assert.equal(res.checks.find((k) => k.id === 'no-hypothesis')?.ok, false);
});
