/**
 * TRACE — Relationship model (conceptual types only; no implementation).
 *
 * A relationship is an edge between two entities. Edges are either FACTs
 * (a transfer/swap happened) or RELATIONs (Nansen asserts a link). A
 * relationship is never a HYPOTHESIS by itself — interpretation lives on events.
 */

import type { Provenance } from './provenance.ts';

export type RelationshipKind =
  | 'transfer'      // FACT: value moved from → to
  | 'swap'          // FACT: DEX swap between trader and pool/token
  | 'funder'        // RELATION: Nansen "First Funder"
  | 'counterparty'  // FACT: interacted, with aggregate volume/interaction_count
  | 'related-wallet'// RELATION: Nansen related-wallets (e.g. "Deployed Contract")
  | 'flow';         // DERIVED: net directional flow computed across transfers

export interface Relationship {
  id: string;
  kind: RelationshipKind;
  fromEntityId: string;
  toEntityId: string;
  /** Directionality: transfers/swaps are directed; some relations are symmetric. */
  directed: boolean;
  /** Aggregate metrics when Nansen provides them (counterparties) or TRACE derives them. */
  metrics?: {
    interactionCount?: number;   // FACT (counterparties)
    volumeInUsd?: number;        // FACT
    volumeOutUsd?: number;       // FACT
    netFlowUsd?: number;         // DERIVED
  };
  /** Nansen's own relation string when kind is funder/related-wallet. */
  nansenRelation?: string;       // e.g. "First Funder", "Deployed Contract"
  /** The events that instantiate/support this edge. */
  evidenceEventIds: string[];
  provenance: Provenance;
}
