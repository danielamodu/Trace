/**
 * TRACE — Deterministic reconstruction engine (Phase 3B).
 *
 * Transforms normalized fixture records into a provenance-preserving
 * investigation reconstruction. Pure functions, zero dependencies.
 *
 * Pipeline:
 *   validate → canonical-sort → dedupe → extract candidate events
 *     → meaningful-event admission → deterministic ordering
 *     → entity assembly → relationship assembly
 *     → derived consolidation/dispersal grouping → Investigation case
 *
 * Strict evidence rules (enforced):
 *  - Never claims intent, ownership, exploit attribution, or causality. Titles
 *    and statements are descriptive; interpretive roles are never assigned.
 *  - Derived groupings carry DERIVED provenance with `calculation` named and
 *    `sourceEventIds` listing every member (expandable).
 *  - No HYPOTHESIS records are produced anywhere in this engine.
 *  - Missing USD / quantities / timestamps are never fabricated. A missing
 *    value stays absent; a missing/invalid timestamp fails loudly (EngineError).
 *  - Nansen relationships ("First Funder", etc.) are reported as reported
 *    links, never as proof of common control.
 *
 * Determinism: identical inputs (+ fixed `reconstructedAt`) → byte-identical
 * output. The only non-deterministic default is `reconstructedAt` when the
 * caller does not provide it (wall-clock read, documented).
 */

import type {
  CounterpartyFact,
  FlowBucketFact,
  Provenanced,
  RelationshipRelation,
  SourceMeta,
  SwapFact,
  TransferFact,
} from './normalized-types.ts';
import type {
  NormalizedTransaction,
  TransactionFact,
} from './transaction.ts';
import type { Entity, EntityRole } from '../types/entities.ts';
import type { TraceEvent, EventType } from '../types/events.ts';
import type { Investigation, SummaryMetric } from '../types/investigation.ts';
import type {
  Provenance,
  SourceRef,
} from '../types/provenance.ts';
import type { Relationship, RelationshipKind } from '../types/relationships.ts';

// ---------------------------------------------------------------------------
// Public constants (documented thresholds & rules)
// ---------------------------------------------------------------------------

/** Engine version stamped into grouping calculations for reproducibility. */
export const ENGINE_VERSION = 'trace-3b/1.0.0';

/**
 * Meaningful-event value floor (USD). A record with `valueUsd >= threshold`
 * is admitted as primary via rule `value-threshold`. Boundary is INCLUSIVE:
 * exactly $1,000,000 admits. `null` USD never admits via this rule (absence is
 * not zero).
 */
export const DEFAULT_VALUE_THRESHOLD_USD = 1_000_000;

/** Minimum member events for a derived consolidation/dispersal grouping. */
export const DEFAULT_MIN_GROUP_MEMBERS = 2;

/** The burn sink. Any movement touching it admits via rule `burn-sink`. */
export const BURN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Contract-interaction admission: a transaction whose lowercased `method`
 * contains one of these substrings is admitted via `method-of-interest`.
 * Plain value-movement methods ("received", "sent", "transfer…") are NOT here —
 * those become `transfer` events, not contract interactions.
 */
export const METHOD_OF_INTEREST_SUBSTRINGS = [
  'flashloan',
  'flash_loan',
  'swap',
  'multicall',
  'borrow',
  'mint',
  'deposit',
  'withdraw',
  'repay',
  'liquidat',
  'delegate',
  'permit',
] as const;

/** Transaction methods treated as plain value movement (→ `transfer`). */
export const TRANSFER_LIKE_METHODS = new Set(['received', 'sent']);

/** Admission rule ids. Every event records exactly one (its primary reason). */
export type AdmissionRuleId =
  | 'value-threshold'
  | 'nansen-relation'
  | 'method-of-interest'
  | 'burn-sink'
  | 'below-threshold' // retained but collapsed (primary:false)
  | 'derived-grouping'; // DERIVED consolidation/dispersal groups

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when engine input is invalid. Never silently repaired. */
export class EngineError extends Error {
  readonly field: string;
  readonly recordIndex: number | null;
  constructor(message: string, field: string, recordIndex: number | null = null) {
    super(message);
    this.name = 'EngineError';
    this.field = field;
    this.recordIndex = recordIndex;
  }
}

// ---------------------------------------------------------------------------
// Public input / output shapes
// ---------------------------------------------------------------------------

/** Already-normalized records the engine consumes. All fields optional (default []). */
export interface EngineInput {
  transfers?: TransferFact[];
  swaps?: SwapFact[];
  counterparties?: CounterpartyFact[];
  relationships?: RelationshipRelation[];
  transactions?: TransactionFact[];
  /**
   * Accepted for forward-compatibility but explicitly NOT eventized: flow
   * buckets are window aggregates without transaction anchors. Listed in
   * `stats.flowsSkipped` when present.
   */
  flows?: FlowBucketFact[];
}

/** The case subject the reconstruction centers on. */
export interface ReconstructionSubject {
  address: string;
  chain: string;
  displayName?: string;
  labels?: string[];
}

/** Case-level authoring input (not Nansen evidence — descriptive only). */
export interface CaseDescriptor {
  id: string;
  name: string;
  /** One-line thesis. Must not assert causation (caller responsibility). */
  headline: string;
  window: { from: string; to: string };
}

export interface EngineOptions {
  valueThresholdUsd?: number;
  minGroupMembers?: number;
  /** Fixed timestamp for deterministic output. Defaults to wall-clock (documented). */
  reconstructedAt?: string;
}

export interface EngineStats {
  inputsReceived: number;
  duplicatesSkipped: number;
  flowsSkipped: number;
  memberEvents: number;
  primaryEvents: number;
  collapsedEvents: number;
  groupsDerived: number;
  entitiesAssembled: number;
  relationshipsAssembled: number;
}

export interface ReconstructionResult {
  investigation: Investigation;
  stats: EngineStats;
}

// ---------------------------------------------------------------------------
// Internal candidate event (before id assignment)
// ---------------------------------------------------------------------------

interface CandidateMovement {
  from: string;
  to: string;
}

interface Candidate {
  type: EventType;
  title: string;
  timestampIso: string;
  epochMs: number;
  txHash: string | null;
  method: string | null;
  valueUsd: number | null;
  /** Address movements observed (transfer/tx). Empty for pure relation events. */
  movements: CandidateMovement[];
  /** Swap-specific anchors. */
  trader: string | null;
  tokenAddress: string | null;
  tokenSymbol: string | null;
  participants: Array<{ address: string; side: 'from' | 'to' | 'actor' | 'counterparty' }>;
  source: SourceMeta;
  provenanceKind: 'FACT' | 'RELATION';
  statement: string;
  reasons: AdmissionRuleId[]; // all matched rules, priority-ordered
  hasRelation: boolean;
  methodOfInterest: boolean;
  burnSink: boolean;
  assumedUtc: boolean;
  fixtureFile: string | null;
}

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortTx(tx: string): string {
  if (tx.length <= 14) return tx;
  return `${tx.slice(0, 10)}...${tx.slice(-4)}`;
}

/** Plain (locale-independent) USD rendering. Never invents precision. */
function fmtUsd(v: number): string {
  return `$${String(v)} USD`;
}

function entityIdFor(address: string): string {
  return `entity_${address.toLowerCase()}`;
}

function kindRank(t: EventType): number {
  switch (t) {
    case 'funding': return 0;
    case 'entity-relationship': return 1;
    case 'transfer': return 2;
    case 'swap': return 3;
    case 'contract-interaction': return 4;
    case 'capital-consolidation': return 5;
    case 'capital-dispersal': return 6;
  }
}

function relKindRank(k: RelationshipKind): number {
  switch (k) {
    case 'funder': return 0;
    case 'related-wallet': return 1;
    case 'transfer': return 2;
    case 'swap': return 3;
    case 'counterparty': return 4;
    case 'flow': return 5;
  }
}

function isBurn(addr: string | null): boolean {
  return addr !== null && addr.toLowerCase() === BURN_ADDRESS;
}

function methodMatchesInterest(method: string): boolean {
  const m = method.toLowerCase();
  return METHOD_OF_INTEREST_SUBSTRINGS.some((s) => m.includes(s));
}

function relationIsFunding(relation: string): boolean {
  return relation.toLowerCase().includes('funder');
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v) ?? 'null';
}

/** Canonical pre-sort so shuffled inputs still yield identical output. */
function canonicalOrder<T>(arr: T[]): T[] {
  return [...arr].sort((a, b) =>
    stableStringify(a) < stableStringify(b) ? -1
    : stableStringify(a) > stableStringify(b) ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function requireRecord<T>(
  rec: unknown,
  index: number,
  kind: string,
): Provenanced<T> {
  if (!isObject(rec)) {
    throw new EngineError(`${kind}[${index}] is not an object`, '.', index);
  }
  const p = rec as Record<string, unknown>;
  if (!isObject(p.value)) {
    throw new EngineError(`${kind}[${index}] has no value object`, 'value', index);
  }
  if (p.provenanceKind !== 'FACT' && p.provenanceKind !== 'RELATION') {
    throw new EngineError(
      `${kind}[${index}] provenanceKind must be FACT|RELATION`,
      'provenanceKind',
      index,
    );
  }
  if (!isObject(p.source)) {
    throw new EngineError(`${kind}[${index}] has no source`, 'source', index);
  }
  const s = p.source as Record<string, unknown>;
  if (typeof s.source !== 'string' || s.source.length === 0) {
    throw new EngineError(`${kind}[${index}] source.source is missing`, 'source.source', index);
  }
  if (typeof s.capturedAt !== 'string' || s.capturedAt.length === 0) {
    throw new EngineError(`${kind}[${index}] source.capturedAt is missing`, 'source.capturedAt', index);
  }
  return rec as unknown as Provenanced<T>;
}

/** Timestamped records must carry a finite epochMs + ISO string. Never defaulted. */
function requireTimestamp(
  value: Record<string, unknown>,
  index: number,
  kind: string,
): { iso: string; epochMs: number; assumedUtc: boolean } {
  const ts = value.timestamp;
  if (!isObject(ts)) {
    throw new EngineError(`${kind}[${index}] timestamp is missing`, 'timestamp', index);
  }
  if (typeof ts.epochMs !== 'number' || !Number.isFinite(ts.epochMs)) {
    throw new EngineError(`${kind}[${index}] timestamp.epochMs is missing or invalid`, 'timestamp.epochMs', index);
  }
  if (typeof ts.iso !== 'string' || ts.iso.length === 0) {
    throw new EngineError(`${kind}[${index}] timestamp.iso is missing`, 'timestamp.iso', index);
  }
  return {
    iso: ts.iso,
    epochMs: ts.epochMs,
    assumedUtc: ts.assumedUtc === true,
  };
}

function requireTxHash(value: Record<string, unknown>, index: number, kind: string): string {
  const v = value.txHash;
  if (typeof v !== 'string' || v.length === 0) {
    throw new EngineError(`${kind}[${index}] txHash is missing`, 'txHash', index);
  }
  return v;
}

function checkProvenanceKind(
  rec: Provenanced<unknown>,
  index: number,
  kind: string,
  expected: 'FACT' | 'RELATION',
): void {
  if (rec.provenanceKind !== expected) {
    throw new EngineError(
      `${kind}[${index}] provenanceKind must be ${expected}, got ${rec.provenanceKind}`,
      'provenanceKind',
      index,
    );
  }
}

// ---------------------------------------------------------------------------
// Dedupe keys (exact-match only; first in canonical order wins, rest counted)
// ---------------------------------------------------------------------------

function dedupeKey(kind: string, rec: Provenanced<unknown>): string {
  const v = rec.value as Record<string, unknown>;
  const ts = (v.timestamp as Record<string, unknown> | undefined);
  const epoch = ts && typeof ts.epochMs === 'number' ? String(ts.epochMs) : '?';
  switch (kind) {
    case 'transfer': {
      const r = v as unknown as { txHash: string; fromAddress: string; toAddress: string };
      return `transfer|${r.txHash}|${r.fromAddress}|${r.toAddress}|${epoch}`;
    }
    case 'swap': {
      const r = v as unknown as { txHash: string; traderAddress: string; tokenAddress: string; tradedTokenAddress: string | null };
      return `swap|${r.txHash}|${r.traderAddress}|${r.tokenAddress}|${r.tradedTokenAddress ?? ''}|${epoch}`;
    }
    case 'relationship': {
      const r = v as unknown as { address: string; relation: string; txHash: string };
      return `relationship|${r.address}|${r.relation}|${r.txHash}`;
    }
    case 'transaction': {
      const r = v as unknown as { txHash: string; method: string };
      return `transaction|${r.txHash}|${r.method}|${epoch}`;
    }
    case 'counterparty': {
      const r = v as unknown as { counterpartyAddress: string };
      return `counterparty|${r.counterpartyAddress}`;
    }
    default:
      return `${kind}|${stableStringify(v)}`;
  }
}

// ---------------------------------------------------------------------------
// Extraction: normalized records → candidates
// ---------------------------------------------------------------------------

interface Extracted {
  candidates: Candidate[];
  duplicatesSkipped: number;
  inputsReceived: number;
}

function sourceRefFor(source: SourceMeta, txHash?: string): SourceRef {
  const ref: SourceRef = {
    source: source.source as SourceRef['source'],
    capturedAt: source.capturedAt,
  };
  if (source.requestId !== null && source.requestId !== undefined && source.requestId !== '') {
    ref.requestId = source.requestId;
  }
  if (txHash !== undefined && txHash !== '') {
    ref.txHash = txHash;
  }
  // Phase 3H/3J: machine-readable evidence-pool origin. An explicit origin
  // (set by the live path, which writes no fixture) wins; otherwise fall back
  // to the fixture-file convention (live-capture namespace vs everything else).
  // Absent when neither is recorded — never defaulted. Additive metadata;
  // admission/ordering/grouping untouched.
  if (source.origin === 'live-nansen' || source.origin === 'fixture-cache') {
    ref.origin = source.origin;
  } else if (source.fixtureFile !== null && source.fixtureFile !== undefined && source.fixtureFile !== '') {
    const f = source.fixtureFile;
    ref.origin = f.startsWith('live/') || f.includes('fixtures/live/') ? 'live-nansen' : 'fixture-cache';
  }
  return ref;
}

function fixtureNote(source: SourceMeta): string {
  // SourceRef has no fixtureFile slot, so the source is cited in the statement.
  // Live reconstructions read no file — cite the live call rather than a name.
  if (source.origin === 'live-nansen') return 'live Nansen capture';
  return source.fixtureFile ?? 'fixture file not recorded';
}

function extractTransfers(records: TransferFact[], threshold: number): Candidate[] {
  return records.map((rec) => {
    const v = rec.value;
    const reasons: AdmissionRuleId[] = [];
    const burn = isBurn(v.fromAddress) || isBurn(v.toAddress);
    if (burn) reasons.push('burn-sink');
    if (v.valueUsd !== null && v.valueUsd >= threshold) reasons.push('value-threshold');
    if (reasons.length === 0) reasons.push('below-threshold');
    const valuePart = v.valueUsd !== null ? ` (${fmtUsd(v.valueUsd)})` : ' (USD value unavailable)';
    return {
      type: 'transfer' as EventType,
      title: `Transfer ${shortAddress(v.fromAddress)} → ${shortAddress(v.toAddress)}${valuePart}`,
      timestampIso: v.timestamp.iso,
      epochMs: v.timestamp.epochMs,
      txHash: v.txHash,
      method: null,
      valueUsd: v.valueUsd,
      movements: [{ from: v.fromAddress, to: v.toAddress }],
      trader: null,
      tokenAddress: null,
      tokenSymbol: null,
      participants: [
        { address: v.fromAddress, side: 'from' as const },
        { address: v.toAddress, side: 'to' as const },
      ],
      source: rec.source,
      provenanceKind: 'FACT',
      statement:
        `Nansen ${rec.source.source} row (${fixtureNote(rec.source)}, captured ${rec.source.capturedAt}): ` +
        `${v.fromAddress} → ${v.toAddress} at ${v.timestamp.iso}` +
        (v.valueUsd !== null ? `, ${fmtUsd(v.valueUsd)} (transfer_value_usd).` : ', USD value unavailable (not estimated).') +
        ` Evidence tx ${v.txHash}.`,
      reasons,
      hasRelation: false,
      methodOfInterest: false,
      burnSink: burn,
      assumedUtc: v.timestamp.assumedUtc,
      fixtureFile: rec.source.fixtureFile,
    };
  });
}

function extractSwaps(records: SwapFact[], threshold: number): Candidate[] {
  return records.map((rec) => {
    const v = rec.value;
    const reasons: AdmissionRuleId[] = [];
    if (v.valueUsd !== null && v.valueUsd >= threshold) reasons.push('value-threshold');
    if (reasons.length === 0) reasons.push('below-threshold');
    const valuePart = v.valueUsd !== null ? ` (${fmtUsd(v.valueUsd)})` : ' (USD value unavailable)';
    const pair = v.tradedTokenName !== null ? `${v.tokenName ?? 'token'} ↔ ${v.tradedTokenName}` : (v.tokenName ?? 'token');
    return {
      type: 'swap' as EventType,
      title: `Swap ${v.action} ${pair} by ${shortAddress(v.traderAddress)}${valuePart}`,
      timestampIso: v.timestamp.iso,
      epochMs: v.timestamp.epochMs,
      txHash: v.txHash,
      method: null,
      valueUsd: v.valueUsd,
      movements: [],
      trader: v.traderAddress,
      tokenAddress: v.tokenAddress,
      tokenSymbol: v.tokenName,
      participants: [
        { address: v.traderAddress, side: 'actor' as const },
        ...(v.tradedTokenAddress !== null
          ? [{ address: v.tradedTokenAddress, side: 'counterparty' as const }]
          : []),
      ],
      source: rec.source,
      provenanceKind: 'FACT',
      statement:
        `Nansen ${rec.source.source} row (${fixtureNote(rec.source)}, captured ${rec.source.capturedAt}): ` +
        `trader ${v.traderAddress} action ${v.action} at ${v.timestamp.iso}` +
        (v.valueUsd !== null ? `, ${fmtUsd(v.valueUsd)} (estimated_value_usd).` : ', USD value unavailable (not estimated).') +
        ` Evidence tx ${v.txHash}.`,
      reasons,
      hasRelation: false,
      methodOfInterest: false,
      burnSink: false,
      assumedUtc: v.timestamp.assumedUtc,
      fixtureFile: rec.source.fixtureFile,
    };
  });
}

function extractRelationships(records: RelationshipRelation[]): Candidate[] {
  return records.map((rec) => {
    const v = rec.value;
    const funding = relationIsFunding(v.relation);
    const reasons: AdmissionRuleId[] = ['nansen-relation'];
    const labelPart = v.label !== null ? ` (label "${v.label}")` : ' (label unavailable)';
    return {
      type: (funding ? 'funding' : 'entity-relationship') as EventType,
      title: funding
        ? `Reported funding link: ${shortAddress(v.address)} → subject ("${v.relation}")`
        : `Reported relationship: ${shortAddress(v.address)} ("${v.relation}")`,
      timestampIso: v.timestamp.iso,
      epochMs: v.timestamp.epochMs,
      txHash: v.txHash,
      method: null,
      valueUsd: null,
      movements: funding ? [{ from: v.address, to: '__subject__' }] : [],
      trader: null,
      tokenAddress: null,
      tokenSymbol: null,
      participants: funding
        ? [
          { address: v.address, side: 'from' as const },
          { address: '__subject__', side: 'to' as const },
        ]
        : [
          { address: v.address, side: 'counterparty' as const },
          { address: '__subject__', side: 'actor' as const },
        ],
      source: rec.source,
      provenanceKind: 'RELATION',
      statement:
        `Nansen ${rec.source.source} row (${fixtureNote(rec.source)}, captured ${rec.source.capturedAt}): ` +
        `Nansen reports ${v.address}${labelPart} as "${v.relation}"` +
        ` with evidence tx ${v.txHash} at ${v.timestamp.iso}. ` +
        `This is a reported link, not proof of common control.`,
      reasons,
      hasRelation: true,
      methodOfInterest: false,
      burnSink: false,
      assumedUtc: v.timestamp.assumedUtc,
      fixtureFile: rec.source.fixtureFile,
    };
  });
}

function extractTransactions(
  records: TransactionFact[],
  threshold: number,
  subjectAddress: string,
): Candidate[] {
  return records.map((rec) => {
    const v: NormalizedTransaction = rec.value;
    const interest = methodMatchesInterest(v.method);
    const transferLike = TRANSFER_LIKE_METHODS.has(v.method) || (v.sourceType ?? '') === 'transfer';
    const allMovements = [...v.tokensSent, ...v.tokensReceived];
    const burn = allMovements.some((m) => isBurn(m.fromAddress) || isBurn(m.toAddress));
    const reasons: AdmissionRuleId[] = [];
    if (burn) reasons.push('burn-sink');
    if (interest) reasons.push('method-of-interest');
    if (v.volumeUsd !== null && v.volumeUsd >= threshold) reasons.push('value-threshold');
    if (reasons.length === 0) reasons.push('below-threshold');

    // Participants: unique movement endpoints; fall back to the case subject
    // when a row carries no movement endpoints (never invent counterparties).
    const seen = new Map<string, 'from' | 'to' | 'actor' | 'counterparty'>();
    for (const m of v.tokensSent) {
      if (m.fromAddress !== null && !seen.has(m.fromAddress)) seen.set(m.fromAddress, 'from');
      if (m.toAddress !== null && !seen.has(m.toAddress)) seen.set(m.toAddress, 'to');
    }
    for (const m of v.tokensReceived) {
      if (m.fromAddress !== null && !seen.has(m.fromAddress)) seen.set(m.fromAddress, 'from');
      if (m.toAddress !== null && !seen.has(m.toAddress)) seen.set(m.toAddress, 'to');
    }
    if (seen.size === 0) seen.set(subjectAddress, 'actor');
    const participants = [...seen.entries()].map(([address, side]) => ({ address, side }));
    const movements: CandidateMovement[] = [];
    for (const m of allMovements) {
      if (m.fromAddress !== null && m.toAddress !== null && m.fromAddress !== m.toAddress) {
        movements.push({ from: m.fromAddress, to: m.toAddress });
      }
    }

    const type: EventType = interest && !transferLike ? 'contract-interaction' : 'transfer';
    const valuePart = v.volumeUsd !== null ? ` (${fmtUsd(v.volumeUsd)})` : ' (USD value unavailable)';
    const title = type === 'contract-interaction'
      ? `Contract call "${v.method}" in ${shortTx(v.txHash)}${valuePart}`
      : `Transfer observed in ${shortTx(v.txHash)} (method "${v.method}")${valuePart}`;
    return {
      type,
      title,
      timestampIso: v.timestamp.iso,
      epochMs: v.timestamp.epochMs,
      txHash: v.txHash,
      method: v.method,
      valueUsd: v.volumeUsd,
      movements,
      trader: null,
      tokenAddress: null,
      tokenSymbol: null,
      participants,
      source: rec.source,
      provenanceKind: 'FACT',
      statement:
        `Nansen ${rec.source.source} row (${fixtureNote(rec.source)}, captured ${rec.source.capturedAt}): ` +
        `method "${v.method}" at ${v.timestamp.iso}` +
        (v.volumeUsd !== null ? `, ${fmtUsd(v.volumeUsd)} (volume_usd).` : ', USD value unavailable (not estimated; per-token USD is null in the source row).') +
        ` Evidence tx ${v.txHash}.`,
      reasons,
      hasRelation: false,
      methodOfInterest: interest && !transferLike,
      burnSink: burn,
      assumedUtc: v.timestamp.assumedUtc,
      fixtureFile: rec.source.fixtureFile,
    };
  });
}

// ---------------------------------------------------------------------------
// Significance (deterministic ranking score; does NOT gate primary status)
// ---------------------------------------------------------------------------

/**
 * Pure ranking score: rounded 10·log10(1+USD) plus fixed bonuses for relation
 * (+25), method-of-interest (+20), burn sink (+15), first-in-window (+10),
 * last-in-window (+10). Identical inputs → identical score. Primary status is
 * decided by admission rules, not by this score (documented in §7 of the
 * Phase 3B doc).
 */
export function significanceScore(c: {
  valueUsd: number | null;
  hasRelation: boolean;
  methodOfInterest: boolean;
  burnSink: boolean;
  firstInWindow: boolean;
  lastInWindow: boolean;
}): number {
  const usd = c.valueUsd !== null && Number.isFinite(c.valueUsd) && c.valueUsd > 0
    ? 10 * Math.log10(1 + c.valueUsd)
    : 0;
  return Math.round(
    usd +
    (c.hasRelation ? 25 : 0) +
    (c.methodOfInterest ? 20 : 0) +
    (c.burnSink ? 15 : 0) +
    (c.firstInWindow ? 10 : 0) +
    (c.lastInWindow ? 10 : 0),
  );
}

// ---------------------------------------------------------------------------
// Main reconstruction
// ---------------------------------------------------------------------------

export function reconstruct(
  input: EngineInput,
  subject: ReconstructionSubject,
  caseDesc: CaseDescriptor,
  options: EngineOptions = {},
): ReconstructionResult {
  if (!isObject(input)) {
    throw new EngineError('input must be an object', 'input');
  }
  if (!isObject(subject) || typeof subject.address !== 'string' || subject.address.length === 0) {
    throw new EngineError('subject.address is required', 'subject.address');
  }
  if (!isObject(caseDesc) || typeof caseDesc.id !== 'string' || caseDesc.id.length === 0) {
    throw new EngineError('caseDesc.id is required', 'caseDesc.id');
  }
  const threshold = options.valueThresholdUsd ?? DEFAULT_VALUE_THRESHOLD_USD;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    throw new EngineError('valueThresholdUsd must be a finite number >= 0', 'valueThresholdUsd');
  }
  const minGroupMembers = options.minGroupMembers ?? DEFAULT_MIN_GROUP_MEMBERS;
  if (!Number.isInteger(minGroupMembers) || minGroupMembers < 2) {
    throw new EngineError('minGroupMembers must be an integer >= 2', 'minGroupMembers');
  }
  const reconstructedAt = options.reconstructedAt ?? new Date().toISOString();

  // --- validate + canonical-sort + dedupe each record kind -----------------
  const kinds = ['transfers', 'swaps', 'counterparties', 'relationships', 'transactions'] as const;
  const expectedKind: Record<string, 'FACT' | 'RELATION'> = {
    transfers: 'FACT',
    swaps: 'FACT',
    counterparties: 'FACT',
    relationships: 'RELATION',
    transactions: 'FACT',
  };
  const cleaned: Record<string, Array<Provenanced<unknown>>> = {};
  let inputsReceived = 0;
  let duplicatesSkipped = 0;
  for (const kind of kinds) {
    const rawArr = (input as Record<string, unknown>)[kind] ?? [];
    if (!Array.isArray(rawArr)) {
      throw new EngineError(`${kind} must be an array`, kind);
    }
    const seenKeys = new Set<string>();
    const kept: Array<Provenanced<unknown>> = [];
    const ordered = canonicalOrder(rawArr);
    ordered.forEach((raw, i) => {
      const rec = requireRecord<unknown>(raw, i, kind);
      checkProvenanceKind(rec, i, kind, expectedKind[kind]);
      const v = rec.value as Record<string, unknown>;
      if (kind === 'counterparties') {
        // counterparties carry no timestamp (window aggregates) — validated below.
      } else {
        requireTimestamp(v, i, kind);
        requireTxHash(v, i, kind);
      }
      const key = dedupeKey(kind === 'counterparties' ? 'counterparty' : kind.slice(0, -1), rec);
      if (seenKeys.has(key)) {
        duplicatesSkipped += 1;
        return;
      }
      seenKeys.add(key);
      kept.push(rec);
    });
    cleaned[kind] = kept;
    inputsReceived += rawArr.length;
  }
  const flows = input.flows ?? [];
  if (!Array.isArray(flows)) throw new EngineError('flows must be an array', 'flows');
  const flowsSkipped = flows.length;
  inputsReceived += flows.length;

  // --- validate counterparty aggregates (no timestamps by design) -----------
  for (let i = 0; i < cleaned.counterparties.length; i++) {
    const v = cleaned.counterparties[i].value as Record<string, unknown>;
    if (typeof v.counterpartyAddress !== 'string' || v.counterpartyAddress.length === 0) {
      throw new EngineError(`counterparties[${i}] counterpartyAddress is missing`, 'counterpartyAddress', i);
    }
  }

  // --- extract member candidates -------------------------------------------
  const candidates: Candidate[] = [
    ...extractTransfers(cleaned.transfers as unknown as TransferFact[], threshold),
    ...extractSwaps(cleaned.swaps as unknown as SwapFact[], threshold),
    ...extractRelationships(cleaned.relationships as unknown as RelationshipRelation[]),
    ...extractTransactions(cleaned.transactions as unknown as TransactionFact[], threshold, subject.address),
  ];

  // Resolve the __subject__ placeholder to the real case-subject address.
  for (const c of candidates) {
    for (const p of c.participants) {
      if (p.address === '__subject__') p.address = subject.address;
    }
    for (const m of c.movements) {
      if (m.from === '__subject__') m.from = subject.address;
      if (m.to === '__subject__') m.to = subject.address;
    }
  }

  // --- deterministic ordering ----------------------------------------------
  // Nansen rows carry no txIndex/logIndex (verified across all fixtures), so
  // the stable tie-break chain is: epochMs → txHash (lexicographic) → event
  // kind rank → source endpoint → canonical input order. Nothing is invented.
  const orderedMembers = [...candidates]
    .map((c, seq) => ({ c, seq }))
    .sort((a, b) =>
      a.c.epochMs - b.c.epochMs ||
      (a.c.txHash ?? '').localeCompare(b.c.txHash ?? '') ||
      kindRank(a.c.type) - kindRank(b.c.type) ||
      (a.c.source.source < b.c.source.source ? -1 : a.c.source.source > b.c.source.source ? 1 : 0) ||
      a.seq - b.seq,
    )
    .map(({ c }) => c);

  const minEpoch = orderedMembers.length > 0 ? orderedMembers[0].epochMs : null;
  const maxEpoch = orderedMembers.length > 0 ? orderedMembers[orderedMembers.length - 1].epochMs : null;

  // --- entities --------------------------------------------------------------
  interface EntityAcc {
    address: string;
    labels: Map<string, { statement: string; source: SourceMeta }>;
    admissionReasons: Set<string>;
    role: EntityRole;
    roleStatement: string;
    roleSource: SourceMeta | null;
    roleKind: 'FACT' | 'RELATION';
    /**
     * Role precedence: 3 subject (fixed) · 2 aggregate/relation · 1 observed
     * participant · 0 none. Higher rank overwrites; equal rank keeps the first
     * writer (deterministic). Guarantees every non-subject entity ends with a
     * sourced role statement — never an empty FACT with no sources.
     */
    roleRank: number;
    chains: Set<string>;
  }
  const entityAcc = new Map<string, EntityAcc>();
  const accFor = (address: string): EntityAcc => {
    const key = address.toLowerCase();
    let acc = entityAcc.get(key);
    if (!acc) {
      acc = {
        address, // first-seen casing preserved; id uses lowercase
        labels: new Map(),
        admissionReasons: new Set(),
        role: 'counterparty',
        roleStatement: '',
        roleSource: null,
        roleKind: 'FACT',
        roleRank: 0,
        chains: new Set(),
      };
      entityAcc.set(key, acc);
    }
    return acc;
  };

  /**
   * Record an entity's investigative role. Subject is fixed; otherwise higher
   * rank overwrites (aggregate/relation statements beat bare participation).
   */
  const noteRole = (
    acc: EntityAcc,
    rank: number,
    role: EntityRole,
    roleKind: 'FACT' | 'RELATION',
    roleSource: SourceMeta,
    roleStatement: string,
  ): void => {
    if (acc.role === 'subject') return;
    if (rank > acc.roleRank) {
      acc.role = role;
      acc.roleKind = roleKind;
      acc.roleSource = roleSource;
      acc.roleStatement = roleStatement;
      acc.roleRank = rank;
    }
  };

  // Subject first (deterministic regardless of input order).
  const subjectAcc = accFor(subject.address);
  subjectAcc.role = 'subject';
  subjectAcc.roleKind = 'FACT';
  subjectAcc.roleStatement = `Case subject ${subject.address} (authored case input; its on-chain activity is evidenced by the case events).`;
  subjectAcc.roleRank = 3;
  subjectAcc.admissionReasons.add('case-subject');
  subjectAcc.chains.add(subject.chain);
  for (const l of subject.labels ?? []) {
    if (!subjectAcc.labels.has(l)) {
      subjectAcc.labels.set(l, {
        statement: `Label "${l}" supplied with the case subject (authored input, not Nansen evidence).`,
        source: {
          source: 'search/general',
          requestId: null,
          capturedAt: reconstructedAt,
          fixtureFile: null,
          creditsCost: null,
        },
      });
    }
  }

  const addLabel = (address: string, label: string, statement: string, source: SourceMeta): void => {
    const acc = accFor(address);
    if (!acc.labels.has(label)) acc.labels.set(label, { statement, source });
  };

  // Labels + admission from transfers / swaps / transactions (FACT).
  for (const rec of cleaned.transfers as unknown as TransferFact[]) {
    const v = rec.value;
    if (v.fromLabel !== null) {
      addLabel(v.fromAddress, v.fromLabel, `Nansen returned label "${v.fromLabel}" for ${v.fromAddress} (from_address_label).`, rec.source);
    }
    if (v.toLabel !== null) {
      addLabel(v.toAddress, v.toLabel, `Nansen returned label "${v.toLabel}" for ${v.toAddress} (to_address_label).`, rec.source);
    }
    for (const a of [v.fromAddress, v.toAddress]) {
      const acc = accFor(a);
      acc.chains.add(subject.chain);
      if (isBurn(a)) acc.admissionReasons.add('burn-sink');
      else acc.admissionReasons.add('transfer-participant');
      noteRole(
        acc,
        1,
        'counterparty',
        'FACT',
        rec.source,
        `Observed ${a} as a transfer participant (evidence tx ${v.txHash} at ${v.timestamp.iso}) in Nansen ${rec.source.source} data. Role "counterparty" records observed interaction only.`,
      );
    }
  }
  for (const rec of cleaned.swaps as unknown as SwapFact[]) {
    const v = rec.value;
    if (v.traderLabel !== null) {
      addLabel(v.traderAddress, v.traderLabel, `Nansen returned label "${v.traderLabel}" for ${v.traderAddress} (trader_address_label).`, rec.source);
    }
    accFor(v.traderAddress).admissionReasons.add('swap-participant');
    accFor(v.traderAddress).chains.add(subject.chain);
    noteRole(
      accFor(v.traderAddress),
      1,
      'counterparty',
      'FACT',
      rec.source,
      `Observed ${v.traderAddress} as a swap trader (evidence tx ${v.txHash} at ${v.timestamp.iso}) in Nansen ${rec.source.source} data. Role "counterparty" records observed interaction only.`,
    );
    if (v.tradedTokenAddress !== null) {
      const tok = accFor(v.tradedTokenAddress);
      tok.admissionReasons.add('swap-token');
      tok.chains.add(subject.chain);
      noteRole(
        tok,
        1,
        'counterparty',
        'FACT',
        rec.source,
        `Observed ${v.tradedTokenAddress} as a swap token (evidence tx ${v.txHash} at ${v.timestamp.iso}) in Nansen ${rec.source.source} data. Role "counterparty" records observed interaction only.`,
      );
      if (v.tradedTokenName !== null) {
        addLabel(v.tradedTokenAddress, v.tradedTokenName, `Nansen returned token name "${v.tradedTokenName}" for ${v.tradedTokenAddress} (traded_token_name).`, rec.source);
      }
    }
    // The quoted token itself is an involved token entity.
    const base = accFor(v.tokenAddress);
    base.admissionReasons.add('swap-token');
    base.chains.add(subject.chain);
    noteRole(
      base,
      1,
      'counterparty',
      'FACT',
      rec.source,
      `Observed ${v.tokenAddress} as a swap token (evidence tx ${v.txHash} at ${v.timestamp.iso}) in Nansen ${rec.source.source} data. Role "counterparty" records observed interaction only.`,
    );
    if (v.tokenName !== null) {
      addLabel(v.tokenAddress, v.tokenName, `Nansen returned token name "${v.tokenName}" for ${v.tokenAddress} (token_name).`, rec.source);
    }
  }
  for (const rec of cleaned.transactions as unknown as TransactionFact[]) {
    const v = rec.value;
    for (const m of [...v.tokensSent, ...v.tokensReceived]) {
      if (m.fromLabel !== null && m.fromAddress !== null) {
        addLabel(m.fromAddress, m.fromLabel, `Nansen returned label "${m.fromLabel}" for ${m.fromAddress} (from_address_label).`, rec.source);
      }
      if (m.toLabel !== null && m.toAddress !== null) {
        addLabel(m.toAddress, m.toLabel, `Nansen returned label "${m.toLabel}" for ${m.toAddress} (to_address_label).`, rec.source);
      }
      for (const a of [m.fromAddress, m.toAddress]) {
        if (a === null) continue;
        const acc = accFor(a);
        acc.chains.add(v.chain);
        if (isBurn(a)) acc.admissionReasons.add('burn-sink');
        else acc.admissionReasons.add('transaction-participant');
        noteRole(
          acc,
          1,
          'counterparty',
          'FACT',
          rec.source,
          `Observed ${a} as a transaction participant (evidence tx ${v.txHash} at ${v.timestamp.iso}) in Nansen ${rec.source.source} data. Role "counterparty" records observed interaction only.`,
        );
      }
    }
  }
  // Counterparties (FACT aggregates) + relationships (RELATION targets).
  for (const rec of cleaned.counterparties as unknown as CounterpartyFact[]) {
    const v = rec.value;
    const acc = accFor(v.counterpartyAddress);
    acc.chains.add(subject.chain);
    const maxVol = Math.max(v.volumeInUsd ?? 0, v.volumeOutUsd ?? 0, v.totalVolumeUsd ?? 0);
    if (isBurn(v.counterpartyAddress)) acc.admissionReasons.add('burn-sink');
    else if (maxVol >= threshold) acc.admissionReasons.add('counterparty-above-threshold');
    else acc.admissionReasons.add('counterparty-observed');
    for (const l of v.labels) {
      addLabel(
        v.counterpartyAddress,
        l,
        `Nansen returned counterparty label "${l}" for ${v.counterpartyAddress} (counterparty_address_label).`,
        rec.source,
      );
    }
    if (acc.role !== 'subject') {
      noteRole(
        acc,
        2,
        'counterparty',
        'FACT',
        rec.source,
        `Nansen returned ${v.counterpartyAddress} as a counterparty with ` +
        `interaction_count ${v.interactionCount ?? 'unavailable'} and total volume ` +
        `${v.totalVolumeUsd !== null ? fmtUsd(v.totalVolumeUsd) : 'unavailable'}. Role "counterparty" records observed interaction only.`,
      );
    }
  }
  for (const rec of cleaned.relationships as unknown as RelationshipRelation[]) {
    const v = rec.value;
    const acc = accFor(v.address);
    acc.chains.add(v.chain);
    acc.admissionReasons.add('nansen-relation-target');
    if (v.label !== null) {
      addLabel(v.address, v.label, `Nansen returned label "${v.label}" for ${v.address} (address_label).`, rec.source);
    }
    if (relationIsFunding(v.relation)) {
      if (acc !== subjectAcc) {
        noteRole(
          acc,
          2,
          'funder',
          'RELATION',
          rec.source,
          `Nansen reports ${v.address} as "${v.relation}" of the case subject (evidence tx ${v.txHash}). ` +
          `Reported link, not proof of common control.`,
        );
      }
    } else if (acc !== subjectAcc) {
      noteRole(
        acc,
        2,
        'counterparty',
        'RELATION',
        rec.source,
        `Nansen reports ${v.address} as "${v.relation}" in connection with the case subject (evidence tx ${v.txHash}). ` +
        `Reported link, not proof of common control.`,
      );
    }
  }

  // Materialize entities sorted by lowercase address (deterministic).
  const sortedAccs = [...entityAcc.values()].sort((a, b) =>
    a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1,
  );
  const entities: Entity[] = sortedAccs.map((acc) => {
    const labels = [...acc.labels.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, info]) => ({
        label,
        provenance: {
          kind: 'FACT',
          sources: [sourceRefFor(info.source)],
          statement: info.statement,
        } as Provenance,
      }));
    const admissionReason = [...acc.admissionReasons].sort().join('+');
    const roleProv: Provenance = acc.roleSource !== null
      ? { kind: acc.roleKind, sources: [sourceRefFor(acc.roleSource)], statement: acc.roleStatement }
      : { kind: 'FACT', sources: [], statement: acc.roleStatement };
    return {
      id: entityIdFor(acc.address),
      kind: 'wallet' as const,
      address: acc.address,
      chain: [...acc.chains].sort()[0] ?? subject.chain,
      displayName: labels.length > 0 ? labels[0].label : shortAddress(acc.address),
      labels,
      role: acc.role,
      admissionReason,
      provenance: roleProv,
    };
  });

  // --- materialize member events (ids assigned in final order later) ---------
  interface Materialized {
    cand: Candidate;
    significance: number;
    primary: boolean;
    admissionRule: AdmissionRuleId;
    provenance: Provenance;
    relationshipIds: string[];
  }
  const memberMats: Materialized[] = orderedMembers.map((c) => {
    const admissionRule = c.reasons[0];
    const primary = admissionRule !== 'below-threshold';
    const significance = significanceScore({
      valueUsd: c.valueUsd,
      hasRelation: c.hasRelation,
      methodOfInterest: c.methodOfInterest,
      burnSink: c.burnSink,
      firstInWindow: minEpoch !== null && c.epochMs === minEpoch,
      lastInWindow: maxEpoch !== null && c.epochMs === maxEpoch,
    });
    const provenance: Provenance = {
      kind: c.provenanceKind,
      sources: [sourceRefFor(c.source, c.txHash ?? undefined)],
      statement: c.statement,
    };
    return { cand: c, significance, primary, admissionRule, provenance, relationshipIds: [] };
  });

  // --- derived consolidation / dispersal groupings ---------------------------
  // Group transfer-type member events (transfer + tx-derived transfer; swaps
  // excluded — documented) by counterparty side. Members stay in events[];
  // groups are DERIVED with full member id lists (expandable).
  interface GroupBuild {
    type: 'capital-consolidation' | 'capital-dispersal';
    keyAddress: string;
    members: Materialized[];
    timestampIso: string;
    epochMs: number;
    valueUsd: number | null;
    membersWithUsd: number;
  }
  const transferMats = memberMats.filter((m) =>
    m.cand.type === 'transfer' && m.cand.movements.length > 0,
  );
  const byTo = new Map<string, Materialized[]>();
  const byFrom = new Map<string, Materialized[]>();
  for (const m of transferMats) {
    const mv = m.cand.movements[0];
    const toK = mv.to.toLowerCase();
    const fromK = mv.from.toLowerCase();
    if (!byTo.has(toK)) byTo.set(toK, []);
    byTo.get(toK)!.push(m);
    if (!byFrom.has(fromK)) byFrom.set(fromK, []);
    byFrom.get(fromK)!.push(m);
  }
  const groupBuilds: GroupBuild[] = [];
  const sortedKeys = (map: Map<string, Materialized[]>): string[] =>
    [...map.keys()].sort();
  for (const k of sortedKeys(byTo)) {
    const members = byTo.get(k)!;
    if (members.length < minGroupMembers) continue;
    const keyAddress = members[0].cand.movements[0].to;
    groupBuilds.push(buildGroup('capital-consolidation', keyAddress, members));
  }
  for (const k of sortedKeys(byFrom)) {
    const members = byFrom.get(k)!;
    if (members.length < minGroupMembers) continue;
    const keyAddress = members[0].cand.movements[0].from;
    groupBuilds.push(buildGroup('capital-dispersal', keyAddress, members));
  }

  function buildGroup(
    type: 'capital-consolidation' | 'capital-dispersal',
    keyAddress: string,
    members: Materialized[],
  ): GroupBuild {
    const epochs = members.map((m) => m.cand.epochMs);
    const maxEpoch = Math.max(...epochs);
    const latest = members.find((m) => m.cand.epochMs === maxEpoch)!;
    const withUsd = members.filter((m) => m.cand.valueUsd !== null);
    return {
      type,
      keyAddress,
      members: [...members].sort((a, b) =>
        a.cand.epochMs - b.cand.epochMs ||
        (a.cand.txHash ?? '').localeCompare(b.cand.txHash ?? ''),
      ),
      timestampIso: latest.cand.timestampIso,
      epochMs: maxEpoch,
      valueUsd: withUsd.length > 0 ? withUsd.reduce((s, m) => s + (m.cand.valueUsd as number), 0) : null,
      membersWithUsd: withUsd.length,
    };
  }

  // --- relationships ----------------------------------------------------------
  interface RelBuild {
    kind: RelationshipKind;
    from: string; // address
    to: string; // address
    directed: boolean;
    metrics?: { interactionCount?: number; volumeInUsd?: number; volumeOutUsd?: number; netFlowUsd?: number };
    nansenRelation?: string;
    evidence: Materialized[]; // member events instantiating this edge
    provenance: Provenance;
    statement: string;
  }
  const relBuilds: RelBuild[] = [];

  // Funder / related-wallet edges from relationship records (RELATION).
  const relMats = memberMats.filter((m) =>
    m.cand.type === 'funding' || m.cand.type === 'entity-relationship',
  );
  for (const m of relMats) {
    const rec = (cleaned.relationships as unknown as RelationshipRelation[]).find(
      (r) => r.value.txHash === m.cand.txHash && r.value.address.toLowerCase() === m.cand.participants[0].address.toLowerCase(),
    );
    const relation = rec?.value.relation ?? 'reported relation';
    if (m.cand.type === 'funding') {
      relBuilds.push({
        kind: 'funder',
        from: m.cand.participants[0].address,
        to: subject.address,
        directed: true,
        nansenRelation: relation,
        evidence: [m],
        provenance: m.provenance,
        statement: m.cand.statement,
      });
    } else {
      relBuilds.push({
        kind: 'related-wallet',
        from: m.cand.participants[0].address,
        to: subject.address,
        directed: false,
        nansenRelation: relation,
        evidence: [m],
        provenance: m.provenance,
        statement: m.cand.statement,
      });
    }
  }

  // Transfer edges: one per unique (from,to) pair, evidence = member events.
  const pairMap = new Map<string, { from: string; to: string; members: Materialized[] }>();
  for (const m of transferMats) {
    const mv = m.cand.movements[0];
    const k = `${mv.from.toLowerCase()}|${mv.to.toLowerCase()}`;
    if (!pairMap.has(k)) pairMap.set(k, { from: mv.from, to: mv.to, members: [] });
    pairMap.get(k)!.members.push(m);
  }
  for (const k of [...pairMap.keys()].sort()) {
    const p = pairMap.get(k)!;
    const withUsd = p.members.filter((m) => m.cand.valueUsd !== null);
    relBuilds.push({
      kind: 'transfer',
      from: p.from,
      to: p.to,
      directed: true,
      metrics: withUsd.length > 0
        ? { netFlowUsd: withUsd.reduce((s, m) => s + (m.cand.valueUsd as number), 0) }
        : undefined,
      evidence: p.members,
      provenance: {
        kind: 'FACT',
        sources: p.members.map((m) => sourceRefFor(m.cand.source, m.cand.txHash ?? undefined)),
        statement:
          `${p.members.length} observed transfer(s) ${p.from} → ${p.to} ` +
          `(evidence txs: ${p.members.map((m) => m.cand.txHash).join(', ')}).` +
          (withUsd.length < p.members.length
            ? ` ${p.members.length - withUsd.length} member(s) have no USD value (not estimated).`
            : ''),
      },
      statement: '',
    });
  }

  // Swap edges: one per unique (trader, token) pair.
  const swapMats = memberMats.filter((m) => m.cand.type === 'swap');
  const swapMap = new Map<string, { trader: string; token: string; members: Materialized[] }>();
  for (const m of swapMats) {
    const k = `${(m.cand.trader as string).toLowerCase()}|${(m.cand.tokenAddress as string).toLowerCase()}`;
    if (!swapMap.has(k)) {
      swapMap.set(k, { trader: m.cand.trader as string, token: m.cand.tokenAddress as string, members: [] });
    }
    swapMap.get(k)!.members.push(m);
  }
  for (const k of [...swapMap.keys()].sort()) {
    const s = swapMap.get(k)!;
    relBuilds.push({
      kind: 'swap',
      from: s.trader,
      to: s.token,
      directed: true,
      evidence: s.members,
      provenance: {
        kind: 'FACT',
        sources: s.members.map((m) => sourceRefFor(m.cand.source, m.cand.txHash ?? undefined)),
        statement:
          `${s.members.length} observed swap(s) by ${s.trader} involving token ${s.token} ` +
          `(evidence txs: ${s.members.map((m) => m.cand.txHash).join(', ')}).`,
      },
      statement: '',
    });
  }

  // Counterparty aggregate edges (FACT, undirected pair with in/out metrics).
  for (const rec of cleaned.counterparties as unknown as CounterpartyFact[]) {
    const v = rec.value;
    if (v.counterpartyAddress.toLowerCase() === subject.address.toLowerCase()) continue;
    relBuilds.push({
      kind: 'counterparty',
      from: subject.address,
      to: v.counterpartyAddress,
      directed: false,
      metrics: {
        ...(v.interactionCount !== null ? { interactionCount: v.interactionCount } : {}),
        ...(v.volumeInUsd !== null ? { volumeInUsd: v.volumeInUsd } : {}),
        ...(v.volumeOutUsd !== null ? { volumeOutUsd: v.volumeOutUsd } : {}),
      },
      evidence: memberMats.filter((m) =>
        m.cand.participants.some((p) => p.address.toLowerCase() === v.counterpartyAddress.toLowerCase()),
      ),
      provenance: {
        kind: 'FACT',
        sources: [sourceRefFor(rec.source)],
        statement:
          `Nansen ${rec.source.source} aggregate (${fixtureNote(rec.source)}): ` +
          `${v.counterpartyAddress} interacted with the investigated cluster ` +
          `(${v.interactionCount ?? 'unavailable'} interactions` +
          `${v.totalVolumeUsd !== null ? `, total ${fmtUsd(v.totalVolumeUsd)}` : ', total USD unavailable'}). ` +
          `Window-level aggregate, not a single transaction.`,
      },
      statement: '',
    });
  }

  // --- final timeline: members + groups, one deterministic sort --------------
  interface GroupMat {
    build: GroupBuild;
    provenance: Provenance;
    significance: number;
  }
  // Group ids depend on member ids, so create member id assignment first in a
  // provisional order, then re-sort with groups and renumber. Member identity
  // is tracked by object reference throughout (no stale ids).
  const timeline: Array<{ epochMs: number; txKey: string; rank: number; srcKey: string; mat: Materialized } | { epochMs: number; txKey: string; rank: number; srcKey: string; grp: GroupMat }> = [];
  memberMats.forEach((mat, seq) => {
    timeline.push({
      epochMs: mat.cand.epochMs,
      txKey: mat.cand.txHash ?? '',
      rank: kindRank(mat.cand.type),
      srcKey: `${mat.cand.source.source}#${seq}`,
      mat,
    });
  });
  const groupMats: GroupMat[] = groupBuilds.map((build) => {
    const significance = significanceScore({
      valueUsd: build.valueUsd,
      hasRelation: false,
      methodOfInterest: false,
      burnSink: isBurn(build.keyAddress),
      firstInWindow: false,
      lastInWindow: false,
    });
    // Placeholder provenance; sourceEventIds filled after id assignment.
    const provenance: Provenance = {
      kind: 'DERIVED',
      sourceEventIds: [],
      calculation: build.type === 'capital-consolidation' ? 'consolidation' : 'dispersal',
      inputs: {
        engine: ENGINE_VERSION,
        members: build.members.length,
        members_with_usd: build.membersWithUsd,
      },
    };
    return { build, provenance, significance };
  });
  groupMats.forEach((grp, i) => {
    timeline.push({
      epochMs: grp.build.epochMs,
      txKey: '',
      rank: kindRank(grp.build.type),
      srcKey: `derived#${i}`,
      grp,
    });
  });
  timeline.sort((a, b) =>
    a.epochMs - b.epochMs ||
    (a.txKey < b.txKey ? -1 : a.txKey > b.txKey ? 1 : 0) ||
    a.rank - b.rank ||
    (a.srcKey < b.srcKey ? -1 : 1),
  );

  // Assign event_### ids in final order; wire member references into groups.
  const pad = (n: number): string => `event_${String(n).padStart(3, '0')}`;
  const matId = new Map<Materialized, string>();
  const grpId = new Map<GroupMat, string>();
  let n = 1;
  for (const entry of timeline) {
    if ('mat' in entry) {
      matId.set(entry.mat, pad(n));
      n += 1;
    } else {
      grpId.set(entry.grp, pad(n));
      n += 1;
    }
  }
  for (const grp of groupMats) {
    const ids = grp.build.members.map((m) => matId.get(m)!).sort();
    (grp.provenance as { sourceEventIds: string[] }).sourceEventIds = ids;
  }

  // Flow edges (DERIVED): one representative edge per group.
  const flowBuilds: RelBuild[] = groupMats.map((grp) => {
    const gid = grpId.get(grp)!;
    const memberIds = (grp.provenance as { sourceEventIds: string[] }).sourceEventIds;
    let from: string;
    let to: string;
    if (grp.build.type === 'capital-consolidation') {
      // Representative source: most frequent sender (tie → smallest address).
      const counts = new Map<string, { addr: string; count: number }>();
      for (const m of grp.build.members) {
        const addr = m.cand.movements[0].from;
        const k = addr.toLowerCase();
        const e = counts.get(k) ?? { addr, count: 0 };
        e.count += 1;
        counts.set(k, e);
      }
      const best = [...counts.values()].sort((a, b) =>
        b.count - a.count || (a.addr.toLowerCase() < b.addr.toLowerCase() ? -1 : 1),
      )[0];
      from = best.addr;
      to = grp.build.keyAddress;
    } else {
      from = grp.build.keyAddress;
      const counts = new Map<string, { addr: string; count: number }>();
      for (const m of grp.build.members) {
        const addr = m.cand.movements[0].to;
        const k = addr.toLowerCase();
        const e = counts.get(k) ?? { addr, count: 0 };
        e.count += 1;
        counts.set(k, e);
      }
      const best = [...counts.values()].sort((a, b) =>
        b.count - a.count || (a.addr.toLowerCase() < b.addr.toLowerCase() ? -1 : 1),
      )[0];
      to = best.addr;
    }
    return {
      kind: 'flow' as RelationshipKind,
      from,
      to,
      directed: true,
      metrics: grp.build.valueUsd !== null ? { netFlowUsd: grp.build.valueUsd } : undefined,
      evidence: [],
      provenance: {
        kind: 'DERIVED',
        sourceEventIds: memberIds,
        calculation: grp.build.type === 'capital-consolidation' ? 'net_flow_consolidation' : 'net_flow_dispersal',
        inputs: { engine: ENGINE_VERSION, group: gid },
      } as Provenance,
      statement: '',
      groupId: gid,
    } as RelBuild & { groupId: string };
  });

  // Materialize relationships with deterministic rel_### ids.
  const allRelBuilds = [...relBuilds, ...flowBuilds].sort((a, b) =>
    relKindRank(a.kind) - relKindRank(b.kind) ||
    (a.from.toLowerCase() < b.from.toLowerCase() ? -1 : 1) ||
    (a.from.toLowerCase() > b.from.toLowerCase() ? 1 : 0) ||
    (a.to.toLowerCase() < b.to.toLowerCase() ? -1 : 1) ||
    (a.to.toLowerCase() > b.to.toLowerCase() ? 1 : 0),
  );
  const relPad = (i: number): string => `rel_${String(i).padStart(3, '0')}`;
  const relIdByBuild = new Map<RelBuild, string>();
  allRelBuilds.forEach((rb, i) => relIdByBuild.set(rb, relPad(i + 1)));

  // Link members to their groups' DERIVED flow edges. relationshipIds holds
  // RELATIONSHIP ids only: group event ids are reachable via the flow edge's
  // evidenceEventIds and the group provenance's sourceEventIds (which keeps
  // every id in relationshipIds resolvable to a relationship).
  const groupIdByMember = new Map<Materialized, string[]>();
  for (const grp of groupMats) {
    const gid = grpId.get(grp)!;
    for (const m of grp.build.members) {
      const arr = groupIdByMember.get(m) ?? [];
      arr.push(gid);
      groupIdByMember.set(m, arr);
    }
  }
  for (const rb of relBuilds) {
    const rid = relIdByBuild.get(rb)!;
    for (const m of rb.evidence) {
      m.relationshipIds.push(rid);
    }
  }
  for (const [m, gids] of groupIdByMember) {
    for (const fb of flowBuilds) {
      const fgid = (fb as RelBuild & { groupId: string }).groupId;
      if (gids.includes(fgid)) m.relationshipIds.push(relIdByBuild.get(fb)!);
    }
  }
  for (const m of memberMats) {
    m.relationshipIds.sort();
  }

  const relationships: Relationship[] = allRelBuilds.map((rb) => {
    const rid = relIdByBuild.get(rb)!;
    const evidenceEventIds = rb.kind === 'flow'
      ? [(rb as RelBuild & { groupId: string }).groupId]
      : rb.evidence.map((m) => matId.get(m)!).sort();
    return {
      id: rid,
      kind: rb.kind,
      fromEntityId: entityIdFor(rb.from),
      toEntityId: entityIdFor(rb.to),
      directed: rb.directed,
      ...(rb.metrics !== undefined ? { metrics: rb.metrics } : {}),
      ...(rb.nansenRelation !== undefined ? { nansenRelation: rb.nansenRelation } : {}),
      evidenceEventIds,
      provenance: rb.provenance,
    };
  });

  // Ensure every address referenced by events/relationships has an entity.
  // (Transfer/swap/token addresses were registered during extraction; the
  // representative flow endpoints always come from member movements, so they
  // are covered. This pass closes any residual gap deterministically.)
  const referenced = new Set<string>();
  for (const m of memberMats) {
    for (const p of m.cand.participants) referenced.add(p.address.toLowerCase());
  }
  for (const rb of allRelBuilds) {
    referenced.add(rb.from.toLowerCase());
    referenced.add(rb.to.toLowerCase());
  }
  const missingEntities: Entity[] = [];
  for (const addr of [...referenced].sort()) {
    if (!entityAcc.has(addr)) {
      // Recover original casing from the first reference.
      let original = addr;
      outer: for (const m of memberMats) {
        for (const p of m.cand.participants) {
          if (p.address.toLowerCase() === addr) { original = p.address; break outer; }
        }
      }
      missingEntities.push({
        id: entityIdFor(original),
        kind: 'wallet',
        address: original,
        chain: subject.chain,
        displayName: shortAddress(original),
        labels: [],
        role: 'counterparty',
        admissionReason: 'referenced-by-event',
        provenance: {
          kind: 'DERIVED',
          sourceEventIds: [],
          calculation: 'entity_closure',
          inputs: { engine: ENGINE_VERSION },
        },
      });
    }
  }
  const allEntities = [...entities, ...missingEntities].sort((a, b) => (a.id < b.id ? -1 : 1));

  // --- materialize TraceEvents in final timeline order ------------------------
  const events: TraceEvent[] = [];
  for (const entry of timeline) {
    if ('mat' in entry) {
      const m = entry.mat;
      const id = matId.get(m)!;
      events.push({
        id,
        type: m.cand.type,
        title: m.cand.title,
        timestamp: m.cand.timestampIso,
        order: events.length + 1,
        participants: m.cand.participants.map((p) => ({
          entityId: entityIdFor(p.address),
          side: p.side,
        })),
        ...(m.cand.valueUsd !== null
          ? {
            value: {
              ...(m.cand.tokenSymbol !== null ? { tokenSymbol: m.cand.tokenSymbol } : {}),
              ...(m.cand.tokenAddress !== null ? { tokenAddress: m.cand.tokenAddress } : {}),
              valueUsd: m.cand.valueUsd,
            },
          }
          : {}),
        ...(m.cand.txHash !== null ? { txHash: m.cand.txHash } : {}),
        ...(m.cand.method !== null ? { method: m.cand.method } : {}),
        significance: m.significance,
        admissionRule: m.admissionRule,
        primary: m.primary,
        relationshipIds: [...m.relationshipIds],
        provenance: m.provenance,
      });
    } else {
      const grp = entry.grp;
      const id = grpId.get(grp)!;
      const memberIds = (grp.provenance as { sourceEventIds: string[] }).sourceEventIds;
      const perSide = grp.build.type === 'capital-consolidation' ? 'to' : 'from';
      events.push({
        id,
        type: grp.build.type,
        title: grp.build.type === 'capital-consolidation'
          ? `Consolidation into ${shortAddress(grp.build.keyAddress)} (${grp.build.members.length} observed transfers${grp.build.valueUsd !== null ? `, ${fmtUsd(grp.build.valueUsd)} combined` : ''})`
          : `Dispersal from ${shortAddress(grp.build.keyAddress)} (${grp.build.members.length} observed transfers${grp.build.valueUsd !== null ? `, ${fmtUsd(grp.build.valueUsd)} combined` : ''})`,
        timestamp: grp.build.timestampIso,
        order: events.length + 1,
        participants: [{ entityId: entityIdFor(grp.build.keyAddress), side: perSide === 'to' ? 'to' : 'from' }],
        ...(grp.build.valueUsd !== null ? { value: { valueUsd: grp.build.valueUsd } } : {}),
        significance: grp.significance,
        admissionRule: 'derived-grouping',
        primary: true,
        relationshipIds: [
          relIdByBuild.get(
            flowBuilds.find((fb) => (fb as RelBuild & { groupId: string }).groupId === id)!,
          )!,
        ],
        provenance: {
          kind: 'DERIVED',
          sourceEventIds: memberIds,
          calculation: grp.build.type === 'capital-consolidation' ? 'consolidation' : 'dispersal',
          inputs: {
            engine: ENGINE_VERSION,
            members: grp.build.members.length,
            members_with_usd: grp.build.membersWithUsd,
            ...(grp.build.valueUsd !== null ? { combined_usd: grp.build.valueUsd } : {}),
          },
        },
      });
    }
  }

  // --- summary (FACT/DERIVED only — never HYPOTHESIS) --------------------------
  const summary: SummaryMetric[] = [
    {
      key: 'steps_reconstructed',
      label: 'Steps reconstructed',
      value: events.filter((e) => e.primary).length,
      unit: 'events',
      provenance: {
        kind: 'DERIVED',
        sourceEventIds: events.filter((e) => e.primary).map((e) => e.id),
        calculation: 'primary_event_count',
        inputs: { engine: ENGINE_VERSION },
      },
    },
    {
      key: 'entities_involved',
      label: 'Entities involved',
      value: allEntities.length,
      unit: 'entities',
      provenance: {
        kind: 'DERIVED',
        sourceEventIds: [],
        calculation: 'entity_count',
        inputs: { engine: ENGINE_VERSION },
      },
    },
  ];
  const valued = memberMats.filter((m) => m.cand.valueUsd !== null);  if (valued.length > 0) {
    const peak = Math.max(...valued.map((m) => m.cand.valueUsd as number));
    const peakEvent = valued.find((m) => m.cand.valueUsd === peak)!;
    summary.push({
      key: 'peak_value_moved_usd',
      label: 'Peak value moved (single observed event)',
      value: peak,
      unit: 'USD',
      provenance: {
        kind: 'DERIVED',
        sourceEventIds: [matId.get(peakEvent)!],
        calculation: 'max_observed_value_usd',
        inputs: { engine: ENGINE_VERSION },
      },
    });
  }

  // --- data gaps (honest, deterministic) --------------------------------------
  const dataGaps: string[] = [
    'Nansen rows carry no txIndex/logIndex; ordering uses (timestamp, txHash lexicographic, event-kind rank, source endpoint) with no invented indexes.',
  ];
  if (cleaned.counterparties.length > 0) {
    dataGaps.push(
      'Counterparty rows are window-level aggregates without per-transaction timestamps; they are represented as undirected aggregate relationships, not timeline events.',
    );
  }
  if (cleaned.transactions.length > 0) {
    dataGaps.push(
      'profiler/address/transactions returns latest-first; exploit-day rows may require pagination beyond the captured sample (is_last_page=false observed in fixtures).',
    );
  }
  const missingUsd = memberMats.filter((m) => m.cand.valueUsd === null).length;
  if (missingUsd > 0) {
    dataGaps.push(
      `${missingUsd} event(s) have no USD value in the source rows; values were not estimated or zero-filled.`,
    );
  }
  if (duplicatesSkipped > 0) {
    dataGaps.push(
      `${duplicatesSkipped} exact-duplicate record(s) collapsed by dedupe key (first in canonical order kept).`,
    );
  }
  if (flowsSkipped > 0) {
    dataGaps.push(
      `${flowsSkipped} flow bucket(s) intentionally not eventized (window aggregates without transaction anchors).`,
    );
  }

  // --- case sources (deduped, sorted) ------------------------------------------
  const seenSources = new Map<string, SourceRef>();
  const consider = (s: SourceMeta): void => {
    const key = `${s.source}|${s.requestId ?? ''}|${s.capturedAt}`;
    if (!seenSources.has(key)) seenSources.set(key, sourceRefFor(s));
  };
  for (const kinds of [cleaned.transfers, cleaned.swaps, cleaned.counterparties, cleaned.relationships, cleaned.transactions]) {
    for (const r of kinds as Array<Provenanced<unknown>>) consider(r.source);
  }
  const sources = [...seenSources.values()].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0 ||
    (a.requestId ?? '') < (b.requestId ?? '') ? -1 : 1,
  );

  const hasPrimary = events.some((e) => e.primary);
  const investigation: Investigation = {
    id: caseDesc.id,
    name: caseDesc.name,
    chain: subject.chain,
    window: { from: caseDesc.window.from, to: caseDesc.window.to },
    status: events.length === 0 || !hasPrimary ? 'partial' : 'reconstructed',
    headline: caseDesc.headline,
    summary,
    events,
    entities: allEntities,
    relationships,
    dataGaps,
    sources,
    reconstructedAt,
  };

  const stats: EngineStats = {
    inputsReceived,
    duplicatesSkipped,
    flowsSkipped,
    memberEvents: memberMats.length,
    primaryEvents: events.filter((e) => e.primary).length,
    collapsedEvents: events.filter((e) => !e.primary).length,
    groupsDerived: groupMats.length,
    entitiesAssembled: allEntities.length,
    relationshipsAssembled: relationships.length,
  };

  return { investigation, stats };
}
