/**
 * TRACE — Evidence completeness computation (Phase 3C).
 *
 * Pure functions, zero dependencies. Two halves:
 *  - countEvidence: recomputable SOLELY from an Investigation (used by both
 *    assembly and validation, so the contract cannot drift from its case).
 *  - computeCompleteness / computeEvidence: assemble the full metadata,
 *    including build-input facts (duplicates, unavailable fields) that the
 *    Investigation alone cannot carry.
 *
 * Completeness rule (documented, enforced by validation):
 *   complete IFF status === 'reconstructed'
 *             AND dataSource === 'live-nansen'
 *             AND every coverage flag is true.
 * Fixture-cache reconstructions are therefore NEVER complete: cached snapshots
 * are point-in-time and revisable (Phase 1 finding), so completeness cannot be
 * claimed from fixtures alone. Every failing check yields an explicit reason.
 */

import type { Investigation } from '../types/investigation.ts';
import type { EngineInput, EngineStats } from '../reconstruction/engine.ts';
import type {
  Completeness,
  CoverageReport,
  DataSource,
  EvidenceCompleteness,
} from './types.ts';

/** Fixed unresolved engine limitations attached to every contract. */
export const ENGINE_LIMITATIONS: readonly string[] = [
  'Nansen rows carry no txIndex/logIndex; intra-block ordering is at txHash granularity (no invented indexes).',
  'Counterparty rows are window-level aggregates; per-hop causal links between aggregates are not evidenced and are never inferred.',
  'Flow dex/cex splits are null for non-exchange labels; cohort splits require flow-intelligence.',
  'Fixture snapshots are point-in-time and revisable; re-capture may shift labels and prices.',
  'Transaction rows carry no per-token USD; row-level volume_usd is used and never estimated when absent.',
  'DERIVED groupings are computed summaries, not observed facts; members remain listed individually.',
  'No HYPOTHESIS records are produced; intent, attribution, and causation questions are out of scope for this contract.',
];

/** Subset of EvidenceCompleteness recomputable from the Investigation alone. */
export interface EvidenceCounts {
  observedFacts: number;
  observedRelations: number;
  derivedValues: number;
  derivedGroupings: number;
  derivedFlowEdges: number;
  primaryEvents: number;
  collapsedEvents: number;
  eventsMissingUsd: number;
}

export function countEvidence(inv: Investigation): EvidenceCounts {
  let observedFacts = 0;
  let observedRelations = 0;
  let derivedValues = 0;
  const bump = (kind: string): void => {
    if (kind === 'FACT') observedFacts += 1;
    else if (kind === 'RELATION') observedRelations += 1;
    else if (kind === 'DERIVED') derivedValues += 1;
  };
  for (const e of inv.events ?? []) bump(e.provenance?.kind as string);
  for (const en of inv.entities ?? []) {
    // The case-subject entity is authored input, not Nansen-observed evidence;
    // it is excluded so observedFacts counts observations only.
    if ((en as { role?: unknown }).role === 'subject') continue;
    bump(en.provenance?.kind as string);
  }
  for (const r of inv.relationships ?? []) bump(r.provenance?.kind as string);

  const derivedGroupings = (inv.events ?? []).filter(
    (e) => e.type === 'capital-consolidation' || e.type === 'capital-dispersal',
  ).length;
  const derivedFlowEdges = (inv.relationships ?? []).filter((r) => r.kind === 'flow').length;
  const primaryEvents = (inv.events ?? []).filter((e) => e.primary === true).length;
  const collapsedEvents = (inv.events ?? []).length - primaryEvents;
  const eventsMissingUsd = (inv.events ?? []).filter(
    (e) => e.type !== 'capital-consolidation' && e.type !== 'capital-dispersal' && !('value' in e),
  ).length;
  return {
    observedFacts,
    observedRelations,
    derivedValues,
    derivedGroupings,
    derivedFlowEdges,
    primaryEvents,
    collapsedEvents,
    eventsMissingUsd,
  };
}

/**
 * Aggregate `unavailableFields` across normalized build inputs: unique,
 * sorted, deterministic. Returns [] when inputs are absent (documented).
 */
export function aggregateUnavailableFields(input?: EngineInput): string[] {
  if (input === undefined || input === null) return [];
  const seen = new Set<string>();
  const kinds = ['transfers', 'swaps', 'counterparties', 'relationships', 'transactions', 'flows'] as const;
  for (const k of kinds) {
    const arr = (input as Record<string, unknown>)[k];
    if (!Array.isArray(arr)) continue;
    for (const rec of arr) {
      if (typeof rec === 'object' && rec !== null && Array.isArray((rec as Record<string, unknown>).unavailableFields)) {
        for (const f of (rec as { unavailableFields: unknown[] }).unavailableFields) {
          if (typeof f === 'string') seen.add(f);
        }
      }
    }
  }
  return [...seen].sort();
}

export function computeCompleteness(
  inv: Investigation,
  coverage: CoverageReport,
  dataSource: DataSource,
): { completeness: Completeness; completenessReasons: string[] } {
  const reasons: string[] = [];
  if (inv.status !== 'reconstructed') {
    reasons.push(
      `status is '${inv.status}': the reconstruction did not resolve to a primary timeline and must not be presented as complete.`,
    );
  }
  if (dataSource !== 'live-nansen') {
    reasons.push(
      `dataSource is '${dataSource}': cached snapshots are point-in-time and revisable, so completeness cannot be claimed from fixtures alone.`,
    );
  }
  const flagNotes: Record<keyof CoverageReport['flags'], string> = {
    fundingEvidence: 'no funding/relation evidence was observed for this case.',
    counterpartyAggregates: 'no counterparty aggregates were observed for this case.',
    transactionWindowCovered:
      'per-transaction rows do not cover the incident window of interest (latest-first dust sample; exploit-day rows require pagination/live capture).',
  };
  (Object.keys(flagNotes) as Array<keyof CoverageReport['flags']>).forEach((flag) => {
    if (coverage.flags[flag] !== true) {
      const detail = coverage.reasons.find((r) => r.includes(flag));
      reasons.push(
        `coverage.${flag} is false: ${detail ?? flagNotes[flag]}`,
      );
    }
  });
  return { completeness: reasons.length === 0 ? 'complete' : 'incomplete', completenessReasons: reasons };
}

export function computeEvidence(
  inv: Investigation,
  stats: EngineStats,
  input?: EngineInput,
): EvidenceCompleteness {
  const counts = countEvidence(inv);
  return {
    ...counts,
    duplicatesSkipped: stats.duplicatesSkipped,
    flowsSkipped: stats.flowsSkipped,
    unavailableFields: aggregateUnavailableFields(input),
    limitations: [...ENGINE_LIMITATIONS],
  };
}

/**
 * Evidence-pool enumeration for a contract (Phase 3H). Collects machine-
 * readable `origin` values from every SourceRef across events, entities
 * (incl. labels), relationships, and summary metrics. Sorted unique. Empty
 * when no origin was recorded (pre-3H builds) — never defaulted.
 */
export function collectOrigins(inv: Investigation): DataSource[] {
  const seen = new Set<string>();
  const refs: Array<{ sources?: unknown }> = [];
  for (const e of inv.events ?? []) refs.push(e.provenance as unknown as { sources?: unknown });
  for (const en of inv.entities ?? []) {
    refs.push(en.provenance as unknown as { sources?: unknown });
    for (const l of en.labels ?? []) refs.push(l.provenance as unknown as { sources?: unknown });
  }
  for (const r of inv.relationships ?? []) refs.push(r.provenance as unknown as { sources?: unknown });
  for (const m of inv.summary ?? []) refs.push(m.provenance as unknown as { sources?: unknown });
  for (const p of refs) {
    const sources = (p as { sources?: unknown }).sources;
    if (!Array.isArray(sources)) continue;
    for (const s of sources) {
      const origin = (s as { origin?: unknown }).origin;
      if (origin === 'fixture-cache' || origin === 'live-nansen') seen.add(origin);
    }
  }
  return [...seen].sort() as DataSource[];
}
