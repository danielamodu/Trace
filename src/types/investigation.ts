/**
 * TRACE — Investigation (Case) model (conceptual types only; no implementation).
 *
 * Composition:  CASE → TIME WINDOW → EVENTS → ENTITIES → RELATIONSHIPS → EVIDENCE
 *
 * The Investigation is the single serializable object the UI renders and the
 * reconstruction pipeline produces. It is fully deterministic from Nansen data
 * plus TRACE's documented rules.
 */

import type { TraceEvent } from './events.ts';
import type { Entity } from './entities.ts';
import type { Relationship } from './relationships.ts';
import type { Provenance, SourceRef } from './provenance.ts';

export interface TimeWindow {
  from: string; // ISO 8601 UTC
  to: string;   // ISO 8601 UTC
}

/** A single measurable headline shown in the incident summary. */
export interface SummaryMetric {
  key: string;                 // e.g. "peak_value_moved_usd"
  label: string;               // "Peak value moved"
  value: number | string;
  unit?: string;               // "USD", "steps", …
  provenance: Provenance;      // FACT or DERIVED — never HYPOTHESIS in the summary
}

export type InvestigationStatus =
  | 'reconstructed'   // pipeline completed, evidence attached
  | 'partial'         // some steps unresolved / data gaps present
  | 'error';

export interface Investigation {
  /** Stable case id, e.g. "case_euler_2023". */
  id: string;
  name: string;                // "Euler Finance exploit and fund return"
  chain: string;               // "ethereum"
  window: TimeWindow;
  status: InvestigationStatus;

  /** One-line thesis shown on load. Never asserts causation. */
  headline: string;

  /** The measurable facts row (summary band). */
  summary: SummaryMetric[];

  /** Chronologically ordered events (primary + collapsed). */
  events: TraceEvent[];

  /** Entities admitted to the case. */
  entities: Entity[];

  /** Relationships (graph edges). */
  relationships: Relationship[];

  /** Known gaps the UI must surface honestly (e.g. pagination, mixer breaks). */
  dataGaps: string[];

  /** Provenance for the case as a whole (which queries built it). */
  sources: SourceRef[];

  /** When this case snapshot was reconstructed. */
  reconstructedAt: string;     // ISO 8601
}

/** Descriptor used by the Command Center to list selectable incidents. */
export interface IncidentDescriptor {
  id: string;
  name: string;
  chain: string;
  window: TimeWindow;
  oneLine: string;
  /** MVP ships exactly one: the Euler case. Others are "coming soon". */
  available: boolean;
}
