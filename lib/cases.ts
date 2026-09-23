/**
 * TRACE — Read-only application adapter (Phase 3D).
 *
 * The single seam between the UI/API routes and the contract layer. Wraps the
 * Phase 3C service: builds it once per server process from the fixture cache
 * and exposes list/get over the authoritative InvestigationContract objects.
 * Framework-free (zero next/* imports) so the existing node:test suite can
 * exercise it directly. Never bypasses the contract, never mutates, never
 * calls the network.
 */

import { buildEulerService } from '../src/investigations/euler.ts';
import type { ContractService } from '../src/contract/service.ts';
import type { CaseSummary, InvestigationContract } from '../src/contract/types.ts';

let service: ContractService | null = null;

/** Process-wide singleton; built once from fixtures on first use. */
export function getService(): ContractService {
  if (service === null) service = buildEulerService();
  return service;
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
