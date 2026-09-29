import { sleep, type RequestOptions, type Transport } from "../core.js";
import { StealthEXTimeoutError } from "../errors.js";
import type { CreateExchangeParams, Exchange, ExchangeStatus, ListExchangesParams } from "../types.js";
import { paginate } from "./pagination.js";

/** Statuses an exchange never leaves. */
export const TERMINAL_STATUSES: readonly ExchangeStatus[] = ["finished", "failed", "refunded", "expired"];

/** Whether an exchange in this status is done for good. */
export function isTerminalStatus(status: ExchangeStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface ListAllExchangesParams extends Omit<ListExchangesParams, "limit" | "offset"> {
  /** Items per request, 1-250. Defaults to 250, the fewest requests. */
  pageSize?: number;
}

export interface WaitForOptions {
  /**
   * When to stop: a list of statuses, or a test of the whole exchange.
   * Defaults to `TERMINAL_STATUSES`.
   */
  until?: readonly ExchangeStatus[] | ((exchange: Exchange) => boolean);
  /** Between polls, in milliseconds. Defaults to 15 000. Keep it well clear of the 600/minute rate limit. */
  intervalMs?: number;
  /** Give up after this long, in milliseconds, with a `StealthEXTimeoutError`. Defaults to no limit. */
  timeoutMs?: number;
  /** Stops waiting; rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Called with the first poll, and again whenever the status changes. */
  onUpdate?: (exchange: Exchange, previous: Exchange | undefined) => void;
}

export class Exchanges {
  constructor(private readonly transport: Transport) {}

  /**
   * Starts a swap. The response's `deposit.address` (and `deposit.extra_id`,
   * when set) is where the user sends `deposit.expected_amount`.
   *
   * A fixed rate needs the `rate.id` from a fixed-rate `rates.estimate()`,
   * used before it expires.
   *
   * `POST /v4/exchanges`
   *
   * Only a 429 is retried here. A timeout or 5xx could come after the
   * exchange was created, and a blind retry would create a second one: list
   * recent exchanges by `withdrawal_address` to find out instead.
   *
   * @throws {StealthEXAPIError} `RateId`, `ExtraId`, `InvalidData`,
   * `InvalidAmount`, `NoUserApiKey` or `RoutesMismatch` (400); `NoPair` (404);
   * or a 422 as for `rates.range()`.
   *
   * @example
   * const exchange = await client.exchanges.create({
   *   route: { from: { symbol: "btc", network: "mainnet" }, to: { symbol: "eth", network: "mainnet" } },
   *   amount: 0.1,
   *   rate: "floating",
   *   address: recipientEthAddress,
   *   refund_address: refundBtcAddress,
   * });
   */
  create(params: CreateExchangeParams, options?: RequestOptions): Promise<Exchange> {
    return this.transport.request<Exchange>({
      method: "POST",
      path: "/v4/exchanges",
      body: { ...params, estimation: params.estimation ?? "direct" },
      idempotent: false,
      options,
    });
  }

  /**
   * One exchange, with its current status.
   *
   * `GET /v4/exchanges/{id}`
   *
   * @throws {StealthEXAPIError} `NotFound` (404).
   */
  get(id: string, options?: RequestOptions): Promise<Exchange> {
    return this.transport.request<Exchange>({
      method: "GET",
      path: `/v4/exchanges/${encodeURIComponent(id)}`,
      idempotent: true,
      options,
    });
  }

  /**
   * One page of your exchanges. See `listAll()` to walk them all.
   *
   * `GET /v4/exchanges`
   *
   * @example
   * const stuck = await client.exchanges.list({ status: ["waiting", "confirming"] });
   */
  list(params: ListExchangesParams = {}, options?: RequestOptions): Promise<Exchange[]> {
    return this.transport.request<Exchange[]>({
      method: "GET",
      path: "/v4/exchanges",
      query: { ...params },
      idempotent: true,
      options,
    });
  }

  /**
   * Every exchange matching the filters, fetched page by page as you iterate.
   *
   * @example
   * for await (const exchange of client.exchanges.listAll({ status: "finished" })) {
   *   total += exchange.withdrawal.amount;
   * }
   */
  listAll(params: ListAllExchangesParams = {}, options?: RequestOptions): AsyncGenerator<Exchange, void, undefined> {
    const { pageSize, ...filters } = params;
    return paginate((limit, offset) => this.list({ ...filters, limit, offset }, options), pageSize);
  }

  /**
   * Attaches the user's deposit transaction hash, so the exchange can be
   * matched to the deposit before it is detected on chain.
   *
   * `PATCH /v4/exchanges/{id}`
   *
   * @throws {StealthEXAPIError} `NotFound` (404).
   */
  async setTransactionHash(id: string, txHash: string, options?: RequestOptions): Promise<void> {
    await this.transport.request<void>({
      method: "PATCH",
      path: `/v4/exchanges/${encodeURIComponent(id)}`,
      body: { tx_hash: txHash },
      idempotent: true,
      options,
    });
  }

  /**
   * Polls an exchange until it reaches a terminal status (or whatever `until`
   * says), and returns it.
   *
   * Reaching `failed`, `refunded` or `expired` is not an error: check
   * `status` on the result.
   *
   * @throws {StealthEXTimeoutError} when `timeoutMs` passes first.
   *
   * @example
   * const done = await client.exchanges.waitFor(exchange.id, {
   *   onUpdate: (ex) => console.log(ex.status),
   *   timeoutMs: 2 * 60 * 60 * 1000,
   * });
   * if (done.status === "finished") console.log("sent", done.withdrawal.tx_hash);
   */
  async waitFor(id: string, options: WaitForOptions = {}): Promise<Exchange> {
    const { until = TERMINAL_STATUSES, intervalMs = 15_000, timeoutMs, signal, onUpdate } = options;
    const done = typeof until === "function" ? until : (exchange: Exchange) => until.includes(exchange.status);
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;

    let previous: Exchange | undefined;
    for (;;) {
      const exchange = await this.get(id, { signal });
      if (previous === undefined || previous.status !== exchange.status) onUpdate?.(exchange, previous);
      if (done(exchange)) return exchange;
      previous = exchange;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new StealthEXTimeoutError(
          `Exchange ${id} was still ${exchange.status} after ${timeoutMs} ms of waiting`,
        );
      }
      await sleep(Math.min(intervalMs, remaining), signal);
    }
  }
}
