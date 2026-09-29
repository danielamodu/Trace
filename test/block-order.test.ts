/**
 * TRACE — item #5: true intra-block ordering (capability tests).
 *
 * node:test + node:assert, zero new dependencies. Proves that captured
 * (blockNumber, transactionIndex) positions — ordering metadata derived
 * out-of-band via public RPC, NOT Nansen evidence — refine the same-block
 * tie-break from an arbitrary txHash-lexicographic order to the real on-chain
 * sequence, WITHOUT altering any reconstruction that carries no positions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconstruct, EngineError } from '../src/reconstruction/engine.ts';
import type { CaseDescriptor, EngineInput, ReconstructionSubject } from '../src/reconstruction/engine.ts';
import { normalizeTransfer, normalizeBlockPosition, sourceMeta } from '../src/reconstruction/normalize.ts';
import type { BlockPositionCapture } from '../src/reconstruction/normalized-types.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';
const SUB = '0x5000000000000000000000000000000000000001';
const SUBJECT: ReconstructionSubject = { address: SUB, chain: 'ethereum' };
const CASE: CaseDescriptor = {
  id: 'case_test', name: 'Test', headline: 'Test.', window: { from: '2023-03-13', to: '2023-03-31' },
};
const CAPTURE: BlockPositionCapture = { rpc: 'ethereum-rpc.publicnode.com', method: 'eth_getTransactionReceipt', capturedAt: FIXED_AT };

// Two OUT transfers in the SAME block + timestamp, chosen so txHash-lexicographic
// order (…aaaa < …bbbb) is the REVERSE of the true on-chain order once positions
// are applied (…bbbb idx 10 before …aaaa idx 50).
const TX_A = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
const TX_B = '0xbbbb000000000000000000000000000000000000000000000000000000000002';
const src = sourceMeta('tgm/transfers', { requestId: 'r', creditsCost: '1' }, '2026-09-21T00:00:00Z', 'test');
const mk = (h: string, to: string) =>
  normalizeTransfer({ block_timestamp: '2023-03-13T10:00:00Z', transaction_hash: h, from_address: SUB, to_address: to, transfer_value_usd: 2_000_000 }, src);
const baseInput = (): EngineInput => ({
  transfers: [
    mk(TX_A, '0xdddd000000000000000000000000000000000000'),
    mk(TX_B, '0xeeee000000000000000000000000000000000000'),
  ],
});
const positions = [
  { txHash: TX_A, blockNumber: 100, transactionIndex: 50, capture: CAPTURE },
  { txHash: TX_B, blockNumber: 100, transactionIndex: 10, capture: CAPTURE },
];

const txOrder = (input: EngineInput): string[] =>
  reconstruct(input, SUBJECT, CASE, { reconstructedAt: FIXED_AT }).investigation.events
    .filter((e) => e.txHash !== undefined)
    .map((e) => e.txHash!.slice(0, 6));

test('BO-1: without positions, same-block events fall back to txHash-lexicographic order', () => {
  assert.deepEqual(txOrder(baseInput()), ['0xaaaa', '0xbbbb']);
});

test('BO-2: captured positions order same-block events by true transactionIndex', () => {
  const r = reconstruct({ ...baseInput(), blockPositions: positions }, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const transfers = r.investigation.events.filter((e) => e.txHash !== undefined);
  // …bbbb (idx 10) now precedes …aaaa (idx 50) — the reverse of txHash-lex.
  assert.deepEqual(transfers.map((e) => e.txHash!.slice(0, 6)), ['0xbbbb', '0xaaaa']);
  assert.deepEqual(transfers.map((e) => e.transactionIndex), [10, 50]);
  assert.deepEqual(transfers.map((e) => e.blockNumber), [100, 100]);
});

test('BO-3: empty/absent positions are byte-identical (behavior-preserving)', () => {
  const withUndef = reconstruct(baseInput(), SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  const withEmpty = reconstruct({ ...baseInput(), blockPositions: [] }, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.equal(JSON.stringify(withEmpty), JSON.stringify(withUndef));
});

test('BO-4: the ordering data-gap reflects how many positions were applied', () => {
  const without = reconstruct(baseInput(), SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.match(without.investigation.dataGaps[0], /Nansen rows carry no txIndex\/logIndex/);
  const withPos = reconstruct({ ...baseInput(), blockPositions: positions }, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.match(withPos.investigation.dataGaps[0], /true \(blockNumber, transactionIndex\).*for 2 event\(s\)/);
});

test('BO-5: malformed positions fail loudly (EngineError), never silently dropped', () => {
  const run = (bad: unknown) =>
    reconstruct({ ...baseInput(), blockPositions: bad as never }, SUBJECT, CASE, { reconstructedAt: FIXED_AT });
  assert.throws(() => run([{ txHash: 'not-hex', blockNumber: 1, transactionIndex: 0, capture: CAPTURE }]), EngineError);
  assert.throws(() => run([{ txHash: TX_A, blockNumber: 1, transactionIndex: -1, capture: CAPTURE }]), EngineError);
  assert.throws(() => run([{ txHash: TX_A, blockNumber: 1.5, transactionIndex: 0, capture: CAPTURE }]), EngineError);
  assert.throws(() => run({ not: 'an array' }), EngineError);
});

test('BO-6: normalizeBlockPosition accepts hex + decimal + key variants, lowercases txHash', () => {
  // Raw eth_getTransactionReceipt shape: transactionHash + hex quantities.
  const hex = normalizeBlockPosition({ transactionHash: '0xAbC1', blockNumber: '0x10', transactionIndex: '0x2' }, CAPTURE);
  assert.deepEqual(hex, { txHash: '0xabc1', blockNumber: 16, transactionIndex: 2, capture: CAPTURE });
  // Capture-script shape: snake_case + decimals.
  const dec = normalizeBlockPosition({ transaction_hash: '0xFF', block_number: 5, transaction_index: 3 }, CAPTURE);
  assert.deepEqual(dec, { txHash: '0xff', blockNumber: 5, transactionIndex: 3, capture: CAPTURE });
  assert.throws(() => normalizeBlockPosition({ txHash: 'nope', blockNumber: 1, transactionIndex: 0 }, CAPTURE));
  assert.throws(() => normalizeBlockPosition({ txHash: TX_A, transactionIndex: 0 }, CAPTURE));
  assert.throws(() => normalizeBlockPosition('not-an-object', CAPTURE));
});
