/**
 * TRACE — capture true intra-block positions (item #5).
 *
 * Nansen rows carry no txIndex/logIndex, so the engine could only tie-break
 * same-block events by txHash (lexicographic, arbitrary). This script reads a
 * case's transaction hashes and fetches each transaction's true
 * `(blockNumber, transactionIndex)` from a PUBLIC Ethereum JSON-RPC endpoint
 * (`eth_getTransactionReceipt`) — no API key, no Nansen credits. It writes a
 * block-order fixture the engine consumes as `EngineInput.blockPositions` to
 * order same-block events by their real on-chain sequence (item #5).
 *
 * Usage:
 *   node scripts/capture-block-order.ts --case euler
 *   node scripts/capture-block-order.ts --case ftx --out fixtures/blockorder/ftx.json
 *   node scripts/capture-block-order.ts --txs 0xabc,0xdef --out fixtures/blockorder/adhoc.json
 * Options:
 *   --rpc <url>    JSON-RPC endpoint (default https://ethereum-rpc.publicnode.com)
 *   --chain <name> chain label recorded in the fixture (default ethereum)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EngineInput } from '../src/reconstruction/engine.ts';
import { loadEulerInputs } from '../src/investigations/euler.ts';
import { loadFtxInputs } from '../src/investigations/ftx.ts';

const DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com';
const RECEIPT_METHOD = 'eth_getTransactionReceipt';
const BATCH = 20;

interface Args { flags: Record<string, string>; }

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[a] = next; i += 1; }
      else flags[a] = 'true';
    }
  }
  return { flags };
}

/** Collect every distinct 0x-hex tx hash carried by a case's engine input. */
function txHashesFromInput(input: EngineInput): string[] {
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
 * POST a JSON-RPC batch of eth_getTransactionReceipt calls. Transactions with
 * no mainnet receipt (null result — e.g. a cross-chain case whose hashes are
 * not all Ethereum-mainnet) are reported as `missing` and skipped, never
 * throwing: a case can legitimately reference txs this endpoint cannot resolve.
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
    if (r.error) throw new Error(`RPC error for ${h}: ${r.error.message ?? 'unknown'}`);
    if (r.result === null || r.result === undefined) missing.push(h);
    else found.set(h, r.result);
  }
  return { found, missing };
}

const hexToInt = (v: string | undefined, what: string, h: string): number => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]+$/.test(v)) throw new Error(`receipt for ${h} missing ${what}`);
  return Number.parseInt(v, 16);
};

async function main(): Promise<number> {
  const { flags } = parseArgs(process.argv.slice(2));
  const rpc = flags['--rpc'] ?? DEFAULT_RPC;
  const chain = flags['--chain'] ?? 'ethereum';
  const caseName = flags['--case'];

  let hashes: string[];
  let outPath: string;
  if (caseName === 'euler') {
    hashes = txHashesFromInput(loadEulerInputs().input);
    outPath = flags['--out'] ?? 'fixtures/blockorder/euler.json';
  } else if (caseName === 'ftx') {
    hashes = txHashesFromInput(loadFtxInputs().input);
    outPath = flags['--out'] ?? 'fixtures/blockorder/ftx.json';
  } else if (flags['--txs'] !== undefined && flags['--txs'] !== 'true') {
    hashes = [...new Set(flags['--txs'].split(',').map((h) => h.trim().toLowerCase()).filter(Boolean))].sort();
    outPath = flags['--out'] ?? 'fixtures/blockorder/adhoc.json';
  } else {
    console.error('usage: capture-block-order.ts (--case euler|ftx | --txs 0x..,0x..) [--out path] [--rpc url]');
    return 2;
  }

  if (hashes.length === 0) { console.error('no transaction hashes to capture'); return 2; }
  console.error(`capturing ${hashes.length} tx position(s) from ${new URL(rpc).host} …`);

  const receipts = new Map<string, RpcReceipt>();
  const unresolved: string[] = [];
  for (let i = 0; i < hashes.length; i += BATCH) {
    const chunk = hashes.slice(i, i + BATCH);
    const { found, missing } = await fetchReceipts(rpc, chunk);
    for (const [h, r] of found) receipts.set(h, r);
    unresolved.push(...missing);
    if (i + BATCH < hashes.length) await new Promise((r) => setTimeout(r, 200));
  }

  // Only hashes with a mainnet receipt get a position; unresolved hashes (e.g.
  // a cross-chain case's non-mainnet txs) are omitted and the engine falls back
  // to its txHash-lexicographic tie-break for them — never an invented index.
  const positions = [...receipts.entries()].map(([h, r]) => ({
    txHash: h,
    blockNumber: hexToInt(r.blockNumber, 'blockNumber', h),
    transactionIndex: hexToInt(r.transactionIndex, 'transactionIndex', h),
  }));
  positions.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex);

  if (positions.length === 0) { console.error(`no receipts resolved for any of ${hashes.length} tx on ${new URL(rpc).host}`); return 1; }

  // How many transactions share a block (where true ordering actually matters).
  const byBlock = new Map<number, number>();
  for (const p of positions) byBlock.set(p.blockNumber, (byBlock.get(p.blockNumber) ?? 0) + 1);
  const sharedBlocks = [...byBlock.values()].filter((n) => n > 1).length;
  const inSharedBlocks = [...byBlock.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0);

  const fixture = {
    endpoint: new URL(rpc).host,
    method: RECEIPT_METHOD,
    chain,
    captured_at: new Date().toISOString(),
    note: 'Intra-block positions for item #5 ordering. Ordering metadata (canonical-chain FACTs), NOT Nansen evidence. No API key used.',
    positions,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  console.error(
    `wrote ${positions.length} position(s) → ${outPath} ` +
    `(${byBlock.size} distinct block(s); ${inSharedBlocks} tx across ${sharedBlocks} shared block(s)` +
    `${unresolved.length ? `; ${unresolved.length} tx unresolved on this endpoint, omitted` : ''})`,
  );
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error(`capture-block-order: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
