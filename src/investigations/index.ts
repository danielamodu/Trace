/**
 * TRACE — investigations module barrel (Phase 3C: case assembly).
 *
 * Case builders bind incident metadata to the engine + fixture cache and wrap
 * results in the application-facing contract. The registry is the app-facing
 * seam; two real fixture-backed cases ship available (Euler, FTX). No live
 * calls, no secrets.
 */

export * from './euler.ts';
export * from './ftx.ts';
export * from './registry.ts';
