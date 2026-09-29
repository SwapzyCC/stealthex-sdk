import { StealthEX, type StealthEXOptions } from "../src/index.js";

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

type Reply = Response | Error | ((call: RecordedCall, signal: AbortSignal | undefined) => Response | Promise<Response>);

/** A `fetch` that answers from a queue and records every call. */
export function mockFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const queue = [...replies];

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const reply = queue.shift();
    if (reply === undefined) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") return reply(call, init.signal ?? undefined);
    return reply;
  };

  return { fetch: fetch as typeof globalThis.fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_test", ...headers },
  });
}

export function apiError(status: number, kind: string, details = "details", headers: Record<string, string> = {}) {
  return json({ err: { kind, details } }, status, headers);
}

export function client(fetch: typeof globalThis.fetch, options: StealthEXOptions = {}): StealthEX {
  return new StealthEX({ apiKey: "test_key", fetch, ...options });
}

export const BTC_TO_ETH = {
  from: { symbol: "btc", network: "mainnet" },
  to: { symbol: "eth", network: "mainnet" },
};

export function exchange(overrides: Record<string, unknown> = {}) {
  const leg = {
    symbol: "btc",
    network: "mainnet",
    amount: 0,
    expected_amount: 0.1,
    address: "deposit-address",
    extra_id: null,
    tx_hash: null,
    address_explorer_url: null,
    tx_explorer_url: null,
  };
  return {
    id: "ex_1",
    status: "waiting",
    rate: "floating",
    deposit: leg,
    withdrawal: { ...leg, symbol: "eth", expected_amount: 2, address: "withdrawal-address" },
    refund_address: null,
    refund_extra_id: null,
    created_at: "2026-01-01T00:00:00Z",
    finished_at: null,
    expires_at: null,
    ...overrides,
  };
}

/** Drains an async iterable. `Array.fromAsync`, without needing the ES2024+ lib. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
