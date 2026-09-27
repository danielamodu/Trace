/**
 * Presentation-only formatters for the TRACE UI. Pure, no contract logic.
 * Guardrail: null / undefined money and amounts render as an em-dash — we
 * never fabricate or zero-fill a value the engine didn't observe.
 */

const EMPTY = '—';

/** USD, compact past a million, never invented. null/undefined → em-dash. */
export function fmtUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY;
  const compact = Math.abs(value) >= 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: 2,
    minimumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

/** Token amount with symbol. Missing amount → em-dash. */
export function fmtAmount(amount: number | null | undefined, symbol?: string | null): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return EMPTY;
  const num = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: amount < 1 ? 6 : 2,
  }).format(amount);
  return symbol ? `${num} ${symbol}` : num;
}

/** "Mar 13, 2023 · 08:50 UTC" */
export function fmtTimestamp(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${date} · ${time} UTC`;
}

/** "Mar 13, 2023" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "Mar 13 – Mar 31, 2023" from a {from,to} window. */
export function fmtWindow(window: { from: string; to: string } | null | undefined): string {
  if (!window?.from || !window?.to) return EMPTY;
  const from = new Date(window.from);
  const to = new Date(window.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return EMPTY;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const left = from.toLocaleDateString('en-US', opts);
  const right = to.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return sameYear ? `${left} – ${right}` : `${left}, ${from.getUTCFullYear()} – ${right}`;
}

/** 0x1234…abcd */
export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return EMPTY;
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
