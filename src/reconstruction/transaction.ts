/**
 * TRACE — Normalized transaction record (Phase 3B gap fill).
 *
 * Phase 3A normalized transfers, swaps, counterparties, relationships, and flow
 * buckets, but left `profiler/address/transactions` without a normalized form.
 * The reconstruction engine needs that endpoint's `method`, row-level
 * `volume_usd`, and per-token movements to build `transfer` and
 * `contract-interaction` events — so this file adds the missing layer under the
 * SAME guarantees as Phase 3A:
 *  - Deterministic: pure functions, no wall-clock/random, stable field order.
 *  - Explicit absence: null / undefined / "" becomes `null` and is named in
 *    `unavailableFields`. Nothing is guessed or zero-filled.
 *  - Anchors preserved: timestamp raw string, tx hash, addresses byte-for-byte.
 *  - Provenance: emits only FACT (a field Nansen returned). NEVER DERIVED or
 *    HYPOTHESIS. No intent, ownership, or causality is inferred here.
 *
 * Note: per-token `price_usd` / `value_usd` are null in the hero fixtures; only
 * the row-level `volume_usd` carries USD. The engine must use the row-level
 * value, not per-token USD (see Phase 3A §8).
 */

import type { Provenanced, SourceMeta } from './normalized-types.ts';
import {
  NormalizationError,
  normalizeTimestamp,
} from './normalize.ts';
import type { NormalizedTimestamp } from './normalized-types.ts';

/** One token movement inside a profiler transaction row. */
export interface NormalizedTxTokenMovement {
  tokenSymbol: string | null; // "" → null
  tokenAmount: number | null;
  tokenAddress: string | null; // "" → null
  fromAddress: string | null;
  toAddress: string | null;
  fromLabel: string | null; // "" → null
  toLabel: string | null; // "" → null
}

/** Normalized `profiler/address/transactions` row (FACT). */
export interface NormalizedTransaction {
  timestamp: NormalizedTimestamp;
  txHash: string;
  chain: string;
  /** Nansen method string verbatim, e.g. "received", "transfer(address,uint256)". */
  method: string;
  /** e.g. "transfer". May be absent in some rows → null. */
  sourceType: string | null;
  /** Row-level USD volume (FACT when present). Per-token USD is NOT used. */
  volumeUsd: number | null;
  tokensSent: NormalizedTxTokenMovement[];
  tokensReceived: NormalizedTxTokenMovement[];
}

/** Convenience alias for the provenance-wrapped record. */
export type TransactionFact = Provenanced<NormalizedTransaction>;

// --- local guards (mirrors normalize.ts semantics; kept local so Phase 3A files stay untouched) ---

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(
  row: Record<string, unknown>,
  key: string,
  fixtureFile: string | null,
): string {
  const v = row[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new NormalizationError(
      `required string field "${key}" is missing or empty`,
      key,
      fixtureFile,
    );
  }
  return v;
}

function optString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0) return null;
  return v;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeMovement(
  raw: unknown,
  fixtureFile: string | null,
): NormalizedTxTokenMovement {
  if (!isObject(raw)) {
    throw new NormalizationError(
      'transaction token entry is not an object',
      'tokens_sent[]/tokens_received[]',
      fixtureFile,
    );
  }
  return {
    tokenSymbol: optString(raw.token_symbol),
    tokenAmount: numberOrNull(raw.token_amount),
    tokenAddress: optString(raw.token_address),
    fromAddress: optString(raw.from_address),
    toAddress: optString(raw.to_address),
    fromLabel: optString(raw.from_address_label),
    toLabel: optString(raw.to_address_label),
  };
}

/**
 * profiler/address/transactions row → NormalizedTransaction (FACT).
 * `tokens_sent` / `tokens_received` default to [] when absent (and are reported
 * in `unavailableFields`); entries keep nulls explicit.
 */
export function normalizeTransaction(
  raw: unknown,
  source: SourceMeta,
): Provenanced<NormalizedTransaction> {
  if (!isObject(raw)) {
    throw new NormalizationError(
      'transaction row is not an object',
      '.',
      source.fixtureFile,
    );
  }
  const missing: string[] = [];

  const sentRaw = raw.tokens_sent;
  const receivedRaw = raw.tokens_received;
  const tokensSent: NormalizedTxTokenMovement[] = Array.isArray(sentRaw)
    ? sentRaw.map((t) => normalizeMovement(t, source.fixtureFile))
    : [];
  const tokensReceived: NormalizedTxTokenMovement[] = Array.isArray(receivedRaw)
    ? receivedRaw.map((t) => normalizeMovement(t, source.fixtureFile))
    : [];
  if (!Array.isArray(sentRaw) || sentRaw.length === 0) missing.push('tokens_sent');
  if (!Array.isArray(receivedRaw) || receivedRaw.length === 0) missing.push('tokens_received');

  const value: NormalizedTransaction = {
    timestamp: normalizeTimestamp(
      requireString(raw, 'block_timestamp', source.fixtureFile),
      'block_timestamp',
      source.fixtureFile,
    ),
    txHash: requireString(raw, 'transaction_hash', source.fixtureFile),
    chain: requireString(raw, 'chain', source.fixtureFile),
    method: requireString(raw, 'method', source.fixtureFile),
    sourceType: optString(raw.source_type),
    volumeUsd: numberOrNull(raw.volume_usd),
    tokensSent,
    tokensReceived,
  };

  const rawRec = raw as Record<string, unknown>;
  for (const k of ['source_type', 'volume_usd']) {
    const v = rawRec[k];
    if (v === null || v === undefined || v === '') missing.push(k);
  }

  return {
    value,
    provenanceKind: 'FACT',
    source,
    unavailableFields: [...missing].sort(),
  };
}
