/**
 * Zero-credit connectivity + auth smoke test.
 *
 * Calls POST /api/v1/search/general (documented cost: 0 credits) so we can
 * confirm the key, base URL, headers, and error envelope WITHOUT spending
 * plan credits. Prints status + sanitized meta.
 *
 * Run:  npm run smoke            (loads .env if present)
 *   or: node scripts/smoke.ts
 *
 * With no NANSEN_API_KEY set, this intentionally reports the exact failure
 * rather than fabricating a response.
 */

import { NansenClient, NansenApiError } from '../src/nansen/client.ts';

async function main() {
  if (!NansenClient.hasKey()) {
    console.error('BLOCKED: NANSEN_API_KEY is not set.');
    console.error('This is the expected Phase-1 blocker until a key is provided.');
    console.error('Copy .env.example to .env and add the key, then re-run.');
    process.exitCode = 2;
    return;
  }

  const client = new NansenClient();
  const path = '/api/v1/search/general';
  const body = { search_query: 'ethereum', result_type: 'any' as const };

  try {
    const { data, meta } = await client.post<{ data?: unknown[] } & Record<string, unknown>>(path, body);
    const rows = Array.isArray((data as any)?.data) ? (data as any).data.length : 'n/a';
    console.log('OK', path);
    console.log('  status           :', meta.status);
    console.log('  request_id       :', meta.requestId);
    console.log('  credits_cost     :', meta.creditsCost);
    console.log('  credits_used     :', meta.creditsUsed);
    console.log('  credits_remaining:', meta.creditsRemaining);
    console.log('  rows_returned    :', rows);
    console.log('  top-level keys   :', Object.keys(data as object).join(', '));
  } catch (err) {
    if (err instanceof NansenApiError) {
      console.error('API ERROR', path);
      console.error('  status    :', err.status);
      console.error('  message   :', err.message);
      console.error('  request_id:', err.meta.requestId);
      console.error('  body      :', JSON.stringify(err.body));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
