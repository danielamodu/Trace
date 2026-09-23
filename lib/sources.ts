/**
 * TRACE — Event-level source helpers (Phase 3H).
 *
 * Framework-free projections answering "where did this evidence come from"
 * per event, kept strictly separate from PROVENANCE (what kind of claim):
 *
 *   FACT + fixture-cache   FACT + live-nansen
 *   RELATION + fixture-cache (+ live, when observed)
 *   DERIVED + fixture-only | live-only | mixed
 *
 * Origins come from machine-readable SourceRef.origin (engine-set from the
 * fixture namespace; absent on pre-3H/authored references → 'unknown', never
 * guessed). DERIVED composition resolves through member events, so a computed
 * summary is never mistaken for a directly returned record.
 */

import type { TraceEvent } from '../src/types/events.ts';
import type { InvestigationContract } from '../src/contract/types.ts';
import type { DataSource } from '../src/contract/types.ts';

export type EventOrigin = DataSource | 'mixed' | 'unknown';

const GROUP_TYPES = new Set(['capital-consolidation', 'capital-dispersal']);

function originsOf(provenance: TraceEvent['provenance'] | { kind: string; sources?: Array<{ origin?: unknown }> }): DataSource[] {
  const p = provenance as { kind?: unknown; sources?: unknown };
  if (!Array.isArray(p.sources)) return [];
  const out: DataSource[] = [];
  for (const s of p.sources as Array<{ origin?: unknown }>) {
    if (s.origin === 'fixture-cache' || s.origin === 'live-nansen') out.push(s.origin);
  }
  return out;
}

/**
 * Source composition of one event: member events report their own pool;
 * DERIVED groups report the union across expandable members.
 */
export function eventOrigin(
  contract: InvestigationContract,
  eventId: string,
): EventOrigin {
  const event = contract.investigation.events.find((e) => e.id === eventId);
  if (!event) return 'unknown';
  if (GROUP_TYPES.has(event.type) && event.provenance.kind === 'DERIVED') {
    const memberOrigins = new Set<DataSource>();
    for (const id of event.provenance.sourceEventIds) {
      const m = contract.investigation.events.find((e) => e.id === id);
      if (!m || GROUP_TYPES.has(m.type)) continue;
      for (const o of originsOf(m.provenance)) memberOrigins.add(o);
    }
    if (memberOrigins.size === 0) return 'unknown';
    if (memberOrigins.size > 1) return 'mixed';
    return [...memberOrigins][0];
  }
  const own = new Set(originsOf(event.provenance));
  if (own.size === 0) return 'unknown';
  if (own.size > 1) return 'mixed';
  return [...own][0];
}

/** Short display label for an origin (raw value kept alongside in the UI). */
export function originLabel(origin: EventOrigin): string {
  switch (origin) {
    case 'fixture-cache': return 'Fixture cache';
    case 'live-nansen': return 'Live Nansen capture';
    case 'mixed': return 'Mixed (fixture + live)';
    case 'unknown': return 'Source unavailable';
  }
}
