/**
 * TRACE — deploy guard for the credit-spending + write routes (feedback #4).
 *
 * Framework-free (no next/*), so node:test drives it with an injected clock and
 * explicit config. The route files are thin adapters that build one Guard from
 * process.env at module load and call it per request.
 *
 * Why it exists: POST /api/reconstruct spends real Nansen credits and
 * POST /api/cases writes to disk. With no controls, a public URL lets anyone
 * drain the owner's credit grant or fill the store. This adds four gates:
 *   1. Shared-secret token   — Authorization: Bearer <t>  (or x-trace-token)
 *   2. Per-IP rate limit      — fixed 60s window, refuses bursts
 *   3. Process credit budget  — a cumulative ceiling across all runs
 *   4. Dry-run cost estimate  — worst-case credits WITHOUT calling Nansen
 * plus a prod gate that disables the /api/cases write path.
 *
 * FAIL-CLOSED: in production (NODE_ENV==='production') with no TRACE_API_TOKEN,
 * the reconstruct gate refuses every request (503) rather than spend for an
 * anonymous caller. Locally (dev) an unset token allows requests for convenience.
 *
 * LIMITATIONS (single-instance assumption): the rate limiter and credit ledger
 * are in-memory and per-process. They reset on restart and are NOT shared across
 * multiple serverless instances or replicas. For the hackathon single-instance
 * deploy this is sufficient; a multi-instance deploy needs a shared store (Redis)
 * and must not treat these as a hard global cap. The token is never logged.
 */

import { DEFAULT_BUDGET, type LiveBudget } from './live.ts';

/** Per-endpoint worst-case credit cost, mirroring live.ts COST_FALLBACK. */
const COUNTERPARTIES_COST = 5;
const RELATED_WALLETS_COST = 1;
const TX_PAGE_COST = 1;

/** Defaults when the corresponding env var is unset. */
const DEFAULT_RATE_PER_MIN = 5;
const DEFAULT_PROD_CREDIT_BUDGET = 100;

export interface CreditEstimate {
  /** Worst-case credits this run could spend (what the ledger checks against). */
  worstCaseCredits: number;
  /** Sum of every planned call at full cost, before the maxCredits ceiling. */
  plannedCredits: number;
  /** The hard per-run ceiling the orchestrator stops at. */
  budgetCeiling: number;
  breakdown: { counterparties: number; relatedWallets: number; transactionPages: number };
}

/**
 * Worst-case credit estimate for a (partial) budget. Pure — never calls Nansen.
 * Because the orchestrator's priciest call (counterparties) runs first, the
 * worst-case actual spend is min(planned, ceiling) with no meaningful overshoot.
 */
export function estimateCredits(partial: Partial<LiveBudget> = {}): CreditEstimate {
  const b: LiveBudget = { ...DEFAULT_BUDGET, ...partial };
  const counterparties = b.fetchCounterparties ? COUNTERPARTIES_COST : 0;
  const relatedWallets = b.fetchRelatedWallets ? RELATED_WALLETS_COST : 0;
  const pages = Math.max(0, Math.trunc(b.maxPages));
  const transactionPages = pages * TX_PAGE_COST;
  const plannedCredits = counterparties + relatedWallets + transactionPages;
  const budgetCeiling = Math.max(0, Math.trunc(b.maxCredits));
  return {
    worstCaseCredits: Math.min(plannedCredits, budgetCeiling),
    plannedCredits,
    budgetCeiling,
    breakdown: { counterparties, relatedWallets, transactionPages },
  };
}

export type HeaderLike = Headers | Record<string, string | string[] | undefined>;

function headerValue(h: HeaderLike, name: string): string | null {
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name);
  const rec = h as Record<string, string | string[] | undefined>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? rec[key] : undefined;
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Constant-time-ish compare that does not early-return on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length, 1);
  for (let i = 0; i < n; i += 1) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Pull the presented bearer / x-trace token from request headers. */
export function presentedToken(headers: HeaderLike): string | null {
  const auth = headerValue(headers, 'authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const x = headerValue(headers, 'x-trace-token');
  return x ? x.trim() : null;
}

/** Best-effort client IP. Spoofable unless a trusted proxy overwrites XFF. */
export function clientIp(headers: HeaderLike): string {
  const xff = headerValue(headers, 'x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return headerValue(headers, 'x-real-ip') ?? 'unknown';
}

export interface Clock {
  now(): number;
}
const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/** In-memory fixed-window per-key rate limiter. Per-process; resets on restart. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;
  constructor(limit: number, windowMs: number, clock: Clock = SYSTEM_CLOCK) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
  }

  /** Record a hit for `key`. ok:false once the window's limit is exceeded. */
  check(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    if (this.limit <= 0) return { ok: true }; // 0 / negative disables the limiter
    const now = this.clock.now();
    const cur = this.hits.get(key);
    if (!cur || now >= cur.resetAt) {
      this.prune(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true };
    }
    cur.count += 1;
    if (cur.count > this.limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
    }
    return { ok: true };
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) if (now >= v.resetAt) this.hits.delete(k);
  }
}

/** Cumulative per-process credit ceiling. Infinity budget = uncapped (local dev). */
export class CreditLedger {
  private spentCredits = 0;
  private readonly budget: number;
  constructor(budget: number) {
    this.budget = budget;
  }
  get spent(): number {
    return this.spentCredits;
  }
  remaining(): number {
    return this.budget === Infinity ? Infinity : Math.max(0, this.budget - this.spentCredits);
  }
  canAfford(credits: number): boolean {
    return this.spentCredits + Math.max(0, credits) <= this.budget;
  }
  record(credits: number): void {
    if (Number.isFinite(credits) && credits > 0) this.spentCredits += credits;
  }
}

/** A refusal shaped as an HTTP result; retryAfterSec drives a Retry-After header. */
export type Refusal = { status: number; body: { error: string; detail?: string }; retryAfterSec?: number };

export interface GuardConfig {
  token: string | null;
  isProduction: boolean;
  ratePerMin: number;
  creditBudget: number;
  allowSave: boolean;
}

function intEnv(v: string | undefined, fallback: number): number {
  const s = (v ?? '').trim();
  if (s === '') return fallback; // unset/blank → fallback (an empty string coerces to 0)
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}
const truthy = (v: string | undefined): boolean => /^(1|true|yes|on)$/i.test((v ?? '').trim());

/**
 * Combines the four gates behind one object built once per server instance.
 * Every method is pure w.r.t. its inputs except the limiter/ledger, which hold
 * per-process counters. Refusals are returned (never thrown) so route adapters
 * stay trivial: `const r = guard.authorize(h); if (r) return respond(r);`.
 */
export class Guard {
  readonly limiter: RateLimiter;
  readonly ledger: CreditLedger;
  private readonly cfg: GuardConfig;
  constructor(cfg: GuardConfig, clock: Clock = SYSTEM_CLOCK) {
    this.cfg = cfg;
    this.limiter = new RateLimiter(cfg.ratePerMin, 60_000, clock);
    this.ledger = new CreditLedger(cfg.creditBudget);
  }

  /** Build from environment. Env is read once; tests construct Guard directly. */
  static fromEnv(env: Record<string, string | undefined> = process.env, clock?: Clock): Guard {
    const isProduction = (env.NODE_ENV ?? '') === 'production';
    const token = (env.TRACE_API_TOKEN ?? '').trim() || null;
    const ratePerMin = intEnv(env.TRACE_RATE_LIMIT_PER_MIN, DEFAULT_RATE_PER_MIN);
    // Budget: uncapped locally, but a conservative cap in prod so a forgotten
    // env var cannot drain the whole grant.
    const hasBudget = env.TRACE_CREDIT_BUDGET !== undefined && env.TRACE_CREDIT_BUDGET.trim() !== '';
    const creditBudget = hasBudget
      ? intEnv(env.TRACE_CREDIT_BUDGET, DEFAULT_PROD_CREDIT_BUDGET)
      : isProduction
        ? DEFAULT_PROD_CREDIT_BUDGET
        : Infinity;
    return new Guard({ token, isProduction, ratePerMin, creditBudget, allowSave: truthy(env.TRACE_ALLOW_SAVE) }, clock);
  }

  /** Token gate. null → allowed; a Refusal → stop with that HTTP result. */
  authorize(headers: HeaderLike): Refusal | null {
    const token = this.cfg.token;
    if (!token) {
      if (this.cfg.isProduction) {
        return {
          status: 503,
          body: {
            error: 'server is not configured for authenticated access',
            detail: 'Set TRACE_API_TOKEN on the deployment to enable this endpoint.',
          },
        };
      }
      return null; // dev convenience: no token configured, not production
    }
    const presented = presentedToken(headers);
    if (!presented || !safeEqual(presented, token)) {
      return {
        status: 401,
        body: {
          error: 'unauthorized',
          detail: 'Provide the API token via Authorization: Bearer <token> or the x-trace-token header.',
        },
      };
    }
    return null;
  }

  /** Per-IP rate gate. */
  rateLimit(ip: string): Refusal | null {
    const r = this.limiter.check(ip);
    if (r.ok) return null;
    return {
      status: 429,
      body: { error: 'rate limit exceeded', detail: `Too many requests. Try again in ${r.retryAfterSec}s.` },
      retryAfterSec: r.retryAfterSec,
    };
  }

  /** Budget gate: refuse if the worst-case estimate exceeds the remaining budget. */
  preflight(estimate: CreditEstimate): Refusal | null {
    if (this.ledger.canAfford(estimate.worstCaseCredits)) return null;
    const remaining = this.ledger.remaining();
    return {
      status: 429,
      body: {
        error: 'deploy credit budget exhausted',
        detail: `This deployment's credit budget is spent (remaining ${remaining}, this run needs up to ${estimate.worstCaseCredits}).`,
      },
    };
  }

  /** Record actual spend after a successful run. */
  settle(creditsSpent: number): void {
    this.ledger.record(creditsSpent);
  }

  /** Whether POST /api/cases may write on this deployment. */
  get saveEnabled(): boolean {
    return this.cfg.allowSave || !this.cfg.isProduction;
  }

  /** Safe, token-free posture for a GET introspection endpoint. */
  posture(): {
    authRequired: boolean;
    ratePerMin: number;
    creditBudget: number | null;
    creditsRemaining: number | null;
    saveEnabled: boolean;
  } {
    const rem = this.ledger.remaining();
    return {
      authRequired: this.cfg.token !== null || this.cfg.isProduction,
      ratePerMin: this.cfg.ratePerMin,
      creditBudget: this.cfg.creditBudget === Infinity ? null : this.cfg.creditBudget,
      creditsRemaining: rem === Infinity ? null : rem,
      saveEnabled: this.saveEnabled,
    };
  }
}



