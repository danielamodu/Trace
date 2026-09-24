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
import { loadSavedContracts } from './saved-cases.ts';
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
 * Ids owned by code (fixture-backed builders above). A saved live case may
 * never shadow these, so the save route rejects them.
 */
export const BUILT_IN_CASE_IDS: readonly string[] = CASE_REGISTRY.map((c) => c.id);

/**
 * Pinned reconstruction clock for the bundled fixture-cache library. Built-in
 * cases are point-in-time snapshots of captured Nansen data, so their
 * `reconstructedAt` is a fixed capture date — NOT the server's boot clock. This
 * makes every built-in contract byte-identical across processes and machines,
 * so its content fingerprint (see contract/verify.ts) is stable and portable:
 * the CLI, the /verify route and a case page all hash the same artifact. An
 * explicit `reconstructedAt` (live runs, tests) still overrides it.
 */
export const BUILTIN_RECONSTRUCTED_AT = '2026-09-22T00:00:00.000Z';

/**
 * Built-in contracts, memoized by reconstructedAt so the fixture reads and
 * engine runs happen once per process even when the service is rebuilt to pick
 * up a newly saved case. The returned arrays are treated as immutable — callers
 * copy before appending saved cases.
 */
let builtInMemo: { key: string; contracts: InvestigationContract[]; availableIds: string[] } | null = null;

function builtInContracts(reconstructedAt?: string): { contracts: InvestigationContract[]; availableIds: string[] } {
  const key = reconstructedAt ?? BUILTIN_RECONSTRUCTED_AT;
  if (builtInMemo !== null && builtInMemo.key === key) return builtInMemo;
  const built = CASE_REGISTRY.map((c) => ({ contract: c.buildContract(key), available: c.available }));
  builtInMemo = {
    key,
    contracts: built.map((b) => b.contract),
    availableIds: built.filter((b) => b.available).map((b) => b.contract.caseId),
  };
  return builtInMemo;
}

/**
 * Build the read-only service over every registered case. Built-in contracts
 * come from the memo above (fixture reads happen once); saved live contracts are
 * then merged in from the local store (data/cases/) so a saved run joins the
 * library. Built-in ids are authoritative: a saved file can never shadow
 * Euler/FTX, and duplicate saved ids collapse to the first seen, so the service
 * never sees a caseId collision. `savedDir` overrides the store (tests only).
 */
export function buildTraceService(reconstructedAt?: string, savedDir?: string): ContractService {
  const base = builtInContracts(reconstructedAt);
  const contracts: InvestigationContract[] = [...base.contracts];
  const availableIds: string[] = [...base.availableIds];

  const seen = new Set(contracts.map((c) => c.caseId));
  for (const saved of loadSavedContracts(savedDir)) {
    if (seen.has(saved.caseId)) continue;
    seen.add(saved.caseId);
    contracts.push(saved);
    availableIds.push(saved.caseId); // saved cases are real runs → always available
  }
  return createContractService(contracts, availableIds);
}
