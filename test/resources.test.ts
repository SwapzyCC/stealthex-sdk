import { afterEach, describe, expect, it, vi } from "vitest";
import { StealthEXTimeoutError, isTerminalStatus, type Exchange } from "../src/index.js";
import { client, collect, exchange, json, mockFetch } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listAll", () => {
  it("walks pages until a short one", async () => {
    const page = (n: number, from: number) => json(Array.from({ length: n }, (_, i) => ({ symbol: `c${from + i}` })));
    const { fetch, calls } = mockFetch(page(2, 0), page(2, 2), page(1, 4));

    const symbols: string[] = [];
    for await (const currency of client(fetch).currencies.listAll({ network: "tron", pageSize: 2 })) {
      symbols.push(currency.symbol);
    }

    expect(symbols).toEqual(["c0", "c1", "c2", "c3", "c4"]);
    expect(calls.map((c) => Object.fromEntries(c.url.searchParams))).toEqual([
      { network: "tron", limit: "2", offset: "0" },
      { network: "tron", limit: "2", offset: "2" },
      { network: "tron", limit: "2", offset: "4" },
    ]);
  });

  it("makes one extra request when the last page is exactly full", async () => {
    const { fetch, calls } = mockFetch(json([exchange()]), json([]));
    const all = await collect(client(fetch).exchanges.listAll({ pageSize: 1, status: "finished" }));
    expect(all).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("status")).toBe("finished");
  });

  it("defaults to the maximum page size", async () => {
    const { fetch, calls } = mockFetch(json([]));
    await collect(client(fetch).currencies.listAll());
    expect(calls[0]!.url.searchParams.get("limit")).toBe("250");
  });

  it("rejects an impossible page size", async () => {
    const { fetch } = mockFetch();
    await expect(collect(client(fetch).currencies.listAll({ pageSize: 500 }))).rejects.toThrow(RangeError);
  });
});

describe("exchanges.waitFor", () => {
  it("polls until a terminal status and reports each change", async () => {
    const { fetch, calls } = mockFetch(
      json(exchange({ status: "waiting" })),
      json(exchange({ status: "waiting" })),
      json(exchange({ status: "exchanging" })),
      json(exchange({ status: "finished" })),
    );
    const seen: string[] = [];

    const done = await client(fetch).exchanges.waitFor("ex_1", {
      intervalMs: 1,
      onUpdate: (ex, previous) => seen.push(`${previous?.status ?? "-"}>${ex.status}`),
    });

    expect(done.status).toBe("finished");
    expect(calls).toHaveLength(4);
    expect(seen).toEqual(["->waiting", "waiting>exchanging", "exchanging>finished"]);
  });

  it("stops at any status in `until`", async () => {
    const { fetch } = mockFetch(json(exchange({ status: "waiting" })), json(exchange({ status: "confirming" })));
    const ex = await client(fetch).exchanges.waitFor("ex_1", { until: ["confirming"], intervalMs: 1 });
    expect(ex.status).toBe("confirming");
  });

  it("accepts a predicate", async () => {
    const { fetch } = mockFetch(
      json(exchange()),
      json(exchange({ deposit: { ...exchange().deposit, tx_hash: "0xdep" } })),
    );
    const ex = await client(fetch).exchanges.waitFor("ex_1", {
      until: (e: Exchange) => e.deposit.tx_hash !== null,
      intervalMs: 1,
    });
    expect(ex.deposit.tx_hash).toBe("0xdep");
  });

  it("gives up after timeoutMs", async () => {
    const waiting = () => json(exchange({ status: "waiting" }));
    const { fetch } = mockFetch(waiting(), waiting(), waiting(), waiting(), waiting(), waiting());
    await expect(
      client(fetch).exchanges.waitFor("ex_1", { intervalMs: 5, timeoutMs: 12 }),
    ).rejects.toBeInstanceOf(StealthEXTimeoutError);
  });

  it("stops when its signal aborts", async () => {
    const waiting = () => json(exchange({ status: "waiting" }));
    const { fetch } = mockFetch(waiting(), waiting());
    const controller = new AbortController();
    const pending = client(fetch).exchanges.waitFor("ex_1", { intervalMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stop")), 10);
    await expect(pending).rejects.toThrow("stop");
  });
});

describe("isTerminalStatus", () => {
  it("knows which statuses are final", () => {
    expect(["finished", "failed", "refunded", "expired"].every((s) => isTerminalStatus(s as never))).toBe(true);
    expect(["waiting", "confirming", "exchanging", "sending", "verifying"].some((s) => isTerminalStatus(s as never)))
      .toBe(false);
  });
});
