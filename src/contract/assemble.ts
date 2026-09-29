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
import type { Investigation } from '../types/investigation.ts';
import { collectOrigins, computeCompleteness, computeEvidence } from './completeness.ts';
import { deriveHypotheses } from './hypotheses.ts';
import { deepFreeze } from './service.ts';
import { CONTRACT_VERSION } from './types.ts';
import type {
  CoverageReport,
  DataSource,
  InvestigationContract,
  OriginAttestation,
} from './types.ts';
import { assertContract } from './validate.ts';

export interface BuildContractOptions {
  dataSource: DataSource;
  coverage: CoverageReport;
  /** Normalized build inputs (for unavailable-field aggregation). Optional but recommended. */
  inputs?: EngineInput;
  /**
   * Hybrid origin-proof (item #3). When present it is folded onto the contract
   * before validation + freeze, so the attestation is covered by the
   * fingerprint. Omit it to build a pre-#3-shaped contract (still valid).
   */
  origin?: OriginAttestation;
}

/**
 * The origin attestation for a fixture-cache build (item #3): no live Nansen
 * HTTP call is made at request time — the records were captured earlier and
 * cached as fixtures. Shared by every fixture case builder so they attest
 * identically. Pass the case's reconstructedAt as `capturedAt` for determinism.
 */
export function noLiveHttpOrigin(capturedAt: string): OriginAttestation {
  return {
    mode: 'no-live-http',
    capturedAt,
    note: 'Fixture-cache build: no live Nansen HTTP response at request time; records were captured earlier and cached as fixtures (see investigation.sources for per-source capture timestamps).',
    receipts: [],
  };
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
  // Derive the optional open-leads channel (never inline, never evidence). It
  // is folded onto the investigation before validation/freeze so the contract
  // carries it end-to-end; absent when no lead rule fires. Completeness,
  // origins, and evidence counts ignore it by construction.
  const hypotheses = deriveHypotheses(result.investigation);
  const investigation: Investigation = hypotheses.length
    ? { ...result.investigation, hypotheses }
    : result.investigation;

  const { completeness, completenessReasons } = computeCompleteness(
    investigation,
    options.coverage,
    options.dataSource,
  );
  const contract: InvestigationContract = {
    contractVersion: CONTRACT_VERSION,
    engineVersion: ENGINE_VERSION,
    caseId: investigation.id,
    dataSource: options.dataSource,
    // Phase 3H: full pool enumeration alongside the conservative single value.
    dataSources: collectOrigins(investigation),
    completeness,
    completenessReasons,
    coverage: {
      flags: { ...options.coverage.flags },
      reasons: [...options.coverage.reasons],
    },
    evidence: computeEvidence(investigation, result.stats, options.inputs),
    investigation,
  };
  // Item #3: fold the origin attestation on only when supplied, so callers that
  // don't opt in produce a byte-identical (pre-#3) contract. Cloned so the
  // caller's object isn't captured by the deep-freeze below.
  if (options.origin) {
    contract.origin = {
      mode: options.origin.mode,
      capturedAt: options.origin.capturedAt,
      ...(options.origin.note !== undefined ? { note: options.origin.note } : {}),
      receipts: options.origin.receipts.map((r) => ({ ...r })),
    };
  }
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
