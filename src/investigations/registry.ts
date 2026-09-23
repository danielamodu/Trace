/**
 * TRACE — case registry (the de-Euler'd application seam).
 *
 * The app serves cases from this registry, not from a hardcoded Euler builder.
 * Each entry binds a case id to a fixture-backed contract builder (no live
 * calls, no secrets) and an availability flag. The engine, contract, service,
 * and UI are already case-agnostic — adding a captured incident is a single
 * registration here.
 *
 * Two cases are registered and available (Euler, FTX), both fixture-backed from
 * real captured Nansen data. Fabricated cases are never registered: the served
 * set only ever reflects real observed evidence.
 */

import { EULER_CASE_ID, buildEulerContract } from './euler.ts';
import { FTX_CASE_ID, buildFtxContract } from './ftx.ts';
import { createContractService } from '../contract/service.ts';
import type { ContractService } from '../contract/service.ts';
import type { InvestigationContract } from '../contract/types.ts';

export interface CaseRegistration {
  /** Stable case id; must equal the built contract's caseId. */
  id: string;
  /** Fixture-backed contract builder. Deterministic given reconstructedAt. */
  buildContract: (reconstructedAt?: string) => InvestigationContract;
  /**
   * Whether the case is offered as available in listings. A registered case
   * that is not yet fully captured can ship as unavailable (descriptor-only)
   * without claiming a complete reconstruction.
   */
  available: boolean;
}

/**
 * Registered cases, in listing order. Both are real, fixture-backed, available
 * cases; new incidents are appended here once their fixtures are captured.
 */
export const CASE_REGISTRY: readonly CaseRegistration[] = [
  { id: EULER_CASE_ID, buildContract: buildEulerContract, available: true },
  { id: FTX_CASE_ID, buildContract: buildFtxContract, available: true },
];

/**
 * Build the read-only service over every registered case. Contracts are built
 * once (fixture reads happen here); the availability flags control which ids
 * are listed as available. This replaces the Euler-only builder at the lib
 * seam and now serves every registered case.
 */
export function buildTraceService(reconstructedAt?: string): ContractService {
  const contracts = CASE_REGISTRY.map((c) => c.buildContract(reconstructedAt));
  const availableIds = CASE_REGISTRY.filter((c) => c.available).map((c) => c.id);
  return createContractService(contracts, availableIds);
}
