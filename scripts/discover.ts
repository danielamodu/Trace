/**
 * Hero-incident discovery helper (TRACE Phase 1B).
 *
 * Cheap, deliberate probes only. Two modes:
 *
 *   node --env-file-if-exists=.env scripts/discover.ts search "<query>"
 *       → POST /api/v1/search/general (0 credits). Prints tokens + entities
 *         with any address + label Nansen already knows.
 *
 *   node --env-file-if-exists=.env scripts/discover.ts address <addr> <from> <to>
 *       → runs the two cheapest ADDRESS-centric probes (1 credit each):
 *         profiler/address/transactions  + profiler/address/related-wallets
 *         over [from,to]. Prints a sanitized summary and writes a fixture.
 *
 * Never calls profiler/address/labels (100 credits). Inline labels are free.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { NansenClient, NansenApiError, redact } from '../src/nansen/client.ts';

function short(a: unknown): string {
  if (typeof a !== 'string') return String(a);
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a;
}

async function search(client: NansenClient, query: string) {
  const { data, meta } = await client.post<any>('/api/v1/search/general', { search_query: query, result_type: 'any' });
  console.log(`search "${query}"  status=${meta.status} cost=${meta.creditsCost} remaining=${meta.creditsRemaining}`);
  const ents = data.entities ?? [];
  const toks = data.tokens ?? [];
  console.log(`  entities (${ents.length}):`);
  for (const e of ents.slice(0, 12)) {
    console.log(`    ${JSON.stringify(e)}`.slice(0, 200));
  }
  console.log(`  tokens (${toks.length}):`);
  for (const t of toks.slice(0, 8)) {
    console.log(`    ${JSON.stringify(t)}`.slice(0, 200));
  }
}

async function address(client: NansenClient, addr: string, from: string, to: string) {
  mkdirSync('fixtures/discovery', { recursive: true });
  const out: any = { address: addr, window: { from, to }, captured_at: new Date().toISOString(), probes: {} };
  let credits = 0;

  // 1) transactions (1 credit)
  try {
    const { data, meta } = await client.post<any>('/api/v1/profiler/address/transactions', {
      address: addr, chain: 'ethereum', date: { from, to }, hide_spam_token: true, pagination: { page: 1, per_page: 25 },
    });
    credits += Number(meta.creditsUsed ?? 0) || 0;
    const rows = data.data ?? [];
    const labels = new Set<string>();
    const counterparts = new Set<string>();
    for (const r of rows) {
      for (const t of [...(r.tokens_sent ?? []), ...(r.tokens_received ?? [])]) {
        if (t.from_address_label) labels.add(String(t.from_address_label));
        if (t.to_address_label) labels.add(String(t.to_address_label));
        if (t.to_address && t.to_address !== addr) counterparts.add(String(t.to_address));
        if (t.from_address && t.from_address !== addr) counterparts.add(String(t.from_address));
      }
    }
    console.log(`  transactions: ${rows.length} rows, is_last_page=${data.pagination?.is_last_page}, cost=${meta.creditsCost}`);
    console.log(`    methods: ${[...new Set(rows.map((r: any) => r.method))].slice(0, 10).join(', ')}`);
    console.log(`    inline labels seen: ${[...labels].slice(0, 12).join(' | ') || '(none)'}`);
    console.log(`    distinct counterparties: ${counterparts.size}`);
    if (rows.length) {
      const ts = rows.map((r: any) => r.block_timestamp).sort();
      console.log(`    time span: ${ts[0]} → ${ts[ts.length - 1]}`);
    }
    out.probes.transactions = { meta, row_count: rows.length, labels: [...labels], counterparty_count: counterparts.size, sample: rows.slice(0, 5) };
  } catch (e) {
    if (e instanceof NansenApiError) { console.log(`  transactions ERR ${e.status} ${e.message}`); out.probes.transactions = { error: e.body, meta: e.meta }; }
    else throw e;
  }

  // 2) related-wallets (1 credit)
  try {
    const { data, meta } = await client.post<any>('/api/v1/profiler/address/related-wallets', {
      address: addr, chain: 'ethereum', pagination: { page: 1, per_page: 25 },
    });
    credits += Number(meta.creditsUsed ?? 0) || 0;
    const rows = data.data ?? [];
    const rels = [...new Set(rows.map((r: any) => r.relation))];
    console.log(`  related-wallets: ${rows.length} rows, cost=${meta.creditsCost}`);
    console.log(`    relations: ${rels.join(' | ') || '(none)'}`);
    console.log(`    labels: ${[...new Set(rows.map((r: any) => r.address_label).filter(Boolean))].slice(0, 10).join(' | ') || '(none)'}`);
    out.probes.related_wallets = { meta, row_count: rows.length, relations: rels, sample: rows.slice(0, 8) };
  } catch (e) {
    if (e instanceof NansenApiError) { console.log(`  related-wallets ERR ${e.status} ${e.message}`); out.probes.related_wallets = { error: e.body, meta: e.meta }; }
    else throw e;
  }

  const file = `fixtures/discovery/${addr.slice(0, 10)}.json`;
  writeFileSync(file, redact(JSON.stringify(out, null, 2)));
  console.log(`  → observed credits this address: ${credits}. fixture: ${file}`);
}

async function entity(client: NansenClient, name: string, from: string, to: string) {
  mkdirSync('fixtures/discovery', { recursive: true });
  // counterparties accepts entity_name (5 credits). group_by entity → entity-level flows.
  const { data, meta } = await client.post<any>('/api/v1/profiler/address/counterparties', {
    entity_name: name, chain: 'ethereum', date: { from, to }, group_by: 'entity', pagination: { page: 1, per_page: 25 },
  });
  const rows = data.data ?? [];
  console.log(`entity "${name}" ${from}..${to}  status=${meta.status} cost=${meta.creditsCost} remaining=${meta.creditsRemaining}`);
  console.log(`  counterparties: ${rows.length}, is_last_page=${data.pagination?.is_last_page}`);
  for (const r of rows.slice(0, 15)) {
    const lbl = Array.isArray(r.counterparty_address_label) ? r.counterparty_address_label.join('/') : r.counterparty_address_label;
    console.log(`    ${short(r.counterparty_address)} [${lbl || '-'}] intx=${r.interaction_count} in=$${Math.round(r.volume_in_usd || 0)} out=$${Math.round(r.volume_out_usd || 0)}`);
  }
  const file = `fixtures/discovery/entity-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  writeFileSync(file, redact(JSON.stringify({ entity: name, window: { from, to }, meta, row_count: rows.length, sample: rows.slice(0, 15), captured_at: new Date().toISOString() }, null, 2)));
  console.log(`  → cost ${meta.creditsUsed ?? meta.creditsCost}. fixture: ${file}`);
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (!NansenClient.hasKey()) { console.error('BLOCKED: NANSEN_API_KEY not set.'); process.exitCode = 2; return; }
  const client = new NansenClient();
  if (mode === 'search') {
    await search(client, rest.join(' '));
  } else if (mode === 'entity') {
    const [name, from, to] = [rest.slice(0, -2).join(' '), rest[rest.length - 2], rest[rest.length - 1]];
    if (!name || !from || !to) { console.error('usage: entity "<name>" <from> <to>'); process.exitCode = 2; return; }
    await entity(client, name, from, to);
  } else if (mode === 'address') {
    const [addr, from, to] = rest;
    if (!addr || !from || !to) { console.error('usage: address <addr> <from> <to>'); process.exitCode = 2; return; }
    console.log(`address ${short(addr)} window ${from}..${to}`);
    await address(client, addr, from, to);
  } else {
    console.error('usage: discover.ts search "<q>" | address <addr> <from> <to>');
    process.exitCode = 2;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
