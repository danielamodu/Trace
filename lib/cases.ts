/**
 * TRACE — Read-only application adapter (Phase 3D).
 *
 * The single seam between the UI/API routes and the contract layer. Wraps the
 * Phase 3C service: builds the fixture-backed cases once per process and merges
 * saved live cases from the local store, rebuilding when that store changes, and
 * exposes list/get over the authoritative InvestigationContract objects.
 * Framework-free (zero next/* imports) so the existing node:test suite can
 * exercise it directly. Never bypasses the contract, never mutates, never
 * calls the network.
 */

import { buildTraceService } from '../src/investigations/registry.ts';
import { savedCasesSignature } from '../src/investigations/saved-cases.ts';
import type { ContractService } from '../src/contract/service.ts';
import type { CaseSummary, InvestigationContract } from '../src/contract/types.ts';

/**
 * Cached service, keyed on a fingerprint of the saved-cases store. Built-in
 * cases (Euler/FTX) are fixture-backed and never change in a process; saved live
 * cases can be added at runtime via POST /api/cases. Rather than trust an
 * in-process reset to reach every reader — Next can run route handlers and RSC
 * pages as separate module instances, so a reset in the writer need not clear
 * the reader's cache — we rebuild whenever the store's on-disk signature changes.
 * The signal is the shared filesystem, so any reader picks up a newly saved case
 * on its next render, in any instance, without a server restart.
 */
let cache: { signature: string; service: ContractService } | null = null;

/** The read-only service over built-ins + saved cases, rebuilt on store change. */
export function getService(): ContractService {
  const signature = savedCasesSignature();
  if (cache !== null && cache.signature === signature) return cache.service;
  const service = buildTraceService();
  cache = { signature, service };
  return service;
}

/**
 * Force the next read to rebuild. The signature check already refreshes readers
 * when the store changes; the save route still calls this so the writing
 * instance reflects its own write immediately, before any mtime-resolution edge.
 */
export function resetService(): void {
  cache = null;
}

/** Case listing for the Command Center page and GET /api/cases. */
export function listCaseSummaries(): readonly CaseSummary[] {
  return getService().listCases();
}

/**
 * Full contract for a case page and GET /api/cases/[id].
 * Returns null for unknown ids (callers map to 404 / not-found).
 */
export function getCaseContract(caseId: string): InvestigationContract | null {
  const svc = getService();
  if (!svc.hasCase(caseId)) return null;
  return svc.getContract(caseId);
}
