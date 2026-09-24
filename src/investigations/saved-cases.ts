/**
 * TRACE — saved live cases (save-as-case store).
 *
 * A finished live reconstruction is already a complete, self-validating
 * InvestigationContract, so "saving" one is just persisting that JSON and
 * re-validating it on load — no code builder is needed. This module is the
 * storage leaf for that: it reads validated contracts out of a local directory
 * (data/cases/, gitignored) and writes one back. The registry merges these
 * alongside the built-in fixture cases so a saved run shows up in the library.
 *
 * Trust model: this is a local / self-hosted store. Only contracts that pass
 * assertContract are ever written or served, and the caseId is constrained to a
 * filesystem-safe charset before it is used as a filename (no path traversal).
 * It does not — and cannot — prove the underlying rows truly came from Nansen;
 * you are saving your own runs.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertContract } from '../contract/validate.ts';
import type { InvestigationContract } from '../contract/types.ts';

/** Thrown when a contract cannot be persisted (e.g. an unsafe caseId). */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/**
 * Filesystem-safe caseId: lowercase-alnum start, then alnum / underscore /
 * hyphen, length-capped. Matches the built-ins (case_euler_2023) and live ids
 * (live_1234abcd_2022-11-11) while rejecting dots, slashes, and traversal.
 */
export const CASE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Default store directory. `TRACE_CASES_DIR` (absolute or cwd-relative) wins when
 * set — it relocates the store for self-hosting and pins the test suite to an
 * ephemeral dir. Otherwise the store is <repo>/data/cases/, built as a runtime
 * path so bundlers leave it alone. Resolving to an absolute path keeps the write
 * side (route handler) and the read side (RSC pages) pointing at the same
 * directory regardless of where each bundle lands on disk.
 */
function defaultSavedDir(): string {
  const override = process.env.TRACE_CASES_DIR;
  if (override && override.trim() !== '') return resolve(override);
  const rel = ['..', '..', 'data', 'cases', ''].join('/');
  return fileURLToPath(new URL(rel, import.meta.url));
}

/**
 * Bundled ("shipped") cases directory — tracked in git, so a real finished run
 * (e.g. the one live reconstruction that reaches `complete`) ships WITH the repo
 * and shows on every deploy, independent of the per-install `data/cases/` store.
 * `TRACE_SHIPPED_CASES_DIR` (absolute or cwd-relative) wins when set — the test
 * suite pins it to an empty dir so the built-in-only assertions stay hermetic.
 * Otherwise the store is <repo>/data/shipped/, built as a runtime path.
 */
export function defaultShippedDir(): string {
  const override = process.env.TRACE_SHIPPED_CASES_DIR;
  if (override && override.trim() !== '') return resolve(override);
  const rel = ['..', '..', 'data', 'shipped', ''].join('/');
  return fileURLToPath(new URL(rel, import.meta.url));
}

/**
 * A cheap fingerprint of the store's current contents: sorted filename + mtime +
 * size for every .json, joined. It changes whenever a case is added, removed, or
 * re-saved, so a reader can detect a new save by comparing signatures — without
 * relying on an in-process cache reset reaching it (route handlers and RSC pages
 * can run in separate module instances). Missing directory → empty signature.
 */
export function savedCasesSignature(dir: string = defaultSavedDir()): string {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const s = statSync(join(dir, name));
      parts.push(`${name}:${s.mtimeMs}:${s.size}`);
    } catch {
      // vanished between readdir and stat — treat as absent
    }
  }
  return parts.join('|');
}

export interface SaveResult {
  caseId: string;
  /** Absolute path of the written file. */
  file: string;
}

/**
 * Validate and persist a contract as <dir>/<caseId>.json. Throws ContractError
 * (invalid contract) or SaveError (unsafe caseId). Creates the directory if
 * needed, and overwrites an existing saved file with the same id (idempotent).
 */
export function saveContract(contract: unknown, dir: string = defaultSavedDir()): SaveResult {
  assertContract(contract);
  const { caseId } = contract;
  if (!CASE_ID_RE.test(caseId)) {
    throw new SaveError(`caseId ${JSON.stringify(caseId)} is not filesystem-safe (must match ${CASE_ID_RE}).`);
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${caseId}.json`);
  writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  return { caseId, file };
}

/**
 * Load every valid saved contract from the store, sorted by filename for a
 * stable order. Missing directory → none. A corrupt or invalid file is skipped
 * (with a server-side warning) rather than taking down the whole library.
 */
export function loadSavedContracts(dir: string = defaultSavedDir()): InvestigationContract[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: InvestigationContract[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      assertContract(parsed);
      out.push(parsed);
    } catch (err) {
      console.warn(`[trace] skipping invalid saved case ${name}: ${(err as Error).message}`);
    }
  }
  return out;
}
