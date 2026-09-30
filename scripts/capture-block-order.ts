/**
 * TRACE — capture true intra-block positions (item #5).
 *
 * Nansen rows carry no txIndex/logIndex, so the engine could only tie-break
 * same-block events by txHash (lexicographic, arbitrary). This script reads a
 * case's transaction hashes and resolves each transaction's true
 * `(blockNumber, transactionIndex)` from a PUBLIC Ethereum JSON-RPC endpoint
 * (`eth_getTransactionReceipt`) — no API key, no Nansen credits — via the shared
 * `blockorder-rpc` capture. It writes a block-order fixture the engine consumes
 * as `EngineInput.blockPositions` to order same-block events by their real
 * on-chain sequence (item #5).
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
import { loadEulerInputs } from '../src/investigations/euler.ts';
import { loadFtxInputs } from '../src/investigations/ftx.ts';
import { captureBlockPositions, txHashesFromInput, DEFAULT_ETH_RPC } from '../src/investigations/blockorder-rpc.ts';

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

async function main(): Promise<number> {
  const { flags } = parseArgs(process.argv.slice(2));
  const rpc = flags['--rpc'] ?? DEFAULT_ETH_RPC;
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

  const { positions, unresolved, endpoint, method } = await captureBlockPositions(hashes, { rpcUrl: rpc });

  if (positions.length === 0) { console.error(`no receipts resolved for any of ${hashes.length} tx on ${endpoint}`); return 1; }

  // How many transactions share a block (where true ordering actually matters).
  const byBlock = new Map<number, number>();
  for (const p of positions) byBlock.set(p.blockNumber, (byBlock.get(p.blockNumber) ?? 0) + 1);
  const sharedBlocks = [...byBlock.values()].filter((n) => n > 1).length;
  const inSharedBlocks = [...byBlock.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0);

  const fixture = {
    endpoint,
    method,
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
