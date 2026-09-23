/**
 * TRACE — Event taxonomy & event model (conceptual types only; no implementation).
 *
 * The EVENT is TRACE's primary unit. The timeline is a chronologically ordered
 * list of events. Every event must be able to answer:
 *   what happened, when, who, how much, why included, what evidence, what provenance.
 */

import type { Provenance } from './provenance.ts';

/**
 * Minimum useful event types — each serves the Euler reconstruction.
 * (No types added purely for completeness.)
 */
export type EventType =
  | 'funding'              // an address is funded (maps to Nansen First Funder)
  | 'transfer'             // value moves between two entities
  | 'swap'                 // a DEX swap (token in/out)
  | 'contract-interaction' // a method call of interest (e.g. flashloan, exploit method)
  | 'capital-consolidation'// multiple inflows converge into one entity  [DERIVED grouping]
  | 'capital-dispersal'    // one entity fans value out to many          [DERIVED grouping]
  | 'entity-relationship'; // a Nansen relation surfaces (funder / related-wallet)

/** A participant slot on an event. */
export interface EventParticipant {
  entityId: string;
  side: 'from' | 'to' | 'actor' | 'counterparty';
}

/** Value moved by an event, when applicable. */
export interface EventValue {
  tokenSymbol?: string;
  tokenAddress?: string;
  amount?: number;         // token units (FACT when from Nansen)
  valueUsd?: number;       // FACT (Nansen) or DERIVED (TRACE sum)
}

export interface TraceEvent {
  /** Stable id, e.g. "event_012". */
  id: string;
  type: EventType;

  // --- what / when ---
  title: string;                 // short human summary ("Flash loan drawn from Balancer")
  timestamp: string;             // ISO 8601 UTC (FACT: block_timestamp)
  /** Ordering key: (timestamp, txIndex, logIndex) resolved deterministically. */
  order: number;

  // --- who / how much ---
  participants: EventParticipant[];
  value?: EventValue;
  txHash?: string;               // FACT anchor
  method?: string;               // FACT: Nansen tx method string

  // --- why it is in the timeline ---
  /** Deterministic significance score (see reconstruction rules). */
  significance: number;
  /** The rule id that admitted this event to the PRIMARY timeline. */
  admissionRule: string;
  /** true = shown on primary timeline; false = available but collapsed. */
  primary: boolean;

  // --- evidence / provenance ---
  /** IDs of relationships this event supports or instantiates. */
  relationshipIds: string[];
  /** The provenance of the event's core claim. */
  provenance: Provenance;
  /** Optional additional interpretive notes, each independently provenanced. */
  annotations?: Array<{ text: string; provenance: Provenance }>;
}
