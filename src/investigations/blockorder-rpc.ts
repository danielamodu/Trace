/**
 * TRACE — shared intra-block position capture over a public Ethereum JSON-RPC
 * (item #5).
 *
 * Nansen rows carry no txIndex/logIndex, so the engine can only tie-break
 * same-block events by txHash (lexicographic, arbitrary). Both the offline
 * `capture-block-order.ts` script (fixture cases) and the live orchestrator
 * (`reconstructFromAddress`) resolve the same true `(blockNumber,
 * transactionIndex)` from `eth_getTransactionReceipt` on a PUBLIC endpoint — no
 * API key, no Nansen credits — so same-block events order by their real
 * on-chain sequence instead of the fallback.
 *
 * Positions are canonical-chain FACTs, NOT Nansen evidence. Transactions with no
 * receipt on the queried endpoint (e.g. a cross-chain case's non-mainnet hashes)
 * are reported as `unresolved` and omitted; the engine then falls back to its
 * documented tie-break for them, never an invented index.
 */

import type { EngineInput } from '../reconstruction/engine.ts';

/** Keyless public Ethereum-mainnet JSON-RPC used when no endpoint is supplied. */
export const DEFAULT_ETH_RPC = 'https://ethereum-rpc.publicnode.com';
export const RECEIPT_METHOD = 'eth_getTransactionReceipt';
const BATCH = 20;
const BATCH_DELAY_MS = 200;

/** A raw resolved position, before normalization into a BlockPositionFact. */
export interface RawBlockPosition {
  txHash: string;
  blockNumber: number;
  transactionIndex: number;
}

/** The outcome of a capture: resolved positions plus the hashes the endpoint could not resolve. */
export interface BlockPositionCapture {
  positions: RawBlockPosition[];
  unresolved: string[];
  /** The endpoint host actually queried (recorded in fixtures / provenance). */
  endpoint: string;
  method: string;
}

/** A source of block positions for a set of hashes — the real RPC by default; injectable in tests. */
export type BlockPositionFetcher = (
  hashes: string[],
  opts?: { rpcUrl?: string },
) => Promise<BlockPositionCapture>;

/** Collect every distinct 0x-hex tx hash carried by an engine input, sorted. */
export function txHashesFromInput(input: EngineInput): string[] {
  const seen = new Set<string>();
  const add = (h: unknown): void => {
    if (typeof h === 'string' && /^0x[0-9a-fA-F]+$/.test(h)) seen.add(h.toLowerCase());
  };
  for (const t of input.transfers ?? []) add(t.value.txHash);
  for (const s of input.swaps ?? []) add(s.value.txHash);
  for (const tx of input.transactions ?? []) add(tx.value.txHash);
  for (const r of input.relationships ?? []) add(r.value.txHash);
  return [...seen].sort();
}

interface RpcReceipt { blockNumber?: string; transactionIndex?: string; }
interface RpcResponse { id: number; result?: RpcReceipt | null; error?: { message?: string }; }

/**
 * POST one JSON-RPC batch of eth_getTransactionReceipt calls. Throws ONLY on a
 * transport/HTTP failure (a whole-batch problem the caller retries); a per-hash
 * RPC error or a null result marks just that hash `missing` — the endpoint cannot
 * resolve it (e.g. a cross-chain case whose hashes are not all Ethereum-mainnet),
 * which is not a reason to fail the batch or the capture.
 */
async function fetchReceipts(
  rpc: string,
  hashes: string[],
): Promise<{ found: Map<string, RpcReceipt>; missing: string[] }> {
  const body = hashes.map((h, i) => ({ jsonrpc: '2.0', id: i, method: RECEIPT_METHOD, params: [h] }));
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status} ${res.statusText}`);
  const json = (await res.json()) as RpcResponse[] | RpcResponse;
  const arr = Array.isArray(json) ? json : [json];
  const found = new Map<string, RpcReceipt>();
  const missing: string[] = [];
  for (const r of arr) {
    const h = hashes[r.id];
    if (h === undefined) continue;
    if (r.error || r.result === null || r.result === undefined) missing.push(h);
    else found.set(h, r.result);
  }
  return { found, missing };
}

/** Number of times to (re)try a single batch before giving up on it. */
const MAX_ATTEMPTS = 3;
/** Backoff before the 2nd and 3rd attempt of a failing batch. */
const RETRY_BACKOFF_MS = [300, 600];

const parseHex = (v: string | undefined): number | null =>
  typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v) ? Number.parseInt(v, 16) : null;

/**
 * Resolve `(blockNumber, transactionIndex)` for `hashes` from a public JSON-RPC,
 * batching to be gentle on the endpoint. Resilient by design and NEVER throws: a
 * batch that fails transport is retried a few times, and if it still fails its
 * hashes are reported `unresolved` rather than discarding the whole capture — so
 * a flaky public endpoint (or a case with hundreds of receipts) yields the
 * positions it COULD resolve instead of an all-or-nothing failure. Returns
 * positions sorted by (blockNumber, transactionIndex) and unresolved sorted, so
 * the capture is deterministic. Free: no API key, no Nansen credits.
 */
export const captureBlockPositions: BlockPositionFetcher = async (hashes, opts) => {
  const rpc = opts?.rpcUrl ?? DEFAULT_ETH_RPC;
  const endpoint = new URL(rpc).host;
  const receipts = new Map<string, RpcReceipt>();
  const unresolved = new Set<string>();
  for (let i = 0; i < hashes.length; i += BATCH) {
    const chunk = hashes.slice(i, i + BATCH);
    let ok = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !ok; attempt += 1) {
      try {
        const { found, missing } = await fetchReceipts(rpc, chunk);
        for (const [h, r] of found) receipts.set(h, r);
        for (const h of missing) unresolved.add(h);
        ok = true;
      } catch {
        const backoff = RETRY_BACKOFF_MS[attempt];
        if (backoff !== undefined) await new Promise((r) => setTimeout(r, backoff));
      }
    }
    if (!ok) for (const h of chunk) unresolved.add(h);
    if (i + BATCH < hashes.length) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
  const positions: RawBlockPosition[] = [];
  for (const [h, r] of receipts) {
    const blockNumber = parseHex(r.blockNumber);
    const transactionIndex = parseHex(r.transactionIndex);
    if (blockNumber === null || transactionIndex === null) { unresolved.add(h); continue; }
    positions.push({ txHash: h, blockNumber, transactionIndex });
  }
  positions.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex);
  return { positions, unresolved: [...unresolved].sort(), endpoint, method: RECEIPT_METHOD };
};
