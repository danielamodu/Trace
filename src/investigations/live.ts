/**
 * TRACE — live reconstruction orchestrator (Phase 3K).
 *
 * The online analogue of the fixture loaders in this directory: instead of
 * reading committed fixtures, it fetches an address's evidence from Nansen at
 * request time, sanitizes it, normalizes it, runs the SAME Phase 3B engine, and
 * assembles a `live-nansen` InvestigationContract. This is the one path that can
 * legitimately reach `completeness: 'complete'` (fixture-cache never can).
 *
 * Guarantees carried over from the rest of TRACE:
 *  - No new engine behavior. Fetch → sanitize → normalize → reconstruct → assemble.
 *  - Deterministic given its inputs: pass `reconstructedAt` to pin the clock.
 *  - Honest coverage: flags are computed from what was actually observed, and a
 *    run that stops before `is_last_page` reports `transactionWindowCovered:false`.
 *  - Budgeted spend: hard caps on credits and pages; actual per-call cost is read
 *    from response headers and accumulated, never assumed away.
 *
 * Security: the Nansen key is server-side only. It is either read from the
 * environment (NANSEN_API_KEY) by NansenClient or passed as `apiKey` (BYO-key).
 * It is never logged, never persisted, and never placed in the returned contract
 * or meta. Do NOT import this module into client components.
 */

import { NansenClient, NansenApiError } from '../nansen/client.ts';
import type {
  AddressCounterparty,
  AddressRelatedWallet,
  AddressTransaction,
  CallMeta,
  Paged,
  TgmTransfer,
  TgmDexTrade,
} from '../nansen/types.ts';
import { sanitizeRows, sanitizeTgmRows, type ClearedCounts } from '../nansen/sanitize.ts';
import {
  normalizeCounterparty,
  normalizeRelationship,
  normalizeTransfer,
  normalizeSwap,
  sourceMeta,
} from '../reconstruction/normalize.ts';
import { normalizeTransaction } from '../reconstruction/transaction.ts';
import { reconstruct } from '../reconstruction/engine.ts';
import type { EngineInput } from '../reconstruction/engine.ts';
import { buildContract } from '../contract/assemble.ts';
import type { CoverageReport, InvestigationContract, OriginAttestation } from '../contract/types.ts';

/** The minimal client surface the orchestrator needs — satisfied by NansenClient. */
export interface NansenLike {
  post<TResponse, TBody extends object = object>(
    path: string,
    body: TBody,
  ): Promise<{ data: TResponse; meta: CallMeta }>;
}

/** Hard limits on a single live run. Defaults in DEFAULT_BUDGET. */
export interface LiveBudget {
  /**
   * Ceiling on credits to spend this run. The next call is skipped once
   * cumulative spend reaches it, so worst-case overspend is one in-flight call.
   */
  maxCredits: number;
  /** Max transaction pages to fetch (each ≈ 1 credit). */
  maxPages: number;
  /** Rows per transaction page (Nansen caps at 100; higher values 422). */
  perPage: number;
  /** Fetch window-level counterparty aggregates (the priciest call, ≈5 credits). */
  fetchCounterparties: boolean;
  /** Fetch related-wallets (funding / relation evidence). */
  fetchRelatedWallets: boolean;
  /**
   * Item #1 — opt-in token-level enrichment. After the subject's counterparties
   * and transactions are fetched, discover the token addresses the subject
   * actually touched (from data ALREADY paid for) and pull token-scoped
   * tgm/transfers (both directions) + tgm/dex-trades for the top ones, folding
   * subject-relevant rows into the SAME engine as `transfers` / `swaps`. Off by
   * default so existing runs are unchanged and cost stays bounded.
   */
  fetchTokenActivity: boolean;
  /** Cap on how many discovered tokens to enrich (each ≈3 credits worst case). */
  maxTokens: number;
  /**
   * Item #2 — optional window chunking for wide or high-activity windows. When
   * > 0, the transaction window is split into contiguous sub-windows of at most
   * this many calendar days each; every sub-window paginates independently (up
   * to `maxPages` pages) and the window counts as covered only when EVERY
   * sub-window reached is_last_page. A narrow sub-window returns far fewer rows,
   * so each one is likely to finish within a modest page budget where the whole
   * window would not — letting a large window reach `transactionWindowCovered`
   * across bounded, resumable steps. `0` (the default) issues one query over the
   * whole window, exactly as before, so existing runs stay byte-identical.
   */
  chunkDays: number;
}

export const DEFAULT_BUDGET: LiveBudget = {
  maxCredits: 12,
  maxPages: 5,
  perPage: 100,
  fetchCounterparties: true,
  fetchRelatedWallets: true,
  fetchTokenActivity: false,
  maxTokens: 3,
  chunkDays: 0,
};

/** One recorded API call, for the audit trail (no secrets, no row contents). */
export interface LiveCall {
  endpoint: string;
  page: number | null;
  status: number;
  creditsCost: string | null;
  creditsRemaining: string | null;
  requestId: string | null;
  rows: number;
  /** SHA-256 hex of the raw response body (item #3); null on a scripted client / empty body. */
  responseSha256: string | null;
}

/**
 * Per-sub-window transaction progress (item #2). A single entry spanning the
 * whole window when chunking is off; one entry per attempted sub-window when it
 * is on. `reachedLastPage` is that sub-window's own coverage.
 */
export interface TransactionChunk {
  from: string;
  to: string;
  pagesFetched: number;
  reachedLastPage: boolean;
  rows: number;
}

/** Run-level accounting returned alongside the contract (safe to surface to a client). */
export interface LiveRunMeta {
  address: string;
  chain: string;
  window: { from: string; to: string };
  creditsSpent: number;
  creditsRemaining: string | null;
  calls: LiveCall[];
  transactionPagesFetched: number;
  reachedLastPage: boolean;
  /**
   * Per-sub-window transaction progress (item #2). One entry for the whole
   * window when chunking is off; one per attempted sub-window when it is on.
   */
  transactionChunks: TransactionChunk[];
  /**
   * When the transaction window was NOT fully covered, the earliest date range
   * still needing capture — pass it back as `window` on a follow-up run to
   * resume rather than restart. `null` when the window is fully covered.
   */
  resumeWindow: { from: string; to: string } | null;
  sanitization: ClearedCounts;
  rowsSkipped: number;
  /** Token addresses discovered from the subject's own activity and enriched (item #1). */
  tokensDiscovered: string[];
  /** Subject-relevant rows folded in from token-scoped endpoints. */
  tokenActivity: { transfers: number; swaps: number };
  stopReason: string;
}

export interface LiveReconstruction {
  contract: InvestigationContract;
  meta: LiveRunMeta;
}

export interface ReconstructFromAddressParams {
  address: string;
  window: { from: string; to: string };
  chain?: string;
  /** BYO Nansen key (server-side only; never logged or persisted). */
  apiKey?: string;
  /** Injected client (tests, or a route that owns the client). Overrides apiKey. */
  client?: NansenLike;
  budget?: Partial<LiveBudget>;
  /** Fixed timestamp to make a run deterministic (tests / reproducibility). */
  reconstructedAt?: string;
  name?: string;
  headline?: string;
}

const EP = {
  counterparties: '/api/v1/profiler/address/counterparties',
  relatedWallets: '/api/v1/profiler/address/related-wallets',
  transactions: '/api/v1/profiler/address/transactions',
  tgmTransfers: '/api/v1/tgm/transfers',
  tgmDexTrades: '/api/v1/tgm/dex-trades',
} as const;

/** Conservative per-endpoint credit estimate used only when the cost header is absent. */
const COST_FALLBACK: Record<string, number> = {
  [EP.counterparties]: 5,
  [EP.relatedWallets]: 1,
  [EP.transactions]: 1,
  [EP.tgmTransfers]: 1,
  [EP.tgmDexTrades]: 1,
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Pseudo-addresses that appear in token fields but are NOT real ERC-20 contracts:
 * the zero address and the native-token sentinel (0xEeee…EEeE, used for ETH and
 * other native coins). The tgm token-scoped endpoints reject them with a 422, so
 * they must be excluded from token discovery.
 */
const NON_TOKEN_ADDRESSES = new Set<string>([
  '0x0000000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
]);

/** Actual credit cost of a call: the response header when numeric, else a conservative estimate. */
function costOf(path: string, meta: CallMeta): number {
  if (meta.creditsCost !== null && meta.creditsCost.trim() !== '') {
    const n = Number(meta.creditsCost);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return COST_FALLBACK[path] ?? 1;
}

function assertParams(address: string, window: { from: string; to: string }): void {
  if (!ADDRESS_RE.test(address)) {
    throw new Error(`reconstructFromAddress: invalid address "${address}" (expected 0x + 40 hex).`);
  }
  if (
    typeof window?.from !== 'string' ||
    typeof window?.to !== 'string' ||
    window.from === '' ||
    window.to === ''
  ) {
    throw new Error('reconstructFromAddress: window.from and window.to are required (YYYY-MM-DD).');
  }
  if (window.from > window.to) {
    throw new Error(`reconstructFromAddress: window.from (${window.from}) is after window.to (${window.to}).`);
  }
}

/** Deterministic id for a live run: `live_<8 hex>_<from>`. */
function liveCaseId(address: string, from: string): string {
  return `live_${address.slice(2, 10).toLowerCase()}_${from}`;
}

/**
 * Deterministically pick the token addresses the subject engaged with most,
 * read from data ALREADY fetched (counterparties' `tokens_info` + transactions'
 * token movements) — so discovery itself spends nothing. Ranked by observation
 * count (desc), ties broken by address (asc); capped at `maxTokens`.
 */
function discoverTokens(
  counterparties: ReturnType<typeof normalizeCounterparty>[],
  transactions: ReturnType<typeof normalizeTransaction>[],
  maxTokens: number,
): string[] {
  const cap = Math.max(0, Math.trunc(maxTokens));
  if (cap === 0) return [];
  const score = new Map<string, { addr: string; count: number }>();
  const bump = (addr: string | null): void => {
    if (addr === null || addr === '') return;
    const k = addr.toLowerCase();
    if (NON_TOKEN_ADDRESSES.has(k)) return; // native/zero sentinels aren't tgm-queryable
    const e = score.get(k) ?? { addr, count: 0 };
    e.count += 1;
    score.set(k, e);
  };
  for (const cp of counterparties) for (const t of cp.value.tokens) bump(t.tokenAddress);
  for (const tx of transactions) {
    for (const m of tx.value.tokensSent) bump(m.tokenAddress);
    for (const m of tx.value.tokensReceived) bump(m.tokenAddress);
  }
  return [...score.values()]
    .sort((a, b) => b.count - a.count || (a.addr.toLowerCase() < b.addr.toLowerCase() ? -1 : 1))
    .slice(0, cap)
    .map((e) => e.addr);
}

/** UTC epoch-day index for a YYYY-MM-DD date. TZ-free and deterministic; NaN if unparseable. */
function toEpochDay(date: string): number {
  const parts = date.split('-').map((s) => Number(s));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return NaN;
  const [y, m, d] = parts;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Inverse of toEpochDay: an epoch-day index back to a YYYY-MM-DD string. */
function fromEpochDay(day: number): string {
  const dt = new Date(day * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Split an inclusive [from, to] date window into contiguous, non-overlapping
 * sub-windows of at most `chunkDays` calendar days (item #2). Deterministic; the
 * final sub-window is clamped to `to`. `chunkDays <= 0`, or a window whose bounds
 * don't parse as YYYY-MM-DD, yields a single whole-window range so the caller's
 * un-chunked path stays byte-identical.
 */
function splitWindow(
  window: { from: string; to: string },
  chunkDays: number,
): Array<{ from: string; to: string }> {
  const step = Math.max(0, Math.trunc(chunkDays));
  const whole = [{ from: window.from, to: window.to }];
  if (step <= 0) return whole;
  const start = toEpochDay(window.from);
  const end = toEpochDay(window.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return whole;
  const ranges: Array<{ from: string; to: string }> = [];
  for (let s = start; s <= end; s += step) {
    ranges.push({ from: fromEpochDay(s), to: fromEpochDay(Math.min(s + step - 1, end)) });
  }
  return ranges;
}

/**
 * Reconstruct an investigation for an arbitrary address + window by fetching
 * live Nansen evidence. Returns the assembled `live-nansen` contract plus a
 * run-level accounting of what was fetched and spent.
 */
export async function reconstructFromAddress(
  params: ReconstructFromAddressParams,
): Promise<LiveReconstruction> {
  const chain = params.chain ?? 'ethereum';
  const { address, window } = params;
  assertParams(address, window);

  const budget: LiveBudget = { ...DEFAULT_BUDGET, ...params.budget };
  const perPage = Math.min(Math.max(1, Math.trunc(budget.perPage)), 100);
  const nowIso = params.reconstructedAt ?? new Date().toISOString();
  const client: NansenLike =
    params.client ?? new NansenClient(params.apiKey !== undefined ? { apiKey: params.apiKey } : {});

  const calls: LiveCall[] = [];
  const sanitization: ClearedCounts = { symbolsCleared: 0, namesCleared: 0, labelsCleared: 0 };
  const stopReasons: string[] = [];
  let creditsSpent = 0;
  let creditsRemaining: string | null = null;
  let rowsSkipped = 0;

  const metaToFixture = (m: CallMeta) => ({ requestId: m.requestId, creditsCost: m.creditsCost });
  const recordCall = (endpoint: string, page: number | null, m: CallMeta, rows: number): void => {
    creditsSpent += costOf(endpoint, m);
    creditsRemaining = m.creditsRemaining ?? creditsRemaining;
    calls.push({
      endpoint,
      page,
      status: m.status,
      creditsCost: m.creditsCost,
      creditsRemaining: m.creditsRemaining,
      requestId: m.requestId,
      rows,
      responseSha256: m.responseSha256 ?? null,
    });
  };
  const budgetLeft = (): boolean => creditsSpent < budget.maxCredits;

  const counterparties: ReturnType<typeof normalizeCounterparty>[] = [];
  const relationships: ReturnType<typeof normalizeRelationship>[] = [];
  const transactions: ReturnType<typeof normalizeTransaction>[] = [];
  const transfers: ReturnType<typeof normalizeTransfer>[] = [];
  const swaps: ReturnType<typeof normalizeSwap>[] = [];

  // --- counterparties: window-level aggregates (the priciest single call) ---
  if (budget.fetchCounterparties && budgetLeft()) {
    const { data, meta } = await client.post<Paged<AddressCounterparty>>(EP.counterparties, {
      address,
      chain,
      date: { from: window.from, to: window.to },
      group_by: 'entity',
      pagination: { page: 1, per_page: perPage },
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    recordCall(EP.counterparties, null, meta, rows.length);
    const src = sourceMeta('profiler/address/counterparties', metaToFixture(meta), nowIso, null, 'live-nansen');
    for (const r of rows) {
      try {
        counterparties.push(normalizeCounterparty(r, src));
      } catch {
        rowsSkipped += 1;
      }
    }
  } else if (budget.fetchCounterparties) {
    stopReasons.push('counterparties skipped: credit budget reached');
  }

  // --- related-wallets: funding / relation evidence (not windowed) ---
  if (budget.fetchRelatedWallets && budgetLeft()) {
    const { data, meta } = await client.post<Paged<AddressRelatedWallet>>(EP.relatedWallets, {
      address,
      chain,
      pagination: { page: 1, per_page: perPage },
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    recordCall(EP.relatedWallets, null, meta, rows.length);
    const src = sourceMeta('profiler/address/related-wallets', metaToFixture(meta), nowIso, null, 'live-nansen');
    for (const r of rows) {
      try {
        relationships.push(normalizeRelationship(r, src));
      } catch {
        rowsSkipped += 1;
      }
    }
  } else if (budget.fetchRelatedWallets) {
    stopReasons.push('related-wallets skipped: credit budget reached');
  }

  // --- transactions: paginated timeline; defines transactionWindowCovered -----
  // One query over the whole window by default. When budget.chunkDays > 0 the
  // window is split into contiguous sub-windows that each paginate on their own,
  // so a wide/high-activity window can be fully covered across bounded, resumable
  // steps (item #2). Coverage holds only when EVERY sub-window reached is_last_page.
  let reachedLastPage = false;
  let pagesFetched = 0;
  const transactionChunks: TransactionChunk[] = [];
  let resumeWindow: { from: string; to: string } | null = null;

  // Fetch + sanitize + normalize one transaction page for a date range. Shared by
  // the un-chunked and chunked paths so the metadata-injection defense and cost
  // accounting are identical; returns the raw row count and this page's is_last flag.
  const fetchTxPage = async (
    range: { from: string; to: string },
    page: number,
  ): Promise<{ rows: number; isLast: boolean }> => {
    const { data, meta } = await client.post<Paged<AddressTransaction>>(EP.transactions, {
      address,
      chain,
      date: { from: range.from, to: range.to },
      hide_spam_token: true,
      pagination: { page, per_page: perPage },
    });
    const rows: Array<Record<string, unknown>> = Array.isArray(data?.data)
      ? (data.data as Array<Record<string, unknown>>)
      : [];
    // Neutralize injected token-metadata IN PLACE before it can reach the contract.
    const cleared = sanitizeRows(rows);
    sanitization.symbolsCleared += cleared.symbolsCleared;
    sanitization.namesCleared += cleared.namesCleared;
    sanitization.labelsCleared += cleared.labelsCleared;
    recordCall(EP.transactions, page, meta, rows.length);
    pagesFetched += 1;
    const src = sourceMeta('profiler/address/transactions', metaToFixture(meta), nowIso, null, 'live-nansen');
    for (const r of rows) {
      try {
        transactions.push(normalizeTransaction(r, src));
      } catch {
        rowsSkipped += 1;
      }
    }
    return { rows: rows.length, isLast: data?.pagination?.is_last_page === true };
  };

  const chunked = Math.trunc(budget.chunkDays) > 0;
  const ranges = chunked ? splitWindow(window, budget.chunkDays) : [{ from: window.from, to: window.to }];

  if (!chunked) {
    // Un-chunked path — preserved verbatim so existing runs stay byte-identical.
    const range = ranges[0];
    let windowRows = 0;
    for (let page = 1; page <= budget.maxPages; page += 1) {
      if (!budgetLeft()) {
        stopReasons.push(`transactions stopped before page ${page}: credit budget reached`);
        break;
      }
      const { rows, isLast } = await fetchTxPage(range, page);
      windowRows += rows;
      if (isLast) {
        reachedLastPage = true;
        stopReasons.push(`transactions complete: is_last_page at page ${page}`);
        break;
      }
      if (rows === 0) {
        reachedLastPage = true;
        stopReasons.push(`transactions complete: empty page ${page}`);
        break;
      }
      if (page === budget.maxPages) {
        stopReasons.push(`transactions stopped: page cap (${budget.maxPages}) reached before is_last_page`);
      }
    }
    transactionChunks.push({ from: range.from, to: range.to, pagesFetched, reachedLastPage, rows: windowRows });
    resumeWindow = reachedLastPage ? null : { from: range.from, to: range.to };
  } else {
    // Chunked path (item #2): each sub-window paginates within the shared credit
    // budget; the earliest sub-window that doesn't finish is the resume boundary.
    let firstUncovered: { from: string; to: string } | null = null;
    for (const range of ranges) {
      if (!budgetLeft()) {
        stopReasons.push(`transactions stopped before chunk ${range.from}..${range.to}: credit budget reached`);
        if (firstUncovered === null) firstUncovered = { from: range.from, to: window.to };
        break;
      }
      let chunkLast = false;
      let chunkPages = 0;
      let chunkRows = 0;
      for (let page = 1; page <= budget.maxPages; page += 1) {
        if (!budgetLeft()) {
          stopReasons.push(`transactions[${range.from}..${range.to}] stopped before page ${page}: credit budget reached`);
          break;
        }
        const { rows, isLast } = await fetchTxPage(range, page);
        chunkPages += 1;
        chunkRows += rows;
        if (isLast) {
          chunkLast = true;
          stopReasons.push(`transactions[${range.from}..${range.to}] complete: is_last_page at page ${page}`);
          break;
        }
        if (rows === 0) {
          chunkLast = true;
          stopReasons.push(`transactions[${range.from}..${range.to}] complete: empty page ${page}`);
          break;
        }
        if (page === budget.maxPages) {
          stopReasons.push(`transactions[${range.from}..${range.to}] stopped: page cap (${budget.maxPages}) reached before is_last_page`);
        }
      }
      transactionChunks.push({ from: range.from, to: range.to, pagesFetched: chunkPages, reachedLastPage: chunkLast, rows: chunkRows });
      if (!chunkLast && firstUncovered === null) firstUncovered = { from: range.from, to: window.to };
    }
    const coveredEveryChunk =
      transactionChunks.length === ranges.length && transactionChunks.every((c) => c.reachedLastPage);
    reachedLastPage = coveredEveryChunk;
    resumeWindow = coveredEveryChunk ? null : firstUncovered ?? { from: window.from, to: window.to };
  }

  // --- token-level enrichment (item #1) -------------------------------------
  // Discover the tokens the subject touched (from data already paid for), then
  // pull token-scoped tgm/transfers (both directions) + dex-trades for the top
  // ones, keeping only rows that involve the subject. Opt-in + budget-gated, so
  // this never runs — and costs nothing — unless explicitly requested.
  const tokensDiscovered: string[] = [];
  const subjectLc = address.toLowerCase();
  if (budget.fetchTokenActivity) {
    const accumulateSanitization = (rows: Array<Record<string, unknown>>): void => {
      const cleared = sanitizeTgmRows(rows);
      sanitization.symbolsCleared += cleared.symbolsCleared;
      sanitization.namesCleared += cleared.namesCleared;
      sanitization.labelsCleared += cleared.labelsCleared;
    };
    for (const token of discoverTokens(counterparties, transactions, budget.maxTokens)) {
      if (!budgetLeft()) {
        stopReasons.push(`token activity stopped before ${token}: credit budget reached`);
        break;
      }
      tokensDiscovered.push(token);

      try {
        // transfers: one call per direction so the filter's AND/OR semantics never
        // matter; the engine's dedupe collapses any self-transfer seen twice.
        for (const dir of ['from_address', 'to_address'] as const) {
          if (!budgetLeft()) {
            stopReasons.push(`token transfers (${dir}) skipped for ${token}: credit budget reached`);
            break;
          }
          const { data, meta } = await client.post<Paged<TgmTransfer>>(EP.tgmTransfers, {
            chain,
            token_address: token,
            date: { from: window.from, to: window.to },
            filters: { [dir]: [address] },
            pagination: { page: 1, per_page: perPage },
          });
          const rows: Array<Record<string, unknown>> = Array.isArray(data?.data)
            ? (data.data as Array<Record<string, unknown>>)
            : [];
          accumulateSanitization(rows);
          recordCall(EP.tgmTransfers, null, meta, rows.length);
          const src = sourceMeta('tgm/transfers', metaToFixture(meta), nowIso, null, 'live-nansen');
          for (const r of rows) {
            try {
              const t = normalizeTransfer(r, src);
              if (
                t.value.fromAddress.toLowerCase() === subjectLc ||
                t.value.toAddress.toLowerCase() === subjectLc
              ) {
                transfers.push(t);
              } else {
                rowsSkipped += 1; // off-subject row (defensive; filter should exclude it)
              }
            } catch {
              rowsSkipped += 1;
            }
          }
        }

        // dex-trades: the endpoint has no address filter, so fetch one market-wide
        // page and keep only trades where the subject is the trader.
        if (!budgetLeft()) {
          stopReasons.push(`token dex-trades skipped for ${token}: credit budget reached`);
          continue;
        }
        const { data, meta } = await client.post<Paged<TgmDexTrade>>(EP.tgmDexTrades, {
          chain,
          token_address: token,
          date: { from: window.from, to: window.to },
          pagination: { page: 1, per_page: perPage },
        });
        const rows: Array<Record<string, unknown>> = Array.isArray(data?.data)
          ? (data.data as Array<Record<string, unknown>>)
          : [];
        accumulateSanitization(rows);
        recordCall(EP.tgmDexTrades, null, meta, rows.length);
        const src = sourceMeta('tgm/dex-trades', metaToFixture(meta), nowIso, null, 'live-nansen');
        for (const r of rows) {
          try {
            const s = normalizeSwap(r, src);
            if (s.value.traderAddress.toLowerCase() === subjectLc) swaps.push(s);
            else rowsSkipped += 1; // trade by another party (kept out of a subject-scoped case)
          } catch {
            rowsSkipped += 1;
          }
        }
      } catch (err) {
        // A credential / rate-limit failure is systemic — rethrow so it is not
        // silently masked and no further paid calls are attempted. Any other
        // upstream error (e.g. a 422 for a token the tgm endpoints don't support)
        // is specific to THIS token: note it and move on, preserving the core
        // reconstruction that was already paid for.
        if (err instanceof NansenApiError && (err.status === 401 || err.status === 403 || err.status === 429)) {
          throw err;
        }
        const detail = err instanceof NansenApiError ? `Nansen ${err.status}` : err instanceof Error ? err.message : String(err);
        stopReasons.push(`token ${token} enrichment skipped (${detail})`);
      }
    }
    if (tokensDiscovered.length === 0) {
      stopReasons.push('token activity requested but no tokens were discovered in the subject data');
    }
  }

  const input: EngineInput = { transfers, swaps, counterparties, relationships, transactions };

  // Coverage flags computed from what was actually observed — never asserted.
  const fundingEvidence = relationships.some((r) => /fund/i.test(r.value.relation));
  const counterpartyAggregates = counterparties.length > 0;
  const transactionWindowCovered = reachedLastPage;
  const coveredChunks = transactionChunks.filter((c) => c.reachedLastPage).length;
  const chunkNote = chunked ? ` across ${transactionChunks.length} sub-window(s)` : '';
  const coverage: CoverageReport = {
    flags: { fundingEvidence, counterpartyAggregates, transactionWindowCovered },
    reasons: [
      `flags.fundingEvidence: ${
        fundingEvidence
          ? `related-wallets returned a funding relation among ${relationships.length} row(s).`
          : `no funding relation observed among ${relationships.length} related-wallet row(s).`
      }`,
      `flags.counterpartyAggregates: ${
        counterpartyAggregates
          ? `${counterparties.length} window-level counterparty aggregate(s) observed.`
          : 'no counterparty aggregates observed for this window.'
      }`,
      `flags.transactionWindowCovered: ${
        transactionWindowCovered
          ? `pagination reached is_last_page${chunkNote} within budget (${pagesFetched} page(s), ${transactions.length} tx).`
          : chunked
            ? `${coveredChunks}/${ranges.length} sub-window(s) fully paginated (${pagesFetched} page(s), ${transactions.length} tx); resume from ${resumeWindow?.from ?? window.from}. The window is a partial sample and needs further capture.`
            : `pagination stopped before is_last_page (${pagesFetched}/${budget.maxPages} page(s)); the window is a partial sample and needs further capture.`
      }`,
    ],
  };

  const caseDesc = {
    id: liveCaseId(address, window.from),
    name: params.name ?? `Live reconstruction: ${address.slice(0, 10)}…`,
    headline:
      params.headline ??
      `Observed on-chain movements for ${address} over ${window.from} → ${window.to}, reconstructed live from Nansen. ` +
        (transactionWindowCovered
          ? 'Transaction window fully paginated.'
          : 'Partial transaction sample — see coverage.'),
    window: { from: window.from, to: window.to },
  };

  const result = reconstruct(input, { address, chain }, caseDesc, { reconstructedAt: nowIso });
  // Item #3, hybrid origin-proof: one receipt per recorded live HTTP response,
  // captured at the run clock (= reconstructedAt) so the attestation is
  // deterministic. Folded onto the contract before fingerprinting.
  const origin: OriginAttestation = {
    mode: 'live-http',
    capturedAt: nowIso,
    receipts: calls.map((c) => ({
      path: c.endpoint,
      status: c.status,
      requestId: c.requestId,
      creditsCost: c.creditsCost,
      creditsRemaining: c.creditsRemaining,
      responseSha256: c.responseSha256,
    })),
  };
  const contract = buildContract(result, { dataSource: 'live-nansen', coverage, inputs: input, origin });

  const meta: LiveRunMeta = {
    address,
    chain,
    window: { from: window.from, to: window.to },
    creditsSpent,
    creditsRemaining,
    calls,
    transactionPagesFetched: pagesFetched,
    reachedLastPage,
    transactionChunks,
    resumeWindow,
    sanitization,
    rowsSkipped,
    tokensDiscovered,
    tokenActivity: { transfers: transfers.length, swaps: swaps.length },
    stopReason: stopReasons.join('; ') || 'no calls made',
  };
  return { contract, meta };
}
