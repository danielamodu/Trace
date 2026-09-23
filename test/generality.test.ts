/**
 * TRACE — Generality proof (the pipeline is not Euler-specific).
 *
 * The engine, normalization, contract assembly, and service must work for any
 * incident, not just Euler. This suite reconstructs a SECOND, structurally
 * different, entirely synthetic incident (different chain, addresses, tokens,
 * and shape) through the exact production path — normalize → reconstruct →
 * buildContract → service — and hosts it alongside the real Euler case.
 *
 * The synthetic case is TEST-ONLY. It is never added to CASE_REGISTRY and never
 * served: it carries no real evidence, so shipping it would violate the
 * observed-evidence-only rule. Its sole purpose is to prove the pipeline is
 * case-agnostic. Determinism and the no-HYPOTHESIS / descriptive-roles-only
 * guarantees are re-asserted here on non-Euler data.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCounterparty,
  normalizeRelationship,
  normalizeTransfer,
  sourceMeta,
} from '../src/reconstruction/normalize.ts';
import { normalizeTransaction } from '../src/reconstruction/transaction.ts';
import type { SourceMeta } from '../src/reconstruction/normalized-types.ts';
import type {
  CaseDescriptor,
  EngineInput,
  ReconstructionSubject,
} from '../src/reconstruction/engine.ts';
import { reconstructContract } from '../src/contract/assemble.ts';
import { UnknownCaseError, createContractService } from '../src/contract/service.ts';
import type { CoverageReport } from '../src/contract/types.ts';
import {
  CASE_REGISTRY,
  EULER_CASE_ID,
  buildEulerContract,
  buildTraceService,
} from '../src/investigations/index.ts';

const FIXED_AT = '2026-09-21T00:00:00.000Z';

// A deliberately non-Euler incident: different chain, fresh addresses/tokens.
const SUBJECT_ADDR = '0x1111111111111111111111111111111111111111';
const FUNDER_ADDR = '0x2222222222222222222222222222222222222222';
const CP_ADDR = '0x3333333333333333333333333333333333333333';
const POOL_ADDR = '0x4444444444444444444444444444444444444444';
const USDC = '0x5555555555555555555555555555555555555555';
const CASE_ID = 'case_synthetic_bridge';

const src = (source: Parameters<typeof sourceMeta>[0]): SourceMeta =>
  sourceMeta(source, { requestId: 'req_gen', creditsCost: '0' }, '2024-01-01T00:00:00Z', 'test/synthetic');

const SUBJECT: ReconstructionSubject = { address: SUBJECT_ADDR, chain: 'arbitrum' };
const CASE: CaseDescriptor = {
  id: CASE_ID,
  name: 'Synthetic bridge-drain (generality fixture)',
  headline: 'Constructed non-Euler reconstruction used only to prove the engine is not Euler-specific.',
  window: { from: '2024-01-01', to: '2024-01-02' },
};

/** A second incident with a different shape than Euler, built via real normalizers. */
function syntheticInput(): EngineInput {
  return {
    relationships: [
      normalizeRelationship(
        { address: FUNDER_ADDR, address_label: 'test-funder.eth', relation: 'First Funder', transaction_hash: '0xf0000001', block_timestamp: '2024-01-01T00:00:00Z', order: 1, chain: 'arbitrum' },
        src('profiler/address/related-wallets'),
      ),
    ],
    transactions: [
      normalizeTransaction(
        { block_timestamp: '2024-01-01T01:00:00Z', transaction_hash: '0xf0000002', chain: 'arbitrum', method: 'flashLoan(address[],uint256[])', source_type: 'contract', volume_usd: 25_000_000, tokens_received: [{ token_symbol: 'USDC', token_amount: 25_000_000, token_address: USDC, from_address: POOL_ADDR, to_address: SUBJECT_ADDR }] },
        src('profiler/address/transactions'),
      ),
    ],
    transfers: [
      normalizeTransfer(
        { block_timestamp: '2024-01-01T02:00:00Z', transaction_hash: '0xf0000003', from_address: SUBJECT_ADDR, to_address: CP_ADDR, transfer_value_usd: 12_000_000, transaction_type: 'transfer' },
        src('tgm/transfers'),
      ),
    ],
    counterparties: [
      normalizeCounterparty(
        { counterparty_address: CP_ADDR, counterparty_address_label: ['test-mixer.eth'], interaction_count: 3, total_volume_usd: 12_000_000, volume_in_usd: 12_000_000, volume_out_usd: 0, tokens_info: [{ token_address: USDC, token_symbol: 'USDC', num_transfer: 3, total_token_amount: 12_000_000 }] },
        src('profiler/address/counterparties'),
      ),
    ],
  };
}

const COVERAGE: CoverageReport = {
  flags: { fundingEvidence: true, counterpartyAggregates: true, transactionWindowCovered: false },
  reasons: ['Synthetic generality fixture: constructed inputs, not live Nansen data; never served.'],
};

const buildSynthetic = () =>
  reconstructContract(syntheticInput(), SUBJECT, CASE, COVERAGE, 'fixture-cache', { reconstructedAt: FIXED_AT });

test('GEN1: a non-Euler synthetic incident reconstructs into a valid contract', () => {
  const c = buildSynthetic();
  assert.equal(c.caseId, CASE_ID);
  assert.equal(c.investigation.chain, 'arbitrum'); // subject chain propagates; nothing hardcoded to ethereum
  assert.equal(c.investigation.status, 'reconstructed');
  const primaries = c.investigation.events.filter((e) => e.primary);
  assert.ok(primaries.length >= 2, 'funding + method/value primaries present');
  const subject = c.investigation.entities.find((e) => e.address === SUBJECT_ADDR)!;
  assert.equal(subject.role, 'subject');
  assert.ok(c.investigation.entities.some((e) => e.address === FUNDER_ADDR && e.role === 'funder'), 'funder admitted');
  assert.ok(c.investigation.entities.some((e) => e.address === CP_ADDR && e.role === 'counterparty'), 'counterparty admitted');
  // No Euler value leaked through a supposedly generic path.
  const json = JSON.stringify(c);
  assert.ok(!json.includes('0xb66cd966670d962c227b3eaba30a872dbfb995db'), 'no Euler attacker leak');
  assert.ok(!json.includes('case_euler'), 'no Euler case id leak');
});

test('GEN2: synthetic reconstruction is deterministic and free of HYPOTHESIS / loaded roles', () => {
  const a = JSON.stringify(buildSynthetic());
  const b = JSON.stringify(buildSynthetic());
  assert.equal(a, b, 'byte-identical rebuild on non-Euler data');
  assert.ok(!a.includes('"HYPOTHESIS"'), 'no HYPOTHESIS records');
  const c = buildSynthetic();
  for (const ent of c.investigation.entities) {
    assert.ok(['subject', 'funder', 'counterparty'].includes(ent.role), `entity role ${ent.role} is descriptive-only`);
  }
  // fixture-cache is structurally incomplete by rule — for any case, not just Euler.
  assert.equal(c.completeness, 'incomplete');
});

test('GEN3: the service hosts Euler and a second case together', () => {
  const svc = createContractService([buildEulerContract(FIXED_AT), buildSynthetic()], [EULER_CASE_ID, CASE_ID]);
  assert.deepEqual([...svc.caseIds], [CASE_ID, EULER_CASE_ID].sort());
  assert.equal(svc.listCases().length, 2);
  assert.equal(svc.getContract(CASE_ID).caseId, CASE_ID);
  assert.equal(svc.getContract(EULER_CASE_ID).caseId, EULER_CASE_ID);
  assert.ok(svc.hasCase(CASE_ID) && svc.hasCase(EULER_CASE_ID));
  assert.throws(() => svc.getContract('case_unknown'), (e: unknown) => e instanceof UnknownCaseError);
});

test('GEN4: buildTraceService serves exactly the registered cases, Euler byte-for-byte', () => {
  const svc = buildTraceService(FIXED_AT);
  const availableIds = CASE_REGISTRY.filter((c) => c.available).map((c) => c.id);
  assert.deepEqual([...svc.caseIds], [...CASE_REGISTRY].map((c) => c.id).sort());
  for (const s of svc.listCases()) {
    assert.equal(s.available, availableIds.includes(s.caseId));
  }
  // The registry seam did not alter the served Euler contract.
  assert.equal(JSON.stringify(svc.getContract(EULER_CASE_ID)), JSON.stringify(buildEulerContract(FIXED_AT)));
  // Euler is the only *available* case today — the honesty guard against a shipped fake.
  assert.deepEqual(availableIds, [EULER_CASE_ID]);
});
