import type { RequestOptions, Transport } from "../core.js";
import type {
  AvailableRoute,
  AvailableRoutesParams,
  Currency,
  CurrencyRouteParams,
  ListCurrenciesParams,
} from "../types.js";
import { paginate } from "./pagination.js";

export interface ListAllCurrenciesParams extends Omit<ListCurrenciesParams, "limit" | "offset"> {
  /** Items per request, 1-250. Defaults to 250, the fewest requests. */
  pageSize?: number;
}

export class Currencies {
  constructor(private readonly transport: Transport) {}

  /**
   * One page of supported currencies. See `listAll()` to get every one.
   *
   * `GET /v4/currencies`
   *
   * @example
   * const page = await client.currencies.list({ network: "mainnet", limit: 100 });
   */
  list(params: ListCurrenciesParams = {}, options?: RequestOptions): Promise<Currency[]> {
    return this.transport.request<Currency[]>({
      method: "GET",
      path: "/v4/currencies",
      query: { ...params },
      idempotent: true,
      options,
    });
  }

  /**
   * Every supported currency, fetched page by page as you iterate.
   *
   * @example
   * for await (const currency of client.currencies.listAll({ rate: "fixed" })) {
   *   console.log(currency.symbol, currency.network);
   * }
   *
   * // Or collect them all (Node 22+):
   * const all = await Array.fromAsync(client.currencies.listAll());
   */
  listAll(params: ListAllCurrenciesParams = {}, options?: RequestOptions): AsyncGenerator<Currency, void, undefined> {
    const { pageSize, ...filters } = params;
    return paginate((limit, offset) => this.list({ ...filters, limit, offset }, options), pageSize);
  }

  /**
   * One currency on one network.
   *
   * `GET /v4/currencies/{symbol}/{network}`
   *
   * @throws {StealthEXAPIError} `NotFound` (404).
   *
   * @example
   * const eth = await client.currencies.get("eth", "mainnet");
   * const valid = new RegExp(eth.address_regex ?? ".*").test(address);
   */
  get(symbol: string, network: string, params: CurrencyRouteParams = {}, options?: RequestOptions): Promise<Currency> {
    return this.transport.request<Currency>({
      method: "GET",
      path: `/v4/currencies/${encodeURIComponent(symbol)}/${encodeURIComponent(network)}`,
      query: { ...params },
      idempotent: true,
      options,
    });
  }

  /**
   * Every network name the API knows, for the `network` of an `Asset`.
   *
   * `GET /v4/currencies/networks`
   */
  networks(options?: RequestOptions): Promise<string[]> {
    return this.transport.request<string[]>({
      method: "GET",
      path: "/v4/currencies/networks",
      idempotent: true,
      options,
    });
  }

  /**
   * Every swappable pair, with the rate types and features each supports.
   *
   * `GET /v4/currencies/available-routes`
   */
  availableRoutes(params: AvailableRoutesParams = {}, options?: RequestOptions): Promise<AvailableRoute[]> {
    return this.transport.request<AvailableRoute[]>({
      method: "GET",
      path: "/v4/currencies/available-routes",
      query: { ...params },
      idempotent: true,
      options,
    });
  }
}
