import { NextResponse } from 'next/server';
import { runReconstruct } from '../../../src/investigations/live-route.ts';
import { Guard, clientIp, type Refusal } from '../../../src/investigations/guard.ts';

/**
 * POST /api/reconstruct — live reconstruction from an address + window.
 *
 * SECURITY: this endpoint spends Nansen credits, so it is gated by a Guard
 * (../../../src/investigations/guard.ts): a shared API token (Authorization:
 * Bearer <token> or x-trace-token), a per-IP rate limit, and a per-process
 * credit budget. In production it is FAIL-CLOSED — with no TRACE_API_TOKEN set
 * it refuses every request. A `{ "dryRun": true }` body returns a worst-case
 * credit estimate without calling Nansen or spending. The server's
 * NANSEN_API_KEY is used only when TRACE_ALLOW_SERVER_KEY is set; otherwise
 * callers bring their own key, used once and never stored, logged, or returned.
 * The API token is never logged. See guard.ts for the single-instance caveats.
 */

// One guard per server instance holds the in-memory rate limiter + credit ledger.
const guard = Guard.fromEnv(process.env);

function refuse(r: Refusal): NextResponse {
  const res = NextResponse.json(r.body, { status: r.status });
  if (r.retryAfterSec) res.headers.set('Retry-After', String(r.retryAfterSec));
  return res;
}

export async function POST(request: Request) {
  const auth = guard.authorize(request.headers);
  if (auth) return refuse(auth);
  const rate = guard.rateLimit(clientIp(request.headers));
  if (rate) return refuse(rate);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const allowServerKey = /^(1|true|yes)$/i.test(process.env.TRACE_ALLOW_SERVER_KEY ?? '');
  const hasServerKey = Boolean(process.env.NANSEN_API_KEY);

  const { status, body: payload } = await runReconstruct(body, {
    allowServerKey,
    hasServerKey,
    guardSpend: (estimate) => guard.preflight(estimate),
  });

  // Charge the deploy's credit ledger with what the run actually spent.
  if (status === 200 && payload && typeof payload === 'object' && 'meta' in payload) {
    const meta = (payload as { meta?: { creditsSpent?: number } }).meta;
    if (meta && typeof meta.creditsSpent === 'number') guard.settle(meta.creditsSpent);
  }

  return NextResponse.json(payload, { status });
}

/**
 * GET /api/reconstruct — credential + guard posture only. Returns whether the
 * server key is enabled, whether the caller must bring their own key, and the
 * safe guard posture (auth required, rate limit, remaining budget).
 * SECURITY: never returns the key or the token — only booleans/numbers from env.
 */
export function GET() {
  const allowServerKey = /^(1|true|yes)$/i.test(process.env.TRACE_ALLOW_SERVER_KEY ?? '');
  const hasServerKey = Boolean(process.env.NANSEN_API_KEY);
  const serverKeyEnabled = allowServerKey && hasServerKey;
  return NextResponse.json({ serverKeyEnabled, byoRequired: !serverKeyEnabled, ...guard.posture() });
}
