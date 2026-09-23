import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSaveCase } from '../src/investigations/save-route.ts';
import {
  loadSavedContracts,
  saveContract,
  CASE_ID_RE,
} from '../src/investigations/saved-cases.ts';
import { buildTraceService } from '../src/investigations/registry.ts';
import { buildEulerContract } from '../src/investigations/euler.ts';
import { reconstructFromAddress } from '../src/investigations/live.ts';
import type { NansenLike } from '../src/investigations/live.ts';
import type { InvestigationContract } from '../src/contract/types.ts';
import type { CallMeta } from '../src/nansen/types.ts';

/**
 * TRACE — save-as-case (/api/cases route logic + local store).
 *
 * Exercises runSaveCase and the saved-cases store with a temp directory and an
 * injected client: a real live-nansen contract saves and reloads as a library
 * case, built-ins can't be shadowed, and invalid / unsafe payloads are refused
 * without ever touching the real store, the network, or a single credit.
 */

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const WINDOW = { from: '2022-11-11', to: '2022-11-30' };
const AT = '2026-09-23T00:00:00.000Z';
const HASH = (n: string) => '0x' + n.repeat(64).slice(0, 64);
const CP = '0x' + 'aa'.repeat(20);
const FUNDER = '0x' + 'bb'.repeat(20);
const TOKEN = '0x' + 'dd'.repeat(20);

function meta(over: Partial<CallMeta> = {}): CallMeta {
  return { status: 200, requestId: 'req', creditsCost: '1', creditsUsed: null, creditsRemaining: '100', rateLimitRemaining: null, retryAfter: null, ...over };
}
const cpRow = () => ({ counterparty_address: CP, counterparty_address_label: ['1inch: Router'], interaction_count: 42, total_volume_usd: 12_000_000, volume_in_usd: 12_000_000, volume_out_usd: 0, tokens_info: [{ token_address: TOKEN, token_symbol: 'USDC', token_name: 'USD Coin', num_transfer: 5, total_token_amount: 12_000_000 }] });
const relRow = () => ({ address: FUNDER, address_label: 'Token Millionaire', relation: 'First Funder', transaction_hash: HASH('a'), block_timestamp: '2022-11-10T00:00:00', order: 1, chain: 'ethereum' });
const txRow = () => ({ chain: 'ethereum', method: 'received', source_type: 'transfer', volume_usd: 5_000_000, block_timestamp: '2022-11-12T08:13:47', transaction_hash: HASH('1'), tokens_sent: [], tokens_received: [{ token_symbol: 'USDC', token_amount: 5_000_000, token_address: TOKEN, from_address: CP, to_address: ADDR }] });
const paged = (rows: unknown[], isLast: boolean, page: number) => ({ data: rows, pagination: { page, per_page: 100, is_last_page: isLast } });

function scriptedClient(): NansenLike {
  return {
    async post(path: string) {
      if (path.includes('counterparties')) return { data: paged([cpRow()], true, 1), meta: meta({ creditsCost: '5' }) };
      if (path.includes('related-wallets')) return { data: paged([relRow()], true, 1), meta: meta({ creditsCost: '1' }) };
      return { data: paged([txRow()], true, 1), meta: meta({ creditsCost: '1' }) };
    },
  } as unknown as NansenLike;
}

async function liveContract(): Promise<InvestigationContract> {
  const { contract } = await reconstructFromAddress({
    address: ADDR, window: WINDOW, chain: 'ethereum', client: scriptedClient(), reconstructedAt: AT,
  });
  return contract;
}
const tmp = () => mkdtempSync(join(tmpdir(), 'trace-cases-'));

test('SAVE1: a valid live contract saves (201) and reloads as a complete library case', async () => {
  const dir = tmp();
  const contract = await liveContract();
  let resets = 0;
  const { status, body } = runSaveCase({ contract }, { dir, afterSave: () => { resets += 1; } });
  assert.equal(status, 201);
  const b = body as { caseId: string; url: string };
  assert.equal(b.caseId, contract.caseId);
  assert.equal(b.url, `/cases/${contract.caseId}`);
  assert.equal(resets, 1, 'afterSave must fire exactly once');
  assert.ok(existsSync(join(dir, `${contract.caseId}.json`)), 'the contract file must exist on disk');

  const loaded = loadSavedContracts(dir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].caseId, contract.caseId);
  assert.equal(loaded[0].completeness, 'complete');
  assert.equal(loaded[0].dataSource, 'live-nansen');
});

test('SAVE2: a saved case is listed and retrievable from the registry service alongside the built-ins', async () => {
  const dir = tmp();
  const contract = await liveContract();
  saveContract(contract, dir);
  const svc = buildTraceService(AT, dir);
  assert.ok(svc.hasCase(contract.caseId));
  assert.ok(svc.listCases().some((c) => c.caseId === contract.caseId));
  assert.equal(svc.getContract(contract.caseId).completeness, 'complete');
  assert.ok(svc.hasCase('case_euler_2023'));
  assert.ok(svc.hasCase('case_ftx_2022'));
});

test('SAVE3: refusing to overwrite a built-in case → 409, nothing written', () => {
  const dir = tmp();
  const { status, body } = runSaveCase({ contract: buildEulerContract(AT) }, { dir });
  assert.equal(status, 409);
  assert.match((body as { error: string }).error, /built-in/);
  assert.ok(!existsSync(join(dir, 'case_euler_2023.json')));
});

test('SAVE4: a non-contract body → 400 without writing', () => {
  const { status, body } = runSaveCase({ contract: { nope: true } }, { dir: tmp() });
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /invalid contract/);
});

test('SAVE5: a filesystem-unsafe caseId is rejected → 400', async () => {
  const dir = tmp();
  const evil = JSON.parse(JSON.stringify(await liveContract())) as {
    caseId: string; investigation: { id: string };
  };
  evil.caseId = '../evil';
  evil.investigation.id = '../evil'; // keep caseId === investigation.id so validation passes
  const { status, body } = runSaveCase({ contract: evil }, { dir });
  assert.equal(status, 400);
  assert.match((body as { error: string }).error, /filesystem-safe/);
  assert.ok(!existsSync(join(dir, '..', 'evil.json')), 'a traversal id must not escape the store');
});

test('SAVE6: CASE_ID_RE accepts real ids and rejects traversal / unsafe chars', () => {
  assert.ok(CASE_ID_RE.test('live_1234abcd_2022-11-11'));
  assert.ok(CASE_ID_RE.test('case_euler_2023'));
  assert.ok(!CASE_ID_RE.test('../evil'));
  assert.ok(!CASE_ID_RE.test('a/b'));
  assert.ok(!CASE_ID_RE.test('has.dot'));
  assert.ok(!CASE_ID_RE.test('UPPER'));
});
