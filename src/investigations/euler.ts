/**
 * TRACE — Euler case assembly (Phase 3C).
 *
 * Binds the canonical Euler incident metadata to the deterministic engine and
 * the fixture cache: loads the discovery fixtures, normalizes them, runs the
 * Phase 3B reconstruction, and wraps the result in the application-facing
 * contract. Fixture-first: no live Nansen calls, no secrets, no network.
 *
 * Honesty rules for this case (enforced by the coverage report, which the
 * contract's completeness rule consumes):
 *  - The transaction sample is latest-first dust ($0.01–$1.74 rows); exploit-day
 *    rows require pagination/live capture → transactionWindowCovered: false.
 *  - The contract is therefore fixture-based AND incomplete, with reasons.
 *  - Counterparty aggregates are exposed as undirected window aggregates; no
 *    causal hop is inferred from them.
 */

import { readFileSync } from 'node:fs';
import {
  normalizeCounterparty,
  normalizeRelationship,
  sourceMeta,
} from '../reconstruction/normalize.ts';
import type { EngineInput } from '../reconstruction/engine.ts';
import { reconstruct } from '../reconstruction/engine.ts';
import type { ReconstructionResult } from '../reconstruction/engine.ts';
import { normalizeTransaction } from '../reconstruction/transaction.ts';
import { buildContract } from '../contract/assemble.ts';
import { createContractService } from '../contract/service.ts';
import type { ContractService } from '../contract/service.ts';
import type { CoverageReport, InvestigationContract } from '../contract/types.ts';
import type { IncidentDescriptor } from '../types/investigation.ts';

// --- canonical Euler metadata (fixture-validated, locked Phase 3A) -----------

export const EULER_CASE_ID = 'case_euler_2023';
export const EULER_NAME = 'Euler Finance exploit and fund return';
export const EULER_CHAIN = 'ethereum';
export const EULER_WINDOW = { from: '2023-03-13', to: '2023-03-31' } as const;
/**
 * Observational headline only: what TRACE observed and from where. Asserts no
 * causation, no attribution, no completeness.
 */
export const EULER_HEADLINE =
  'Observed on-chain movements around the Euler incident window (2023-03-13 → 2023-03-31), reconstructed from cached Nansen fixtures plus a live incident-day capture.';

export const EULER_ATTACKER = '0xb66cd966670d962c227b3eaba30a872dbfb995db';
export const EULER_FIRST_FUNDER = '0x036cec1a199234fc02f72d29e596a09440825f1c';
export const EULER_BALANCER_VAULT = '0xba12222222228d8ba445958a75a0704d566bf2c8';

const COUNTERPARTIES_FIXTURE = 'discovery/entity-euler-exploiter.json';
const ATTACKER_FIXTURE = 'discovery/0xb66cd966.json';
const LIVE_TRANSACTIONS_FIXTURE = 'live/euler/profiler-transactions-2023-03-13-p1.json';

function fixturesDir(): URL {
  // Built as a runtime expression (not a string literal) so bundlers leave it
  // alone instead of resolving it as a static asset. The resolved URL is
  // identical to '../../fixtures/' relative to this file; node:test covers it.
  const rel = ['..', '..', 'fixtures', ''].join('/');
  return new URL(rel, import.meta.url);
}

function readFixtureJson(rel: string): unknown {
  return JSON.parse(readFileSync(new URL(rel, fixturesDir()), 'utf8')) as unknown;
}

/** Load + normalize the Euler discovery fixtures into engine input. */
export function loadEulerInputs(): { input: EngineInput; files: string[] } {
  const counterpartiesFx = readFixtureJson(COUNTERPARTIES_FIXTURE) as Record<string, unknown>;
  const attackerFx = readFixtureJson(ATTACKER_FIXTURE) as Record<string, unknown>;
  if (!Array.isArray(counterpartiesFx.sample)) {
    throw new Error(`${COUNTERPARTIES_FIXTURE}: missing sample[]`);
  }
  const probes = attackerFx.probes as Record<string, Record<string, unknown>> | undefined;
  const txSample = probes?.transactions?.sample;
  const relSample = probes?.related_wallets?.sample;
  if (!Array.isArray(txSample) || !Array.isArray(relSample)) {
    throw new Error(`${ATTACKER_FIXTURE}: missing probes.transactions.sample[] / probes.related_wallets.sample[]`);
  }
  const cpMeta = counterpartiesFx.meta as { requestId?: string; creditsCost?: string } | undefined;
  const cpCaptured = counterpartiesFx.captured_at;
  const txMeta = probes?.transactions?.meta as { requestId?: string; creditsCost?: string } | undefined;
  const relMeta = probes?.related_wallets?.meta as { requestId?: string; creditsCost?: string } | undefined;
  const attackerCaptured = attackerFx.captured_at;
  if (typeof cpCaptured !== 'string' || typeof attackerCaptured !== 'string') {
    throw new Error('fixture captured_at timestamps are required');
  }
  // Phase 3G live incident-day capture: unioned with (never replacing) the
  // discovery sample. Missing file fails loudly — the served case requires it.
  const liveFx = readFixtureJson(LIVE_TRANSACTIONS_FIXTURE) as Record<string, unknown>;
  const liveRows = (liveFx as { response_body?: { data?: unknown } }).response_body?.data;
  const liveMeta = liveFx.response_meta as { requestId?: string; creditsCost?: string } | undefined;
  const liveCaptured = liveFx.captured_at;
  if (!Array.isArray(liveRows) || typeof liveCaptured !== 'string') {
    throw new Error(`${LIVE_TRANSACTIONS_FIXTURE}: missing response_body.data[] / captured_at`);
  }
  const liveSource = sourceMeta(
    'profiler/address/transactions', liveMeta ?? null, liveCaptured, LIVE_TRANSACTIONS_FIXTURE,
  );
  const input: EngineInput = {
    counterparties: (counterpartiesFx.sample as unknown[]).map((r) =>
      normalizeCounterparty(
        r,
        sourceMeta('profiler/address/counterparties', cpMeta ?? null, cpCaptured, COUNTERPARTIES_FIXTURE),
      ),
    ),
    relationships: (relSample as unknown[]).map((r) =>
      normalizeRelationship(
        r,
        sourceMeta('profiler/address/related-wallets', relMeta ?? null, attackerCaptured, ATTACKER_FIXTURE),
      ),
    ),
    transactions: [
      ...(txSample as unknown[]).map((r) =>
        normalizeTransaction(
          r,
          sourceMeta('profiler/address/transactions', txMeta ?? null, attackerCaptured, ATTACKER_FIXTURE),
        ),
      ),
      ...(liveRows as unknown[]).map((r) => normalizeTransaction(r, liveSource)),
    ],
  };
  return { input, files: [COUNTERPARTIES_FIXTURE, ATTACKER_FIXTURE, LIVE_TRANSACTIONS_FIXTURE] };}

/** Coverage for the Euler fixture case — the honest carrier of its limits. */
export function eulerCoverage(): CoverageReport {
  return {
    flags: {
      fundingEvidence: true,
      counterpartyAggregates: true,
      transactionWindowCovered: false,
    },
    reasons: [
      'flags.fundingEvidence: Nansen related-wallets row reports 0x036cec… as "First Funder" with evidence tx 0x298bde3f…db55 at 2023-03-13T09:12:23Z (reported link, not control proof).',
      'flags.counterpartyAggregates: 15 window-level counterparty rows observed (top: attacker EOA $378.4M in=out, aWBTC_v2, balancervault.eth $355.0M); aggregates only, no per-hop evidence.',
      'flags.transactionWindowCovered: 2023-03-13 is now covered by 17 live incident-day rows (funding tx, swaps, withdrawals), but 2023-03-15 → 2023-03-27 and the return period remain absent and still require live capture; the discovery sample is still latest-first dust.',
    ],
  };
}

/** Run the Phase 3B reconstruction over the Euler fixtures. */
export function buildEulerInvestigation(reconstructedAt?: string): ReconstructionResult {
  const { input } = loadEulerInputs();
  return reconstruct(
    input,
    { address: EULER_ATTACKER, chain: EULER_CHAIN },
    {
      id: EULER_CASE_ID,
      name: EULER_NAME,
      headline: EULER_HEADLINE,
      window: { from: EULER_WINDOW.from, to: EULER_WINDOW.to },
    },
    reconstructedAt !== undefined ? { reconstructedAt } : {},
  );
}

/**
 * Assemble the full application-facing Euler contract: fixture-cache sourced,
 * incomplete (by rule), validated, and deep-frozen.
 */
export function buildEulerContract(reconstructedAt?: string): InvestigationContract {
  const { input } = loadEulerInputs();
  const result = reconstruct(
    input,
    { address: EULER_ATTACKER, chain: EULER_CHAIN },
    {
      id: EULER_CASE_ID,
      name: EULER_NAME,
      headline: EULER_HEADLINE,
      window: { from: EULER_WINDOW.from, to: EULER_WINDOW.to },
    },
    reconstructedAt !== undefined ? { reconstructedAt } : {},
  );
  return buildContract(result, {
    dataSource: 'fixture-cache',
    coverage: eulerCoverage(),
    inputs: input,
  });
}

/** Case registry manifest. MVP ships exactly one available case (Euler). */
export const AVAILABLE_CASES: IncidentDescriptor[] = [
  {
    id: EULER_CASE_ID,
    name: EULER_NAME,
    chain: EULER_CHAIN,
    window: { from: EULER_WINDOW.from, to: EULER_WINDOW.to },
    oneLine: 'Cached-fixture reconstruction of observed movements around the Euler incident window.',
    available: true,
  },
];

/** Ready-to-serve read-only service for route handlers. */
export function buildEulerService(reconstructedAt?: string): ContractService {
  return createContractService([buildEulerContract(reconstructedAt)], [EULER_CASE_ID]);
}
