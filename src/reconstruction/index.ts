/**
 * TRACE — reconstruction module barrel (Phase 3B: normalization + engine).
 *
 * Phase 3A shipped the normalized data contract + deterministic normalizers.
 * Phase 3B adds the transaction normalizer gap-fill (transaction.ts) and the
 * deterministic reconstruction engine (engine.ts). No HYPOTHESIS records are
 * produced anywhere in this module.
 */

export type * from './normalized-types.ts';
export * from './normalize.ts';
export type * from './transaction.ts';
export { normalizeTransaction } from './transaction.ts';
export * from './engine.ts';
