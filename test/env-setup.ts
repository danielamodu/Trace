/**
 * TRACE — test bootstrap (preloaded via `node --import` before any test file).
 *
 * Pins the saved-cases store to a fresh, empty temp directory for the whole
 * suite. This makes the built-in-only assertions (U1/U2, GEN4) hermetic: they
 * see exactly Euler + FTX regardless of whatever a developer may have saved into
 * the real data/cases/ store. Tests that exercise saving still pass their own
 * temp dir explicitly, so they are unaffected by this default.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRACE_CASES_DIR = mkdtempSync(join(tmpdir(), 'trace-cases-empty-'));
