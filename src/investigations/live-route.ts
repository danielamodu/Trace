/**
 * TRACE — live reconstruction route logic (Phase 3K, step 2).
 *
 * Framework-free glue between the Next.js POST handler (app/api/reconstruct)
 * and the orchestrator (reconstructFromAddress). Kept out of the route file so
 * it can be unit-tested with node:test and an injected client — no next/*, no
 * network, no key. The route file is a thin adapter over runReconstruct().
 *
 * SECURITY POSTURE (read before deploying):
 *  - This endpoint SPENDS CREDITS. Each successful run makes paid Nansen calls,
 *    against either a caller-supplied key (BYO) or the server's NANSEN_API_KEY.
 *  - There is NO authentication and NO rate limiting here. That is acceptable
 *    for local / self-hosted single-user use (the intended hackathon/OSS mode)
 *    but is NOT safe to expose publicly as-is: add auth + rate limiting first.
 *  - The server key is used ONLY when TRACE_ALLOW_SERVER_KEY is truthy, so a
 *    deployed instance does not silently drain the owner's credits for anon
 *    callers. BYO keys always work.
 *  - A caller-supplied key is used for exactly one request: passed to the
 *    orchestrator, never logged, never persisted, never echoed in the response.
 *  - Budget is clamped to server maxima regardless of what the caller asks for.
 */

import { reconstructFromAddress, type LiveBudget, type NansenLike } from './live.ts';
import { NansenApiError } from '../nansen/client.ts';

/** Hard server-side ceilings on a single request's spend (caller cannot exceed). */
export const SERVER_MAX_CREDITS = 25;
export const SERVER_MAX_PAGES = 10;

export interface RunOptions {
  /** Whether the server's NANSEN_API_KEY may be used as a fallback credential. */
  allowServerKey: boolean;
  /** Whether a server key is actually present (never the value itself). */
  hasServerKey: boolean;
  /** Test seam: an injected client bypasses all key handling. */
  client?: NansenLike;
  /** Fixed clock for deterministic tests. */
  reconstructedAt?: string;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

/** A validation failure that maps to HTTP 400 with a safe, caller-facing message. */
class BadRequest extends Error {}

function asRecord(v: unknown, label: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new BadRequest(`${label} must be a JSON object`);
  }
  return v as Record<string, unknown>;
}

function reqString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new BadRequest(`"${key}" is required and must be a non-empty string`);
  }
  return v.trim();
}

function clampBudget(raw: unknown): Partial<LiveBudget> {
  const out: Partial<LiveBudget> = {};
  if (raw === undefined || raw === null) return out;
  const rec = asRecord(raw, '"budget"');
  if (rec.maxCredits !== undefined) {
    const n = Number(rec.maxCredits);
    if (!Number.isFinite(n) || n <= 0) throw new BadRequest('"budget.maxCredits" must be a positive number');
    out.maxCredits = Math.min(Math.trunc(n), SERVER_MAX_CREDITS);
  }
  if (rec.maxPages !== undefined) {
    const n = Number(rec.maxPages);
    if (!Number.isFinite(n) || n <= 0) throw new BadRequest('"budget.maxPages" must be a positive number');
    out.maxPages = Math.min(Math.trunc(n), SERVER_MAX_PAGES);
  }
  if (rec.perPage !== undefined) {
    const n = Number(rec.perPage);
    if (Number.isFinite(n) && n > 0) out.perPage = Math.trunc(n); // orchestrator clamps to 100
  }
  if (typeof rec.fetchCounterparties === 'boolean') out.fetchCounterparties = rec.fetchCounterparties;
  if (typeof rec.fetchRelatedWallets === 'boolean') out.fetchRelatedWallets = rec.fetchRelatedWallets;
  return out;
}

export interface ParsedRequest {
  address: string;
  window: { from: string; to: string };
  budget: Partial<LiveBudget>;
  chain?: string;
  apiKey?: string; // BYO, server-side only — never logged, persisted, or returned
  name?: string;
  headline?: string;
}

/** Validate + normalize the request body. Throws BadRequest (→ 400) on bad input. */
export function parseReconstructRequest(body: unknown): ParsedRequest {
  const rec = asRecord(body, 'request body');
  const address = reqString(rec, 'address');
  const win = asRecord(rec.window, '"window"');
  const parsed: ParsedRequest = {
    address,
    window: { from: reqString(win, 'from'), to: reqString(win, 'to') },
    budget: clampBudget(rec.budget),
  };
  if (typeof rec.chain === 'string' && rec.chain.trim() !== '') parsed.chain = rec.chain.trim();
  if (typeof rec.apiKey === 'string' && rec.apiKey.trim() !== '') parsed.apiKey = rec.apiKey.trim();
  if (typeof rec.name === 'string' && rec.name.trim() !== '') parsed.name = rec.name.trim();
  if (typeof rec.headline === 'string' && rec.headline.trim() !== '') parsed.headline = rec.headline.trim();
  return parsed;
}

/** Map any thrown error to a safe HTTP result. Never leaks a key (none is in scope here). */
function toErrorResult(err: unknown): RouteResult {
  // Orchestrator param validation (assertParams) — all messages are prefixed.
  if (err instanceof Error && err.message.startsWith('reconstructFromAddress:')) {
    return { status: 400, body: { error: err.message.slice('reconstructFromAddress:'.length).trim() } };
  }
  // Upstream Nansen failure: surface auth/rate-limit verbatim, collapse the rest to 502.
  if (err instanceof NansenApiError) {
    const upstream = err.status;
    const mapped = upstream === 401 || upstream === 403 || upstream === 429 ? upstream : 502;
    return { status: mapped, body: { error: 'Nansen API call failed', nansenStatus: upstream, detail: err.message } };
  }
  // NansenClient constructor when no key is present anywhere.
  if (err instanceof Error && /NANSEN_API_KEY is not set/.test(err.message)) {
    return { status: 400, body: { error: 'no Nansen API key available' } };
  }
  return {
    status: 500,
    body: { error: 'reconstruction failed', detail: err instanceof Error ? err.message : String(err) },
  };
}

/**
 * Parse → authorize a credential → reconstruct → shape the HTTP result.
 * Returns `{ status, body }`; the route handler just serializes it. The BYO key
 * (or server key) is confined to this call and never appears in the response.
 */
export async function runReconstruct(body: unknown, opts: RunOptions): Promise<RouteResult> {
  let parsed: ParsedRequest;
  try {
    parsed = parseReconstructRequest(body);
  } catch (err) {
    if (err instanceof BadRequest) return { status: 400, body: { error: err.message } };
    throw err;
  }

  const useInjected = opts.client !== undefined;
  const byoKey = parsed.apiKey;
  const serverKeyUsable = opts.allowServerKey && opts.hasServerKey;
  if (!useInjected && byoKey === undefined && !serverKeyUsable) {
    return {
      status: 400,
      body: {
        error: 'no Nansen API key available',
        detail: opts.hasServerKey
          ? 'A server key is present but disabled for this endpoint (set TRACE_ALLOW_SERVER_KEY=1 to enable it). Otherwise supply your own key in the request.'
          : 'Provide your own Nansen API key in the request. It is used once to call Nansen and is never stored, logged, or returned.',
      },
    };
  }

  try {
    const { contract, meta } = await reconstructFromAddress({
      address: parsed.address,
      window: parsed.window,
      budget: parsed.budget,
      ...(parsed.chain !== undefined ? { chain: parsed.chain } : {}),
      ...(useInjected ? { client: opts.client } : byoKey !== undefined ? { apiKey: byoKey } : {}),
      ...(opts.reconstructedAt !== undefined ? { reconstructedAt: opts.reconstructedAt } : {}),
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.headline !== undefined ? { headline: parsed.headline } : {}),
    });
    return { status: 200, body: { contract, meta } };
  } catch (err) {
    return toErrorResult(err);
  }
}
