import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBlockPositions } from '../src/investigations/blockorder-rpc.ts';

/**
 * TRACE — block-order capture resilience (item #5, hardening).
 *
 * The capture talks to a FREE public JSON-RPC, so a batch can transiently 500 or
 * time out. These tests stub `fetch` (no network, no key) to prove the capture is
 * partial-not-all-or-nothing: a failing batch surfaces its hashes as `unresolved`
 * and the rest still resolve, the call NEVER throws, and the output is
 * deterministic. That resilience is exactly what a many-hundred-tx case needs.
 */

const H = (n: number) => '0x' + n.toString(16).padStart(64, '0');
const hx = (n: number) => '0x' + n.toString(16);

interface RpcReq { id: number; params: [string] }
type Behavior = (hashesInBatch: string[]) => { ok: boolean; body: unknown } ;

function stubFetch(behavior: Behavior) {
  const original = globalThis.fetch;
  const calls: string[][] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const reqs = JSON.parse(init.body) as RpcReq[];
    const hashes = reqs.map((r) => r.params[0]);
    calls.push(hashes);
    const { ok, body } = behavior(hashes);
    return {
      ok,
      status: ok ? 200 : 503,
      statusText: ok ? 'OK' : 'Service Unavailable',
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** A well-formed receipt array answering every hash with a distinct block/index. */
const answerAll = (hashes: string[], blockOf: (h: string) => number) =>
  hashes.map((h, i) => ({ id: i, result: { blockNumber: hx(blockOf(h)), transactionIndex: hx(i) } }));

test('capture resolves every hash and sorts by (block, txIndex)', async () => {
  const hashes = [H(3), H(1), H(2)];
  const block: Record<string, number> = { [H(1)]: 100, [H(2)]: 100, [H(3)]: 99 };
  const { restore } = stubFetch((hs) => ({ ok: true, body: hs.map((h, i) => ({ id: i, result: { blockNumber: hx(block[h]), transactionIndex: hx(h === H(2) ? 5 : 1) } })) }));
  try {
    const cap = await captureBlockPositions(hashes, { rpcUrl: 'https://rpc.test' });
    assert.equal(cap.unresolved.length, 0);
    assert.equal(cap.endpoint, 'rpc.test');
    // sorted: block 99 first, then block 100 ordered by txIndex (1 before 5)
    assert.deepEqual(cap.positions.map((p) => p.txHash), [H(3), H(1), H(2)]);
  } finally { restore(); }
});

test('a batch that keeps failing surfaces its hashes as unresolved — never throws, rest still resolve', async () => {
  // 21 hashes → batch1 = 20, batch2 = 1. Fail every batch that contains H(999).
  const hashes = [...Array.from({ length: 20 }, (_, i) => H(i + 1)), H(999)];
  const { calls, restore } = stubFetch((hs) =>
    hs.includes(H(999))
      ? { ok: false, body: {} }
      : { ok: true, body: answerAll(hs, () => 100) },
  );
  try {
    const cap = await captureBlockPositions(hashes, { rpcUrl: 'https://rpc.test' });
    assert.equal(cap.positions.length, 20, 'the healthy batch still resolves');
    assert.deepEqual(cap.unresolved, [H(999)], 'the failing batch is surfaced, not fatal');
    // batch2 was retried MAX_ATTEMPTS(3) times; batch1 once → 4 calls total.
    assert.equal(calls.length, 4);
  } finally { restore(); }
});

test('a per-hash RPC error or null result marks just that hash unresolved, not the batch', async () => {
  const hashes = [H(1), H(2), H(3)];
  const { calls, restore } = stubFetch((hs) => ({
    ok: true,
    body: hs.map((h, i) =>
      h === H(2) ? { id: i, error: { message: 'not found' } }
      : h === H(3) ? { id: i, result: null }
      : { id: i, result: { blockNumber: hx(50), transactionIndex: hx(0) } }),
  }));
  try {
    const cap = await captureBlockPositions(hashes, { rpcUrl: 'https://rpc.test' });
    assert.deepEqual(cap.positions.map((p) => p.txHash), [H(1)]);
    assert.deepEqual(cap.unresolved, [H(2), H(3)].sort());
    assert.equal(calls.length, 1, 'a per-hash error does not trigger a batch retry');
  } finally { restore(); }
});

test('a resolved receipt with malformed hex is treated as unresolved', async () => {
  const hashes = [H(1), H(2)];
  const { restore } = stubFetch((hs) => ({
    ok: true,
    body: hs.map((h, i) =>
      h === H(2) ? { id: i, result: { blockNumber: 'not-hex', transactionIndex: hx(1) } }
      : { id: i, result: { blockNumber: hx(10), transactionIndex: hx(0) } }),
  }));
  try {
    const cap = await captureBlockPositions(hashes, { rpcUrl: 'https://rpc.test' });
    assert.deepEqual(cap.positions.map((p) => p.txHash), [H(1)]);
    assert.deepEqual(cap.unresolved, [H(2)]);
  } finally { restore(); }
});
