/**
 * TRACE — Open-lead ("hypotheses") channel tests.
 *
 * node:test + node:assert, zero deps. Proves the walled-off leads channel is
 * honest and deterministic: it fires only when the evidence supports it, the
 * leads carry NO provenance and NO `kind` field (so the contract's HYPOTHESIS
 * ban is untouched), every supporting event resolves, and the validator rejects
 * malformed leads. Grounded against the two real fixture cases.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildEulerContract, buildFtxContract } from '../src/investigations/index.ts';
import {
  deriveHypotheses,
  EXIT_KEYWORDS,
  DEX_PROTOCOL_KEYWORDS,
  MAX_HYPOTHESES,
} from '../src/contract/hypotheses.ts';
import { validateContract } from '../src/contract/index.ts';

const FTX_AT = '2026-09-23T00:00:00.000Z';
const EULER_AT = '2026-09-21T00:00:00.000Z';

const clone = <T>(v: T): T => structuredClone(v);

// ---------------------------------------------------------------------------
// Firing: honest, grounded, deterministic
// ---------------------------------------------------------------------------

test('H-FTX: the backbone rule fires one low-confidence onward-movement lead', () => {
  const c = buildFtxContract(FTX_AT);
  const leads = c.investigation.hypotheses;
  assert.ok(Array.isArray(leads) && leads.length >= 1, 'FTX surfaces at least one lead');

  const eventIds = new Set(c.investigation.events.map((e) => e.id));
  for (const h of leads!) {
    assert.match(h.id, /^hyp_\d+$/, 'well-formed id');
    assert.ok(['low', 'medium'].includes(h.confidence), 'confidence is capped');
    assert.ok(h.statement.length > 0 && h.basis.length > 0 && h.whatWouldConfirm.length > 0);
    assert.ok(h.supportingEventIds.length >= 1, 'each lead cites ≥1 supporting event');
    for (const id of h.supportingEventIds) assert.ok(eventIds.has(id), `${id} resolves to a real event`);
    // Locked design: leads are possibilities, not claims — never a kind field.
    assert.ok(!('kind' in h), 'lead carries no kind field');
  }

  // The flagship lead: $1.75M into an unnamed wallet where the walk dead-ends.
  const onward = leads!.find((h) => h.confidence === 'low');
  assert.ok(onward, 'a low-confidence onward-movement lead exists');
  assert.ok(onward!.supportingEventIds.includes('event_208'), 'anchored to the dead-end transfer');
});

test('H-EULER: a cleanly-resolved trail produces no leads (never fabricated)', () => {
  const c = buildEulerContract(EULER_AT);
  // Euler's high-value flow reaches named entities / returns; no honest onward
  // lead exists, so the channel is simply absent — not forced.
  assert.equal(c.investigation.hypotheses, undefined);
});

test('H-DETERMINISM: leads are byte-identical across rebuilds', () => {
  const a = JSON.stringify(deriveHypotheses(buildFtxContract(FTX_AT).investigation));
  const b = JSON.stringify(deriveHypotheses(buildFtxContract(FTX_AT).investigation));
  assert.equal(a, b);
});

test('H-CAP: derived leads never exceed the cap and ids are sequential', () => {
  const leads = deriveHypotheses(buildFtxContract(FTX_AT).investigation);
  assert.ok(leads.length <= MAX_HYPOTHESES);
  leads.forEach((h, i) => assert.equal(h.id, `hyp_${String(i + 1).padStart(3, '0')}`));
});

test('H-NOSTRING: no `"HYPOTHESIS"` token leaks into the served contract', () => {
  const json = JSON.stringify(buildFtxContract(FTX_AT));
  assert.ok(!json.includes('"HYPOTHESIS"'), 'the HYPOTHESIS provenance ban stands');
  assert.ok(json.includes('"hypotheses"'), 'leads ship under the lowercase channel key');
});

test('H-KEYWORDS: exit + veto keyword sets are lowercase and non-empty', () => {
  assert.ok(EXIT_KEYWORDS.length > 0 && DEX_PROTOCOL_KEYWORDS.length > 0);
  for (const k of [...EXIT_KEYWORDS, ...DEX_PROTOCOL_KEYWORDS]) {
    assert.equal(k, k.toLowerCase(), `keyword "${k}" is lowercase for case-insensitive match`);
  }
});

// ---------------------------------------------------------------------------
// Validation: malformed leads are rejected; a well-formed channel validates
// ---------------------------------------------------------------------------

test('H-VALID: the FTX contract with leads validates clean', () => {
  assert.deepEqual(validateContract(buildFtxContract(FTX_AT)), []);
});

test('H-VALID-NEG: malformed leads are caught with paths', () => {
  const base = buildFtxContract(FTX_AT);
  assert.ok(base.investigation.hypotheses && base.investigation.hypotheses.length >= 1);

  const dangling = clone(base);
  dangling.investigation.hypotheses![0].supportingEventIds = ['event_9999'];
  assert.match(validateContract(dangling).join(' | '), /supportingEventIds.*dangles/);

  const badConf = clone(base);
  (badConf.investigation.hypotheses![0] as { confidence: string }).confidence = 'high';
  assert.match(validateContract(badConf).join(' | '), /confidence must be low\|medium/);

  const badId = clone(base);
  badId.investigation.hypotheses![0].id = 'lead1';
  assert.match(validateContract(badId).join(' | '), /hyp_###/);

  const emptyStmt = clone(base);
  emptyStmt.investigation.hypotheses![0].statement = '';
  assert.match(validateContract(emptyStmt).join(' | '), /statement must be a non-empty string/);

  const noSupport = clone(base);
  noSupport.investigation.hypotheses![0].supportingEventIds = [];
  assert.match(validateContract(noSupport).join(' | '), /supportingEventIds must list at least one event/);

  const notArray = clone(base) as unknown as { investigation: { hypotheses: unknown } };
  notArray.investigation.hypotheses = 'nope';
  assert.match(validateContract(notArray).join(' | '), /hypotheses must be an array/);
});
