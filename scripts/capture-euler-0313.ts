/**
 * TRACE Phase 3G — controlled live capture of Euler exploit-day transactions.
 *
 * Queries ONLY the repo-canonical attacker address (imported programmatically
 * from src/investigations/euler.ts — never retyped) on
 * POST /api/v1/profiler/address/transactions for 2023-03-13 → 2023-03-14.
 *
 * Budget: hard max 5 calls / ~5 credits. Stops early on is_last_page, on
 * timestamps exiting the window, or when remaining credits cannot cover
 * another page. Raw responses preserved under fixtures/live/euler/; existing
 * fixtures untouched. Key material never logged or written (redact() applied).
 *
 * Usage: node --env-file-if-exists=.env scripts/capture-euler-0313.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { NansenClient, NansenApiError, redact } from '../src/nansen/client.ts';
import { EULER_ATTACKER, EULER_CHAIN } from '../src/investigations/euler.ts';

const PATH = '/api/v1/profiler/address/transactions';
const WINDOW = { from: '2023-03-13', to: '2023-03-14' };
const PER_PAGE = 100; // endpoint max (422 value_out_of_range above 100; corrected 2026-09-22)
const MAX_CALLS = 5;
const OUT_DIR = 'fixtures/live/euler';

interface PageRecord {
  page: number;
  status: number;
  requestId: string | null;
  creditsCost: string | null;
  creditsUsed: string | null;
  creditsRemaining: string | null;
  rowsReturned: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  isLastPage: boolean | null;
  fixtureFile: string;
}

function timestampsOf(rows: Array<Record<string, unknown>>): { min: string | null; max: string | null } {
  const ts = rows
    .map((r) => r.block_timestamp)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .sort();
  if (ts.length === 0) return { min: null, max: null };
  return { min: ts[0], max: ts[ts.length - 1] };
}

async function main(): Promise<void> {
  if (!NansenClient.hasKey()) {
    console.error('BLOCKED: NANSEN_API_KEY is not set. No calls made.');
    process.exitCode = 2;
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const client = new NansenClient();
  const pages: PageRecord[] = [];
  let stopReason = 'unknown';
  let calls = 0;

  for (let page = 1; page <= MAX_CALLS; page++) {
    const body = {
      address: EULER_ATTACKER,
      chain: EULER_CHAIN,
      date: { ...WINDOW },
      hide_spam_token: false,
      pagination: { page, per_page: PER_PAGE },
    };
    calls += 1;
    try {
      const started = Date.now();
      const { data, meta } = await client.post<Record<string, unknown>>(PATH, body);
      const rows = Array.isArray((data as { data?: unknown }).data)
        ? (data as { data: Array<Record<string, unknown>> }).data
        : [];
      const { min, max } = timestampsOf(rows);
      const pagination = (data as { pagination?: Record<string, unknown> }).pagination;
      const isLast = typeof pagination?.is_last_page === 'boolean' ? pagination.is_last_page as boolean : null;
      const file = `${OUT_DIR}/profiler-transactions-2023-03-13-p${page}.json`;
      writeFileSync(file, redact(JSON.stringify({
        endpoint: PATH,
        request_body: body,
        response_meta: meta,
        response_body: data,
        pagination_summary: {
          page, rowsReturned: rows.length, earliestTimestamp: min, latestTimestamp: max, isLastPage: isLast,
        },
        captured_at: new Date().toISOString(),
      }, null, 2)));
      pages.push({
        page, status: meta.status, requestId: meta.requestId,
        creditsCost: meta.creditsCost, creditsUsed: meta.creditsUsed, creditsRemaining: meta.creditsRemaining,
        rowsReturned: rows.length, earliestTimestamp: min, latestTimestamp: max, isLastPage: isLast,
        fixtureFile: file,
      });
      console.log(`OK   page=${page} status=${meta.status} cost=${meta.creditsCost} used=${meta.creditsUsed} remaining=${meta.creditsRemaining} rows=${rows.length} min=${min} max=${max} last=${isLast} ${Date.now() - started}ms`);

      if (is_last_page(data)) {
        stopReason = `is_last_page=true on page ${page}; window covered`;
        break;
      }
      if (max !== null && max < `${WINDOW.from}T00:00:00`) {
        stopReason = `page ${page} timestamps exited the window below ${WINDOW.from}; stopping`;
        break;
      }
      const remaining = meta.creditsRemaining !== null ? Number(meta.creditsRemaining) : NaN;
      if (Number.isFinite(remaining) && remaining < 1) {
        stopReason = `insufficient remaining credits (${meta.creditsRemaining}) for another page; stopping`;
        break;
      }
      if (page === MAX_CALLS) {
        stopReason = `reached MAX_CALLS=${MAX_CALLS} without is_last_page; stopping per budget`;
        break;
      }
      await new Promise((r) => setTimeout(r, 500)); // gentle self-throttle
    } catch (err) {
      if (err instanceof NansenApiError) {
        console.error(`ERR  page=${page} status=${err.status} ${err.message}`);
        writeFileSync(`${OUT_DIR}/profiler-transactions-2023-03-13-p${page}.error.json`, redact(JSON.stringify({
          endpoint: PATH, request_body: body, status: err.status,
          error_body: err.body, meta: err.meta, captured_at: new Date().toISOString(),
        }, null, 2)));
        stopReason = `API error on page ${page} (status ${err.status}); stopping without further spend`;
        break;
      }
      throw err;
    }
  }

  const manifest = {
    phase: '3G',
    address: EULER_ATTACKER,
    address_source: 'src/investigations/euler.ts EULER_ATTACKER (programmatic, not retyped)',
    window: WINDOW,
    endpoint: PATH,
    maxCalls: MAX_CALLS,
    callsMade: calls,
    stopReason,
    pages,
    totalRows: pages.reduce((s, p) => s + p.rowsReturned, 0),
    creditsUsedTotal: pages.reduce((s, p) => s + (Number(p.creditsUsed ?? p.creditsCost ?? 0) || 0), 0),
    creditsRemainingAfter: pages.length > 0 ? pages[pages.length - 1].creditsRemaining : null,
    captured_at: new Date().toISOString(),
  };
  writeFileSync(`${OUT_DIR}/manifest.json`, redact(JSON.stringify(manifest, null, 2)));
  console.log(`\nDone. calls=${calls} rows=${manifest.totalRows} stop="${stopReason}"`);
  console.log(`Manifest: ${OUT_DIR}/manifest.json`);

  function is_last_page(data: Record<string, unknown>): boolean {
    const p = (data as { pagination?: Record<string, unknown> }).pagination;
    return p?.is_last_page === true;
  }
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
