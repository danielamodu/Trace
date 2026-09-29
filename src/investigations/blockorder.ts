/**
 * TRACE — block-order fixture loader (item #5).
 *
 * Loads a captured block-order fixture (the output of
 * scripts/capture-block-order.ts) and normalizes it into engine `blockPositions`.
 *
 * These are ORDERING METADATA, derived out-of-band from a public Ethereum
 * JSON-RPC endpoint (eth_getTransactionReceipt) — NOT Nansen evidence, no API
 * key, no credits. They only refine the same-block tie-break from an arbitrary
 * txHash-lexicographic order to the real on-chain (blockNumber, transactionIndex)
 * sequence. Events whose tx has no captured position are unaffected.
 *
 * The fixture is a committed part of the built-in cases, so a missing or
 * malformed file fails loudly rather than silently degrading served ordering.
 */

import { readFileSync } from 'node:fs';
import { normalizeBlockPosition } from '../reconstruction/normalize.ts';
import type { BlockPositionFact } from '../reconstruction/normalized-types.ts';

interface BlockOrderFixture {
  endpoint?: unknown;
  method?: unknown;
  captured_at?: unknown;
  positions?: unknown;
}

/** Load + normalize a block-order fixture at `rel` (relative to `fixturesDir`). */
export function loadBlockPositions(fixturesDir: URL, rel: string): BlockPositionFact[] {
  const fx = JSON.parse(readFileSync(new URL(rel, fixturesDir), 'utf8')) as BlockOrderFixture;
  if (!Array.isArray(fx.positions)) {
    throw new Error(`${rel}: missing positions[] — run scripts/capture-block-order.ts`);
  }
  if (typeof fx.endpoint !== 'string' || typeof fx.method !== 'string' || typeof fx.captured_at !== 'string') {
    throw new Error(`${rel}: missing endpoint/method/captured_at`);
  }
  const capture = { rpc: fx.endpoint, method: fx.method, capturedAt: fx.captured_at };
  return fx.positions.map((p) => normalizeBlockPosition(p, capture));
}
