/**
 * POST /api/cases — save a finished live reconstruction into the local library.
 *
 * Security posture (matches /api/reconstruct): no authentication, no rate
 * limiting — run locally or behind your own access controls. This route WRITES
 * to the server's disk (data/cases/, gitignored). Only contracts that pass full
 * validation are written, the caseId is constrained to a filesystem-safe
 * charset (no path traversal), and built-in cases (Euler/FTX) can never be
 * overwritten. Saved cases are local to this install and are not committed.
 */

import { NextResponse } from 'next/server';

import { runSaveCase } from '../../../src/investigations/save-route.ts';
import { resetService } from '../../../lib/cases.ts';

export async function POST(request: Request) {
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
