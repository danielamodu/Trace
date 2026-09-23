/**
 * TRACE — Contract assembly (Phase 3C).
 *
 * `buildContract` wraps a Phase 3B `ReconstructionResult` in the stable
 * application-facing envelope: completeness (recomputed by rule, never
 * asserted), evidence metadata, and the frozen investigation. Build-time
 * `assertContract` guarantees only valid contracts leave this function.
 */

import type {
  EngineInput,
  EngineOptions,
  ReconstructionResult,
} from '../reconstruction/engine.ts';
import { ENGINE_VERSION, reconstruct } from '../reconstruction/engine.ts';
import type { ReconstructionSubject, CaseDescriptor } from '../reconstruction/engine.ts';
import { collectOrigins, computeCompleteness, computeEvidence } from './completeness.ts';
import { deepFreeze } from './service.ts';
import { CONTRACT_VERSION } from './types.ts';
import type {
  CoverageReport,
  DataSource,
  InvestigationContract,
} from './types.ts';
import { assertContract } from './validate.ts';

export interface BuildContractOptions {
  dataSource: DataSource;
  coverage: CoverageReport;
  /** Normalized build inputs (for unavailable-field aggregation). Optional but recommended. */
  inputs?: EngineInput;
}

/**
 * Assemble, validate, and deep-freeze an InvestigationContract. Throws
 * ContractError when the result violates the contract (fail loudly, never
 * serve a broken case).
 */
export function buildContract(
  result: ReconstructionResult,
  options: BuildContractOptions,
): InvestigationContract {
  const { completeness, completenessReasons } = computeCompleteness(
    result.investigation,
    options.coverage,
    options.dataSource,
  );
  const contract: InvestigationContract = {
    contractVersion: CONTRACT_VERSION,
    engineVersion: ENGINE_VERSION,
    caseId: result.investigation.id,
    dataSource: options.dataSource,
    // Phase 3H: full pool enumeration alongside the conservative single value.
    dataSources: collectOrigins(result.investigation),
    completeness,
    completenessReasons,
    coverage: {
      flags: { ...options.coverage.flags },
      reasons: [...options.coverage.reasons],
    },
    evidence: computeEvidence(result.investigation, result.stats, options.inputs),
    investigation: result.investigation,
  };
  assertContract(contract);
  return deepFreeze(contract);
}

/**
 * Convenience: reconstruct + assemble in one step. Used by case builders
 * (see src/investigations/) and tests.
 */
export function reconstructContract(
  input: EngineInput,
  subject: ReconstructionSubject,
  caseDesc: CaseDescriptor,
  coverage: CoverageReport,
  dataSource: DataSource,
  engineOptions: EngineOptions = {},
): InvestigationContract {
  const result = reconstruct(input, subject, caseDesc, engineOptions);
  return buildContract(result, { dataSource, coverage, inputs: input });
}
