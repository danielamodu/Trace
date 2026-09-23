/**
 * TRACE — Entity model (conceptual types only; no implementation).
 *
 * An entity is any actor or object that participates in the incident. Entities
 * enter the investigation ONLY when a rule admits them (see graph rules in the
 * spec) — TRACE is not a wallet explorer and does not enumerate everything.
 */

import type { Provenance } from './provenance.ts';

export type EntityKind =
  | 'wallet'     // EOA
  | 'contract'   // smart contract
  | 'exchange'   // CEX entity
  | 'protocol'   // DeFi protocol (e.g. Euler, Balancer)
  | 'token'      // an ERC-20 involved in the flow
  | 'cluster';   // a Nansen-labelled entity aggregating multiple addresses

/** A Nansen label attached to an entity (always FACT-sourced, free inline). */
export interface EntityLabel {
  label: string;                 // e.g. "balancervault.eth", "Euler Exploiter"
  category?: string;             // e.g. "Exploit", "DEX"
  tags?: string[];               // e.g. ["Blacklist","Attack","Exploit"]
  provenance: Provenance;        // typically FACT
}

export interface Entity {
  /** Stable id within an investigation (e.g. "entity_attacker"). */
  id: string;
  kind: EntityKind;
  /** Primary on-chain address (absent for pure cluster/token groupings). */
  address?: string;
  chain: string;                 // "ethereum" for the hero incident
  /** Display name TRACE shows; derived from label or shortened address. */
  displayName: string;
  labels: EntityLabel[];
  /** The investigative role TRACE assigns. Roles above "subject" are HYPOTHESIS. */
  role: EntityRole;
  /** Why this entity is in the case (admission rule that let it in). */
  admissionReason: string;
  provenance: Provenance;
}

/**
 * Investigative role. "subject"/"funder"/"counterparty" are grounded in
 * Nansen relations/facts. "attacker"/"beneficiary" are interpretive and must
 * carry HYPOTHESIS provenance — TRACE labels roles, it does not accuse.
 */
export type EntityRole =
  | 'subject'        // the address the case centers on (FACT: it exists / has activity)
  | 'funder'         // RELATION: Nansen "First Funder"
  | 'counterparty'   // FACT: appears in counterparties/transfers
  | 'liquidity-source' // e.g. Balancer Vault (FACT it interacted; role is interpretive)
  | 'sink'           // burn / consolidation target (FACT: received; role interpretive)
  | 'attacker'       // HYPOTHESIS
  | 'beneficiary';   // HYPOTHESIS
