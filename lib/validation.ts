/**
 * Client-side input guards for the reconstruction form. Deliberately pure and
 * framework-free so the form and any tests can share them. These only shape the
 * UI; the server re-validates every request before spending a credit.
 */

/** A well-formed 0x EVM address: 40 hex chars after the 0x prefix. */
export function isValidEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

/** An ordered date window. Empty bounds are treated as "not yet filled", not invalid. */
export function isOrderedDateWindow(from: string, to: string): boolean {
  if (!from || !to) return true;
  return from <= to;
}
