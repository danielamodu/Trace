/**
 * TRACE — conceptual type barrel (Phase 2 spec).
 *
 * These are the canonical shapes the product is designed around. They contain
 * NO implementation logic — the reconstruction engine, client, and UI are
 * Phase 3. See docs/phase-2-product-system-spec.md.
 */

export type * from './provenance.ts';
export type * from './entities.ts';
export type * from './relationships.ts';
export type * from './events.ts';
export type * from './investigation.ts';
