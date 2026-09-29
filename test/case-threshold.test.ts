/**
 * TRACE — case-local value threshold (feedback #6).
 *
 * node:test + node:assert, zero deps. Proves the meaningful-value floor is
 * resolved by a fixed precedence — explicit per-run option > case-local default
 * > global $1M default — and that a case-authored floor is validated, never
 * carried unchecked into extraction.
 *
 * A single $500k transfer is the probe: below the $1M global default it is
 * retained-but-collapsed (primary:false); lower the case floor to $100k and the
 * same row is admitted as a primary value-threshold event; a per-run option then
 * overrides the case floor either way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTransfer, sourceMeta } from '../src/reconstruction/normalize.ts';
import type { SourceMeta } from '../src/reconstruction/normalized-types.ts';
import {
  reconstruct,
  DEFAULT_VALUE_THRESHOLD_USD,
  type CaseDescriptor,
  type EngineInput,
  type ReconstructionSubject,
  type ReconstructionResult,
} from '../src/reconstruction/engine.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';

const src = (source: Parameters<typeof sourceMeta>[0]): SourceMeta =>
  sourceMeta(source, { requestId: 'req_test', creditsCost: '1' }, '2026-09-21T00:00:00Z', 'test');

const SUBJECT: ReconstructionSubject = {
  address: '0xaaaa00000000000000000000000000000000000001',
  chain: 'ethereum',
};

const baseCase: CaseDescriptor = {
  id: 'case_threshold',
  name: 'Threshold probe',
  headline: 'Deterministic reconstruction of one observed sub-$1M transfer.',
  window: { from: '2023-03-13', to: '2023-03-31' },
};

/** One $500k transfer — below the $1M global default, above a $100k case floor. */
function halfMillionInput(): EngineInput {
  return {
    transfers: [
      normalizeTransfer(
        {
          block_timestamp: '2023-03-13T10:00:00Z',
          transaction_hash: '0xprobe',
          from_address: '0xaaaa00000000000000000000000000000000000001',
          to_address: '0xbbbb00000000000000000000000000000000000002',
          transfer_value_usd: 500_000,
        },
        src('tgm/transfers'),
      ),
    ],
  };
}

const primaryTransfers = (r: ReconstructionResult): number =>
  r.investigation.events.filter((e) => e.type === 'transfer' && e.primary).length;

const build = (caseDesc: CaseDescriptor, valueThresholdUsd?: number): ReconstructionResult =>
  reconstruct(halfMillionInput(), SUBJECT, caseDesc, {
    reconstructedAt: FIXED_AT,
    ...(valueThresholdUsd !== undefined ? { valueThresholdUsd } : {}),
  });

// ---------------------------------------------------------------------------

test('TH-DEFAULT: with no floor set, a $500k transfer stays below the $1M global default', () => {
  assert.equal(DEFAULT_VALUE_THRESHOLD_USD, 1_000_000);
  const r = build(baseCase);
  assert.equal(primaryTransfers(r), 0, 'nothing crosses the default floor');
});

test('TH-CASE-LOCAL: a case-local $100k floor admits the same transfer as primary', () => {
  const r = build({ ...baseCase, valueThresholdUsd: 100_000 });
  assert.equal(primaryTransfers(r), 1, 'the $500k row now clears the case floor');
  const ev = r.investigation.events.find((e) => e.type === 'transfer' && e.primary);
  assert.ok(ev, 'a primary transfer event exists');
  assert.equal(ev!.admissionRule, 'value-threshold', 'admitted by value, not a bespoke rule');
});

test('TH-PRECEDENCE-RAISE: an explicit per-run option overrides a lower case floor', () => {
  // Case floor would admit ($100k), but the per-run option raises it past $500k.
  const r = build({ ...baseCase, valueThresholdUsd: 100_000 }, 10_000_000);
  assert.equal(primaryTransfers(r), 0, 'the per-run option wins over the case default');
});

test('TH-PRECEDENCE-LOWER: an explicit per-run option can also lower past the case floor', () => {
  // Case floor would reject (stays at the $1M default), but the option lowers it.
  const r = build(baseCase, 100_000);
  assert.equal(primaryTransfers(r), 1, 'the per-run option admits below the case/global floor');
});

test('TH-VALIDATION: a malformed case-local floor fails loudly', () => {
  assert.throws(
    () => build({ ...baseCase, valueThresholdUsd: -5 }),
    /valueThresholdUsd/,
    'a negative case floor is rejected',
  );
  assert.throws(
    () => build({ ...baseCase, valueThresholdUsd: Number.NaN }),
    /valueThresholdUsd/,
    'a non-finite case floor is rejected',
  );
});

test('TH-DETERMINISM: same inputs + same floor → byte-identical reconstruction', () => {
  const a = JSON.stringify(build({ ...baseCase, valueThresholdUsd: 100_000 }).investigation);
  const b = JSON.stringify(build({ ...baseCase, valueThresholdUsd: 100_000 }).investigation);
  assert.equal(a, b);
});
