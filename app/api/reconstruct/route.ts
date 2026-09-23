import { NextResponse } from 'next/server';
import { runReconstruct } from '../../../src/investigations/live-route.ts';

/**
 * POST /api/reconstruct — live reconstruction from an address + window.
 *
 * SECURITY: this endpoint spends Nansen credits and has NO authentication and
 * NO rate limiting. It is intended for local / self-hosted single-user use
 * (the hackathon / OSS mode). Do NOT expose it publicly without adding auth and
 * rate limiting first. The server's NANSEN_API_KEY is used only when
 * TRACE_ALLOW_SERVER_KEY is set; otherwise callers must bring their own key,
 * which is used for one request and never stored, logged, or returned.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const allowServerKey = /^(1|true|yes)$/i.test(process.env.TRACE_ALLOW_SERVER_KEY ?? '');
  const hasServerKey = Boolean(process.env.NANSEN_API_KEY);

  const { status, body: payload } = await runReconstruct(body, { allowServerKey, hasServerKey });
  return NextResponse.json(payload, { status });
}
