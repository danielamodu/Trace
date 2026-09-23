/**
 * Typed request/response boundaries for the Nansen API endpoints TRACE relies on.
 *
 * Source of truth: the OpenAPI 3.1 specs embedded in the official docs
 * (https://docs.nansen.ai/<path>.md). These types are intentionally partial —
 * they cover the fields TRACE reads, not every field the API can return.
 * Response objects therefore keep an index signature so unmodelled fields survive.
 *
 * Do not treat these as a guarantee of what the live API returns. They encode
 * the documented contract; runtime responses are validated by the recon runner.
 */

export type Chain =
  | 'ethereum' | 'solana' | 'bnb' | 'base' | 'arbitrum' | 'polygon'
  | 'optimism' | 'avalanche' | 'tron' | 'ton' | 'sei' | 'sonic'
  | 'linea' | 'mantle' | 'starknet' | 'sui' | 'near' | 'injective'
  | 'hyperevm' | 'monad' | string; // open set — see reference/chains

/** ISO 8601 date range. Most endpoints cap the span at one year. */
export interface DateRange {
  from: string; // "YYYY-MM-DD" or full ISO datetime
  to: string;
}

export interface PaginationRequest {
  page?: number;      // 1-based, default 1
  per_page?: number;  // max 1000, default 10
}

export interface PaginationInfo {
  page: number;
  per_page: number;
  is_last_page: boolean;
}

export interface SortOrder<F extends string = string> {
  field: F;
  direction: 'ASC' | 'DESC';
}

export interface NumericRange {
  min?: number;
  max?: number;
}

/** Envelope returned by every list endpoint. */
export interface Paged<T> {
  data: T[];
  pagination: PaginationInfo;
  warnings?: string[];
}

/** Metadata TRACE records for every call for reproducibility + credit tracking. */
export interface CallMeta {
  status: number;
  requestId: string | null;
  creditsCost: string | null;      // X-Nansen-Credits-Cost
  creditsUsed: string | null;      // X-Nansen-Credits-Used
  creditsRemaining: string | null; // X-Nansen-Credits-Remaining
  rateLimitRemaining: string | null;
  retryAfter: string | null;
}

/** Structured error body the API returns for 4xx/5xx (except 402). */
export interface NansenErrorBody {
  error: string;
  message: string;
  code: string;
  status: number;
  request_id?: string | null;
  doc_url?: string;
  param?: string;
  retry_after?: number;
  detail?: string;
  errors?: Array<{ field: string; message: string; code: string }>;
}

// --- POST /api/v1/tgm/transfers ------------------------------------------------
export interface TgmTransfersRequest {
  chain: Chain;
  token_address: string;
  date: DateRange;
  pagination?: PaginationRequest;
  filters?: {
    include_dex?: boolean;
    include_cex?: boolean;
    non_exchange_transfers?: boolean;
    only_smart_money?: boolean;
    from_address?: string | string[];
    to_address?: string | string[];
    transaction_hash?: string | string[];
    transfer_value_usd?: NumericRange;
  };
  order_by?: SortOrder[];
}
export interface TgmTransfer {
  block_timestamp: string;
  transaction_hash: string;
  from_address: string;
  to_address: string;
  from_address_label?: string;
  to_address_label?: string;
  transaction_type?: string;
  transfer_amount?: number;
  transfer_value_usd?: number;
  [k: string]: unknown;
}

// --- POST /api/v1/tgm/dex-trades ----------------------------------------------
export interface TgmDexTradesRequest {
  chain: Chain;
  token_address: string;
  date: DateRange;
  only_smart_money?: boolean;
  pagination?: PaginationRequest;
  filters?: { action?: 'BUY' | 'SELL'; estimated_value_usd?: NumericRange };
  order_by?: SortOrder[];
}
export interface TgmDexTrade {
  block_timestamp: string;
  transaction_hash: string;
  trader_address: string;
  trader_address_label?: string;
  action: 'BUY' | 'SELL';
  token_address: string;
  token_name: string;
  token_amount: number;
  traded_token_amount: number;
  estimated_swap_price_usd: number;
  estimated_value_usd: number;
  [k: string]: unknown;
}

// --- POST /api/v1/tgm/who-bought-sold -----------------------------------------
export interface TgmWhoBoughtSoldRequest {
  chain: Chain;
  token_address: string;
  buy_or_sell?: 'BUY' | 'SELL';
  date: DateRange;
  pagination?: PaginationRequest;
}
export interface TgmWhoBoughtSold {
  address: string;
  address_label?: string;
  bought_volume_usd?: number;
  sold_volume_usd?: number;
  trade_volume_usd?: number;
  [k: string]: unknown;
}

// --- POST /api/v1/tgm/flows ----------------------------------------------------
export interface TgmFlowsRequest {
  chain: Chain;
  token_address: string;
  date: DateRange;
  label?: 'whale' | 'public_figure' | 'smart_money' | 'top_100_holders' | 'exchange';
  pagination?: PaginationRequest;
}
export interface TgmFlowBucket {
  date: string;
  bucket_end?: string;
  is_complete?: boolean;
  price_usd?: number;
  value_usd?: number;
  total_inflows_dex?: number;
  total_outflows_dex?: number;
  total_inflows_cex?: number;
  total_outflows_cex?: number;
  [k: string]: unknown;
}

// --- POST /api/v1/tgm/holders --------------------------------------------------
export interface TgmHoldersRequest {
  chain: Chain;
  token_address: string;
  aggregate_by_entity?: boolean;
  label_type?: 'whale' | 'public_figure' | 'smart_money' | 'all_holders' | 'exchange';
  pagination?: PaginationRequest;
  premium_labels?: boolean; // costs 150 credits when true
}
export interface TgmHolder {
  address?: string;
  address_label?: string;
  token_amount?: number;
  ownership_percentage?: number;
  value_usd?: number;
  balance_change_24h?: number;
  balance_change_7d?: number;
  [k: string]: unknown;
}

// --- POST /api/v1/smart-money/netflow -----------------------------------------
export interface SmartMoneyNetflowRequest {
  chains: Chain[];
  filters?: { token_address?: string | string[]; include_stablecoins?: boolean };
  pagination?: PaginationRequest;
  order_by?: SortOrder[];
}
export interface SmartMoneyNetflow {
  token_address: string;
  token_symbol: string;
  net_flow_1h_usd: number;
  net_flow_24h_usd: number;
  net_flow_7d_usd: number;
  net_flow_30d_usd: number;
  chain: string;
  trader_count: number;
  [k: string]: unknown;
}

// --- POST /api/v1/profiler/address/counterparties -----------------------------
export interface AddressCounterpartiesRequest {
  address?: string;
  entity_name?: string;
  chain: Chain | 'all';
  date: DateRange;
  source_input?: 'Combined' | 'Tokens' | 'ETH';
  group_by?: 'wallet' | 'entity';
  pagination?: PaginationRequest;
}
export interface AddressCounterparty {
  counterparty_address: string;
  counterparty_address_label?: string[];
  interaction_count: number;
  total_volume_usd?: number;
  volume_in_usd?: number;
  volume_out_usd?: number;
  [k: string]: unknown;
}

// --- POST /api/v1/profiler/address/related-wallets ----------------------------
export interface AddressRelatedWalletsRequest {
  address: string;
  chain: Chain;
  pagination?: PaginationRequest;
}
export interface AddressRelatedWallet {
  address: string;
  address_label?: string;
  relation: string;
  transaction_hash: string;
  block_timestamp: string;
  order: number;
  chain: string;
  [k: string]: unknown;
}

// --- POST /api/v1/profiler/address/labels -------------------------------------
export interface AddressLabelsRequest {
  address: string;
  chain: Chain | 'all';
  pagination?: PaginationRequest;
}
export interface AddressLabel {
  label: string;
  category?: string;
  kind?: string[];
  [k: string]: unknown;
}

// --- POST /api/v1/profiler/address/transactions -------------------------------
export interface AddressTransactionsRequest {
  address: string;
  chain: Chain | 'all';
  date: DateRange;
  hide_spam_token?: boolean;
  pagination?: PaginationRequest;
  order_by?: SortOrder[];
}
export interface AddressTransaction {
  chain: string;
  method: string;
  volume_usd?: number;
  block_timestamp: string;
  transaction_hash: string;
  source_type: string;
  tokens_sent?: Array<Record<string, unknown>>;
  tokens_received?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}
