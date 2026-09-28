/**
 * TRACE — Open-lead derivation (the walled-off "hypotheses" channel).
 *
 * `deriveHypotheses` turns honest gaps in the captured evidence into
 * deterministic, rule-generated LEADS — suggestions of where an investigation
 * could go next. Leads are explicitly NOT evidence:
 *
 *  - They carry no provenance and no `kind` field (the contract bans
 *    `HYPOTHESIS` provenance on evidence; leads are possibilities, not claims).
 *  - Each restates something already observed (a dead-end, an exit-labelled
 *    counterparty) plus the concrete evidence that would confirm it.
 *  - Nothing is fabricated: a lead fires only when the rule's observations hold
 *    against the reconstructed case. A clean trail produces zero leads.
 *
 * Pure and deterministic: identical investigations → byte-identical leads. The
 * follow-the-money walk is reused verbatim from lib/follow.ts, so a lead's
 * dead-end is the same dead-end the UI renders on the timeline.
 */

import type { Investigation, Hypothesis } from '../types/investigation.ts';
import type { InvestigationContract } from './types.ts';
import { DEFAULT_VALUE_THRESHOLD_USD } from '../reconstruction/engine.ts';
import { followFromEvent } from '../../lib/follow.ts';

/** Hard cap on surfaced leads — a lead list is a shortlist, never a firehose. */
export const MAX_HYPOTHESES = 4;

/**
 * Curated, auditable off-ramp keyword set for Rule 2. Case-insensitive
 * substring match against an entity's label / category / tags. Deliberately
 * excludes DEX/protocol venues (see {@link DEX_PROTOCOL_KEYWORDS}): a swap on a
 * DEX is on-chain and traceable, so it is not an exit.
 */
export const EXIT_KEYWORDS: readonly string[] = [
  'exchange', 'cex', 'binance', 'coinbase', 'kraken', 'okx', 'okex', 'huobi',
  'kucoin', 'bitfinex', 'gemini', 'bybit', 'gate.io', 'crypto.com', 'bitstamp',
  'bridge', 'tornado', 'mixer', 'wasabi', 'railgun', 'sinbad', 'blender.io',
];

/**
 * DEX / on-chain-protocol markers that VETO an exit match: value reaching these
 * stays on-chain and traceable, so it is never treated as an off-ramp lead.
 */
export const DEX_PROTOCOL_KEYWORDS: readonly string[] = [
  'uniswap', 'sushiswap', 'balancer', 'curve', 'pancakeswap', 'dodo', 'bancor',
  '1inch', 'aggregator', 'dex', 'lp', 'vault', 'pool', 'protocol',
];

/**
 * A "named" entity is one Nansen actually identified. Nansen returns a bare
 * bracketed short-address (e.g. "[0x38699d]") when it has NO name for an
 * address — that is a formatted address, not an identity — so an entity whose
 * only labels are such placeholders counts as unnamed for lead purposes.
 */
const PLACEHOLDER_LABEL = /^\[0x[0-9a-fA-F]+\]$/;

interface LabelLike {
  label: string;
  category?: string;
  tags?: string[];
}

function isPlaceholderLabel(label: string): boolean {
  return PLACEHOLDER_LABEL.test(label.trim());
}

/** True when Nansen gave this entity a real name (not just a bracketed address). */
function isNamed(labels: readonly LabelLike[]): boolean {
  return labels.some((l) => !isPlaceholderLabel(l.label));
}

/** Lowercased haystack over an entity's label text, category and tags. */
function labelHaystack(labels: readonly LabelLike[]): string {
  const parts: string[] = [];
  for (const l of labels) {
    parts.push(l.label);
    if (l.category) parts.push(l.category);
    if (Array.isArray(l.tags)) parts.push(...l.tags);
  }
  return parts.join(' ').toLowerCase();
}

/** The exit label an entity matches, if any (and not vetoed as a DEX/protocol). */
function matchedExitLabel(labels: readonly LabelLike[]): string | null {
  if (labels.length === 0) return null;
  const hay = labelHaystack(labels);
  if (DEX_PROTOCOL_KEYWORDS.some((k) => hay.includes(k))) return null;
  if (!EXIT_KEYWORDS.some((k) => hay.includes(k))) return null;
  // Report the first real (non-placeholder) label as the human-readable name.
  const named = labels.find((l) => !isPlaceholderLabel(l.label));
  return (named ?? labels[0]).label;
}

function short(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function compactUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

/** Internal candidate before sort / cap / id assignment. */
interface Candidate {
  entityId: string;
  order: number;              // supporting event order (for deterministic sort)
  confidence: 'low' | 'medium';
  statement: string;
  basis: string;
  supportingEventIds: string[];
  whatWouldConfirm: string;
}

/**
 * Derive open leads for an investigation. Deterministic and side-effect free.
 * Returns [] when no rule fires (the honest outcome for a cleanly-resolved
 * trail). Never mutates the input.
 */
export function deriveHypotheses(inv: Investigation): Hypothesis[] {
  const events = inv.events ?? [];
  const entitiesById = new Map(inv.entities.map((e) => [e.id, e]));
  // followFromEvent reads only contract.investigation, so a thin wrapper works
  // pre-assembly (before the full contract exists).
  const asContract = { investigation: inv } as InvestigationContract;

  const byEntity = new Map<string, Candidate>();
  const consider = (c: Candidate): void => {
    const existing = byEntity.get(c.entityId);
    // One lead per target entity; the stronger (medium) signal wins a tie.
    if (existing && !(existing.confidence === 'low' && c.confidence === 'medium')) return;
    byEntity.set(c.entityId, c);
  };

  for (const ev of events) {
    if (ev.type !== 'transfer' || !ev.primary) continue;
    const usd = ev.value?.valueUsd;
    if (usd == null || usd < DEFAULT_VALUE_THRESHOLD_USD) continue;
    const to = ev.participants.find((p) => p.side === 'to');
    if (!to) continue;
    const ent = entitiesById.get(to.entityId);
    if (!ent || !ent.address) continue;
    const labels = ent.labels ?? [];
    const addr = ent.address;

    // Rule 2 (bonus) — value reaching a labelled off-ramp / bridge / mixer.
    const exitLabel = matchedExitLabel(labels);
    if (exitLabel !== null) {
      consider({
        entityId: ent.id,
        order: ev.order,
        confidence: 'medium',
        statement: `Value reaching ${exitLabel} (${short(addr)}) may have left on-chain traceability at this counterparty.`,
        basis: `${short(addr)} carries the Nansen label "${exitLabel}", matching a known off-ramp / bridge / mixer pattern; ${compactUsd(usd)} reached it in ${ev.id}.`,
        supportingEventIds: [ev.id],
        whatWouldConfirm: `Off-chain records from the exchange or bridge, or the counterparty's downstream on-chain activity, would show where the value went next.`,
      });
      continue;
    }

    // Rule 1 (backbone) — high-value transfer into an UNNAMED wallet where the
    // follow-the-money walk has no captured next hop.
    if (isNamed(labels)) continue;
    const follow = followFromEvent(asContract, ev.id);
    if (follow?.kind !== 'dead-end') continue;
    consider({
      entityId: ent.id,
      order: ev.order,
      confidence: 'low',
      statement: `Value reaching ${short(addr)} may have moved onward beyond the evidence captured in this case.`,
      basis: `${short(addr)} received ${compactUsd(usd)} in ${ev.id} and is not named by Nansen; the follow-the-money walk records no next hop from it here.`,
      supportingEventIds: [ev.id],
      whatWouldConfirm: `Capturing ${short(addr)}'s later transactions would show whether the value moved on, and to where.`,
    });
  }

  const ranked = [...byEntity.values()].sort((a, b) => {
    // Stronger leads first, then chronological, then stable by entity id.
    const conf = (a.confidence === 'medium' ? 0 : 1) - (b.confidence === 'medium' ? 0 : 1);
    if (conf !== 0) return conf;
    if (a.order !== b.order) return a.order - b.order;
    return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
  });

  return ranked.slice(0, MAX_HYPOTHESES).map((c, i) => ({
    id: `hyp_${String(i + 1).padStart(3, '0')}`,
    statement: c.statement,
    basis: c.basis,
    supportingEventIds: c.supportingEventIds,
    confidence: c.confidence,
    whatWouldConfirm: c.whatWouldConfirm,
  }));
}
