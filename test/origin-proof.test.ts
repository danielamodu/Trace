import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructFromAddress, type NansenLike } from '../src/investigations/live.ts';
import { buildEulerContract, buildFtxContract } from '../src/investigations/index.ts';
import { validateContract } from '../src/contract/validate.ts';
import { fingerprintContract, verifyContract } from '../src/contract/verify.ts';
import type { InvestigationContract } from '../src/contract/types.ts';
import type { CallMeta } from '../src/nansen/types.ts';

/**
 * TRACE — item #3: hybrid origin-proof.
 *
 * A contract records HOW its evidence was obtained. A live run carries a
 * `live-http` attestation with one receipt per response (path, status, request
 * id, credit headers, and a SHA-256 of the raw body); a fixture-cache build
 * carries `no-live-http` with an empty receipt set. The attestation is folded
 * into the contract before fingerprinting, so it is tamper-evident. It is
 * optional + additive, so pre-#3 artifacts still validate. Every test injects a
 * scripted client: no key, no network, no credits.
 *
 * ORIGIN1  a live run → live-http, one receipt per call, capturedAt pinned to
 *          reconstructedAt, response hash carried through, contract valid.
 * ORIGIN2  the attestation is fingerprint-covered: editing a receipt changes the
 *          fingerprint (tamper-evidence).
 * ORIGIN3  fixture cases → no-live-http, empty receipts, capturedAt = the case's
 *          reconstructedAt, and they still verify green.
 * ORIGIN4  validation rejects an origin whose mode/receipts are inconsistent.
 * ORIGIN5  a contract with NO origin still validates; the origin check reports
 *          nothing to re-check (backward compatibility).
 */

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const WINDOW = { from: '2022-11-11', to: '2022-11-30' };
const AT = '2026-09-23T00:00:00.000Z';
const HASH = (n: string) => '0x' + n.repeat(64).slice(0, 64);
const CP = '0x' + 'aa'.repeat(20);
const FUNDER = '0x' + 'bb'.repeat(20);
const TOKEN = '0x' + 'dd'.repeat(20);
const RESP_SHA = 'ab'.repeat(32); // 64-hex, a plausible response digest

function meta(over: Partial<CallMeta> = {}): CallMeta {
  return {
    status: 200,
    requestId: 'req_test',
    creditsCost: '1',
    creditsUsed: null,
    creditsRemaining: '100',
    rateLimitRemaining: null,
    retryAfter: null,
    responseSha256: null,
    ...over,
  };
}
const cpRow = () => ({ counterparty_address: CP, counterparty_address_label: ['1inch: Router'], interaction_count: 42, total_volume_usd: 12_000_000, volume_in_usd: 12_000_000, volume_out_usd: 0, tokens_info: [{ token_address: TOKEN, token_symbol: 'USDC', token_name: 'USD Coin', num_transfer: 5, total_token_amount: 12_000_000 }] });
const relRow = () => ({ address: FUNDER, address_label: 'Token Millionaire', relation: 'First Funder', transaction_hash: HASH('a'), block_timestamp: '2022-11-10T00:00:00', order: 1, chain: 'ethereum' });
const txRow = () => ({ chain: 'ethereum', method: 'received', source_type: 'transfer', volume_usd: 5_000_000, block_timestamp: '2022-11-12T08:13:47', transaction_hash: HASH('1'), tokens_sent: [], tokens_received: [{ token_symbol: 'USDC', token_amount: 5_000_000, token_address: TOKEN, from_address: CP, to_address: ADDR }] });

const paged = (rows: unknown[], isLast: boolean, page: number) => ({ data: rows, pagination: { page, per_page: 100, is_last_page: isLast } });

/** A scripted client that stamps a response digest on the transaction call. */
function scriptedClient(): NansenLike {
  return {
    async post(path: string) {
      if (path.includes('counterparties')) return { data: paged([cpRow()], true, 1), meta: meta({ creditsCost: '5' }) };
      if (path.includes('related-wallets')) return { data: paged([relRow()], true, 1), meta: meta({ creditsCost: '1' }) };
      return { data: paged([txRow()], true, 1), meta: meta({ creditsCost: '1', responseSha256: RESP_SHA }) };
    },
  } as unknown as NansenLike;
}

test('ORIGIN1: a live run carries a live-http attestation, one receipt per call', async () => {
  const { contract, meta: run } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client: scriptedClient(), reconstructedAt: AT,
  });

  assert.equal(contract.dataSource, 'live-nansen');
  assert.ok(contract.origin, 'a live contract has an origin attestation');
  assert.equal(contract.origin?.mode, 'live-http');
  assert.equal(contract.origin?.capturedAt, AT, 'capturedAt is pinned to reconstructedAt');
  // one receipt per recorded call, in call order.
  assert.equal(contract.origin?.receipts.length, run.calls.length);
  assert.deepEqual(
    contract.origin?.receipts.map((r) => r.path),
    run.calls.map((c) => c.endpoint),
  );
  // the transaction call's response digest flows through to its receipt.
  const txReceipt = contract.origin?.receipts.find((r) => r.path.includes('transactions'));
  assert.equal(txReceipt?.responseSha256, RESP_SHA);
  assert.equal(txReceipt?.status, 200);
  assert.equal(txReceipt?.requestId, 'req_test');
  // the whole contract still validates + verifies green (origin check passes).
  assert.deepEqual(validateContract(contract), []);
  const res = await verifyContract(contract);
  assert.equal(res.ok, true);
  assert.equal(res.checks.find((k) => k.id === 'origin')?.ok, true);

  // deterministic given inputs + reconstructedAt (attestation included).
  const again = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client: scriptedClient(), reconstructedAt: AT,
  });
  assert.equal(JSON.stringify(contract), JSON.stringify(again.contract));
});

test('ORIGIN2: the attestation is fingerprint-covered (tamper-evident)', async () => {
  const { contract } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, client: scriptedClient(), reconstructedAt: AT,
  });
  const base = await fingerprintContract(contract);

  // Editing a receipt's response hash changes the fingerprint.
  const mutated = structuredClone(contract) as InvestigationContract;
  mutated.origin!.receipts[0].responseSha256 = 'ff'.repeat(32);
  assert.notEqual(await fingerprintContract(mutated), base);

  // Adding a phantom receipt changes it too.
  const mutated2 = structuredClone(contract) as InvestigationContract;
  mutated2.origin!.receipts.push({
    path: '/api/v1/profiler/address/labels', status: 200, requestId: 'req_x',
    creditsCost: '1', creditsRemaining: '99', responseSha256: 'cc'.repeat(32),
  });
  assert.notEqual(await fingerprintContract(mutated2), base);
});

test('ORIGIN3: fixture cases carry a no-live-http attestation and verify green', async () => {
  for (const build of [buildEulerContract, buildFtxContract]) {
    const c = build(AT);
    assert.equal(c.dataSource, 'fixture-cache');
    assert.equal(c.origin?.mode, 'no-live-http');
    assert.deepEqual(c.origin?.receipts, []);
    assert.equal(c.origin?.capturedAt, c.investigation.reconstructedAt);
    assert.equal(c.origin?.capturedAt, AT);
    assert.ok((c.origin?.note ?? '').length > 0, 'no-live-http carries an explanatory note');
    assert.deepEqual(validateContract(c), []);
    const res = await verifyContract(c);
    assert.equal(res.ok, true);
    assert.equal(res.checks.find((k) => k.id === 'origin')?.ok, true);
  }
});

test('ORIGIN4: validation rejects an inconsistent origin', async () => {
  const live = (await reconstructFromAddress({
    address: ADDR, window: WINDOW, client: scriptedClient(), reconstructedAt: AT,
  })).contract;
  const euler = buildEulerContract(AT);

  // live-nansen must be live-http.
  const a = structuredClone(live) as InvestigationContract;
  a.origin!.mode = 'no-live-http';
  a.origin!.receipts = [];
  assert.ok(validateContract(a).some((e) => e.includes("contradicts dataSource 'live-nansen'")));

  // fixture-cache must be no-live-http.
  const b = structuredClone(euler) as InvestigationContract;
  b.origin!.mode = 'live-http';
  assert.ok(validateContract(b).some((e) => e.includes("contradicts dataSource 'fixture-cache'")));

  // no-live-http must carry no receipts.
  const c = structuredClone(euler) as InvestigationContract;
  c.origin!.receipts = [{ path: '/x', status: 200, requestId: null, creditsCost: null, creditsRemaining: null, responseSha256: null }];
  assert.ok(validateContract(c).some((e) => e.includes('must be empty when origin.mode is no-live-http')));

  // bad mode.
  const d = structuredClone(euler) as unknown as { origin: { mode: string } };
  d.origin.mode = 'nope';
  assert.ok(validateContract(d).some((e) => e.includes('origin.mode must be live-http|no-live-http')));

  // bad capturedAt.
  const e = structuredClone(euler) as unknown as { origin: { capturedAt: string } };
  e.origin.capturedAt = 'not-a-date';
  assert.ok(validateContract(e).some((x) => x.includes('origin.capturedAt must be ISO-8601')));

  // malformed receipt on a live contract.
  const f = structuredClone(live) as unknown as { origin: { receipts: unknown[] } };
  f.origin.receipts = [{ path: 42, status: 'ok' }];
  const fErr = validateContract(f);
  assert.ok(fErr.some((x) => x.includes('origin.receipts[0].path is required')));
  assert.ok(fErr.some((x) => x.includes('origin.receipts[0].status must be a number')));
});

test('ORIGIN5: a contract with no origin still validates (backward compatibility)', async () => {
  const euler = buildEulerContract(AT);
  const legacy = structuredClone(euler) as InvestigationContract;
  delete legacy.origin;
  assert.equal(legacy.origin, undefined);
  assert.deepEqual(validateContract(legacy), []);
  const res = await verifyContract(legacy);
  assert.equal(res.ok, true);
  const originCheck = res.checks.find((k) => k.id === 'origin');
  assert.equal(originCheck?.ok, true);
  assert.match(originCheck?.detail ?? '', /nothing to re-check/i);
});
