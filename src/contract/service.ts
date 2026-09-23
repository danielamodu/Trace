/**
 * TRACE — Read-only contract service (Phase 3C).
 *
 * The seam future Next.js route handlers consume: `listCases()` for the case
 * listing, `getContract(caseId)` for the full reconstruction. Everything
 * served is deep-frozen at build time, so handlers (and their callers) cannot
 * mutate the cached case — the service is strictly read-only. No network, no
 * live calls, no secrets: cases are assembled from fixtures by
 * src/investigations/ before being handed to `createContractService`.
 */

import type { CaseSummary, InvestigationContract } from './types.ts';

/** Recursively freeze an object graph (cycle-safe). Returns the input. */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>();
  const freeze = (v: unknown): void => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v as object);
    if (Array.isArray(v)) {
      for (const item of v) freeze(item);
    } else {
      for (const key of Object.keys(v)) freeze((v as Record<string, unknown>)[key]);
    }
    Object.freeze(v);
  };
  freeze(value);
  return value;
}

/** Thrown when a route handler requests an unknown case id. */
export class UnknownCaseError extends Error {
  readonly caseId: string;
  constructor(caseId: string, known: string[]) {
    super(`unknown case '${caseId}' (known: ${known.join(', ') || 'none'})`);
    this.name = 'UnknownCaseError';
    this.caseId = caseId;
  }
}

export interface ContractService {
  /** Frozen case listing (one entry per available case). */
  listCases(): readonly CaseSummary[];
  /** Frozen full contract. Throws UnknownCaseError for unknown ids. */
  getContract(caseId: string): InvestigationContract;
  hasCase(caseId: string): boolean;
  readonly caseIds: readonly string[];
}

function summarize(contract: InvestigationContract, available: boolean): CaseSummary {
  const inv = contract.investigation;
  return deepFreeze({
    caseId: contract.caseId,
    name: inv.name,
    chain: inv.chain,
    window: { ...inv.window },
    status: inv.status,
    dataSource: contract.dataSource,
    completeness: contract.completeness,
    primaryEvents: contract.evidence.primaryEvents,
    entities: inv.entities.length,
    available,
  });
}

export function createContractService(
  contracts: InvestigationContract[],
  availableIds?: string[],
): ContractService {
  const byId = new Map<string, InvestigationContract>();
  for (const c of contracts) {
    if (byId.has(c.caseId)) {
      throw new Error(`duplicate contract caseId '${c.caseId}'`);
    }
    byId.set(c.caseId, deepFreeze(c));
  }
  const available = new Set(availableIds ?? [...byId.keys()]);
  const summaries = deepFreeze(
    [...byId.values()].map((c) => summarize(c, available.has(c.caseId))),
  );
  const ids = deepFreeze([...byId.keys()].sort());
  return {
    listCases: () => summaries,
    getContract: (caseId: string) => {
      const found = byId.get(caseId);
      if (!found) throw new UnknownCaseError(caseId, [...byId.keys()].sort());
      return found;
    },
    hasCase: (caseId: string) => byId.has(caseId),
    caseIds: ids,
  };
}
