import type { RequestOptions, Transport } from "../core.js";
import type { Estimate, EstimateParams, Range, RangeParams } from "../types.js";

export class Rates {
  constructor(private readonly transport: Transport) {}

  /**
   * The minimum and maximum amount a route accepts.
   *
   * `POST /v4/rates/range`
   *
   * @throws {StealthEXAPIError} `NoPair` (404) for an unknown pair; `NotAllowed`,
   * `NoExchangeRoute`, `RouteIsDisabled` or `MarketUnavailable` (422).
   *
   * @example
   * const { min_amount, max_amount } = await client.rates.range({
   *   route: { from: { symbol: "btc", network: "mainnet" }, to: { symbol: "eth", network: "mainnet" } },
   *   rate: "floating",
   * });
   */
  range(params: RangeParams, options?: RequestOptions): Promise<Range> {
    return this.transport.request<Range>({
      method: "POST",
      path: "/v4/rates/range",
      body: { ...params, estimation: params.estimation ?? "direct" },
      idempotent: true,
      options,
    });
  }

  /**
   * How much the other side of a swap comes to. A fixed-rate estimate also
   * returns `rate.id`, which `exchanges.create()` needs, and when it expires.
   *
   * `POST /v4/rates/estimated-amount`
   *
   * @throws {StealthEXAPIError} `InvalidAmount` (400), `NoPair` (404), or a 422
   * as for `range()`.
   *
   * @example
   * const { estimated_amount } = await client.rates.estimate({
   *   route: { from: { symbol: "btc", network: "mainnet" }, to: { symbol: "eth", network: "mainnet" } },
   *   amount: 0.1,
   *   rate: "floating",
   * });
   */
  estimate(params: EstimateParams, options?: RequestOptions): Promise<Estimate> {
    return this.transport.request<Estimate>({
      method: "POST",
      path: "/v4/rates/estimated-amount",
      body: { ...params, estimation: params.estimation ?? "direct" },
      idempotent: true,
      options,
    });
  }
}
