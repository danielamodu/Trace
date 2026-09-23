/**
 * TRACE Phase 3J — controlled live capture of FTX drain-window transactions.
 *
 * Queries ONLY the repo-canonical subject address (imported programmatically
 * from src/investigations/ftx.ts — never retyped) on
 * POST /api/v1/profiler/address/transactions for the drain core window.
 *
 * Budget: hard max 3 calls / ~3 credits. Stops early on is_last_page, on
 * timestamps exiting the window, or when remaining credits cannot cover another
 * page. Raw responses preserved under fixtures/live/ftx/; existing fixtures
 * untouched. Key material never logged or written (redact() applied).
 *
 * Data hygiene: the subject received airdropped tokens whose metadata carries
 * malicious multi-kilobyte symbol/name strings. Each page is sanitized BEFORE
 * being written — any token_symbol/token_name over a length cap is stored empty
 * (normalizes to null downstream). Every real transfer anchor (addresses,
 * amounts, USD, hash, timestamp) is preserved untouched. The count of cleared
 * strings is recorded per page and in the manifest so the mutation is auditable.
 *
 * Usage: node --env-file-if-exists=.env scripts/capture-ftx.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { NansenClient, NansenApiError, redact } from '../src/nansen/client.ts';
import { FTX_SUBJECT, FTX_CHAIN, FTX_CAPTURE_WINDOW } from '../src/investigations/ftx.ts';
import { sanitizeRows, DEFAULT_CAPS } from '../src/nansen/sanitize.ts';

const PATH = '/api/v1/profiler/address/transactions';
const WINDOW = { from: FTX_CAPTURE_WINDOW.from, to: FTX_CAPTURE_WINDOW.to };
const PER_PAGE = 100; // endpoint max (422 above 100)
const MAX_CALLS = 3;
const OUT_DIR = 'fixtures/live/ftx';

interface PageRecord {
  page: number;
  status: number;
  requestId: string | null;
  creditsCost: string | null;
  creditsUsed: string | null;
  creditsRemaining: string | null;
  rowsReturned: number;
  symbolsCleared: number;
  namesCleared: number;
  labelsCleared: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  isLastPage: boolean | null;
  fixtureFile: string;
  rel: string;
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
      address: FTX_SUBJECT,
      chain: FTX_CHAIN,
      date: { ...WINDOW },
      hide_spam_token: true,
      pagination: { page, per_page: PER_PAGE },
    };
    calls += 1;
    try {
      const started = Date.now();
      const { data, meta } = await client.post<Record<string, unknown>>(PATH, body);
      const rows = Array.isArray((data as { data?: unknown }).data)
        ? (data as { data: Array<Record<string, unknown>> }).data
        : [];
      const cleared = sanitizeRows(rows); // mutates rows within `data` before writing
      const { min, max } = timestampsOf(rows);
      const pagination = (data as { pagination?: Record<string, unknown> }).pagination;
      const isLast = typeof pagination?.is_last_page === 'boolean' ? pagination.is_last_page as boolean : null;
      const basename = `profiler-transactions-2022-11-11-p${page}.json`;
      const file = `${OUT_DIR}/${basename}`;
      const rel = `live/ftx/${basename}`;
      writeFileSync(file, redact(JSON.stringify({
        endpoint: PATH,
        request_body: body,
        response_meta: meta,
        sanitization: { ...DEFAULT_CAPS, ...cleared },
        response_body: data,
        pagination_summary: {
          page, rowsReturned: rows.length, earliestTimestamp: min, latestTimestamp: max, isLastPage: isLast,
        },
        captured_at: new Date().toISOString(),
      }, null, 2)));
      pages.push({
        page, status: meta.status, requestId: meta.requestId,
        creditsCost: meta.creditsCost, creditsUsed: meta.creditsUsed, creditsRemaining: meta.creditsRemaining,
        rowsReturned: rows.length, symbolsCleared: cleared.symbolsCleared, namesCleared: cleared.namesCleared,
        labelsCleared: cleared.labelsCleared,
        earliestTimestamp: min, latestTimestamp: max, isLastPage: isLast, fixtureFile: file, rel,
      });
      console.log(`OK   page=${page} status=${meta.status} cost=${meta.creditsCost} remaining=${meta.creditsRemaining} rows=${rows.length} cleared=${cleared.symbolsCleared}/${cleared.namesCleared}/${cleared.labelsCleared} min=${min} max=${max} last=${isLast} ${Date.now() - started}ms`);

      if (isLast === true) { stopReason = `is_last_page=true on page ${page}; window covered`; break; }
      if (max !== null && max < `${WINDOW.from}T00:00:00`) {
        stopReason = `page ${page} timestamps exited the window below ${WINDOW.from}; stopping`; break;
      }
      const remaining = meta.creditsRemaining !== null ? Number(meta.creditsRemaining) : NaN;
      if (Number.isFinite(remaining) && remaining < 1) {
        stopReason = `insufficient remaining credits (${meta.creditsRemaining}); stopping`; break;
      }
      if (page === MAX_CALLS) { stopReason = `reached MAX_CALLS=${MAX_CALLS}; stopping per budget`; break; }
      await new Promise((r) => setTimeout(r, 500)); // gentle self-throttle
    } catch (err) {
      if (err instanceof NansenApiError) {
        console.error(`ERR  page=${page} status=${err.status} ${err.message}`);
        writeFileSync(`${OUT_DIR}/profiler-transactions-2022-11-11-p${page}.error.json`, redact(JSON.stringify({
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
    phase: '3J',
    address: FTX_SUBJECT,
    address_source: 'src/investigations/ftx.ts FTX_SUBJECT (programmatic, not retyped)',
    window: WINDOW,
    endpoint: PATH,
    hideSpamToken: true,
    sanitization: DEFAULT_CAPS,
    maxCalls: MAX_CALLS,
    callsMade: calls,
    stopReason,
    pages,
    totalRows: pages.reduce((s, p) => s + p.rowsReturned, 0),
    symbolsClearedTotal: pages.reduce((s, p) => s + p.symbolsCleared, 0),
    namesClearedTotal: pages.reduce((s, p) => s + p.namesCleared, 0),
    labelsClearedTotal: pages.reduce((s, p) => s + p.labelsCleared, 0),
    creditsUsedTotal: pages.reduce((s, p) => s + (Number(p.creditsUsed ?? p.creditsCost ?? 0) || 0), 0),
    creditsRemainingAfter: pages.length > 0 ? pages[pages.length - 1].creditsRemaining : null,
    captured_at: new Date().toISOString(),
  };
  writeFileSync(`${OUT_DIR}/manifest.json`, redact(JSON.stringify(manifest, null, 2)));
  console.log(`\nDone. calls=${calls} rows=${manifest.totalRows} cleared=${manifest.symbolsClearedTotal}/${manifest.namesClearedTotal}/${manifest.labelsClearedTotal} stop="${stopReason}"`);
  console.log(`Manifest: ${OUT_DIR}/manifest.json`);
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });

