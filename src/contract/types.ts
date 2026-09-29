/**
 * TRACE — Application-facing investigation contract types (Phase 3C).
 *
 * View-model layer (NOT domain types): a stable envelope around the Phase 3B
 * `Investigation` that route handlers (future Next.js API routes) can serve
 * directly. Adds what the domain model deliberately lacks:
 *  - dataSource: fixture-cache vs live-nansen (never conflate the two).
 *  - completeness: complete vs incomplete, with explicit reasons. A
 *    fixture-cache reconstruction is NEVER labeled complete.
 *  - coverage: which evidence dimensions are actually covered (the transaction
 *    window flag is the honest carrier of the latest-first-dust limitation).
 *  - evidence: completeness metadata (observed vs derived counts, unavailable
 *    fields, unresolved limitations).
 *
 * No HYPOTHESIS records are representable in the default contract: validation
 * (validate.ts) rejects them.
 */

import type { Investigation, TimeWindow } from '../types/investigation.ts';

/** Application-facing contract version. Validation pins this exactly. */
export const CONTRACT_VERSION = 'trace-3c/1.0.0';

/** Where the underlying records came from. */
export type DataSource = 'fixture-cache' | 'live-nansen';

/** Whether the reconstruction may be presented as complete. */
export type Completeness = 'complete' | 'incomplete';

/**
 * How the contract's records reached the engine (item #3, hybrid origin-proof):
 *  - live-http: at least one live Nansen HTTP response was captured this run.
 *  - no-live-http: a fixture-cache build that made no live HTTP call at request
 *    time (records were captured earlier and cached; see investigation.sources).
 */
export type OriginMode = 'live-http' | 'no-live-http';

/**
 * One live HTTP response captured during a live reconstruction, reduced to the
 * facts that make it auditable without re-disclosing row contents or the key:
 * endpoint path, HTTP status, Nansen request id, credit accounting, and a
 * SHA-256 of the RAW response body. The raw body is never shipped, so the hash
 * is not re-derivable offline — folding the receipt into the contract binds it
 * to the fingerprint, so any edit to a receipt changes the artifact fingerprint.
 */
export interface OriginReceipt {
  /** Endpoint path called (no query string, no key). */
  path: string;
  /** HTTP status of the response. */
  status: number;
  /** Nansen X-Request-Id, when the response carried one. */
  requestId: string | null;
  /** X-Nansen-Credits-Cost header value, when present. */
  creditsCost: string | null;
  /** X-Nansen-Credits-Remaining header value, when present. */
  creditsRemaining: string | null;
  /** SHA-256 hex of the raw response body; null when no body / a scripted client. */
  responseSha256: string | null;
}

/**
 * Hybrid origin-proof (item #3): records HOW a contract's evidence was obtained.
 * A live run carries `live-http` with one receipt per response; a fixture-cache
 * build carries `no-live-http` with an empty receipt set and a note.
 *
 * Optional + additive on the contract: artifacts built before item #3 (and the
 * shipped live contracts not yet re-pinned) omit it and still validate. It is
 * folded onto the contract BEFORE fingerprinting, so the attestation is covered
 * by the SHA-256 fingerprint — that is the tamper-evidence mechanism.
 */
export interface OriginAttestation {
  mode: OriginMode;
  /**
   * When the responses were captured. Pinned to the run's reconstructedAt for
   * determinism (a re-run with identical inputs + reconstructedAt yields a
   * byte-identical attestation). For no-live-http, the case's reconstructedAt.
   */
  capturedAt: string;
  /** Optional human-readable note (e.g. why there was no live HTTP call). */
  note?: string;
  /** One receipt per recorded live HTTP response; empty for no-live-http. */
  receipts: OriginReceipt[];
}

/**
 * Which evidence dimensions the reconstruction actually covers. Each false
 * flag must have a corresponding entry in `reasons`.
 */
export interface CoverageFlags {
  /** A funding/relation row was observed (e.g. First Funder with evidence tx). */
  fundingEvidence: boolean;
  /** Window-level counterparty aggregates were observed. */
  counterpartyAggregates: boolean;
  /**
   * Per-transaction rows cover the incident window of interest. FALSE for the
   * Euler fixture case: the captured sample is latest-first dust and
   * exploit-day rows require pagination/live capture.
   */
  transactionWindowCovered: boolean;
}

export interface CoverageReport {
  flags: CoverageFlags;
  /** Human-readable per-flag evidence notes; false flags must be explained. */
  reasons: string[];
}

/**
 * Evidence completeness metadata. Counts are recomputable from the
 * investigation alone (see countEvidence); the remaining fields come from the
 * build inputs and are shape-checked by validation.
 */
export interface EvidenceCompleteness {
  /** Top-level FACT provenances across events, entities, relationships. */
  observedFacts: number;
  /** Top-level RELATION provenances (reported links, not control proof). */
  observedRelations: number;
  /** Top-level DERIVED provenances (groups, flow edges, entity closure). */
  derivedValues: number;
  /** capital-consolidation / capital-dispersal events (subset of derivedValues). */
  derivedGroupings: number;
  /** flow-kind relationships (subset of derivedValues). */
  derivedFlowEdges: number;
  primaryEvents: number;
  collapsedEvents: number;
  /** Exact-duplicate input records collapsed by the engine. */
  duplicatesSkipped: number;
  /** Flow buckets intentionally not eventized. */
  flowsSkipped: number;
  /** Member events with no USD value (never estimated). */
  eventsMissingUsd: number;
  /** Source fields that were null/missing/empty, aggregated over build inputs. */
  unavailableFields: string[];
  /** Unresolved engine limitations (fixed list, see ENGINE_LIMITATIONS). */
  limitations: string[];
}

/**
 * The stable application-facing contract. Served read-only (deep-frozen at
 * build time; see service.ts).
 */
export interface InvestigationContract {
  contractVersion: string;
  engineVersion: string;
  caseId: string;
  dataSource: DataSource;
  /**
   * Full evidence-pool enumeration (Phase 3H, additive + optional for
   * backward compatibility: older contracts without it still validate).
   * Sorted unique subset containing dataSource. Mixed builds list both pools
   * while dataSource stays at the conservative single value the completeness
   * rule consumes — the rule itself is unchanged.
   */
  dataSources?: DataSource[];
  completeness: Completeness;
  completenessReasons: string[];
  coverage: CoverageReport;
  evidence: EvidenceCompleteness;
  /**
   * Hybrid origin-proof (item #3, additive + optional for backward
   * compatibility: older contracts without it still validate). Records whether
   * the evidence came from a live Nansen HTTP run (with per-response receipts)
   * or a fixture-cache build (no live HTTP). Fingerprint-covered.
   */
  origin?: OriginAttestation;
  investigation: Investigation;
}

/** Lightweight row for case listings (route-handler friendly). */
export interface CaseSummary {
  caseId: string;
  name: string;
  chain: string;
  window: TimeWindow;
  status: Investigation['status'];
  dataSource: DataSource;
  completeness: Completeness;
  primaryEvents: number;
  entities: number;
  available: boolean;
}
