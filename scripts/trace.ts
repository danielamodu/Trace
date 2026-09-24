/**
 * TRACE — thin command-line interface over the reconstruction engine.
 *
 * Three verbs, mirroring the three product surfaces:
 *   list                  — every case in the library (built-in + saved). 0 credits.
 *   show <caseId>         — full reconstruction detail for one case.       0 credits.
 *   reconstruct <address> — run a live reconstruction against Nansen.      SPENDS CREDITS.
 *
 * `list`/`show` are offline: they read the fixture-backed built-ins plus any
 * saved runs from the local store and never touch the network. `reconstruct`
 * is the only verb that calls Nansen; it uses your own key (NANSEN_API_KEY,
 * server-side only, never logged or persisted) and stops at a credit/page budget.
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/trace.ts list
 *   node --env-file-if-exists=.env scripts/trace.ts show case_euler_2023
 *   node --env-file-if-exists=.env scripts/trace.ts reconstruct 0xADDR --from 2022-11-06 --to 2022-11-12 [--save]
 *
 * Or via npm:  npm run trace -- list
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildTraceService } from '../src/investigations/registry.ts';
import { reconstructFromAddress, DEFAULT_BUDGET } from '../src/investigations/live.ts';
import { saveContract } from '../src/investigations/saved-cases.ts';
import { verifyContract } from '../src/contract/verify.ts';
import { NansenClient } from '../src/nansen/client.ts';
import type { LiveBudget } from '../src/investigations/live.ts';
import type { InvestigationContract } from '../src/contract/types.ts';

// ---- tiny arg parser --------------------------------------------------------
const VALUE_FLAGS = new Set(['--from', '--to', '--chain', '--max-pages', '--max-credits', '--per-page', '--out']);

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
  bools: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new Error(`flag ${a} needs a value`);
        flags[a] = v;
        i++;
      } else {
        bools.add(a);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, bools };
}

const USAGE = `TRACE CLI — onchain incident reconstruction

  list                    List every case in the library (built-in + saved). 0 credits.
  show <caseId>           Print one case's full reconstruction. 0 credits.
  verify <caseId|file>    Re-derive an artifact's verdict + fingerprint. Offline, 0 credits.
  reconstruct <address>   Run a live reconstruction against Nansen. SPENDS CREDITS.
      --from <YYYY-MM-DD>       window start (required)
      --to   <YYYY-MM-DD>       window end   (required)
      --chain <name>            chain (default ethereum)
      --max-credits <n>         credit ceiling (default ${DEFAULT_BUDGET.maxCredits})
      --max-pages <n>           transaction pages (default ${DEFAULT_BUDGET.maxPages})
      --per-page <n>            rows per page (default ${DEFAULT_BUDGET.perPage}, max 100)
      --no-counterparties       skip the counterparties fetch
      --no-related              skip the related-wallets fetch
      --save                    save the result into the library (data/cases/)
      --out <path>              also write the contract JSON to <path>

Examples:
  node --env-file-if-exists=.env scripts/trace.ts list
  node --env-file-if-exists=.env scripts/trace.ts show case_ftx_2022
  node --env-file-if-exists=.env scripts/trace.ts verify case_euler_2023
  npm run trace -- reconstruct 0xADDR --from 2022-11-06 --to 2022-11-12 --save
`;

// ---- list -------------------------------------------------------------------
function cmdList(): void {
  const cases = buildTraceService().listCases();
  if (cases.length === 0) { console.log('No cases registered.'); return; }
  console.log(`${cases.length} case(s) in the library:\n`);
  for (const c of cases) {
    const tail = c.available ? '' : '  [unavailable]';
    console.log(
      `  ${c.caseId.padEnd(26)} ${c.completeness.padEnd(10)} ${c.dataSource.padEnd(13)}` +
      ` ${String(c.primaryEvents).padStart(4)} ev ${String(c.entities).padStart(3)} ent  ${c.name}${tail}`,
    );
  }
  console.log('\nRun `show <caseId>` for detail.');
}

// ---- show -------------------------------------------------------------------
function printContract(c: InvestigationContract): void {
  const inv = c.investigation;
  console.log(`${inv.name}  [${c.caseId}]`);
  console.log(`  ${inv.headline}\n`);
  console.log(`  chain          ${inv.chain}`);
  console.log(`  window         ${inv.window.from} → ${inv.window.to}`);
  console.log(`  status         ${inv.status}`);
  console.log(`  data source    ${c.dataSource}`);
  console.log(`  completeness   ${c.completeness}`);
  for (const r of c.completenessReasons) console.log(`                 - ${r}`);
  console.log(`  events         ${inv.events.length} total`);
  console.log(`  entities       ${inv.entities.length}`);
  console.log(`  relationships  ${inv.relationships.length}`);
  if (inv.summary.length) {
    console.log('\n  Summary:');
    for (const m of inv.summary) {
      const unit = m.unit ? ` ${m.unit}` : '';
      console.log(`    ${m.label.padEnd(28)} ${m.value}${unit}   (${m.provenance.kind})`);
    }
  }
  if (inv.dataGaps.length) {
    console.log('\n  Data gaps:');
    for (const g of inv.dataGaps) console.log(`    - ${g}`);
  }
}

function cmdShow(caseId: string | undefined): number {
  if (!caseId) { console.error('show: missing <caseId>. Run `list` to see ids.'); return 2; }
  const svc = buildTraceService();
  if (!svc.hasCase(caseId)) { console.error(`show: unknown case "${caseId}". Run \`list\` to see ids.`); return 2; }
  printContract(svc.getContract(caseId));
  return 0;
}

// ---- verify (offline, 0 credits) -------------------------------------------
async function cmdVerify(target: string | undefined): Promise<number> {
  if (!target) { console.error('verify: missing <caseId|file>.'); return 2; }
  let contract: unknown;
  if (existsSync(target)) {
    try {
      contract = JSON.parse(readFileSync(target, 'utf8'));
    } catch (e) {
      console.error(`verify: ${target} is not valid JSON: ${e instanceof Error ? e.message : e}`);
      return 2;
    }
  } else {
    const svc = buildTraceService();
    if (!svc.hasCase(target)) {
      console.error(`verify: "${target}" is neither a file nor a known caseId. Run \`list\` to see ids.`);
      return 2;
    }
    contract = svc.getContract(target);
  }

  const res = await verifyContract(contract);
  console.log(`Verifying ${target}\n`);
  for (const c of res.checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}`);
    console.log(`      ${c.detail}`);
  }
  console.log(`\n  ${res.algorithm} fingerprint`);
  console.log(`      ${res.fingerprint}`);
  if (!res.ok && res.errors.length > 0) {
    console.log('\n  Validation errors:');
    for (const e of res.errors) console.log(`      - ${e}`);
  }
  console.log(`\n${res.ok ? 'PASS — artifact re-derives its own verdict.' : 'FAIL — artifact is not self-consistent.'}`);
  return res.ok ? 0 : 1;
}

// ---- reconstruct (SPENDS CREDITS) ------------------------------------------
async function cmdReconstruct(args: ParsedArgs): Promise<number> {
  const address = args.positionals[0];
  if (!address) { console.error('reconstruct: missing <address>.'); return 2; }
  const from = args.flags['--from'];
  const to = args.flags['--to'];
  if (!from || !to) { console.error('reconstruct: --from and --to (YYYY-MM-DD) are required.'); return 2; }

  if (!NansenClient.hasKey()) {
    console.error('BLOCKED: NANSEN_API_KEY is not set — cannot run a live reconstruction.');
    console.error('Copy .env.example to .env, add your key, then re-run. No calls were made.');
    return 2;
  }

  const budget: Partial<LiveBudget> = {};
  if (args.flags['--max-credits']) budget.maxCredits = Number(args.flags['--max-credits']);
  if (args.flags['--max-pages']) budget.maxPages = Number(args.flags['--max-pages']);
  if (args.flags['--per-page']) budget.perPage = Number(args.flags['--per-page']);
  if (args.bools.has('--no-counterparties')) budget.fetchCounterparties = false;
  if (args.bools.has('--no-related')) budget.fetchRelatedWallets = false;
  const chain = args.flags['--chain'] ?? 'ethereum';
  const eff: LiveBudget = { ...DEFAULT_BUDGET, ...budget };

  console.log(`Reconstructing ${address} on ${chain}  ${from} → ${to}`);
  console.log(
    `Budget: up to ${eff.maxCredits} credits, ${eff.maxPages} page(s)` +
    `${eff.fetchCounterparties ? '' : ', no counterparties'}${eff.fetchRelatedWallets ? '' : ', no related-wallets'}.` +
    ' Calling Nansen…\n',
  );

  const { contract, meta } = await reconstructFromAddress({ address, window: { from, to }, chain, budget });

  console.log('Run accounting:');
  console.log(`  credits spent      ${meta.creditsSpent}`);
  console.log(`  credits remaining  ${meta.creditsRemaining ?? 'unknown'}`);
  console.log(`  tx pages fetched   ${meta.transactionPagesFetched}  (reached last page: ${meta.reachedLastPage})`);
  console.log(`  rows skipped       ${meta.rowsSkipped}`);
  console.log(`  stop reason        ${meta.stopReason}`);
  console.log(`  calls              ${meta.calls.length}\n`);
  printContract(contract);

  if (args.flags['--out']) {
    writeFileSync(args.flags['--out'], `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
    console.log(`\nContract written to ${args.flags['--out']}`);
  }
  if (args.bools.has('--save')) {
    const { caseId, file } = saveContract(contract);
    console.log(`\nSaved to library as ${caseId}\n  ${file}`);
  }
  return 0;
}

// ---- main -------------------------------------------------------------------
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(USAGE); return; }

  const rest = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'list': cmdList(); return;
    case 'show': process.exitCode = cmdShow(rest.positionals[0]); return;
    case 'verify': process.exitCode = await cmdVerify(rest.positionals[0]); return;
    case 'reconstruct': process.exitCode = await cmdReconstruct(rest); return;
    default:
      console.error(`Unknown command "${cmd}".\n`);
      console.log(USAGE);
      process.exitCode = 2;
  }
}

main().catch((e) => { console.error('FATAL', e instanceof Error ? e.message : e); process.exitCode = 1; });
