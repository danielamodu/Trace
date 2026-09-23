/**
 * TRACE — Evidence-graph data builders (Phase 3E).
 *
 * Pure, deterministic, contract-only projections for the supporting
 * relationship view. The graph answers "which entities are directly connected
 * to this evidence" — nothing more:
 *
 *  - SUPPORTED kinds only: transfer, swap, funder, related-wallet,
 *    counterparty. DERIVED flow edges are excluded structurally (kind filter)
 *    AND defensively (provenance filter), so a computed summary can never
 *    render as an observed transaction.
 *  - Counterparty aggregates keep their undirected, aggregate character
 *    (directed: false); direction is shown only where the contract supports it.
 *  - Unknown/isolated focus yields an empty graph; the UI renders an explicit
 *    empty state instead of inventing edges.
 */

import type { Entity } from '../src/types/entities.ts';
import type { TraceEvent } from '../src/types/events.ts';
import type { InvestigationContract } from '../src/contract/types.ts';
import { focusAddressForEvent } from './follow.ts';

export const SUPPORTED_EDGE_KINDS = new Set([
  'transfer',
  'swap',
  'funder',
  'related-wallet',
  'counterparty',
]);

export interface GraphNodeDatum {
  entityId: string;
  address: string;
  displayName: string;
  role: string;
  isFocus: boolean;
}

export interface GraphEdgeDatum {
  id: string;
  kind: string;
  fromEntityId: string;
  toEntityId: string;
  directed: boolean;
  evidenceCount: number;
  evidenceEventIds: string[];
  nansenRelation: string | null;
}

export interface GraphData {
  focusEntityId: string | null;
  nodes: GraphNodeDatum[];
  edges: GraphEdgeDatum[];
}

const EDGE_RANK = ['funder', 'related-wallet', 'transfer', 'swap', 'counterparty'] as const;

/** Default visible edges in the supporting graph; the rest hide behind an explicit toggle. */
export const VISIBLE_EDGE_LIMIT = 5;

function edgeRank(kind: string): number {
  const i = (EDGE_RANK as readonly string[]).indexOf(kind);
  return i === -1 ? 99 : i;
}

export function entityIdForAddress(
  contract: InvestigationContract,
  address: string,
): string | null {
  const found = contract.investigation.entities.find(
    (en) => (en.address ?? '').toLowerCase() === address.toLowerCase(),
  );
  return found ? found.id : null;
}

/** Focus address for an event: shared rule with follow-the-money. */
export function focusForEvent(
  contract: InvestigationContract,
  eventId: string,
): string | null {
  const event = contract.investigation.events.find((e) => e.id === eventId);
  if (!event) return null;
  const addressById = new Map(
    contract.investigation.entities.map((en) => [en.id, en.address ?? en.id]),
  );
  return focusAddressForEvent(event, addressById);
}

/**
 * Directly observed neighborhood of one entity. Sorted deterministically
 * (edges by kind rank then id; nodes by entity id). Empty when the address
 * resolves to no entity or no supported edge.
 */
export function buildGraphData(
  contract: InvestigationContract,
  focusAddress: string,
): GraphData {
  const inv = contract.investigation;
  const focusEntityId = entityIdForAddress(contract, focusAddress);
  if (focusEntityId === null) return { focusEntityId: null, nodes: [], edges: [] };

  const edges: GraphEdgeDatum[] = [];
  for (const r of inv.relationships) {
    if (!SUPPORTED_EDGE_KINDS.has(r.kind)) continue;
    if (r.provenance.kind === 'DERIVED') continue;
    if (r.fromEntityId !== focusEntityId && r.toEntityId !== focusEntityId) continue;
    edges.push({
      id: r.id,
      kind: r.kind,
      fromEntityId: r.fromEntityId,
      toEntityId: r.toEntityId,
      directed: r.directed,
      evidenceCount: r.evidenceEventIds.length,
      evidenceEventIds: [...r.evidenceEventIds].sort(),
      nansenRelation: r.nansenRelation ?? null,
    });
  }
  edges.sort((a, b) => edgeRank(a.kind) - edgeRank(b.kind) || (a.id < b.id ? -1 : 1));
  if (edges.length === 0) return { focusEntityId, nodes: [], edges: [] };

  const byId = new Map(inv.entities.map((en) => [en.id, en]));
  const neighborIds = new Set<string>();
  for (const e of edges) {
    neighborIds.add(e.fromEntityId);
    neighborIds.add(e.toEntityId);
  }
  neighborIds.delete(focusEntityId);
  const nodes: GraphNodeDatum[] = [];
  const focus = byId.get(focusEntityId);
  if (focus) nodes.push(toNode(focus, true));
  for (const id of [...neighborIds].sort()) {
    const en = byId.get(id);
    if (en) nodes.push(toNode(en, false));
  }
  return { focusEntityId, nodes, edges };
}

function toNode(en: Entity, isFocus: boolean): GraphNodeDatum {
  return {
    entityId: en.id,
    address: en.address ?? en.id,
    displayName: en.displayName,
    role: en.role,
    isFocus,
  };
}

/** Observed (non-group) events involving an address, in timeline order. */
export function eventsForEntity(
  contract: InvestigationContract,
  address: string,
): TraceEvent[] {
  const entityId = entityIdForAddress(contract, address);
  if (entityId === null) return [];
  return contract.investigation.events.filter(
    (e) => e.type !== 'capital-consolidation' && e.type !== 'capital-dispersal'
      && e.participants.some((p) => p.entityId === entityId),
  );
}

/**
 * Prioritized visible subset of a neighborhood (Phase 3J). The supporting
 * graph shows immediate, investigation-relevant edges by default instead of
 * the full relationship universe:
 *   1. the explicitly selected edge (when present),
 *   2. edges backing the selected event,
 *   3. remaining edges by kind tier (reported links before movements before
 *      window aggregates), evidence count, then id.
 * Deterministic; the hidden remainder stays available via an explicit toggle —
 * never filtered by significance, ownership, or any interpretation.
 */
export function prioritizeEdges(
  edges: GraphEdgeDatum[],
  activeEdgeIds: string[],
  selectedEdgeId: string | null,
  limit: number = VISIBLE_EDGE_LIMIT,
): GraphEdgeDatum[] {
  const active = new Set(activeEdgeIds);
  const rank = (e: GraphEdgeDatum): number => {
    if (selectedEdgeId !== null && e.id === selectedEdgeId) return 0;
    if (active.has(e.id)) return 1;
    return 2;
  };
  return [...edges]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        edgeRank(a.kind) - edgeRank(b.kind) ||
        b.evidenceCount - a.evidenceCount ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, Math.max(0, limit));
}
