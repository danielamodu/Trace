/**
 * TRACE — one-shot re-sanitizer for already-captured FTX transaction fixtures.
 *
 * The first capture predated the address-label cap, so a 200 KB malicious
 * `to_address_label` survived into the page fixtures. This re-applies the shared
 * sanitizer to the fixtures already on disk (NO API calls, 0 credits), rewrites
 * each page with updated cleared-counts + a `resanitized_at` marker, and updates
 * the manifest totals. Idempotent: re-running clears nothing further.
 *
 * Usage: node scripts/resanitize-ftx.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizeRows, DEFAULT_CAPS, type ClearedCounts } from '../src/nansen/sanitize.ts';

const DIR = 'fixtures/live/ftx';
const MANIFEST = `${DIR}/manifest.json`;

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  pages: Array<{ fixtureFile: string; symbolsCleared?: number; namesCleared?: number; labelsCleared?: number }>;
  [k: string]: unknown;
};

const totals: ClearedCounts = { symbolsCleared: 0, namesCleared: 0, labelsCleared: 0 };
const now = new Date().toISOString();

for (const page of manifest.pages) {
  const file = page.fixtureFile;
  const fx = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const rows = (fx as { response_body?: { data?: unknown } }).response_body?.data;
  if (!Array.isArray(rows)) throw new Error(`${file}: missing response_body.data[]`);
  const cleared = sanitizeRows(rows as Array<Record<string, unknown>>);
  fx.sanitization = { ...DEFAULT_CAPS, ...mergeCleared(fx.sanitization, cleared) };
  (fx as Record<string, unknown>).resanitized_at = now;
  writeFileSync(file, JSON.stringify(fx, null, 2));
  page.symbolsCleared = (page.symbolsCleared ?? 0) + cleared.symbolsCleared;
  page.namesCleared = (page.namesCleared ?? 0) + cleared.namesCleared;
  page.labelsCleared = (page.labelsCleared ?? 0) + cleared.labelsCleared;
  totals.symbolsCleared += cleared.symbolsCleared;
  totals.namesCleared += cleared.namesCleared;
  totals.labelsCleared += cleared.labelsCleared;
  console.log(`${file}: cleared symbols=${cleared.symbolsCleared} names=${cleared.namesCleared} labels=${cleared.labelsCleared}`);
}

manifest.symbolsClearedTotal = (Number(manifest.symbolsClearedTotal) || 0) + totals.symbolsCleared;
manifest.namesClearedTotal = (Number(manifest.namesClearedTotal) || 0) + totals.namesCleared;
manifest.labelsClearedTotal = (Number(manifest.labelsClearedTotal) || 0) + totals.labelsCleared;
manifest.resanitized_at = now;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`\nDone. this pass cleared symbols=${totals.symbolsCleared} names=${totals.namesCleared} labels=${totals.labelsCleared}`);

function mergeCleared(prev: unknown, add: ClearedCounts): ClearedCounts {
  const p = (prev ?? {}) as Partial<ClearedCounts>;
  return {
    symbolsCleared: (p.symbolsCleared ?? 0) + add.symbolsCleared,
    namesCleared: (p.namesCleared ?? 0) + add.namesCleared,
    labelsCleared: (p.labelsCleared ?? 0) + add.labelsCleared,
  };
}
