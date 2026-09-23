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
