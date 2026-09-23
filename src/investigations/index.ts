/**
 * TRACE — investigations module barrel (Phase 3C: case assembly).
 *
 * Case builders bind incident metadata to the engine + fixture cache and wrap
 * results in the application-facing contract. MVP ships exactly one available
 * case (Euler). No live calls, no secrets.
 */

export * from './euler.ts';
