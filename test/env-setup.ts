/**
 * TRACE — test bootstrap (preloaded via `node --import` before any test file).
 *
 * Pins BOTH runtime case stores to fresh, empty temp directories for the whole
 * suite: the per-install `data/cases/` store and the bundled `data/shipped/`
 * store. This makes the built-in-only assertions (U1/U2, GEN4) hermetic: they
 * see exactly Euler + FTX regardless of whatever a developer may have saved into
 * data/cases/ or committed into data/shipped/. Tests that exercise saving still
 * pass their own temp dir explicitly, so they are unaffected by these defaults.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACE_CASES_DIR = mkdtempSync(join(tmpdir(), 'trace-cases-empty-'));
process.env.TRACE_SHIPPED_CASES_DIR = mkdtempSync(join(tmpdir(), 'trace-shipped-empty-'));
