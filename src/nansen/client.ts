/**
 * Minimal server-side Nansen API client.
 *
 * Design constraints (TRACE Phase 1):
 *  - Server-side only. The API key is read from NANSEN_API_KEY and must never
 *    be sent to a browser or written to logs.
 *  - Zero runtime dependencies — uses Node's global fetch (Node >= 18/22).
 *  - Every call returns a typed { data, meta } result. `meta` captures the
 *    request id, credit accounting, and rate-limit state from response headers
 *    so recon runs are reproducible and credit usage is observable.
 *  - Errors surface as NansenApiError with the structured body when present.
 *
 * This file deliberately does NOT invent endpoint paths or fields. Paths and
 * request shapes come from the official OpenAPI specs at docs.nansen.ai.
 */

import type { CallMeta, NansenErrorBody } from './types.ts';

const DEFAULT_BASE_URL = 'https://api.nansen.ai';

export class NansenApiError extends Error {
  readonly status: number;
  readonly body: NansenErrorBody | string | null;
  readonly meta: CallMeta;
  constructor(message: string, status: number, body: NansenErrorBody | string | null, meta: CallMeta) {
    super(message);
    this.name = 'NansenApiError';
    this.status = status;
    this.body = body;
    this.meta = meta;
  }
}

export interface NansenResult<T> {
  data: T;
  meta: CallMeta;
}

export interface NansenClientOptions {
  apiKey?: string;      // defaults to process.env.NANSEN_API_KEY
  baseUrl?: string;     // defaults to NANSEN_BASE_URL or the public base
  timeoutMs?: number;   // per-request timeout, default 30s
}

function readMeta(res: Response): CallMeta {
  const h = res.headers;
  return {
    status: res.status,
    requestId: h.get('x-request-id'),
    creditsCost: h.get('x-nansen-credits-cost'),
    creditsUsed: h.get('x-nansen-credits-used'),
    creditsRemaining: h.get('x-nansen-credits-remaining'),
    rateLimitRemaining: h.get('x-ratelimit-remaining') ?? h.get('ratelimit-remaining'),
    retryAfter: h.get('retry-after'),
  };
}

export class NansenClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(opts: NansenClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.NANSEN_API_KEY ?? '';
    if (!apiKey) {
      throw new Error(
        'NANSEN_API_KEY is not set. Add it to your environment or .env file. ' +
        'The key is server-side only and must never reach the client.',
      );
    }
    this.#apiKey = apiKey;
    this.#baseUrl = (opts.baseUrl ?? process.env.NANSEN_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** True when a usable key is present. Never reveals the key itself. */
  static hasKey(): boolean {
    return Boolean(process.env.NANSEN_API_KEY);
  }

  /**
   * POST a JSON body to `path` (e.g. "/api/v1/tgm/transfers").
   * Resolves with typed data + meta on 2xx, throws NansenApiError otherwise.
   */
  async post<TResponse, TBody extends object = object>(
    path: string,
    body: TBody,
  ): Promise<NansenResult<TResponse>> {
    const url = this.#baseUrl + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // lowercase canonical header per Nansen docs; value never logged
          apikey: this.#apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const meta = readMeta(res);
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }

    if (!res.ok) {
      const errBody = (parsed ?? null) as NansenErrorBody | string | null;
      const msg =
        errBody && typeof errBody === 'object' && 'message' in errBody
          ? `${res.status} ${(errBody as NansenErrorBody).code ?? ''}: ${(errBody as NansenErrorBody).message}`
          : `${res.status} ${res.statusText}`;
      throw new NansenApiError(msg, res.status, errBody, meta);
    }

    return { data: parsed as TResponse, meta };
  }
}

/**
 * Redact anything that looks like a secret before printing. Belt-and-suspenders:
 * the client never logs the key, but recon output passes through here too.
 */
export function redact(value: string): string {
  const key = process.env.NANSEN_API_KEY;
  if (key && value.includes(key)) return value.split(key).join('***REDACTED***');
  return value;
}
