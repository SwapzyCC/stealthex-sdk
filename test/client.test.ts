import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StealthEX,
  StealthEXAPIError,
  StealthEXAuthenticationError,
  StealthEXConnectionError,
  StealthEXError,
  StealthEXRateLimitError,
  StealthEXTimeoutError,
  VERSION,
} from "../src/index.js";
import { parseRetryAfter } from "../src/core.js";
import { BTC_TO_ETH, apiError, client, exchange, json, mockFetch } from "./helpers.js";

beforeEach(() => {
  // Full-jitter backoff times out at zero, so retries do not slow the suite.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("construction", () => {
  it("requires an API key", () => {
    vi.stubEnv("STEALTHEX_API_KEY", "");
    expect(() => new StealthEX()).toThrow(StealthEXError);
  });

  it("falls back to STEALTHEX_API_KEY", async () => {
    vi.stubEnv("STEALTHEX_API_KEY", "from_env");
    const { fetch, calls } = mockFetch(json(["mainnet"]));
    await new StealthEX({ fetch }).currencies.networks();
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer from_env");
  });

  it("refuses requireSignature without a secret", () => {
    expect(() => client(mockFetch().fetch, { requireSignature: true })).toThrow(/signingSecret/);
  });

  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe("requests", () => {
  it("sends the key as a bearer token, never in the URL", async () => {
    const { fetch, calls } = mockFetch(json(["mainnet", "tron"]));
    const networks = await client(fetch, { headers: { authorization: "Bearer hijack", "X-Extra": "1" } })
      .currencies.networks();

    expect(networks).toEqual(["mainnet", "tron"]);
    const call = calls[0]!;
    expect(call.url.toString()).toBe("https://api.stealthex.io/v4/currencies/networks");
    expect(call.headers.get("authorization")).toBe("Bearer test_key");
    expect(call.headers.get("x-extra")).toBe("1");
    expect(call.headers.get("user-agent")).toBe(`stealthex-sdk-js/${VERSION}`);
    expect(call.url.searchParams.has("api_key")).toBe(false);
  });

  it("honours a custom base URL", async () => {
    const { fetch, calls } = mockFetch(json([]));
    await client(fetch, { baseUrl: "https://proxy.example/stealthex/" }).currencies.networks();
    expect(calls[0]!.url.toString()).toBe("https://proxy.example/stealthex/v4/currencies/networks");
  });

  it("posts a range request and defaults estimation to direct", async () => {
    const { fetch, calls } = mockFetch(json({ min_amount: 0.001, max_amount: null }));
    const range = await client(fetch).rates.range({ route: BTC_TO_ETH, rate: "floating" });

    expect(range).toEqual({ min_amount: 0.001, max_amount: null });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/v4/rates/range");
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(calls[0]!.body).toEqual({ route: BTC_TO_ETH, rate: "floating", estimation: "direct" });
  });

  it("passes a reversed fixed estimate through", async () => {
    const { fetch, calls } = mockFetch(
      json({ estimated_amount: 0.05, rate: { id: "rate_1", valid_until: "2026-01-01T00:05:00Z" } }),
    );
    const estimate = await client(fetch).rates.estimate({
      route: BTC_TO_ETH,
      amount: 1,
      rate: "fixed",
      estimation: "reversed",
    });

    expect(estimate.rate?.id).toBe("rate_1");
    expect(calls[0]!.url.pathname).toBe("/v4/rates/estimated-amount");
    expect(calls[0]!.body).toMatchObject({ amount: 1, rate: "fixed", estimation: "reversed" });
  });

  it("serializes booleans, dates and status lists into the query", async () => {
    const { fetch, calls } = mockFetch(json([]), json([]));
    const sdk = client(fetch);

    await sdk.currencies.list({ include_available_routes: true, available_routes_direction: "deposit", limit: 10 });
    await sdk.exchanges.list({
      status: ["waiting", "finished"],
      created_after: new Date("2026-01-01T00:00:00Z"),
      withdrawal_address: undefined,
    });

    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      include_available_routes: "true",
      available_routes_direction: "deposit",
      limit: "10",
    });
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({
      status: "waiting,finished",
      created_after: "2026-01-01T00:00:00.000Z",
    });
  });

  it("encodes path segments", async () => {
    const { fetch, calls } = mockFetch(json({}), json(exchange()));
    await client(fetch).currencies.get("usdt", "bsc/bep20");
    await client(fetch).exchanges.get("a b");
    expect(calls[0]!.url.pathname).toBe("/v4/currencies/usdt/bsc%2Fbep20");
    expect(calls[1]!.url.pathname).toBe("/v4/exchanges/a%20b");
  });

  it("sets a transaction hash and resolves to undefined on 204", async () => {
    const { fetch, calls } = mockFetch(new Response(null, { status: 204 }));
    await expect(client(fetch).exchanges.setTransactionHash("ex_1", "0xabc")).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ tx_hash: "0xabc" });
  });
});

describe("errors", () => {
  it("maps an API error body onto StealthEXAPIError", async () => {
    const { fetch } = mockFetch(apiError(404, "NoPair", "no such pair"));
    const error = await client(fetch).rates.range({ route: BTC_TO_ETH, rate: "floating" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StealthEXAPIError);
    expect(error).toMatchObject({ status: 404, kind: "NoPair", details: "no such pair", requestId: "req_test" });
    expect((error as Error).message).toBe("StealthEX API 404: NoPair: no such pair (request id req_test)");
  });

  it("uses a dedicated class for 401", async () => {
    const { fetch } = mockFetch(apiError(401, "Auth", "API key is not provided"));
    await expect(client(fetch).currencies.networks()).rejects.toBeInstanceOf(StealthEXAuthenticationError);
  });

  it("keeps a body that is not JSON", async () => {
    const { fetch } = mockFetch(new Response("<html>Bad gateway</html>", { status: 400 }));
    const error = (await client(fetch).currencies.networks().catch((e: unknown) => e)) as StealthEXAPIError;
    expect(error.kind).toBeUndefined();
    expect(error.body).toBe("<html>Bad gateway</html>");
  });

  it("does not retry a 4xx", async () => {
    const { fetch, calls } = mockFetch(apiError(422, "MarketUnavailable"));
    await expect(client(fetch).rates.range({ route: BTC_TO_ETH, rate: "floating" })).rejects.toThrow(
      /MarketUnavailable/,
    );
    expect(calls).toHaveLength(1);
  });
});

describe("retries", () => {
  it("retries a 5xx on an idempotent call", async () => {
    const { fetch, calls } = mockFetch(new Response("oops", { status: 502 }), json(["mainnet"]));
    await expect(client(fetch).currencies.networks()).resolves.toEqual(["mainnet"]);
    expect(calls).toHaveLength(2);
  });

  it("retries a dropped connection, then gives up with StealthEXConnectionError", async () => {
    const { fetch, calls } = mockFetch(new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("x"));
    const error = await client(fetch).currencies.networks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StealthEXConnectionError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(3);
  });

  it("honours maxRetries per call", async () => {
    const { fetch, calls } = mockFetch(new Response("", { status: 503 }));
    await expect(client(fetch).currencies.networks({ maxRetries: 0 })).rejects.toBeInstanceOf(StealthEXAPIError);
    expect(calls).toHaveLength(1);
  });

  it("never retries creating an exchange after a 5xx or a dropped connection", async () => {
    const params = { route: BTC_TO_ETH, amount: 0.1, rate: "floating", address: "addr" } as const;

    const first = mockFetch(new Response("", { status: 500 }));
    await expect(client(first.fetch).exchanges.create(params)).rejects.toBeInstanceOf(StealthEXAPIError);
    expect(first.calls).toHaveLength(1);

    const second = mockFetch(new TypeError("fetch failed"));
    await expect(client(second.fetch).exchanges.create(params)).rejects.toBeInstanceOf(StealthEXConnectionError);
    expect(second.calls).toHaveLength(1);
  });

  it("retries creating an exchange after a 429, which was never processed", async () => {
    const { fetch, calls } = mockFetch(apiError(429, "TooManyRequests", "slow down", { "retry-after": "0" }), json(exchange(), 201));
    const created = await client(fetch).exchanges.create({
      route: BTC_TO_ETH,
      amount: 0.1,
      rate: "floating",
      address: "addr",
    });
    expect(created.id).toBe("ex_1");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toMatchObject({ estimation: "direct", address: "addr" });
  });

  it("throws StealthEXRateLimitError once retries run out", async () => {
    const limited = () => apiError(429, "TooManyRequests", "slow down", { "retry-after": "0" });
    const { fetch } = mockFetch(limited(), limited(), limited());
    const error = await client(fetch).currencies.networks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StealthEXRateLimitError);
    expect((error as StealthEXRateLimitError).retryAfterMs).toBe(0);
  });

  it("does not wait out a Retry-After longer than a minute", async () => {
    const { fetch, calls } = mockFetch(apiError(429, "TooManyRequests", "", { "retry-after": "3600" }));
    await expect(client(fetch).currencies.networks()).rejects.toBeInstanceOf(StealthEXRateLimitError);
    expect(calls).toHaveLength(1);
  });

  it("parses Retry-After as seconds or as an HTTP date", () => {
    const now = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(parseRetryAfter("2", now)).toBe(2000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:27:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe("timeouts and aborts", () => {
  /** A fetch that never answers until its signal aborts. */
  const hang = (_call: unknown, signal: AbortSignal | undefined) =>
    new Promise<Response>((_, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });

  it("times out each attempt", async () => {
    const { fetch, calls } = mockFetch(hang, hang);
    const error = await client(fetch, { timeoutMs: 20, maxRetries: 1 }).currencies.networks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StealthEXTimeoutError);
    expect(calls).toHaveLength(2);
  });

  it("rejects with the caller's abort reason and does not retry", async () => {
    const { fetch, calls } = mockFetch(hang);
    const controller = new AbortController();
    const pending = client(fetch).currencies.networks({ signal: controller.signal });
    controller.abort(new Error("user cancelled"));
    await expect(pending).rejects.toThrow("user cancelled");
    expect(calls).toHaveLength(1);
  });

  it("does not send anything with an already-aborted signal", async () => {
    const { fetch, calls } = mockFetch();
    await expect(client(fetch).currencies.networks({ signal: AbortSignal.abort() })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
