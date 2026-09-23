/**
 * TRACE — Normalized intermediate data contract (Phase 3A).
 *
 * This is the layer BETWEEN the raw Nansen response types (`src/nansen/types.ts`,
 * which mirror the wire format, partial + index-signatured) and the domain model
 * (`src/types/*`, the Investigation/TraceEvent/Entity/Relationship shapes the UI
 * renders). Nothing here scores significance, groups a timeline, or builds a graph
 * — that is Phase 3B and beyond.
 *
 * Design rules (enforced by the normalizers in `normalize.ts`):
 *  - Deterministic: identical input → identical output, independent of machine TZ.
 *  - Explicit absence: a field Nansen did not provide (null / undefined / "") is
 *    represented as `null` AND named in `unavailableFields`. Never guessed or filled.
 *  - Preserve anchors: original timestamp string, transaction hash, and addresses
 *    are carried through verbatim.
 *  - Provenance: the normalized layer only ever emits FACT (a field Nansen returned)
 *    or RELATION (a link Nansen asserts). It NEVER emits DERIVED or HYPOTHESIS —
 *    those are produced later, by the reconstruction engine, from these records.
 */

import type { NansenSource, ProvenanceKind } from '../types/provenance.ts';

/**
 * A timestamp normalized for deterministic ordering while preserving the original.
 * Some Nansen fixtures return naive timestamps (no timezone), e.g.
 * "2023-03-31T18:02:35"; others carry "Z". `Date.parse` treats a naive string as
 * LOCAL time, so we append "Z" before parsing and flag it. Nansen documents its
 * timestamps as UTC, so assuming UTC is correct — but we record the assumption
 * rather than hide it.
 */
export interface NormalizedTimestamp {
  /** Exactly as Nansen returned it. Never rewritten. */
  raw: string;
  /** ISO-8601 UTC. Naive inputs get a trailing "Z" (see `assumedUtc`). */
  iso: string;
  /** true when `raw` lacked a timezone offset and we treated it as UTC. */
  assumedUtc: boolean;
  /** Milliseconds since epoch, for deterministic ordering. */
  epochMs: number;
}

/** Where a normalized record came from — full audit trail, no secrets. */
export interface SourceMeta {
  /** The Nansen endpoint the datum originated from. */
  source: NansenSource;
  /** Nansen X-Request-Id captured at fetch time (may be absent in older fixtures). */
  requestId: string | null;
  /** When the underlying fixture was captured (historical data is revisable). */
  capturedAt: string;
  /** The fixture file this record was read from, for local reproducibility. */
  fixtureFile: string | null;
  /** Credit cost recorded for the originating call, when known. */
  creditsCost: string | null;
  /**
   * Evidence-pool origin (Phase 3J): set explicitly for live reconstructions,
   * where no fixture file is written and the `live/`-path convention cannot
   * apply. Optional + defaulted-absent so every fixture caller is unaffected;
   * when present it takes precedence over the fixture-file convention in the
   * engine's SourceRef stamping.
   */
  origin?: 'fixture-cache' | 'live-nansen';
}

/**
 * Every normalized record is wrapped with its provenance category, its source,
 * and the explicit list of fields that were unavailable in the raw datum.
 */
export interface Provenanced<T> {
  value: T;
  /** Normalized layer emits only 'FACT' or 'RELATION' (never DERIVED/HYPOTHESIS). */
  provenanceKind: Extract<ProvenanceKind, 'FACT' | 'RELATION'>;
  source: SourceMeta;
  /** Names of source fields that were null / missing / empty. Deterministic order. */
  unavailableFields: string[];
}

// --- normalized/transfers  (tgm/transfers) ------------------------------------
export interface NormalizedTransfer {
  timestamp: NormalizedTimestamp;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  fromLabel: string | null;
  toLabel: string | null;
  transactionType: string | null;
  amount: number | null;
  valueUsd: number | null;
}

// --- normalized/swaps  (tgm/dex-trades) ---------------------------------------
export interface NormalizedSwap {
  timestamp: NormalizedTimestamp;
  txHash: string;
  traderAddress: string;
  traderLabel: string | null;
  action: 'BUY' | 'SELL';
  tokenAddress: string;
  tokenName: string | null;
  tokenAmount: number | null;
  tradedTokenAddress: string | null;
  tradedTokenName: string | null;
  tradedTokenAmount: number | null;
  swapPriceUsd: number | null;
  valueUsd: number | null;
}

/** Per-token in/out breakdown inside a counterparty edge (tokens_info[]). */
export interface NormalizedTokenBreakdown {
  tokenAddress: string;
  tokenSymbol: string | null;   // "" → null
  tokenName: string | null;     // "" → null
  numTransfer: number | null;   // Nansen returns this as a STRING ("88") → 88
  totalTokenAmount: number | null;
  tokenInAmount: number | null;
  tokenOutAmount: number | null;
}

// --- normalized/counterparties  (profiler/address/counterparties) -------------
export interface NormalizedCounterparty {
  counterpartyAddress: string;
  /** counterparty_address_label: null → []; array preserved. */
  labels: string[];
  interactionCount: number | null;
  totalVolumeUsd: number | null;
  volumeInUsd: number | null;
  volumeOutUsd: number | null;
  tokens: NormalizedTokenBreakdown[];
}

// --- normalized/relationships  (profiler/address/related-wallets) -------------
export interface NormalizedRelationship {
  address: string;
  label: string | null;         // "" → null
  /** Nansen's relation string, e.g. "First Funder", "Deployed Contract". */
  relation: string;
  txHash: string;               // the evidence transaction for the relation
  timestamp: NormalizedTimestamp;
  order: number | null;
  chain: string;
}

// --- normalized/flows  (tgm/flows) --------------------------------------------
/**
 * Included because the hero fixtures exercise the null-flow case: dex/cex split
 * fields are null unless label=exchange. Represented explicitly, never zero-filled.
 */
export interface NormalizedFlowBucket {
  timestamp: NormalizedTimestamp;      // from `date`
  bucketEnd: NormalizedTimestamp | null;
  isComplete: boolean | null;
  priceUsd: number | null;
  valueUsd: number | null;
  inflowsDexUsd: number | null;        // null in the hero data — kept explicit
  outflowsDexUsd: number | null;
  inflowsCexUsd: number | null;
  outflowsCexUsd: number | null;
  holdersCount: number | null;
}

/** Convenience aliases for the provenance-wrapped records. */
export type TransferFact = Provenanced<NormalizedTransfer>;
export type SwapFact = Provenanced<NormalizedSwap>;
export type CounterpartyFact = Provenanced<NormalizedCounterparty>;
export type RelationshipRelation = Provenanced<NormalizedRelationship>;
export type FlowBucketFact = Provenanced<NormalizedFlowBucket>;
