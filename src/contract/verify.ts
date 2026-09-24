/**
 * TRACE — Artifact self-verification (Pillar ④, "The Flex").
 *
 * A TRACE contract is a portable artifact: hand someone the JSON and they can
 * re-derive its verdict offline, with zero credits and no network. This module
 * is that re-derivation, expressed as a small set of named checks plus a
 * content fingerprint.
 *
 * The spine is the existing `validateContract` (validate.ts), which already
 * recomputes completeness, evidence counts and the data-source pool from the
 * artifact itself and rejects any HYPOTHESIS record. Here we run it and, for
 * legibility, surface the individual re-derivations as separate named checks —
 * the same mechanical facts, presented so a reviewer can read each one.
 *
 * Pure + isomorphic: no fs, no node-only APIs. SHA-256 comes from the Web
 * Crypto API (`globalThis.crypto.subtle`), present in the browser, the Next.js
 * server, and Node ≥ 20 — so the browser panel, the /verify route and the CLI
 * all produce the identical fingerprint for the same artifact.
 */

import type { Investigation } from '../types/investigation.ts';
import { computeCompleteness, countEvidence } from './completeness.ts';
import type { EvidenceCounts } from './completeness.ts';
import { validateContract } from './validate.ts';
import type { Completeness, CoverageReport, DataSource, InvestigationContract } from './types.ts';

export interface VerifyCheck {
  id: 'schema' | 'verdict' | 'counts' | 'no-hypothesis';
  label: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  /** True only when every check passed. */
  ok: boolean;
  algorithm: 'SHA-256';
  /** SHA-256 hex over the canonical (whitespace-independent) contract JSON. */
  fingerprint: string;
  checks: VerifyCheck[];
  /** Raw validateContract errors (empty when ok). */
  errors: string[];
  /** The values re-derived from the artifact, for display. */
  recomputed: { completeness: Completeness; completenessReasons: string[]; counts: EvidenceCounts };
}

/**
 * Deterministic, whitespace-independent JSON serialization: object keys are
 * sorted recursively, so two artifacts with identical content — regardless of
 * key order or formatting — canonicalize to the same string (and fingerprint).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of the canonical JSON, hex-encoded. The artifact's content fingerprint. */
export async function fingerprintContract(contract: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(contract));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/** True if any provenance anywhere is HYPOTHESIS. Mirrors validation's traversal
 *  so the "no inference" claim stands on its own, independent of full validation. */
function hasHypothesis(inv: Investigation): boolean {
  const kinds: unknown[] = [];
  for (const e of inv.events ?? []) kinds.push(e.provenance?.kind);
  for (const en of inv.entities ?? []) {
    kinds.push(en.provenance?.kind);
    for (const l of en.labels ?? []) kinds.push((l as { provenance?: { kind?: unknown } }).provenance?.kind);
  }
  for (const r of inv.relationships ?? []) kinds.push(r.provenance?.kind);
  for (const m of inv.summary ?? []) kinds.push(m.provenance?.kind);
  return kinds.includes('HYPOTHESIS');
}

function countsMatch(recomputed: EvidenceCounts, stored: unknown): boolean {
  if (typeof stored !== 'object' || stored === null) return false;
  const s = stored as Record<string, unknown>;
  return (Object.keys(recomputed) as Array<keyof EvidenceCounts>).every((k) => s[k] === recomputed[k]);
}

/**
 * Re-derive an artifact's verdict from the artifact alone. Offline, no credits.
 * Returns a fingerprint plus four named checks; `ok` is true only when all pass.
 */
export async function verifyContract(contract: unknown): Promise<VerifyResult> {
  const errors = validateContract(contract);
  const fingerprint = await fingerprintContract(contract);
  const c = (typeof contract === 'object' && contract !== null ? contract : {}) as Partial<InvestigationContract>;
  const inv = (c.investigation ?? {}) as Investigation;

  const verdict = computeCompleteness(
    inv,
    (c.coverage ?? { flags: {}, reasons: [] }) as CoverageReport,
    (c.dataSource ?? 'fixture-cache') as DataSource,
  );
  const counts = countEvidence(inv);

  const reasonsMatch =
    JSON.stringify([...verdict.completenessReasons].sort()) ===
    JSON.stringify([...(c.completenessReasons ?? [])].sort());
  const verdictOk = verdict.completeness === c.completeness && reasonsMatch;
  const countsOk = countsMatch(counts, c.evidence);
  const noHypothesis = !hasHypothesis(inv);

  const checks: VerifyCheck[] = [
    {
      id: 'schema',
      label: 'Schema, references & provenance',
      ok: errors.length === 0,
      detail: errors.length === 0
        ? 'Passes full contract validation — schema, cross-references, and provenance rules all hold.'
        : `${errors.length} validation error(s); the artifact is not internally consistent.`,
    },
    {
      id: 'verdict',
      label: 'Completeness verdict re-derived',
      ok: verdictOk,
      detail: verdictOk
        ? `Recomputed independently as '${verdict.completeness}', matching the stored verdict — ${
            verdict.completeness === 'complete'
              ? 'reconstructed, live-nansen, every coverage flag observed.'
              : `${verdict.completenessReasons.length} reason(s) hold.`
          }`
        : `Recomputed '${verdict.completeness}' but the artifact stores '${c.completeness ?? '—'}'.`,
    },
    {
      id: 'counts',
      label: 'Evidence tallies re-derived',
      ok: countsOk,
      detail: countsOk
        ? `${counts.observedFacts} facts · ${counts.observedRelations} relations · ${counts.derivedValues} derived — re-tallied from the timeline, all match.`
        : 'Re-tallied evidence counts do not match the stored evidence block.',
    },
    {
      id: 'no-hypothesis',
      label: 'No inference — zero HYPOTHESIS',
      ok: noHypothesis,
      detail: noHypothesis
        ? 'Every claim is FACT, RELATION, or DERIVED. Nothing interpretive.'
        : 'Contains HYPOTHESIS provenance — interpretive claims are not allowed in the contract.',
    },
  ];

  return {
    ok: checks.every((k) => k.ok),
    algorithm: 'SHA-256',
    fingerprint,
    checks,
    errors,
    recomputed: { completeness: verdict.completeness, completenessReasons: verdict.completenessReasons, counts },
  };
}
