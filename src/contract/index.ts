/**
 * TRACE — contract module barrel (Phase 3C: application-facing contract).
 *
 * View-model layer around the Phase 3B Investigation: envelope types,
 * completeness computation, runtime validation, assembly, and the read-only
 * service future route handlers consume. No HYPOTHESIS is representable in
 * the default contract (enforced by validate.ts).
 */

export type * from './types.ts';
export { CONTRACT_VERSION } from './types.ts';
export * from './completeness.ts';
export * from './validate.ts';
export * from './verify.ts';
export * from './assemble.ts';
export * from './service.ts';
