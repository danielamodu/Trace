/**
 * TRACE — FTX Exploiter case assembly (Phase 3J: second registered case).
 *
 * Mirrors the Euler assembly exactly: load the discovery + live fixtures,
 * normalize them, run the Phase 3B reconstruction, wrap the result in the
 * application-facing contract. Fixture-first: no live Nansen calls at build or
 * request time, no secrets, no network.
 *
 * Incident: the November 2022 FTX unauthorized-transfer incident. Nansen labels
 * the subject entity "FTX Exploiter". TRACE asserts NO attribution and NO
 * causation — it reconstructs observed on-chain movements and reported links
 * only, and marks their provenance.
 *
 * Data-hygiene note (honest, and load-bearing): the subject received airdropped
 * tokens whose metadata carries malicious multi-kilobyte symbol/name strings.
 * scripts/capture-ftx.ts neutralizes those at capture time — symbols/names over
 * a length cap are stored empty (→ normalized to null, tracked as unavailable).
 * Every real transfer anchor (addresses, amounts, USD, hash, timestamp) is
 * preserved untouched; only the pathological display strings are dropped.
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
import type { CoverageReport, InvestigationContract } from '../contract/types.ts';

// --- canonical FTX metadata (fixture-validated) ------------------------------

export const FTX_CASE_ID = 'case_ftx_2022';
export const FTX_NAME = 'FTX unauthorized transfers and laundering';
export const FTX_CHAIN = 'ethereum';
export const FTX_WINDOW = { from: '2022-11-11', to: '2022-11-30' } as const;
/** The bounded window actually captured live (drain core), for honest coverage. */
export const FTX_CAPTURE_WINDOW = { from: '2022-11-11', to: '2022-11-13' } as const;
/**
 * Observational headline only: what TRACE observed and from where. Asserts no
 * causation, no attribution, no completeness.
 */
export const FTX_HEADLINE =
  'Observed on-chain movements around the FTX unauthorized-transfer incident (2022-11-11 → 2022-11-30), reconstructed from cached Nansen fixtures plus a live capture of the drain-window transactions.';

/** Nansen-labelled subject entity address ("FTX Exploiter"). */
export const FTX_SUBJECT = '0x59abf3837fa962d6853b4cc0a19513aa031fd32b';
/** Reported First Funder (Nansen related-wallets); also a top counterparty. */
export const FTX_FIRST_FUNDER = '0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2';

const COUNTERPARTIES_FIXTURE = 'discovery/entity-ftx-exploiter.json';
const RELATED_FIXTURE = 'discovery/ftx-related-wallets.json';
const LIVE_MANIFEST = 'live/ftx/manifest.json';

function fixturesDir(): URL {
  // Runtime expression (not a string literal) so bundlers leave it alone rather
  // than resolving it as a static asset. Identical to '../../fixtures/' here.
  const rel = ['..', '..', 'fixtures', ''].join('/');
  return new URL(rel, import.meta.url);
}

function readFixtureJson(rel: string): unknown {
  return JSON.parse(readFileSync(new URL(rel, fixturesDir()), 'utf8')) as unknown;
}

/** Load + normalize the FTX discovery + live fixtures into engine input. */
export function loadFtxInputs(): { input: EngineInput; files: string[] } {
  const counterpartiesFx = readFixtureJson(COUNTERPARTIES_FIXTURE) as Record<string, unknown>;
  const relatedFx = readFixtureJson(RELATED_FIXTURE) as Record<string, unknown>;
  if (!Array.isArray(counterpartiesFx.sample)) {
    throw new Error(`${COUNTERPARTIES_FIXTURE}: missing sample[]`);
  }
  if (!Array.isArray(relatedFx.sample)) {
    throw new Error(`${RELATED_FIXTURE}: missing sample[]`);
  }
  const cpMeta = counterpartiesFx.meta as { requestId?: string; creditsCost?: string } | undefined;
  const cpCaptured = counterpartiesFx.captured_at;
  const relMeta = relatedFx.meta as { requestId?: string; creditsCost?: string } | undefined;
  const relCaptured = relatedFx.captured_at;
  if (typeof cpCaptured !== 'string' || typeof relCaptured !== 'string') {
    throw new Error('fixture captured_at timestamps are required');
  }

  // Live drain-window capture: a manifest lists one file per page. Each page is
  // unioned into a single transaction stream; the engine orders deterministically.
  const manifest = readFixtureJson(LIVE_MANIFEST) as { pages?: Array<Record<string, unknown>> };
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  if (pages.length === 0) {
    throw new Error(`${LIVE_MANIFEST}: missing pages[] — run scripts/capture-ftx.ts`);
  }
  const files = [COUNTERPARTIES_FIXTURE, RELATED_FIXTURE, LIVE_MANIFEST];
  const liveTransactions = pages.flatMap((p) => {
    const rel = p.rel;
    if (typeof rel !== 'string') throw new Error(`${LIVE_MANIFEST}: page missing rel`);
    const pageFx = readFixtureJson(rel) as Record<string, unknown>;
    const rows = (pageFx as { response_body?: { data?: unknown } }).response_body?.data;
    const meta = pageFx.response_meta as { requestId?: string; creditsCost?: string } | undefined;
    const captured = pageFx.captured_at;
    if (!Array.isArray(rows) || typeof captured !== 'string') {
      throw new Error(`${rel}: missing response_body.data[] / captured_at`);
    }
    files.push(rel);
    const src = sourceMeta('profiler/address/transactions', meta ?? null, captured, rel);
    return (rows as unknown[]).map((r) => normalizeTransaction(r, src));
  });

  const input: EngineInput = {
    counterparties: (counterpartiesFx.sample as unknown[]).map((r) =>
      normalizeCounterparty(
        r,
        sourceMeta('profiler/address/counterparties', cpMeta ?? null, cpCaptured, COUNTERPARTIES_FIXTURE),
      ),
    ),
    relationships: (relatedFx.sample as unknown[]).map((r) =>
      normalizeRelationship(
        r,
        sourceMeta('profiler/address/related-wallets', relMeta ?? null, relCaptured, RELATED_FIXTURE),
      ),
    ),
    transactions: liveTransactions,
  };
  return { input, files };
}

/** Coverage for the FTX fixture case — the honest carrier of its limits. */
export function ftxCoverage(): CoverageReport {
  return {
    flags: {
      fundingEvidence: true,
      counterpartyAggregates: true,
      transactionWindowCovered: false,
    },
    reasons: [
      'flags.fundingEvidence: Nansen related-wallets reports 0x2faf487a…76ad2 ("Token Millionaire") as "First Funder" with evidence tx 0x6580bf69…9653 at 2022-11-12T02:22:23Z (reported link, not control proof); that address is also a $219.0M inbound counterparty.',
      'flags.counterpartyAggregates: 15 window-level counterparty rows observed (top: 0xc40abf7e… $570.9M, 1inch V4 router $298.0M, CoW Protocol settlement $272.7M, 0x2faf487a… $219.0M in); aggregates only, no per-hop evidence.',
      'flags.transactionWindowCovered: the live capture covers the drain core 2022-11-11 → 2022-11-13 only; the remainder of the incident window (2022-11-14 → 2022-11-30 laundering/bridging) is absent and still requires live capture.',
    ],
  };
}

function runFtx(reconstructedAt?: string): { result: ReconstructionResult; input: EngineInput } {
  const { input } = loadFtxInputs();
  const result = reconstruct(
    input,
    { address: FTX_SUBJECT, chain: FTX_CHAIN },
    {
      id: FTX_CASE_ID,
      name: FTX_NAME,
      headline: FTX_HEADLINE,
      window: { from: FTX_WINDOW.from, to: FTX_WINDOW.to },
    },
    reconstructedAt !== undefined ? { reconstructedAt } : {},
  );
  return { result, input };
}

/** Run the Phase 3B reconstruction over the FTX fixtures. */
export function buildFtxInvestigation(reconstructedAt?: string): ReconstructionResult {
  return runFtx(reconstructedAt).result;
}

/**
 * Assemble the full application-facing FTX contract: fixture-cache sourced,
 * incomplete (by rule), validated, and deep-frozen.
 */
export function buildFtxContract(reconstructedAt?: string): InvestigationContract {
  const { result, input } = runFtx(reconstructedAt);
  return buildContract(result, {
    dataSource: 'fixture-cache',
    coverage: ftxCoverage(),
    inputs: input,
  });
}

