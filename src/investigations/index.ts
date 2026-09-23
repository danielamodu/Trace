/**
 * TRACE — investigations module barrel (Phase 3C: case assembly).
 *
 * Case builders bind incident metadata to the engine + fixture cache and wrap
 * results in the application-facing contract. The registry is the app-facing
 * seam; MVP ships exactly one available case (Euler). No live calls, no secrets.
 */

export * from './euler.ts';
export * from './registry.ts';
