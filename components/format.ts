/** Display helpers. Formatting only — never a source of truth. USD values come
 *  verbatim from the contract; missing values stay missing (no zero-fill). */

export function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Deterministic en-US grouping; null stays null (rendered as unavailable). */
export function fmtUsd(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`;
}

/** ISO-8601 UTC → "YYYY-MM-DD HH:MM:SS UTC" via string ops only (no Date/TZ). */
export function fmtTime(iso: string): string {
  const t = iso.length >= 19 ? iso.slice(0, 19).replace('T', ' ') : iso;
  return `${t} UTC`;
}

export function eventTypeLabel(t: string): string {  switch (t) {
    case 'funding': return 'Funding';
    case 'transfer': return 'Transfer';
    case 'swap': return 'Swap';
    case 'contract-interaction': return 'Contract call';
    case 'capital-consolidation': return 'Consolidation';
    case 'capital-dispersal': return 'Dispersal';
    case 'entity-relationship': return 'Relationship';
    default: return t;
  }
}

export function provenanceLabel(kind: string): string {
  if (kind === 'FACT') return 'Observed';
  if (kind === 'RELATION') return 'Reported relationship';
  if (kind === 'DERIVED') return 'Derived';
  return kind;
}

export function explorerTxUrl(txHash: string): string {
  return `https://etherscan.io/tx/${txHash}`;
}

/** Display family for event-type tinting: movement, reported-link, or derived-group. */
export function eventTypeFamily(t: string): 'move' | 'rel' | 'derived' {
  if (t === 'funding' || t === 'entity-relationship') return 'rel';
  if (t === 'capital-consolidation' || t === 'capital-dispersal') return 'derived';
  return 'move';
}
