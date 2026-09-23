/**
 * TRACE — Follow-the-money algorithm (Phase 3E).
 *
 * Pure, deterministic, contract-only. Given a selected event, identifies the
 * relevant observed entity and walks to the next chronological OBSERVED event
 * involving that same entity. Never invents transfers, never implies
 * causality, never crosses entities, and never lands on DERIVED groups:
 *
 *  - Entity rule: preferred participant side order to → from → actor →
 *    counterparty (first match). The money's destination leads.
 *  - Candidate rule: member events (never capital-consolidation/dispersal
 *    groups) positioned later in the final timeline order that list the
 *    entity as a participant. Counterparty aggregates create no events, so
 *    they can never fabricate a hop.
 *  - Dead end: exact message "No subsequent supported movement in captured
 *    evidence." — rendered verbatim by the UI.
 *
 * No network, no Nansen, no hypotheses.
 */

import type { TraceEvent } from '../src/types/events.ts';
import type { InvestigationContract } from '../src/contract/types.ts';

/** Exact dead-end copy. The UI renders this verbatim; tests pin it. */
export const FOLLOW_DEAD_END = 'No subsequent supported movement in captured evidence.';

const GROUP_TYPES = new Set(['capital-consolidation', 'capital-dispersal']);
const SIDE_RANK = ['to', 'from', 'actor', 'counterparty'] as const;

export interface FollowStep {
  /** Address being followed (verbatim from the contract). */
  entity: string;
  fromEventId: string;
  toEventId: string;
}

export type FollowResult =
  | { kind: 'followed'; step: FollowStep }
  | { kind: 'dead-end'; entity: string; fromEventId: string };

function addressOf(entityId: string, byId: Map<string, string>): string | null {
  return byId.get(entityId) ?? null;
}

/**
 * The relevant observed entity for an event: first participant in side order
 * to → from → actor → counterparty. Returns null when the event has no
 * addressable participant (never happens for engine output, guarded anyway).
 */
export function focusAddressForEvent(
  event: TraceEvent,
  entityAddressById: Map<string, string>,
): string | null {
  for (const side of SIDE_RANK) {
    const p = event.participants.find((x) => x.side === side);
    if (p) {
      const addr = addressOf(p.entityId, entityAddressById);
      if (addr !== null) return addr;
    }
  }
  return null;
}

function entityIdForAddress(
  address: string,
  entityIdByAddress: Map<string, string>,
): string | null {
  return entityIdByAddress.get(address.toLowerCase()) ?? null;
}

/**
 * Single deterministic follow step from `fromEventId`. Targets are observed
 * member events later in timeline order involving the same address.
 */
export function followFromEvent(
  contract: InvestigationContract,
  fromEventId: string,
): FollowResult | null {
  const inv = contract.investigation;
  const events = inv.events;
  const fromIdx = events.findIndex((e) => e.id === fromEventId);
  if (fromIdx === -1) return null;
  const fromEvent = events[fromIdx];

  const addressById = new Map(inv.entities.map((en) => [en.id, en.address ?? en.id]));
  const entity = focusAddressForEvent(fromEvent, addressById);
  if (entity === null) return null;
  const idByAddress = new Map(inv.entities.map((en) => [(en.address ?? en.id).toLowerCase(), en.id]));
  const entityId = entityIdForAddress(entity, idByAddress);
  if (entityId === null) return null;

  for (let i = fromIdx + 1; i < events.length; i++) {
    const cand = events[i];
    if (GROUP_TYPES.has(cand.type)) continue; // summaries are never movements
    if (cand.participants.some((p) => p.entityId === entityId)) {
      return { kind: 'followed', step: { entity, fromEventId, toEventId: cand.id } };
    }
  }
  return { kind: 'dead-end', entity, fromEventId };
}

/** Convenience for the UI: can this event be followed anywhere? */
export function canFollow(contract: InvestigationContract, fromEventId: string): boolean {
  const r = followFromEvent(contract, fromEventId);
  return r !== null && r.kind === 'followed';
}

/**
 * Deterministic full walk from a starting event (repeated single steps).
 * Used by tests to pin trail stability; the UI advances one step per click.
 */
export function walkTrail(contract: InvestigationContract, startEventId: string): FollowStep[] {
  const steps: FollowStep[] = [];
  const seen = new Set<string>([startEventId]);
  let current = startEventId;
  for (;;) {
    const r = followFromEvent(contract, current);
    if (r === null || r.kind === 'dead-end') return steps;
    if (seen.has(r.step.toEventId)) return steps; // cycle guard (unreachable on ordered timelines)
    seen.add(r.step.toEventId);
    steps.push(r.step);
    current = r.step.toEventId;
  }
}
