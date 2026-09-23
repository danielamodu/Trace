/**
 * Reproducible endpoint reconnaissance runner (TRACE Phase 1, Task 3).
 *
 * Runs a deliberate, SMALL set of Nansen calls, prints status + credit meta,
 * and writes a sanitized fixture per endpoint to fixtures/<name>.json.
 * Fixtures are truncated (default 3 rows) and passed through redact() so no
 * API key can leak. Nothing is fabricated — if a call fails, the error
 * envelope is saved instead.
 *
 * Usage:
 *   node scripts/recon.ts                 # run every probe below
 *   node scripts/recon.ts tgm-transfers   # run one probe by name
 *   node scripts/recon.ts --list          # list probe names + est. credit cost
 *
 * Each probe targets USDC on Ethereum over a fixed 1-day window so runs are
 * deterministic and cheap. Adjust TARGET below to point at a real incident.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { NansenClient, NansenApiError, redact } from '../src/nansen/client.ts';

// --- Deterministic target: USDC on Ethereum, a fixed historical day ----------
const TARGET = {
  chain: 'ethereum',
  // USDC — a high-liquidity token guaranteed to have data on any given day.
  token_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  date: { from: '2025-01-06', to: '2025-01-07' },
  // A well-known labelled entity for profiler probes: Binance 14 hot wallet.
  address: '0x28c6c06298d514db089934071355e5743bf21d60',
};

// tgm/flows rejects stablecoins, so it needs a non-stablecoin token.
// WETH on Ethereum — high liquidity, guaranteed data.
const NON_STABLE_TOKEN = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

interface Probe {
  name: string;
  path: string;
  estCredits: number; // documented Pro-plan cost
  body: object;
}

const PROBES: Probe[] = [
  {
    name: 'search-general',
    path: '/api/v1/search/general',
    estCredits: 0,
    body: { search_query: 'USDC', result_type: 'any' },
  },
  {
    name: 'tgm-transfers',
    path: '/api/v1/tgm/transfers',
    estCredits: 1,
    body: { ...pick(TARGET, ['chain', 'token_address', 'date']), pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'tgm-dex-trades',
    path: '/api/v1/tgm/dex-trades',
    estCredits: 1,
    body: { ...pick(TARGET, ['chain', 'token_address', 'date']), pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'tgm-flows',
    path: '/api/v1/tgm/flows',
    estCredits: 1,
    // WETH, not the USDC TARGET: tgm/flows rejects stablecoins (422).
    body: { chain: TARGET.chain, token_address: NON_STABLE_TOKEN, date: TARGET.date, pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'tgm-flow-intelligence',
    path: '/api/v1/tgm/flow-intelligence',
    estCredits: 1,
    body: { chain: TARGET.chain, token_address: TARGET.token_address, timeframe: '1d' },
  },
  {
    name: 'tgm-who-bought-sold',
    path: '/api/v1/tgm/who-bought-sold',
    estCredits: 1,
    body: { ...pick(TARGET, ['chain', 'token_address', 'date']), buy_or_sell: 'BUY', pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'tgm-holders',
    path: '/api/v1/tgm/holders',
    estCredits: 5,
    body: { chain: TARGET.chain, token_address: TARGET.token_address, label_type: 'all_holders', pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'smart-money-netflow',
    path: '/api/v1/smart-money/netflow',
    estCredits: 5,
    body: { chains: ['ethereum'], pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'profiler-related-wallets',
    path: '/api/v1/profiler/address/related-wallets',
    estCredits: 1,
    body: { address: TARGET.address, chain: TARGET.chain, pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'profiler-counterparties',
    path: '/api/v1/profiler/address/counterparties',
    estCredits: 5,
    body: { address: TARGET.address, chain: TARGET.chain, date: TARGET.date, pagination: { page: 1, per_page: 3 } },
  },
  {
    name: 'profiler-transactions',
    path: '/api/v1/profiler/address/transactions',
    estCredits: 1,
    body: { address: TARGET.address, chain: TARGET.chain, date: TARGET.date, pagination: { page: 1, per_page: 3 } },
  },
  // NOTE: profiler/address/labels is deliberately EXCLUDED from the default run.
  // It costs 100 credits (500 for premium labels) — see docs/credits. Run it
  // explicitly and only when needed:  node scripts/recon.ts profiler-labels
  {
    name: 'profiler-labels',
    path: '/api/v1/profiler/address/labels',
    estCredits: 100,
    body: { address: TARGET.address, chain: TARGET.chain, pagination: { page: 1, per_page: 5 } },
  },
];

// Probes that are safe/cheap to run as part of the default sweep.
const DEFAULT_SET = PROBES.filter((p) => p.estCredits <= 5);

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

function truncate(data: unknown, rows = 3): unknown {
  if (data && typeof data === 'object' && Array.isArray((data as any).data)) {
    const d = data as any;
    return { ...d, data: d.data.slice(0, rows), _note: `truncated to ${rows} of ${d.data.length} rows for fixture` };
  }
  return data;
}

async function runProbe(client: NansenClient, probe: Probe, outDir: string): Promise<{ credits: number }> {
  const started = Date.now();
  try {
    const { data, meta } = await client.post<Record<string, unknown>>(probe.path, probe.body);
    const rows = Array.isArray((data as any)?.data) ? (data as any).data.length : null;
    console.log(`OK   ${probe.name.padEnd(26)} status=${meta.status} cost=${meta.creditsCost} used=${meta.creditsUsed} remaining=${meta.creditsRemaining} rows=${rows} ${Date.now() - started}ms`);
    const fixture = {
      probe: probe.name,
      path: probe.path,
      request_body: probe.body,
      response_meta: meta,
      response_sample: truncate(data),
      captured_at: new Date().toISOString(),
    };
    writeFileSync(`${outDir}/${probe.name}.json`, redact(JSON.stringify(fixture, null, 2)));
    return { credits: Number(meta.creditsUsed ?? meta.creditsCost ?? 0) || 0 };
  } catch (err) {
    if (err instanceof NansenApiError) {
      console.error(`ERR  ${probe.name.padEnd(26)} status=${err.status} ${err.message}`);
      writeFileSync(`${outDir}/${probe.name}.error.json`, redact(JSON.stringify({
        probe: probe.name, path: probe.path, request_body: probe.body,
        status: err.status, error_body: err.body, meta: err.meta,
        captured_at: new Date().toISOString(),
      }, null, 2)));
      return { credits: Number(err.meta.creditsUsed ?? 0) || 0 };
    }
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log('Available probes (name — est. Pro credits):');
    for (const p of PROBES) console.log(`  ${p.name.padEnd(26)} ${p.estCredits}${DEFAULT_SET.includes(p) ? '' : '   [excluded from default sweep]'}`);
    return;
  }

  if (!NansenClient.hasKey()) {
    console.error('BLOCKED: NANSEN_API_KEY is not set — cannot run recon.');
    console.error('Copy .env.example to .env, add the key, then re-run. No calls were made.');
    process.exitCode = 2;
    return;
  }

  const outDir = 'fixtures';
  mkdirSync(outDir, { recursive: true });

  const selected = args.length && !args[0].startsWith('--')
    ? PROBES.filter((p) => args.includes(p.name))
    : DEFAULT_SET;

  if (!selected.length) {
    console.error('No matching probe. Use --list to see names.');
    process.exitCode = 2;
    return;
  }

  const estTotal = selected.reduce((s, p) => s + p.estCredits, 0);
  console.log(`Running ${selected.length} probe(s). Estimated credit cost: ${estTotal}\n`);

  const client = new NansenClient();
  let spent = 0;
  for (const probe of selected) {
    const { credits } = await runProbe(client, probe, outDir);
    spent += credits;
    await new Promise((r) => setTimeout(r, 250)); // gentle self-throttle
  }
  console.log(`\nDone. Observed credits used this run: ${spent}. Fixtures written to ${outDir}/.`);
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
