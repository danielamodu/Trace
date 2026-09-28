/**
 * POST /api/cases — save a finished live reconstruction into the local library.
 *
 * Security posture: this is the ONE write path in TRACE (it writes to the
 * server's disk, data/cases/, gitignored). It is gated by a Guard
 * (../../../src/investigations/guard.ts): DISABLED in production unless
 * TRACE_ALLOW_SAVE=1, and — when enabled — protected by the same shared API
 * token (Authorization: Bearer <token> or x-trace-token) and per-IP rate limit
 * as /api/reconstruct. Only contracts that pass full validation are written, the
 * caseId is constrained to a filesystem-safe charset (no path traversal), and
 * built-in cases (Euler/FTX) can never be overwritten. Saved cases are local to
 * this install and are not committed. The API token is never logged.
 */

import { NextResponse } from 'next/server';

import { runSaveCase } from '../../../src/investigations/save-route.ts';
import { resetService } from '../../../lib/cases.ts';
import { Guard, clientIp, type Refusal } from '../../../src/investigations/guard.ts';

// One guard per server instance (shares the rate limiter across save requests).
const guard = Guard.fromEnv(process.env);

function refuse(r: Refusal): NextResponse {
  const res = NextResponse.json(r.body, { status: r.status });
  if (r.retryAfterSec) res.headers.set('Retry-After', String(r.retryAfterSec));
  return res;
}

export async function POST(request: Request) {
  if (!guard.saveEnabled) {
    return NextResponse.json(
      {
        error: 'saving cases is disabled on this deployment',
        detail: 'Set TRACE_ALLOW_SAVE=1 to enable the write path (intended for local / self-hosted use).',
      },
      { status: 403 },
    );
  }
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
  // On a successful write, drop the cached service so the new case appears
  // immediately in the library (same server process; local/self-hosted).
  const { status, body: payload } = runSaveCase(body, { afterSave: resetService });
  return NextResponse.json(payload, { status });
}
