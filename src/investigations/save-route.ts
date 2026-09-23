/**
 * TRACE — /api/cases save-as-case route logic.
 *
 * Framework-free (no next/*), so the node:test suite drives it directly.
 * Accepts a finished InvestigationContract (bare, or wrapped as { contract }),
 * validates it, refuses to shadow a built-in case, and persists it to the local
 * store. This is the ONE write path in TRACE — every other seam is read-only —
 * so the guards live here: full contract validation, a built-in id guard, and a
 * filesystem-safe caseId (enforced in saveContract) before anything touches disk.
 */

import { validateContract, ContractError } from '../contract/validate.ts';
import type { InvestigationContract } from '../contract/types.ts';
import { saveContract, SaveError } from './saved-cases.ts';
import { BUILT_IN_CASE_IDS } from './registry.ts';

export interface SaveRouteResult {
  status: number;
  body: unknown;
}

export interface SaveCaseOptions {
  /** Storage dir override (tests). Defaults to the real store in saveContract. */
  dir?: string;
  /** Called once after a successful write (the route resets the case singleton). */
  afterSave?: () => void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unwrap a { contract } envelope, else treat the body itself as the contract. */
function contractFrom(body: unknown): unknown {
  if (isObject(body) && isObject(body.contract)) return body.contract;
  return body;
}

/**
 * Validate + persist a live contract into the local library. Returns a
 * RouteResult (never throws): 201 on success, 400 for an invalid contract or an
 * unsafe id, 409 when the id belongs to a built-in case, 500 on an unexpected
 * write failure. Never spends credits and never calls the network.
 */
export function runSaveCase(body: unknown, opts: SaveCaseOptions = {}): SaveRouteResult {
  const contract = contractFrom(body);
  const errors = validateContract(contract);
  if (errors.length > 0) {
    return { status: 400, body: { error: 'invalid contract', detail: errors.slice(0, 5) } };
  }
  const caseId = (contract as InvestigationContract).caseId;
  if (BUILT_IN_CASE_IDS.includes(caseId)) {
    return {
      status: 409,
      body: { error: `case '${caseId}' is a built-in and cannot be overwritten` },
    };
  }
  try {
    const { caseId: id } = saveContract(contract, opts.dir);
    opts.afterSave?.();
    return { status: 201, body: { caseId: id, url: `/cases/${id}` } };
  } catch (err) {
    if (err instanceof SaveError || err instanceof ContractError) {
      return { status: 400, body: { error: err.message } };
    }
    return { status: 500, body: { error: 'failed to save case', detail: (err as Error).message } };
  }
}
