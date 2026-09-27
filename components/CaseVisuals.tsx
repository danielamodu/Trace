import {
  Banknote, Send, Repeat, Zap, Combine, Split, Link2,
  type LucideIcon,
} from 'lucide-react';
import type { EventType } from '@/src/types/events.ts';
import type { Provenance, ProvenanceKind } from '@/src/types/provenance.ts';
import type { InvestigationContract } from '@/src/contract/types.ts';
import type { Entity } from '@/src/types/entities.ts';

/** Per-event-type sticker hue + icon + noun. Colours are the Duolingo family. */
export interface EventStyle {
  hue: string;
  lip: string;
  Icon: LucideIcon;
  noun: string;
}

export const EVENT_STYLE: Record<EventType, EventStyle> = {
  funding: { hue: '#58cc02', lip: '#58a700', Icon: Banknote, noun: 'Funding' },
  transfer: { hue: '#1cb0f6', lip: '#1899d6', Icon: Send, noun: 'Transfer' },
  swap: { hue: '#ce82ff', lip: '#a568cc', Icon: Repeat, noun: 'Swap' },
  'contract-interaction': { hue: '#ff9600', lip: '#e58600', Icon: Zap, noun: 'Contract call' },
  'capital-consolidation': { hue: '#ffc800', lip: '#e0a800', Icon: Combine, noun: 'Consolidation' },
  'capital-dispersal': { hue: '#ffc800', lip: '#e0a800', Icon: Split, noun: 'Dispersal' },
  'entity-relationship': { hue: '#ce82ff', lip: '#a568cc', Icon: Link2, noun: 'Relationship' },
};

/** DERIVED groupings summarise; they are not directed hops on the money trail. */
export const DERIVED_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  'capital-consolidation',
  'capital-dispersal',
]);

/** Provenance vocabulary — semantic and load-bearing. */
export interface ProvStyle {
  label: string;
  bg: string;
  fg: string;
  bd: string;
}

export const PROV: Record<ProvenanceKind, ProvStyle> = {
  FACT: { label: 'Fact', bg: '#f2f2f2', fg: '#4b4b4b', bd: '#e5e5e5' },
  RELATION: { label: 'Relation', bg: '#f7ecff', fg: '#9d4edd', bd: '#e9ccff' },
  DERIVED: { label: 'Derived', bg: '#e8f7ff', fg: '#1478b4', bd: '#c7ebff' },
  HYPOTHESIS: { label: 'Hypothesis', bg: '#fff4e5', fg: '#c9760a', bd: '#ffe0b3' },
};

/** A little semantic provenance chip. */
export function ProvenanceTag({ provenance, className }: { provenance: Provenance; className?: string }) {
  const s = PROV[provenance.kind];
  return (
    <span
      className={`pill ${className ?? ''}`}
      style={{ background: s.bg, color: s.fg, borderColor: s.bd }}
    >
      {s.label}
    </span>
  );
}

/** Resolve an entityId against the contract's entity table. */
export function entityById(contract: InvestigationContract, id: string): Entity | undefined {
  return contract.investigation.entities.find((e) => e.id === id);
}

/** Human wording for a participant side. */
export function sideLabel(side: 'from' | 'to' | 'actor' | 'counterparty'): string {
  switch (side) {
    case 'from': return 'From';
    case 'to': return 'To';
    case 'actor': return 'Actor';
    case 'counterparty': return 'Counterparty';
  }
}
