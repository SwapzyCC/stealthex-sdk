/**
 * Request and response shapes of the StealthEX API v4.
 *
 * Field names are snake_case on purpose: they are exactly what goes over the
 * wire, so the API documentation, these types and your logs all read the same.
 */

/** How the rate is set. A fixed rate is locked for a while; a floating rate follows the market. */
export type RateType = "floating" | "fixed";

/**
 * Which side of the trade `amount` refers to.
 *
 * - `direct`: `amount` is what the user sends; the API estimates what they get.
 * - `reversed`: `amount` is what the user must receive; the API estimates what
 *   they have to send. Only available with a fixed rate.
 */
export type Estimation = "direct" | "reversed";

/** Optional capabilities of a currency or route. `custom_fee` means `additional_fee_percent` is accepted. */
export type Feature = "custom_fee";

/** Which side of a route a currency is on. */
export type RouteDirection = "deposit" | "withdrawal";

/** Every state an exchange can be in. */
export type ExchangeStatus =
  | "waiting"
  | "confirming"
  | "exchanging"
  | "sending"
  | "verifying"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

/**
 * A currency on a specific network.
 *
 * Use `"mainnet"` as the network for a chain's base currency (BTC on Bitcoin,
 * ETH on Ethereum, ...). Everything else names its network, such as
 * `{ symbol: "usdt", network: "<network>" }`: `currencies.networks()` lists
 * the names, and `currencies.list()` shows which network each token is on.
 */
export interface Asset {
  symbol: string;
  network: string;
}

/** What the user sends (`from`) and what they receive (`to`). */
export interface Route {
  from: Asset;
  to: Asset;
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

interface FloatingQuote {
  route: Route;
  rate: "floating";
  /** Floating rates only support `direct`. Defaults to `direct`. */
  estimation?: "direct";
  /**
   * Your partner fee in percent (0-20), on top of the standard 0.4%.
   * For a 1% total profit, pass `0.6`. Floating rate only.
   */
  additional_fee_percent?: number;
}

interface FixedQuote {
  route: Route;
  rate: "fixed";
  /** Defaults to `direct`. */
  estimation?: Estimation;
}

/** Body of `rates.range()`. */
export type RangeParams = FloatingQuote | FixedQuote;

/** Body of `rates.estimate()`. */
export type EstimateParams = (FloatingQuote | FixedQuote) & {
  /** Must be greater than zero. Which side it refers to depends on `estimation`. */
  amount: number;
};

/** The amounts a route accepts. */
export interface Range {
  min_amount: number;
  /** `null` means there is no upper limit. */
  max_amount: number | null;
}

/** A locked fixed rate, to pass to `exchanges.create()` as `rate_id` before it expires. */
export interface FixedRate {
  id: string;
  /** ISO 8601 timestamp. */
  valid_until: string;
}

/** The result of `rates.estimate()`. */
export interface Estimate {
  /**
   * With `direct` estimation, what the user receives. With `reversed`, what
   * they must send.
   */
  estimated_amount: number;
  /** Present for fixed-rate estimates. */
  rate?: FixedRate;
}

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

/** A currency this one can be swapped with. */
export interface CurrencyRoute {
  symbol: string;
  network: string;
  rates: RateType[];
  features: Feature[];
}

export interface Currency {
  symbol: string;
  network: string;
  /** The ticker used by API versions before v4. */
  legacy_symbol: string;
  name: string;
  rates: RateType[];
  features: Feature[];
  icon_url: string;
  /** Decimal places supported, or `null` when unspecified. */
  precision: number | null;
  /** The name of the extra ID (Memo, Destination Tag, ...), or `null` if the currency has none. */
  extra_id: string | null;
  /** Validates an address of this currency. A string, to pass to `new RegExp()`. */
  address_regex: string | null;
  /** Validates an extra ID of this currency. */
  extra_id_regex: string | null;
  contract_address: string | null;
  /** Human-readable warnings to show before a deposit or a withdrawal. */
  warnings: {
    deposit: string[];
    withdrawal: string[];
  };
  /** Only present when requested with `include_available_routes: true`. */
  available_routes?: CurrencyRoute[];
}

/** One swappable pair. */
export interface AvailableRoute {
  from: Asset;
  to: Asset;
  rates: RateType[];
  features: Feature[];
}

export interface PageParams {
  /** 1-250. The API default is 50. */
  limit?: number;
  /** The API default is 0. */
  offset?: number;
}

export interface CurrencyRouteParams {
  /** Attach each currency's `available_routes`. */
  include_available_routes?: boolean;
  /** Which side of the attached routes this currency is on. The API default is `withdrawal`. */
  available_routes_direction?: RouteDirection;
}

export interface ListCurrenciesParams extends PageParams, CurrencyRouteParams {
  /** Only currencies on this network. */
  network?: string;
  /** Only currencies that support this rate type. */
  rate?: RateType;
  /** Only currencies that support this feature. */
  feature?: Feature;
}

export interface AvailableRoutesParams {
  /** The API default is `withdrawal`. */
  direction?: RouteDirection;
}

// ---------------------------------------------------------------------------
// Exchanges
// ---------------------------------------------------------------------------

/** One side of an exchange: what the user sends (`deposit`) or receives (`withdrawal`). */
export interface ExchangeLeg {
  symbol: string;
  network: string;
  /** What actually arrived (deposit) or was sent (withdrawal). */
  amount: number;
  /** What is expected to arrive or be sent. */
  expected_amount: number;
  /** Deposit: where the user sends funds. Withdrawal: the recipient. */
  address: string;
  extra_id: string | null;
  tx_hash: string | null;
  address_explorer_url: string | null;
  tx_explorer_url: string | null;
}

export interface Exchange {
  id: string;
  status: ExchangeStatus;
  rate: RateType;
  deposit: ExchangeLeg;
  withdrawal: ExchangeLeg;
  refund_address: string | null;
  refund_extra_id: string | null;
  /** ISO 8601 timestamp. */
  created_at: string;
  /** ISO 8601 timestamp, or `null` while the exchange is running. */
  finished_at: string | null;
  /** ISO 8601 timestamp when a fixed-rate exchange expires; `null` for floating. */
  expires_at: string | null;
}

interface CreateExchangeBase {
  route: Route;
  /** Must be greater than zero. Which side it refers to depends on `estimation`. */
  amount: number;
  /** The recipient's address, on the `to` network. */
  address: string;
  /** The recipient's Memo / Destination Tag, if the `to` currency uses one. */
  extra_id?: string;
  /** Where funds go if the exchange fails, on the `from` network. Strongly recommended. */
  refund_address?: string;
  /** Memo / Destination Tag for the refund address. */
  refund_extra_id?: string;
}

export interface CreateFloatingExchangeParams extends CreateExchangeBase {
  rate: "floating";
  /** Defaults to `direct`. */
  estimation?: "direct";
  /** Your partner fee in percent (0-20), on top of the standard 0.4%. */
  additional_fee_percent?: number;
}

export interface CreateFixedExchangeParams extends CreateExchangeBase {
  rate: "fixed";
  /** Defaults to `direct`. */
  estimation?: Estimation;
  /** `rate.id` from a fixed-rate `rates.estimate()`, before its `valid_until`. */
  rate_id: string;
}

/** Body of `exchanges.create()`. A fixed rate requires the `rate_id` of an estimate. */
export type CreateExchangeParams = CreateFloatingExchangeParams | CreateFixedExchangeParams;

export interface ListExchangesParams extends PageParams {
  /** Only exchanges created before this time. A `Date` or an RFC 3339 string. */
  created_before?: Date | string;
  /** Only exchanges created after this time. A `Date` or an RFC 3339 string. */
  created_after?: Date | string;
  deposit_address?: string;
  withdrawal_address?: string;
  /** One status or several. */
  status?: ExchangeStatus | ExchangeStatus[];
}
