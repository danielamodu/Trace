/**
 * TRACE — "Nansen authority" projection (Pillar ④B).
 *
 * A whole-contract summary of what Nansen contributed that a raw block explorer
 * cannot: resolved identity (labels), asserted relationships (First Funder and
 * other related-wallet links), and pre-aggregated counterparty volume — plus the
 * exact Nansen endpoints each datum was cited to.
 *
 * Pure and deterministic: derived ONLY from data already in the contract. No new
 * inference, no fetch, no network — the same discipline as the reconstruction
 * itself. Every figure here is recomputable from the served JSON alone.
 */

import type { Entity } from '../src/types/entities.ts';
import type { NansenSource } from '../src/types/provenance.ts';
import type { DataSource, InvestigationContract } from '../src/contract/types.ts';

export interface NamedEntityRef {
  entityId: string;
  /** The Nansen name (bracketed-address noise stripped). e.g. "UniswapV2". */
  name: string;
  address?: string;
  role: Entity['role'];
}

export interface AuthorityRelation {
  id: string;
  /** Nansen's own relation string, e.g. "First Funder", "Deployed Contract". */
  nansenRelation: string;
  fromName: string;
  toName: string;
}

export interface CounterpartyAgg {
  id: string;
  name: string;
  address?: string;
  interactionCount?: number;
  /** Observed USD moved through this counterparty (in + out), from Nansen. */
  volumeUsd: number;
}

export interface EndpointUse {
  endpoint: NansenSource;
  /** How many SourceRefs across the whole contract cite this endpoint. */
  citations: number;
}

export interface NansenAuthority {
  entitiesTotal: number;
  /** Entities Nansen resolves to a human/entity name (not a bare hex address). */
  entitiesNamed: number;
  namedSamples: NamedEntityRef[];
  relations: AuthorityRelation[];
  counterpartiesTotal: number;
  counterpartiesWithVolume: number;
  topCounterparties: CounterpartyAgg[];
  totalCounterpartyVolumeUsd: number;
  endpoints: EndpointUse[];
  origins: DataSource[];
  /** Total FACT/RELATION source citations across events, entities, relationships. */
  citationsTotal: number;
}

const ROLE_RANK: Record<string, number> = {
  subject: 0,
  funder: 1,
  'liquidity-source': 2,
  sink: 3,
  counterparty: 4,
  attacker: 5,
  beneficiary: 6,
};

/**
 * Strip bracketed / bare hex-address tokens from a Nansen label and return the
 * remaining human name, or null if nothing but an address was there.
 * "UniswapV2 [0x003590]" → "UniswapV2"; "[0x036cec]" → null; "motunrayo.eth*" → itself.
 */
export function labelName(label: string): string | null {
  const stripped = label
    .replace(/\[?0x[0-9a-fA-F]{4,}\]?/g, '')
    .replace(/\[\s*\]/g, '')
    .trim();
  return stripped.length > 0 ? stripped : null;
}

/** The first named label on an entity (Nansen identity), or null if unnamed. */
function namedLabelOf(entity: Entity): string | null {
  for (const l of entity.labels) {
    const n = labelName(l.label);
    if (n) return n;
  }
  return null;
}

function volumeOf(metrics: { volumeInUsd?: number; volumeOutUsd?: number } | undefined): number {
  if (!metrics) return 0;
  const inUsd = Number.isFinite(metrics.volumeInUsd) ? (metrics.volumeInUsd as number) : 0;
  const outUsd = Number.isFinite(metrics.volumeOutUsd) ? (metrics.volumeOutUsd as number) : 0;
  return inUsd + outUsd;
}

/** Build the Nansen-authority summary from a contract. Deterministic. */
export function buildNansenAuthority(contract: InvestigationContract): NansenAuthority {
  const inv = contract.investigation;
  const byId = new Map<string, Entity>(inv.entities.map((e) => [e.id, e]));
  const subjectId = inv.entities.find((e) => e.role === 'subject')?.id ?? null;

  // ---- identity: which addresses Nansen resolves to a name ------------------
  const named: NamedEntityRef[] = [];
  for (const e of inv.entities) {
    const name = namedLabelOf(e);
    if (name) named.push({ entityId: e.id, name, address: e.address, role: e.role });
  }
  named.sort(
    (a, b) =>
      (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) ||
      a.name.localeCompare(b.name) ||
      a.entityId.localeCompare(b.entityId),
  );

  // ---- relationships Nansen asserts (funder / related-wallet) ---------------
  const nameFor = (id: string): string => {
    const e = byId.get(id);
    if (!e) return id;
    return namedLabelOf(e) ?? e.displayName;
  };
  const relations: AuthorityRelation[] = inv.relationships
    .filter((r) => (r.kind === 'funder' || r.kind === 'related-wallet') && r.nansenRelation)
    .map((r) => ({
      id: r.id,
      nansenRelation: r.nansenRelation as string,
      fromName: nameFor(r.fromEntityId),
      toName: nameFor(r.toEntityId),
    }))
    .sort((a, b) => a.nansenRelation.localeCompare(b.nansenRelation) || a.id.localeCompare(b.id));

  // ---- counterparty aggregates (Nansen pre-aggregated volume) ---------------
  const cpRels = inv.relationships.filter((r) => r.kind === 'counterparty');
  const counterparties: CounterpartyAgg[] = cpRels.map((r) => {
    // the non-subject end is the counterparty
    const cpId = r.fromEntityId === subjectId ? r.toEntityId : r.fromEntityId;
    const e = byId.get(cpId);
    return {
      id: r.id,
      name: (e && (namedLabelOf(e) ?? e.displayName)) ?? cpId,
      address: e?.address,
      interactionCount: r.metrics?.interactionCount,
      volumeUsd: volumeOf(r.metrics),
    };
  });
  const totalCounterpartyVolumeUsd = counterparties.reduce((s, c) => s + c.volumeUsd, 0);
  const topCounterparties = [...counterparties]
    .sort((a, b) => b.volumeUsd - a.volumeUsd || a.id.localeCompare(b.id))
    .slice(0, 5);

  // ---- citation surface: which Nansen endpoints backed the evidence ---------
  const endpointCounts = new Map<NansenSource, number>();
  const origins = new Set<DataSource>();
  let citationsTotal = 0;
  const collect = (p: unknown) => {
    const prov = p as { kind?: string; sources?: Array<{ source: NansenSource; origin?: DataSource }> };
    if ((prov.kind === 'FACT' || prov.kind === 'RELATION') && Array.isArray(prov.sources)) {
      for (const s of prov.sources) {
        citationsTotal += 1;
        endpointCounts.set(s.source, (endpointCounts.get(s.source) ?? 0) + 1);
        if (s.origin === 'fixture-cache' || s.origin === 'live-nansen') origins.add(s.origin);
      }
    }
  };
  for (const e of inv.events) collect(e.provenance);
  for (const e of inv.entities) {
    collect(e.provenance);
    for (const l of e.labels) collect(l.provenance);
  }
  for (const r of inv.relationships) collect(r.provenance);

  const endpoints: EndpointUse[] = [...endpointCounts.entries()]
    .map(([endpoint, citations]) => ({ endpoint, citations }))
    .sort((a, b) => b.citations - a.citations || a.endpoint.localeCompare(b.endpoint));

  return {
    entitiesTotal: inv.entities.length,
    entitiesNamed: named.length,
    namedSamples: named.slice(0, 8),
    relations,
    counterpartiesTotal: cpRels.length,
    counterpartiesWithVolume: counterparties.filter((c) => c.volumeUsd > 0).length,
    topCounterparties,
    totalCounterpartyVolumeUsd,
    endpoints,
    origins: [...origins].sort(),
    citationsTotal,
  };
}
