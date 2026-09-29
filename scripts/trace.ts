/**
 * TRACE — command-line interface over the reconstruction engine.
 *
 * Read-only verbs (offline, 0 credits): list, show, timeline, follow, entities,
 * search, stats, verify. The one credit-spending verb is reconstruct.
 *
 *   list                  — every case in the library (built-in + live/saved).
 *   show <caseId>         — full reconstruction detail + fingerprint.
 *   timeline <caseId>     — the ordered event trail (--all includes collapsed).
 *   follow <caseId>       — follow the money hop by hop to an honest dead end.
 *   entities <caseId>     — actors in the case, grouped by role.
 *   search <term>         — find an address / label / tx across the library.
 *   stats                 — library dashboard.
 *   diff <caseA> <caseB>  — compare two reconstructions + shared addresses.
 *   export <caseId>       — write the portable contract artifact to a file.
 *   verify <caseId|file>  — re-derive an artifact's verdict + fingerprint.
 *   reconstruct <address> — run a live reconstruction against Nansen.  SPENDS CREDITS.
 *
 * `list`/`show`/`verify` are offline: they read fixture-backed built-ins plus
 * saved runs from the local store and never touch the network. `reconstruct`
 * is the only verb that calls Nansen; it uses your own key (NANSEN_API_KEY,
 * server-side only, never logged or persisted) and stops at a credit/page budget.
 *
 * Output is colorized on a TTY; piping out, --json, or NO_COLOR/--no-color make
 * it plain text so it stays scriptable.
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/trace.ts list
 *   node --env-file-if-exists=.env scripts/trace.ts show case_euler_2023
 *   npm run trace -- reconstruct 0xADDR --from 2022-11-06 --to 2022-11-12 --save
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildTraceService, BUILT_IN_CASE_IDS } from '../src/investigations/registry.ts';
import { reconstructFromAddress, DEFAULT_BUDGET } from '../src/investigations/live.ts';
import { DEFAULT_VALUE_THRESHOLD_USD } from '../src/reconstruction/engine.ts';
import { saveContract } from '../src/investigations/saved-cases.ts';
import { verifyContract, fingerprintContract } from '../src/contract/verify.ts';
import { NansenClient } from '../src/nansen/client.ts';
import { followFromEvent, FOLLOW_DEAD_END } from '../lib/follow.ts';
import type { LiveBudget } from '../src/investigations/live.ts';
import type { CaseSummary, InvestigationContract } from '../src/contract/types.ts';

// ---- output styling (TTY-aware; NO_COLOR / --no-color / pipes fall back) ----
let COLOR = process.stdout.isTTY === true && !process.env.NO_COLOR;
const sgr = (open: string, close: string) => (s: string) => (COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : s);
const bold = sgr('1', '22');
const dim = sgr('2', '22');
const under = sgr('4', '24');
const red = sgr('31', '39');
const green = sgr('32', '39');
const yellow = sgr('33', '39');
const cyan = sgr('36', '39');
const gray = sgr('90', '39');
const brand = sgr('38;2;47;112;96', '39'); // TRACE green (#2f7060)

const termCols = () => (process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 100);
const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`);
const completenessTag = (c: string) => (c === 'complete' ? green(c) : yellow(c));
const dot = (available: boolean, complete: boolean) => (!available ? gray('○') : complete ? green('●') : yellow('◐'));
const shortAddr = (a: string | undefined) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? '—');
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtTime = (ts: string) => `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
const provTag = (k: string) => (k === 'FACT' ? gray('FACT') : k === 'DERIVED' ? cyan('DERIVED') : yellow(k));
const eventValue = (e: { value?: { valueUsd?: number; tokenSymbol?: string; amount?: number } }): string => {
  const v = e.value;
  if (!v) return '';
  if (typeof v.valueUsd === 'number') return usd(v.valueUsd);
  if (typeof v.amount === 'number' && v.tokenSymbol) return `${v.amount} ${v.tokenSymbol}`;
  return '';
};
// ---- help -------------------------------------------------------------------
function usage(): string {
  const h = (s: string) => bold(s);
  return `${brand(bold('TRACE'))} ${dim('— onchain incident reconstruction')}

${h('USAGE')}
  trace <command> [options]

${h('COMMANDS')}
  ${cyan('list')}                    Every case in the library (built-in + live/saved). 0 credits.
  ${cyan('show')} <caseId>           One case's full reconstruction + fingerprint.       0 credits.
  ${cyan('verify')} <caseId|file>    Re-derive an artifact's verdict + fingerprint.      0 credits.
  ${cyan('timeline')} <caseId>       The ordered event trail (--all includes collapsed). 0 credits.
  ${cyan('follow')} <caseId>         Follow the money hop by hop to a dead end.          0 credits.
  ${cyan('entities')} <caseId>       Actors in the case, grouped by role.                0 credits.
  ${cyan('search')} <term>           Find an address / label / tx across the library.    0 credits.
  ${cyan('stats')}                   Library dashboard: totals, coverage, chains.        0 credits.
  ${cyan('diff')} <caseA> <caseB>    Compare two reconstructions + shared addresses.     0 credits.
  ${cyan('export')} <caseId>         Write the portable contract artifact to a file.     0 credits.
  ${cyan('reconstruct')} <address>   Live reconstruction against Nansen.       ${yellow('SPENDS CREDITS')}.

${h('RECONSTRUCT OPTIONS')}
  --from <YYYY-MM-DD>       window start (required)
  --to   <YYYY-MM-DD>       window end   (required)
  --chain <name>            chain (default ethereum)
  --max-credits <n>         credit ceiling (default ${DEFAULT_BUDGET.maxCredits})
  --max-pages <n>           transaction pages (default ${DEFAULT_BUDGET.maxPages})
  --per-page <n>            rows per page (default ${DEFAULT_BUDGET.perPage}, max 100)
  --name <text>             human-readable case name
  --headline <text>         one-line case headline
  --value-threshold <usd>   case-local meaningful-value floor in USD (default ${DEFAULT_VALUE_THRESHOLD_USD}); lower it
                            for a small-flow address, raise it for a whale-only case
  --no-counterparties       skip the counterparties fetch
  --no-related              skip the related-wallets fetch
  --token-activity          also fetch token-scoped transfers + dex-trades (opt-in; ~3 credits/token)
  --max-tokens <n>          cap discovered tokens to enrich (default ${DEFAULT_BUDGET.maxTokens})
  --chunk-days <n>          split the window into <n>-day sub-windows so a wide window can
                            fully paginate across bounded steps (default off; see 'resume from')
  --save                    save the result into the library (data/cases/)
  --out <path>              also write the contract JSON to <path>

${h('GLOBAL')}
  --json                    machine-readable JSON (list / show / verify)
  --no-color                disable ANSI color

${h('EXAMPLES')}
  ${dim('$')} npm run trace -- list
  ${dim('$')} npm run trace -- show case_ftx_2022
  ${dim('$')} npm run trace -- verify case_euler_2023
  ${dim('$')} npm run trace -- reconstruct 0xADDR --from 2022-11-06 --to 2022-11-12 --save
`;
}

// ---- tiny arg parser --------------------------------------------------------
const VALUE_FLAGS = new Set(['--from', '--to', '--chain', '--max-pages', '--max-credits', '--per-page', '--max-tokens', '--chunk-days', '--value-threshold', '--out', '--name', '--headline']);

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

// ---- list -------------------------------------------------------------------
function cmdList(json: boolean): void {
  const cases = buildTraceService().listCases();
  if (json) { console.log(JSON.stringify(cases, null, 2)); return; }
  if (cases.length === 0) { console.log(dim('No cases registered.')); return; }

  const builtIn = new Set(BUILT_IN_CASE_IDS);
  const groups: Array<{ title: string; rows: CaseSummary[] }> = [
    { title: 'BUILT-IN', rows: cases.filter((c) => builtIn.has(c.caseId)) },
    { title: 'LIVE · SAVED', rows: cases.filter((c) => !builtIn.has(c.caseId)) },
  ];
  const width = Math.min(termCols(), 84);

  console.log(`\n${brand(bold('TRACE'))}  ${dim('case library')}\n`);
  for (const g of groups) {
    if (g.rows.length === 0) continue;
    console.log(gray(g.title));
    for (const c of g.rows) {
      const glyph = dot(c.available, c.completeness === 'complete');
      const name = truncate(c.name, Math.max(12, width - 6 - c.caseId.length));
      const gap = Math.max(2, width - 4 - name.length - c.caseId.length);
      console.log(`  ${glyph} ${bold(name)}${' '.repeat(gap)}${dim(c.caseId)}`);
      const meta =
        dim(`${c.chain} · ${c.primaryEvents} events · ${c.entities} entities · `) +
        completenessTag(c.completeness) +
        dim(` · ${c.dataSource}`) +
        (c.available ? '' : yellow(' · unavailable'));
      console.log(`    ${meta}`);
    }
    console.log('');
  }
  const total = cases.length;
  const complete = cases.filter((c) => c.completeness === 'complete').length;
  const live = cases.filter((c) => c.dataSource === 'live-nansen').length;
  console.log(gray(`${total} case${total === 1 ? '' : 's'} · ${complete} complete · ${live} live-nansen`));
  console.log(dim('Run `trace show <id>` for the full reconstruction · `trace verify <id>` to re-derive its verdict.'));
}
// ---- show -------------------------------------------------------------------
function printContract(c: InvestigationContract): void {
  const inv = c.investigation;
  console.log(`\n${bold(inv.name)}  ${dim(`[${c.caseId}]`)}`);
  console.log(`${dim(inv.headline)}\n`);

  const kv = (k: string, v: string) => console.log(`  ${gray(k.padEnd(14))}${v}`);
  kv('chain', inv.chain);
  kv('window', `${inv.window.from} → ${inv.window.to}`);
  kv('status', inv.status);
  kv('data source', c.dataSource);
  kv('completeness', completenessTag(c.completeness));
  for (const r of c.completenessReasons) console.log(`  ${' '.repeat(14)}${dim(`· ${r}`)}`);
  const ev = c.evidence;
  kv('evidence', dim(`${ev.observedFacts} facts · ${ev.observedRelations} relations · ${ev.derivedValues} derived · ${ev.primaryEvents} primary of ${inv.events.length} events`));

  if (inv.summary.length) {
    console.log(`\n  ${under('Summary')}`);
    const lblW = Math.max(...inv.summary.map((m) => m.label.length));
    for (const m of inv.summary) {
      const unit = m.unit ? ` ${m.unit}` : '';
      console.log(`    ${m.label.padEnd(lblW)}  ${bold(`${m.value}${unit}`)}  ${gray(`(${m.provenance.kind})`)}`);
    }
  }
  if (inv.dataGaps.length) {
    console.log(`\n  ${under('Data gaps')}`);
    for (const g of inv.dataGaps) console.log(`    ${dim(`· ${g}`)}`);
  }

  // Open leads (the walled-off hypotheses channel), when present. Read defensively
  // so the CLI renders them regardless of when the contract type lands the field.
  const leads = (inv as unknown as { hypotheses?: Array<{ statement: string; confidence?: string }> }).hypotheses;
  if (Array.isArray(leads) && leads.length > 0) {
    console.log(`\n  ${under('Open leads')} ${gray('— not evidence')}`);
    for (const h of leads) {
      const conf = h.confidence ? yellow(`[${h.confidence}] `) : '';
      console.log(`    ${yellow('◇')} ${conf}${h.statement}`);
    }
  }
}

async function cmdShow(caseId: string | undefined, json: boolean): Promise<number> {
  if (!caseId) { console.error(`${red('show:')} missing <caseId>. Run \`list\` to see ids.`); return 2; }
  const svc = buildTraceService();
  if (!svc.hasCase(caseId)) { console.error(`${red('show:')} unknown case "${caseId}". Run \`list\` to see ids.`); return 2; }
  const contract = svc.getContract(caseId);
  if (json) { console.log(JSON.stringify(contract, null, 2)); return 0; }
  printContract(contract);
  const res = await verifyContract(contract);
  const badge = res.ok ? green('✓ self-verifies') : red('✗ inconsistent');
  console.log(`\n  ${gray('SHA-256')}  ${res.fingerprint.slice(0, 16)}${dim('…')}  ${badge}`);
  console.log(dim(`  \`trace verify ${caseId}\` re-derives the full verdict offline.`));
  return 0;
}
// ---- verify (offline, 0 credits) -------------------------------------------
async function cmdVerify(target: string | undefined, json: boolean): Promise<number> {
  if (!target) { console.error(`${red('verify:')} missing <caseId|file>.`); return 2; }
  let contract: unknown;
  if (existsSync(target)) {
    try {
      contract = JSON.parse(readFileSync(target, 'utf8'));
    } catch (e) {
      console.error(`${red('verify:')} ${target} is not valid JSON: ${e instanceof Error ? e.message : e}`);
      return 2;
    }
  } else {
    const svc = buildTraceService();
    if (!svc.hasCase(target)) {
      console.error(`${red('verify:')} "${target}" is neither a file nor a known caseId. Run \`list\` to see ids.`);
      return 2;
    }
    contract = svc.getContract(target);
  }

  const res = await verifyContract(contract);
  if (json) { console.log(JSON.stringify(res, null, 2)); return res.ok ? 0 : 1; }

  console.log(`\n${bold('Verifying')} ${cyan(target)}  ${dim('· offline · 0 credits')}\n`);
  for (const c of res.checks) {
    console.log(`  ${c.ok ? green('✓') : red('✗')} ${bold(c.label)}`);
    console.log(`      ${dim(c.detail)}`);
  }
  console.log(`\n  ${gray(`${res.algorithm} fingerprint`)}`);
  console.log(`      ${res.fingerprint}`);
  if (!res.ok && res.errors.length > 0) {
    console.log(`\n  ${red('Validation errors')}`);
    for (const e of res.errors) console.log(`      ${dim(`- ${e}`)}`);
  }
  const banner = res.ok
    ? `${green(bold(' PASS '))} ${dim('— artifact re-derives its own verdict.')}`
    : `${red(bold(' FAIL '))} ${dim('— artifact is not self-consistent.')}`;
  console.log(`\n${banner}`);
  return res.ok ? 0 : 1;
}
// ---- reconstruct (SPENDS CREDITS) ------------------------------------------
async function cmdReconstruct(args: ParsedArgs): Promise<number> {
  const address = args.positionals[0];
  if (!address) { console.error(`${red('reconstruct:')} missing <address>.`); return 2; }
  const from = args.flags['--from'];
  const to = args.flags['--to'];
  if (!from || !to) { console.error(`${red('reconstruct:')} --from and --to (YYYY-MM-DD) are required.`); return 2; }

  if (!NansenClient.hasKey()) {
    console.error(`${red(bold('BLOCKED'))} — NANSEN_API_KEY is not set; cannot run a live reconstruction.`);
    console.error(dim('Copy .env.example to .env, add your key, then re-run. No calls were made.'));
    return 2;
  }

  const budget: Partial<LiveBudget> = {};
  if (args.flags['--max-credits']) budget.maxCredits = Number(args.flags['--max-credits']);
  if (args.flags['--max-pages']) budget.maxPages = Number(args.flags['--max-pages']);
  if (args.flags['--per-page']) budget.perPage = Number(args.flags['--per-page']);
  if (args.bools.has('--no-counterparties')) budget.fetchCounterparties = false;
  if (args.bools.has('--no-related')) budget.fetchRelatedWallets = false;
  if (args.bools.has('--token-activity')) budget.fetchTokenActivity = true;
  if (args.flags['--max-tokens']) budget.maxTokens = Number(args.flags['--max-tokens']);
  if (args.flags['--chunk-days']) budget.chunkDays = Number(args.flags['--chunk-days']);
  const chain = args.flags['--chain'] ?? 'ethereum';
  const eff: LiveBudget = { ...DEFAULT_BUDGET, ...budget };
  const valueThresholdUsd =
    args.flags['--value-threshold'] !== undefined ? Number(args.flags['--value-threshold']) : undefined;
  if (valueThresholdUsd !== undefined && (!Number.isFinite(valueThresholdUsd) || valueThresholdUsd < 0)) {
    console.error(`${red('reconstruct:')} --value-threshold must be a number >= 0.`);
    return 2;
  }

  console.log(`\n${yellow(bold('LIVE RECONSTRUCTION'))} ${dim('· spends Nansen credits')}`);
  console.log(`  ${gray('target')}  ${address}  ${dim(`on ${chain}`)}`);
  console.log(`  ${gray('window')}  ${from} → ${to}`);
  if (valueThresholdUsd !== undefined) {
    console.log(`  ${gray('value floor')}  $${valueThresholdUsd.toLocaleString('en-US')}  ${dim(`(default $${DEFAULT_VALUE_THRESHOLD_USD.toLocaleString('en-US')})`)}`);
  }
  console.log(
    `  ${gray('budget')}  up to ${eff.maxCredits} credits, ${eff.maxPages} page(s)` +
    `${eff.fetchCounterparties ? '' : ', no counterparties'}${eff.fetchRelatedWallets ? '' : ', no related-wallets'}` +
    `${eff.fetchTokenActivity ? `, token activity (≤${eff.maxTokens} token${eff.maxTokens === 1 ? '' : 's'})` : ''}` +
    `${eff.chunkDays > 0 ? `, ${eff.chunkDays}-day chunks` : ''}`,
  );
  console.log(dim('  Calling Nansen…\n'));

  const { contract, meta } = await reconstructFromAddress({
    address,
    window: { from, to },
    chain,
    budget,
    name: args.flags['--name'],
    headline: args.flags['--headline'],
    ...(valueThresholdUsd !== undefined ? { valueThresholdUsd } : {}),
  });

  console.log(under('Run accounting'));
  const acc = (k: string, v: string) => console.log(`  ${gray(k.padEnd(18))}${v}`);
  acc('credits spent', bold(String(meta.creditsSpent)));
  acc('credits remaining', String(meta.creditsRemaining ?? 'unknown'));
  acc('tx pages fetched', `${meta.transactionPagesFetched}  (reached last page: ${meta.reachedLastPage})`);
  if (meta.transactionChunks.length > 1) {
    const covered = meta.transactionChunks.filter((c) => c.reachedLastPage).length;
    acc('tx sub-windows', `${covered}/${meta.transactionChunks.length} fully paginated`);
  }
  if (meta.resumeWindow) {
    acc('resume from', `${meta.resumeWindow.from} → ${meta.resumeWindow.to}  ${dim('(re-run with this window to continue)')}`);
  }
  if (meta.tokensDiscovered.length > 0) {
    acc('tokens enriched', `${meta.tokensDiscovered.length}  (${meta.tokenActivity.transfers} transfer(s), ${meta.tokenActivity.swaps} swap(s))`);
  }
  acc('rows skipped', String(meta.rowsSkipped));
  acc('stop reason', meta.stopReason);
  acc('calls', String(meta.calls.length));
  printContract(contract);

  if (args.flags['--out']) {
    writeFileSync(args.flags['--out'], `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
    console.log(`\n${green('written')} ${args.flags['--out']}`);
  }
  if (args.bools.has('--save')) {
    const { caseId, file } = saveContract(contract);
    console.log(`\n${green('saved')} to library as ${bold(caseId)}\n  ${dim(file)}`);
  }
  return 0;
}
// ---- timeline ---------------------------------------------------------------
function cmdTimeline(caseId: string | undefined, all: boolean, json: boolean): number {
  if (!caseId) { console.error(`${red('timeline:')} missing <caseId>.`); return 2; }
  const svc = buildTraceService();
  if (!svc.hasCase(caseId)) { console.error(`${red('timeline:')} unknown case "${caseId}". Run \`list\` to see ids.`); return 2; }
  const inv = svc.getContract(caseId).investigation;
  const ordered = [...inv.events].sort((a, b) => a.order - b.order);
  const shown = all ? ordered : ordered.filter((e) => e.primary);
  if (json) { console.log(JSON.stringify(shown, null, 2)); return 0; }

  console.log(`\n${bold(inv.name)}  ${dim(`[${caseId}]`)}`);
  console.log(`${dim(`${shown.length} ${all ? 'events (all)' : 'primary events'} · ${inv.chain}`)}\n`);
  shown.forEach((e, i) => {
    const val = eventValue(e);
    const collapsed = e.primary ? '' : gray(' · collapsed');
    console.log(`  ${gray(`STEP ${String(i + 1).padStart(2, '0')}`)}  ${gray(`[${e.type}]`)} ${e.title}${val ? `  ${bold(val)}` : ''}`);
    console.log(`          ${dim(fmtTime(e.timestamp))} · ${provTag(e.provenance.kind)}${collapsed}`);
  });
  console.log(dim(`\nRun \`trace follow ${caseId}\` to trace the money hop by hop.`));
  return 0;
}
// ---- follow (the money) -----------------------------------------------------
function cmdFollow(caseId: string | undefined, fromId: string | undefined, json: boolean): number {
  if (!caseId) { console.error(`${red('follow:')} missing <caseId>.`); return 2; }
  const svc = buildTraceService();
  if (!svc.hasCase(caseId)) { console.error(`${red('follow:')} unknown case "${caseId}". Run \`list\` to see ids.`); return 2; }
  const contract = svc.getContract(caseId);
  const events = contract.investigation.events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const start = fromId ?? events.find((e) => e.primary)?.id ?? events[0]?.id;
  if (!start || !byId.has(start)) { console.error(`${red('follow:')} no start event (${start ?? 'none'}).`); return 2; }

  const hops: Array<{ entity: string; toEventId: string }> = [];
  let deadEnd: string | null = null;
  let current = start;
  const seen = new Set([start]);
  for (;;) {
    const r = followFromEvent(contract, current);
    if (r === null || r.kind === 'dead-end') { deadEnd = r ? r.entity : null; break; }
    hops.push({ entity: r.step.entity, toEventId: r.step.toEventId });
    if (seen.has(r.step.toEventId)) break;
    seen.add(r.step.toEventId);
    current = r.step.toEventId;
  }
  if (json) { console.log(JSON.stringify({ start, hops, deadEnd }, null, 2)); return 0; }

  const s = byId.get(start);
  console.log(`\n${bold('Follow the money')}  ${dim(`[${caseId}]`)}`);
  if (s) console.log(`  ${green('◉')} ${gray('origin')}  ${s.title}  ${dim(fmtTime(s.timestamp))}`);
  for (const h of hops) {
    const e = byId.get(h.toEventId);
    const val = e ? eventValue(e) : '';
    console.log(`  ${cyan('↓')}  ${dim(shortAddr(h.entity))}`);
    console.log(`  ${green('◉')} ${e ? e.title : h.toEventId}${val ? `  ${bold(val)}` : ''}${e ? `  ${dim(fmtTime(e.timestamp))}` : ''}`);
  }
  console.log(`  ${yellow('⊘')}  ${dim(`${FOLLOW_DEAD_END}${deadEnd ? ` (last seen: ${shortAddr(deadEnd)})` : ''}`)}`);
  console.log(dim(`\n${hops.length} hop(s) traced within captured evidence.`));
  return 0;
}
// ---- entities ---------------------------------------------------------------
const ROLE_ORDER = ['subject', 'funder', 'counterparty', 'liquidity-source', 'sink', 'attacker', 'beneficiary'];
function cmdEntities(caseId: string | undefined, json: boolean): number {
  if (!caseId) { console.error(`${red('entities:')} missing <caseId>.`); return 2; }
  const svc = buildTraceService();
  if (!svc.hasCase(caseId)) { console.error(`${red('entities:')} unknown case "${caseId}". Run \`list\` to see ids.`); return 2; }
  const inv = svc.getContract(caseId).investigation;
  if (json) { console.log(JSON.stringify(inv.entities, null, 2)); return 0; }

  const rank = (r: string) => { const i = ROLE_ORDER.indexOf(r); return i === -1 ? 999 : i; };
  const ordered = [...inv.entities].sort((a, b) => rank(a.role) - rank(b.role) || a.displayName.localeCompare(b.displayName));
  console.log(`\n${bold(inv.name)}  ${dim(`[${caseId}]`)}`);
  console.log(`${dim(`${inv.entities.length} entities`)}\n`);
  let lastRole = '';
  for (const en of ordered) {
    if (en.role !== lastRole) { console.log(gray(en.role.toUpperCase())); lastRole = en.role; }
    const labels = en.labels.map((l) => l.label).filter(Boolean).slice(0, 3).join(', ');
    console.log(`  ${bold(en.displayName)}  ${dim(shortAddr(en.address))}  ${gray(en.kind)}${labels ? `  ${dim(labels)}` : ''}`);
  }
  return 0;
}
// ---- search (across the library) --------------------------------------------
function cmdSearch(term: string | undefined, json: boolean): number {
  if (!term) { console.error(`${red('search:')} missing <term> (address, label, txHash, or word).`); return 2; }
  const svc = buildTraceService();
  const q = term.toLowerCase();
  const hits: Array<{ caseId: string; where: string; detail: string }> = [];
  for (const id of svc.caseIds) {
    const inv = svc.getContract(id).investigation;
    if (inv.name.toLowerCase().includes(q) || inv.headline.toLowerCase().includes(q)) {
      hits.push({ caseId: id, where: 'case', detail: inv.name });
    }
    for (const en of inv.entities) {
      if ((en.address ?? '').toLowerCase().includes(q) || en.displayName.toLowerCase().includes(q) ||
          en.labels.some((l) => l.label.toLowerCase().includes(q))) {
        hits.push({ caseId: id, where: 'entity', detail: `${en.displayName} ${shortAddr(en.address)} [${en.role}]` });
      }
    }
    for (const e of inv.events) {
      if (e.title.toLowerCase().includes(q) || (e.txHash ?? '').toLowerCase().includes(q) || (e.method ?? '').toLowerCase().includes(q)) {
        hits.push({ caseId: id, where: 'event', detail: `${e.id} ${e.title}` });
      }
    }
  }
  if (json) { console.log(JSON.stringify(hits, null, 2)); return hits.length ? 0 : 1; }

  console.log(`\n${bold('Search')} ${cyan(term)}  ${dim(`· ${svc.caseIds.length} cases`)}\n`);
  if (hits.length === 0) { console.log(dim('No matches.')); return 1; }
  let lastCase = '';
  for (const h of hits) {
    if (h.caseId !== lastCase) { console.log(brand(h.caseId)); lastCase = h.caseId; }
    console.log(`  ${gray(h.where.padEnd(6))} ${truncate(h.detail, Math.min(termCols(), 96) - 12)}`);
  }
  console.log(dim(`\n${hits.length} match(es).`));
  return 0;
}
// ---- stats (library dashboard) ----------------------------------------------
function cmdStats(json: boolean): number {
  const cases = buildTraceService().listCases();
  const complete = cases.filter((c) => c.completeness === 'complete').length;
  const live = cases.filter((c) => c.dataSource === 'live-nansen').length;
  const events = cases.reduce((s, c) => s + c.primaryEvents, 0);
  const entities = cases.reduce((s, c) => s + c.entities, 0);
  const byChain: Record<string, number> = {};
  for (const c of cases) byChain[c.chain] = (byChain[c.chain] ?? 0) + 1;
  const biggest = [...cases].sort((a, b) => b.primaryEvents - a.primaryEvents)[0];
  if (json) { console.log(JSON.stringify({ total: cases.length, complete, live, events, entities, byChain }, null, 2)); return 0; }

  console.log(`\n${brand(bold('TRACE'))}  ${dim('library stats')}\n`);
  const row = (k: string, v: string) => console.log(`  ${gray(k.padEnd(18))}${v}`);
  row('cases', `${bold(String(cases.length))}  (${green(`${complete} complete`)} · ${yellow(`${cases.length - complete} incomplete`)})`);
  row('data source', `${live} live-nansen · ${cases.length - live} fixture-cache`);
  row('primary events', bold(String(events)));
  row('entities', bold(String(entities)));
  row('chains', Object.entries(byChain).map(([c, n]) => `${c} (${n})`).join(' · '));
  if (biggest) row('largest case', `${biggest.caseId} ${dim(`(${biggest.primaryEvents} events)`)}`);
  return 0;
}
// ---- diff (compare two reconstructions) -------------------------------------
async function cmdDiff(idA: string | undefined, idB: string | undefined, json: boolean): Promise<number> {
  if (!idA || !idB) { console.error(`${red('diff:')} needs two case ids: \`diff <caseA> <caseB>\`.`); return 2; }
  const svc = buildTraceService();
  for (const id of [idA, idB]) {
    if (!svc.hasCase(id)) { console.error(`${red('diff:')} unknown case "${id}". Run \`list\` to see ids.`); return 2; }
  }
  const a = svc.getContract(idA);
  const b = svc.getContract(idB);
  const [fpA, fpB] = await Promise.all([fingerprintContract(a), fingerprintContract(b)]);

  // Shared on-chain addresses — the investigative payoff of comparing two cases.
  const addrs = (c: InvestigationContract) =>
    new Map(c.investigation.entities.filter((e) => e.address).map((e) => [(e.address as string).toLowerCase(), e]));
  const mapA = addrs(a);
  const mapB = addrs(b);
  const shared = [...mapA.keys()].filter((k) => mapB.has(k));

  if (json) {
    console.log(JSON.stringify({
      a: { caseId: idA, fingerprint: fpA },
      b: { caseId: idB, fingerprint: fpB },
      shared: shared.map((k) => ({ address: k, aRole: mapA.get(k)?.role, bRole: mapB.get(k)?.role })),
    }, null, 2));
    return 0;
  }

  const rowsA = [
    idA, a.investigation.chain, `${a.investigation.window.from}→${a.investigation.window.to}`,
    a.dataSource, a.completeness, String(a.evidence.primaryEvents),
    String(a.investigation.entities.length), String(a.investigation.relationships.length), `${fpA.slice(0, 12)}…`,
  ];
  const colW = Math.max(...rowsA.map((s) => s.length)) + 2;
  const field = (label: string, va: string, vb: string) =>
    console.log(`  ${gray(label.padEnd(15))}${va.padEnd(colW)}${va === vb ? dim(vb) : yellow(vb)}`);
  console.log(`\n${bold('Diff')}  ${brand(idA)}  ${dim('vs')}  ${brand(idB)}\n`);
  console.log(`  ${' '.repeat(15)}${bold(idA.padEnd(colW))}${bold(idB)}`);
  field('chain', a.investigation.chain, b.investigation.chain);
  field('window', `${a.investigation.window.from}→${a.investigation.window.to}`, `${b.investigation.window.from}→${b.investigation.window.to}`);
  field('data source', a.dataSource, b.dataSource);
  field('completeness', a.completeness, b.completeness);
  field('primary events', String(a.evidence.primaryEvents), String(b.evidence.primaryEvents));
  field('entities', String(a.investigation.entities.length), String(b.investigation.entities.length));
  field('relationships', String(a.investigation.relationships.length), String(b.investigation.relationships.length));
  console.log(`  ${gray('fingerprint'.padEnd(15))}${`${fpA.slice(0, 12)}…`.padEnd(colW)}${fpA === fpB ? green(`${fpB.slice(0, 12)}… identical`) : dim(`${fpB.slice(0, 12)}…`)}`);

  console.log(`\n  ${under('Shared addresses')} ${gray(`— ${shared.length} in both cases`)}`);
  if (shared.length === 0) console.log(`    ${dim('none — these cases share no on-chain address.')}`);
  for (const k of shared.slice(0, 12)) {
    const ea = mapA.get(k);
    const eb = mapB.get(k);
    console.log(`    ${dim(shortAddr(k))}  ${ea?.displayName ?? '—'}  ${gray(`[${ea?.role} / ${eb?.role}]`)}`);
  }
  if (shared.length > 12) console.log(`    ${dim(`… and ${shared.length - 12} more`)}`);
  return 0;
}

// ---- export (write the portable artifact) -----------------------------------
async function cmdExport(caseId: string | undefined, outFlag: string | undefined): Promise<number> {
  if (!caseId) { console.error(`${red('export:')} missing <caseId>. Usage: \`export <caseId> [--out <path>]\`.`); return 2; }
  const svc = buildTraceService();
  if (!svc.hasCase(caseId)) { console.error(`${red('export:')} unknown case "${caseId}". Run \`list\` to see ids.`); return 2; }
  const contract = svc.getContract(caseId);
  const out = outFlag ?? `${caseId}.json`;
  writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  const fp = await fingerprintContract(contract);
  console.log(`\n${green('exported')} ${bold(caseId)} ${dim('→')} ${out}`);
  console.log(`  ${gray('SHA-256')}  ${fp}`);
  console.log(dim(`  Portable artifact — re-derive its verdict anywhere with \`trace verify ${out}\`.`));
  return 0;
}

// ---- main -------------------------------------------------------------------
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(usage()); return; }

  const rest = parseArgs(argv.slice(1));
  if (rest.bools.has('--no-color')) COLOR = false;
  const json = rest.bools.has('--json');

  switch (cmd) {
    case 'list': cmdList(json); return;
    case 'show': process.exitCode = await cmdShow(rest.positionals[0], json); return;
    case 'verify': process.exitCode = await cmdVerify(rest.positionals[0], json); return;
    case 'timeline': process.exitCode = cmdTimeline(rest.positionals[0], rest.bools.has('--all'), json); return;
    case 'follow': process.exitCode = cmdFollow(rest.positionals[0], rest.flags['--from'], json); return;
    case 'entities': process.exitCode = cmdEntities(rest.positionals[0], json); return;
    case 'search': process.exitCode = cmdSearch(rest.positionals[0], json); return;
    case 'stats': cmdStats(json); return;
    case 'diff': process.exitCode = await cmdDiff(rest.positionals[0], rest.positionals[1], json); return;
    case 'export': process.exitCode = await cmdExport(rest.positionals[0], rest.flags['--out']); return;
    case 'reconstruct': process.exitCode = await cmdReconstruct(rest); return;
    default:
      console.error(`${red(`Unknown command "${cmd}".`)}\n`);
      console.log(usage());
      process.exitCode = 2;
  }
}

main().catch((e) => { console.error(red('FATAL'), e instanceof Error ? e.message : e); process.exitCode = 1; });
