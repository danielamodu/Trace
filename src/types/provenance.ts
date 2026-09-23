/**
 * TRACE — Provenance model (conceptual types only; no implementation).
 *
 * Provenance is TRACE's core differentiator: every rendered claim carries a
 * category and a chain back to its Nansen source. The UI must let a reviewer
 * walk CONCLUSION → EVENT → EVIDENCE. A HYPOTHESIS must never be presentable as FACT.
 *
 * Phase 2 deliverable — do NOT add runtime logic here.
 */

/** The four provenance categories. Ordered by strength of proof. */
export type ProvenanceKind =
  | 'FACT'        // Directly returned by Nansen (a field in a response).
  | 'DERIVED'     // Deterministically computed by TRACE from FACTs (no inference).
  | 'RELATION'    // A relationship explicitly returned by Nansen (e.g. "First Funder").
  | 'HYPOTHESIS'; // An interpretation not directly proven. Always visually distinct.

/** Which Nansen endpoint a FACT/RELATION originated from. */
export type NansenSource =
  | 'profiler/address/counterparties'
  | 'profiler/address/transactions'
  | 'profiler/address/related-wallets'
  | 'tgm/transfers'
  | 'tgm/dex-trades'
  | 'tgm/flows'
  | 'smart-money/netflow'
  | 'search/general';

/** A pointer back to the exact source datum, for auditability. */
export interface SourceRef {
  /** The endpoint the datum came from. */
  source: NansenSource;
  /** Nansen X-Request-Id captured at fetch time (audit trail). */
  requestId?: string;
  /** When TRACE captured it (historical data is revisable). */
  capturedAt: string; // ISO 8601
  /** The response field path this datum maps to, e.g. "data[3].volume_in_usd". */
  fieldPath?: string;
  /** On-chain anchor when applicable. */
  txHash?: string;
  /**
   * Which evidence pool the datum came from (Phase 3H, additive + optional).
   * SOURCE (where) stays separate from PROVENANCE (what kind of claim).
   * Absent on older/authored references — never defaulted or guessed.
   */
  origin?: 'fixture-cache' | 'live-nansen';
}

/** FACT / RELATION provenance: asserted directly by Nansen. */
export interface DirectProvenance {
  kind: 'FACT' | 'RELATION';
  sources: SourceRef[]; // ≥1
  /** Human-readable statement of exactly what Nansen asserted. */
  statement: string;
}

/** DERIVED provenance: computed deterministically from other events/facts. */
export interface DerivedProvenance {
  kind: 'DERIVED';
  /** IDs of the events/facts this value was computed from. */
  sourceEventIds: string[];
  /** Named, deterministic rule (see reconstruction spec), e.g. "net_flow". */
  calculation: string;
  /** Optional inputs snapshot for reproducibility. */
  inputs?: Record<string, number | string>;
}

/** HYPOTHESIS provenance: interpretation. Never derivable to FACT. */
export interface HypothesisProvenance {
  kind: 'HYPOTHESIS';
  /** The interpretation, phrased as a possibility. */
  statement: string;
  /** What supports it (event ids) and what would refute it. */
  supportingEventIds: string[];
  /** Explicit confidence signal for the UI — never "certain". */
  confidence: 'low' | 'medium';
}

export type Provenance =
  | DirectProvenance
  | DerivedProvenance
  | HypothesisProvenance;
