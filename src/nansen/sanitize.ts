/**
 * TRACE — token-metadata sanitizer (shared: live orchestrator + capture scripts).
 *
 * Scam airdrops inject megabyte-scale strings into token display fields —
 * observed here as a 200 KB `to_address_label` on a zero-value "FOLLOWME"
 * transfer. Nansen's `hide_spam_token` does not strip these. This clears any
 * oversized display string (symbol / name / address label) in place, leaving
 * every real transfer anchor — addresses, amounts, USD, hash, timestamp —
 * untouched. Cleared strings normalize to null downstream (tracked, not guessed).
 *
 * This lives under src/ (not scripts/) because it is a production concern: the
 * live reconstruction path (src/investigations/live.ts) sanitizes transaction
 * rows at request time, before they ever reach the normalizer or the contract.
 */

export interface SanitizeCaps {
  symbolMax: number;
  nameMax: number;
  labelMax: number;
}

/** Real symbols/names/labels are short; anything longer is injected metadata. */
export const DEFAULT_CAPS: SanitizeCaps = { symbolMax: 40, nameMax: 80, labelMax: 96 };

export interface ClearedCounts {
  symbolsCleared: number;
  namesCleared: number;
  labelsCleared: number;
}

const LABEL_FIELDS = ['from_address_label', 'to_address_label'] as const;

/** Sanitize transaction rows in place; returns how many strings were cleared. */
export function sanitizeRows(
  rows: Array<Record<string, unknown>>,
  caps: SanitizeCaps = DEFAULT_CAPS,
): ClearedCounts {
  const counts: ClearedCounts = { symbolsCleared: 0, namesCleared: 0, labelsCleared: 0 };
  const clear = (obj: Record<string, unknown>, field: string, max: number, bump: keyof ClearedCounts): void => {
    const v = obj[field];
    if (typeof v === 'string' && v.length > max) {
      obj[field] = '';
      counts[bump] += 1;
    }
  };
  for (const row of rows) {
    for (const lf of LABEL_FIELDS) clear(row, lf, caps.labelMax, 'labelsCleared');
    for (const key of ['tokens_sent', 'tokens_received'] as const) {
      const arr = row[key];
      if (!Array.isArray(arr)) continue;
      for (const tok of arr as Array<Record<string, unknown>>) {
        clear(tok, 'token_symbol', caps.symbolMax, 'symbolsCleared');
        clear(tok, 'token_name', caps.nameMax, 'namesCleared');
        for (const lf of LABEL_FIELDS) clear(tok, lf, caps.labelMax, 'labelsCleared');
      }
    }
  }
  return counts;
}

/**
 * Sanitize token-god-mode rows (tgm/transfers, tgm/dex-trades) in place. Unlike
 * profiler/transactions, these carry their display strings at the ROW level
 * (`token_symbol`, `token_name`, `traded_token_name`, and the `*_address_label`
 * fields), so the same injected-metadata defense must reach them before the
 * normalizer or the contract. Returns how many strings were cleared, so the
 * live run can accumulate it into the same sanitization tally.
 */
export function sanitizeTgmRows(
  rows: Array<Record<string, unknown>>,
  caps: SanitizeCaps = DEFAULT_CAPS,
): ClearedCounts {
  const counts: ClearedCounts = { symbolsCleared: 0, namesCleared: 0, labelsCleared: 0 };
  const clear = (obj: Record<string, unknown>, field: string, max: number, bump: keyof ClearedCounts): void => {
    const v = obj[field];
    if (typeof v === 'string' && v.length > max) {
      obj[field] = '';
      counts[bump] += 1;
    }
  };
  for (const row of rows) {
    clear(row, 'token_symbol', caps.symbolMax, 'symbolsCleared');
    clear(row, 'token_name', caps.nameMax, 'namesCleared');
    clear(row, 'traded_token_name', caps.nameMax, 'namesCleared');
    clear(row, 'from_address_label', caps.labelMax, 'labelsCleared');
    clear(row, 'to_address_label', caps.labelMax, 'labelsCleared');
    clear(row, 'trader_address_label', caps.labelMax, 'labelsCleared');
  }
  return counts;
}
