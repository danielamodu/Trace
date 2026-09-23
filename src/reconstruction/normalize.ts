/**
 * TRACE — Normalization layer (Phase 3A).
 *
 * Deterministic transforms from raw Nansen rows (as captured in `fixtures/`) into
 * the normalized intermediate contract in `normalized-types.ts`. Runtime-validated:
 * external data is not trusted, required fields are checked, and anything absent is
 * represented explicitly (null + named in `unavailableFields`) rather than guessed.
 *
 * Scope guard (Phase 3A): row-level normalization ONLY. No significance scoring,
 * no timeline grouping, no graph building, no causal/ownership/intent inference.
 */

import type {
  NansenSource,
  ProvenanceKind,
} from '../types/provenance.ts';
import type {
  NormalizedTimestamp,
  SourceMeta,
  Provenanced,
  NormalizedTransfer,
  NormalizedSwap,
  NormalizedTokenBreakdown,
  NormalizedCounterparty,
  NormalizedRelationship,
  NormalizedFlowBucket,
} from './normalized-types.ts';

/** Thrown when a required field is missing or the record is malformed. */
export class NormalizationError extends Error {
  readonly field: string;
  readonly fixtureFile: string | null;
  constructor(message: string, field: string, fixtureFile: string | null = null) {
    super(message);
    this.name = 'NormalizationError';
    this.field = field;
    this.fixtureFile = fixtureFile;
  }
}

// --- primitive guards ---------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A required string field: must be a non-empty string, else throw. */
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

/** An optional string: "" and null/undefined both become null (and are reported). */
function optString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0) return null;
  return v;
}

/**
 * A number that Nansen may return as a number, a numeric string ("88"), null, or
 * absent. Returns a finite number or null. Never throws — numeric absence is data,
 * not corruption.
 */
function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/** Push `key` onto `missing` when `raw[key]` is null / undefined / "". */
function trackAbsent(
  raw: Record<string, unknown>,
  key: string,
  missing: string[],
): void {
  const v = raw[key];
  if (v === null || v === undefined || v === '') missing.push(key);
}

// --- timestamp normalization (deterministic, TZ-independent) ------------------

const HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Normalize a timestamp deterministically. Naive strings (no offset) are treated
 * as UTC per Nansen's documented convention, with `assumedUtc: true` recorded.
 * A string that cannot be parsed to a finite epoch throws (required-field failure).
 */
export function normalizeTimestamp(
  raw: string,
  field: string,
  fixtureFile: string | null = null,
): NormalizedTimestamp {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new NormalizationError(`timestamp "${field}" is missing or empty`, field, fixtureFile);
  }
  const assumedUtc = !HAS_TZ.test(raw);
  const isoInput = assumedUtc ? `${raw}Z` : raw;
  const epochMs = Date.parse(isoInput);
  if (!Number.isFinite(epochMs)) {
    throw new NormalizationError(`timestamp "${field}" is not parseable: ${raw}`, field, fixtureFile);
  }
  return {
    raw,
    iso: new Date(epochMs).toISOString(),
    assumedUtc,
    epochMs,
  };
}

// --- source metadata ----------------------------------------------------------

/** Shape of the `meta`/`response_meta` block recorded in fixtures. */
export interface FixtureMeta {
  requestId?: string | null;
  creditsCost?: string | null;
  [k: string]: unknown;
}

/**
 * Build a SourceMeta from a fixture's meta block. No secrets are read.
 *
 * `origin` (Phase 3J) is passed explicitly by the live reconstruction path,
 * which reads no fixture file (so `fixtureFile` stays null) but must still mark
 * its data as `live-nansen`. Fixture callers omit it and are unaffected — the
 * engine falls back to the `live/`-path convention when origin is absent.
 */
export function sourceMeta(
  source: NansenSource,
  meta: FixtureMeta | null | undefined,
  capturedAt: string,
  fixtureFile: string | null = null,
  origin?: 'fixture-cache' | 'live-nansen',
): SourceMeta {
  return {
    source,
    requestId: meta?.requestId ?? null,
    capturedAt,
    fixtureFile,
    creditsCost: meta?.creditsCost ?? null,
    ...(origin !== undefined ? { origin } : {}),
  };
}

function wrap<T>(
  value: T,
  provenanceKind: Extract<ProvenanceKind, 'FACT' | 'RELATION'>,
  source: SourceMeta,
  unavailableFields: string[],
): Provenanced<T> {
  // Stable order so identical input → identical output.
  return { value, provenanceKind, source, unavailableFields: [...unavailableFields].sort() };
}

// --- normalizers --------------------------------------------------------------

/** tgm/transfers row → NormalizedTransfer (FACT). */
export function normalizeTransfer(raw: unknown, source: SourceMeta): Provenanced<NormalizedTransfer> {
  if (!isObject(raw)) throw new NormalizationError('transfer row is not an object', '.', source.fixtureFile);
  const missing: string[] = [];
  const value: NormalizedTransfer = {
    timestamp: normalizeTimestamp(requireString(raw, 'block_timestamp', source.fixtureFile), 'block_timestamp', source.fixtureFile),
    txHash: requireString(raw, 'transaction_hash', source.fixtureFile),
    fromAddress: requireString(raw, 'from_address', source.fixtureFile),
    toAddress: requireString(raw, 'to_address', source.fixtureFile),
    fromLabel: optString(raw.from_address_label),
    toLabel: optString(raw.to_address_label),
    transactionType: optString(raw.transaction_type),
    amount: numberOrNull(raw.transfer_amount),
    valueUsd: numberOrNull(raw.transfer_value_usd),
  };
  for (const k of ['from_address_label', 'to_address_label', 'transaction_type', 'transfer_amount', 'transfer_value_usd']) {
    trackAbsent(raw, k, missing);
  }
  return wrap(value, 'FACT', source, missing);
}

/** tgm/dex-trades row → NormalizedSwap (FACT). */
export function normalizeSwap(raw: unknown, source: SourceMeta): Provenanced<NormalizedSwap> {
  if (!isObject(raw)) throw new NormalizationError('swap row is not an object', '.', source.fixtureFile);
  const action = raw.action;
  if (action !== 'BUY' && action !== 'SELL') {
    throw new NormalizationError(`swap "action" must be BUY|SELL, got ${JSON.stringify(action)}`, 'action', source.fixtureFile);
  }
  const missing: string[] = [];
  const value: NormalizedSwap = {
    timestamp: normalizeTimestamp(requireString(raw, 'block_timestamp', source.fixtureFile), 'block_timestamp', source.fixtureFile),
    txHash: requireString(raw, 'transaction_hash', source.fixtureFile),
    traderAddress: requireString(raw, 'trader_address', source.fixtureFile),
    traderLabel: optString(raw.trader_address_label),
    action,
    tokenAddress: requireString(raw, 'token_address', source.fixtureFile),
    tokenName: optString(raw.token_name),
    tokenAmount: numberOrNull(raw.token_amount),
    tradedTokenAddress: optString(raw.traded_token_address),
    tradedTokenName: optString(raw.traded_token_name),
    tradedTokenAmount: numberOrNull(raw.traded_token_amount),
    swapPriceUsd: numberOrNull(raw.estimated_swap_price_usd),
    valueUsd: numberOrNull(raw.estimated_value_usd),
  };
  for (const k of ['trader_address_label', 'token_name', 'token_amount', 'traded_token_address', 'traded_token_name', 'traded_token_amount', 'estimated_swap_price_usd', 'estimated_value_usd']) {
    trackAbsent(raw, k, missing);
  }
  return wrap(value, 'FACT', source, missing);
}

function normalizeTokenBreakdown(raw: unknown, fixtureFile: string | null): NormalizedTokenBreakdown {
  if (!isObject(raw)) throw new NormalizationError('tokens_info entry is not an object', 'tokens_info[]', fixtureFile);
  return {
    tokenAddress: requireString(raw, 'token_address', fixtureFile),
    tokenSymbol: optString(raw.token_symbol),
    tokenName: optString(raw.token_name),
    numTransfer: numberOrNull(raw.num_transfer),
    totalTokenAmount: numberOrNull(raw.total_token_amount),
    tokenInAmount: numberOrNull(raw.token_in_amount),
    tokenOutAmount: numberOrNull(raw.token_out_amount),
  };
}

/** profiler/address/counterparties row → NormalizedCounterparty (FACT). */
export function normalizeCounterparty(raw: unknown, source: SourceMeta): Provenanced<NormalizedCounterparty> {
  if (!isObject(raw)) throw new NormalizationError('counterparty row is not an object', '.', source.fixtureFile);
  const missing: string[] = [];

  const rawLabels = raw.counterparty_address_label;
  let labels: string[];
  if (rawLabels === null || rawLabels === undefined) {
    labels = [];
    missing.push('counterparty_address_label');
  } else if (Array.isArray(rawLabels)) {
    labels = rawLabels.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (labels.length === 0) missing.push('counterparty_address_label');
  } else {
    throw new NormalizationError('counterparty_address_label must be array|null', 'counterparty_address_label', source.fixtureFile);
  }

  const rawTokens = raw.tokens_info;
  const tokens: NormalizedTokenBreakdown[] = Array.isArray(rawTokens)
    ? rawTokens.map((t) => normalizeTokenBreakdown(t, source.fixtureFile))
    : [];
  if (!Array.isArray(rawTokens) || rawTokens.length === 0) missing.push('tokens_info');

  const value: NormalizedCounterparty = {
    counterpartyAddress: requireString(raw, 'counterparty_address', source.fixtureFile),
    labels,
    interactionCount: numberOrNull(raw.interaction_count),
    totalVolumeUsd: numberOrNull(raw.total_volume_usd),
    volumeInUsd: numberOrNull(raw.volume_in_usd),
    volumeOutUsd: numberOrNull(raw.volume_out_usd),
    tokens,
  };
  for (const k of ['interaction_count', 'total_volume_usd', 'volume_in_usd', 'volume_out_usd']) {
    trackAbsent(raw, k, missing);
  }
  return wrap(value, 'FACT', source, missing);
}

/**
 * profiler/address/related-wallets row → NormalizedRelationship (RELATION).
 * A relation is a Nansen-asserted link, NOT proof of common ownership. The
 * normalized layer tags it RELATION; interpretation stays out of this layer.
 */
export function normalizeRelationship(raw: unknown, source: SourceMeta): Provenanced<NormalizedRelationship> {
  if (!isObject(raw)) throw new NormalizationError('related-wallet row is not an object', '.', source.fixtureFile);
  const missing: string[] = [];
  const value: NormalizedRelationship = {
    address: requireString(raw, 'address', source.fixtureFile),
    label: optString(raw.address_label),
    relation: requireString(raw, 'relation', source.fixtureFile),
    txHash: requireString(raw, 'transaction_hash', source.fixtureFile),
    timestamp: normalizeTimestamp(requireString(raw, 'block_timestamp', source.fixtureFile), 'block_timestamp', source.fixtureFile),
    order: numberOrNull(raw.order),
    chain: requireString(raw, 'chain', source.fixtureFile),
  };
  trackAbsent(raw, 'address_label', missing);
  trackAbsent(raw, 'order', missing);
  return wrap(value, 'RELATION', source, missing);
}

/** tgm/flows row → NormalizedFlowBucket (FACT). Null dex/cex splits stay null. */
export function normalizeFlowBucket(raw: unknown, source: SourceMeta): Provenanced<NormalizedFlowBucket> {
  if (!isObject(raw)) throw new NormalizationError('flow bucket is not an object', '.', source.fixtureFile);
  const missing: string[] = [];
  const bucketEndRaw = raw.bucket_end;
  const value: NormalizedFlowBucket = {
    timestamp: normalizeTimestamp(requireString(raw, 'date', source.fixtureFile), 'date', source.fixtureFile),
    bucketEnd: typeof bucketEndRaw === 'string' && bucketEndRaw.length > 0
      ? normalizeTimestamp(bucketEndRaw, 'bucket_end', source.fixtureFile)
      : null,
    isComplete: boolOrNull(raw.is_complete),
    priceUsd: numberOrNull(raw.price_usd),
    valueUsd: numberOrNull(raw.value_usd),
    inflowsDexUsd: numberOrNull(raw.total_inflows_dex),
    outflowsDexUsd: numberOrNull(raw.total_outflows_dex),
    inflowsCexUsd: numberOrNull(raw.total_inflows_cex),
    outflowsCexUsd: numberOrNull(raw.total_outflows_cex),
    holdersCount: numberOrNull(raw.holders_count),
  };
  for (const k of ['bucket_end', 'is_complete', 'price_usd', 'value_usd', 'total_inflows_dex', 'total_outflows_dex', 'total_inflows_cex', 'total_outflows_cex', 'holders_count']) {
    trackAbsent(raw, k, missing);
  }
  return wrap(value, 'FACT', source, missing);
}
