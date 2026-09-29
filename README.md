<h1 align="center">stealthex-sdk</h1>

<p align="center">
  <b>An unofficial, fully typed TypeScript client for the <a href="https://stealthex.io">StealthEX</a> exchange API v4.</b><br>
  Zero dependencies · ESM · Node 22+, Bun, Deno and Cloudflare Workers
</p>

<p align="center">
  <a href="https://github.com/SwapzyCC/stealthex-sdk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/SwapzyCC/stealthex-sdk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg">
  <img alt="Dependencies: 0" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg">
</p>

> [!NOTE]
> This is a community project maintained by [Swapzy](https://swapzy.cc). It is **not affiliated with, endorsed by or supported by StealthEX**. "StealthEX" is a trademark of its owner. For API keys, account questions and the authoritative API reference, go to [stealthex.io](https://stealthex.io).

```ts
import { StealthEX } from "@swapzy/stealthex-sdk";

const stealthex = new StealthEX({ apiKey: process.env.STEALTHEX_API_KEY });

const { estimated_amount } = await stealthex.rates.estimate({
  route: { from: { symbol: "btc", network: "mainnet" }, to: { symbol: "eth", network: "mainnet" } },
  amount: 0.1,
  rate: "floating",
});
```

## Contents

- [Why this SDK](#why-this-sdk)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Recipes](#recipes)
- [Error handling](#error-handling)
- [Retries, timeouts and cancellation](#retries-timeouts-and-cancellation)
- [Response signatures](#response-signatures)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Runtime support](#runtime-support)
- [Security](#security)
- [Using with AI assistants](#using-with-ai-assistants)
- [Development](#development)
- [License](#license)

## Why this SDK

- **Every endpoint of API v4**: rates, currencies, routes and exchanges, one method each.
- **Types that follow the wire format.** Field names are the API's own snake_case, so the StealthEX docs, your code and your logs all match. Invalid combinations don't compile: a fixed-rate exchange without a `rate_id`, or a reversed estimate on a floating rate.
- **Safe retries.** Rate limits (`429` + `Retry-After`), `5xx` responses and dropped connections are retried with backoff. Creating an exchange is never blindly retried, so a flaky network cannot create a swap twice.
- **Typed errors** with the API's `kind`, `details` and `Request-Id`.
- **Pagination as iteration**: `for await (const c of stealthex.currencies.listAll())`.
- **Status tracking**: `exchanges.waitFor(id)` polls until the swap is done.
- **Signature verification** of the optional `Sx-Signature` header, in constant time, with support for secret rotation.
- **Zero runtime dependencies.** Only `fetch` and Web Crypto, so it runs anywhere they do.

## Installation

The package is installed straight from GitHub; the build runs on install.

```sh
npm install github:SwapzyCC/stealthex-sdk
# or
pnpm add github:SwapzyCC/stealthex-sdk
yarn add github:SwapzyCC/stealthex-sdk
bun add github:SwapzyCC/stealthex-sdk
```

Pin a release with a tag, e.g. `github:SwapzyCC/stealthex-sdk#v0.1.0`.

You need a StealthEX API key: register at [stealthex.io/pp](https://stealthex.io/pp/).

## Quick start

```ts
import { StealthEX } from "@swapzy/stealthex-sdk";

// Reads STEALTHEX_API_KEY from the environment when apiKey is omitted.
const stealthex = new StealthEX();

const route = {
  from: { symbol: "btc", network: "mainnet" },
  to: { symbol: "eth", network: "mainnet" },
};

// 1. What amounts does the route accept?
const { min_amount, max_amount } = await stealthex.rates.range({ route, rate: "floating" });

// 2. What would 0.1 BTC get?
const { estimated_amount } = await stealthex.rates.estimate({ route, amount: 0.1, rate: "floating" });

// 3. Create the exchange.
const exchange = await stealthex.exchanges.create({
  route,
  amount: 0.1,
  rate: "floating",
  address: "<recipient ETH address>",
  refund_address: "<refund BTC address>",
});

console.log(`Send ${exchange.deposit.expected_amount} BTC to ${exchange.deposit.address}`);

// 4. Follow it to the end.
const done = await stealthex.exchanges.waitFor(exchange.id, {
  onUpdate: (ex) => console.log(ex.status),
});
```

Runnable versions are in [`examples/`](./examples).

## Core concepts

**Assets are a symbol on a network.** Use `"mainnet"` as the network for a chain's base currency (BTC, ETH, SOL, ...). Tokens name their own network. `currencies.networks()` lists every network name, and `currencies.list()` shows which network each token is on. Symbols are lowercase, as in the API's own examples (`"btc"`, `"eth"`).

**Two kinds of rate.**

| | `floating` | `fixed` |
|---|---|---|
| Rate | Follows the market | Locked when you estimate |
| `rate_id` on create | Not used | **Required**: `rate.id` from a fixed-rate `estimate()` |
| Expires | No (`expires_at` is `null`) | Yes: `expires_at` |
| `estimation: "reversed"` | No | Yes |
| Custom partner fee | Yes | No |

**Two directions of estimation.** `direct` (the default here) means `amount` is what the user *sends*. `reversed` means `amount` is what the recipient must *receive*, and the API works out what to send. Reversed estimation is fixed-rate only.

**Exchange lifecycle.** `waiting` → `confirming` → `exchanging` → `sending` → `verifying` → `finished`. It can also end as `failed`, `refunded` or `expired`. Those four are terminal (`TERMINAL_STATUSES`).

**Amounts are JavaScript numbers**, because the API sends them as JSON numbers. Format them for display with the currency's `precision`, and don't do money arithmetic on them without a decimal library.

## Recipes

### Pay an exact amount (fixed rate, reversed)

```ts
const route = { from: { symbol: "btc", network: "mainnet" }, to: { symbol: "eth", network: "mainnet" } };

// The recipient must get exactly 1 ETH.
const estimate = await stealthex.rates.estimate({ route, amount: 1, rate: "fixed", estimation: "reversed" });
// estimate.estimated_amount is the BTC to send; estimate.rate.valid_until is the deadline.

const exchange = await stealthex.exchanges.create({
  route,
  amount: 1,
  rate: "fixed",
  estimation: "reversed",
  rate_id: estimate.rate!.id,
  address: "<recipient ETH address>",
  refund_address: "<refund BTC address>",
});
```

### Earn a partner fee

StealthEX pays partners 0.4% of each exchange by default. `additional_fee_percent` (0 to 20) adds your own fee on top. For 1% in total, pass `0.6`. Floating rate only, and only on currencies whose `features` include `"custom_fee"`.

```ts
await stealthex.rates.estimate({ route, amount: 0.1, rate: "floating", additional_fee_percent: 0.6 });
await stealthex.exchanges.create({ route, amount: 0.1, rate: "floating", additional_fee_percent: 0.6, address });
```

Pass the same fee to `estimate()` and `create()`, so the user sees what they will actually get.

### Validate an address before creating an exchange

```ts
const currency = await stealthex.currencies.get("eth", "mainnet");

if (currency.address_regex && !new RegExp(currency.address_regex).test(address)) {
  throw new Error(`Not a valid ${currency.name} address`);
}
if (currency.extra_id) {
  // This currency needs a memo / destination tag, named currency.extra_id.
}
for (const warning of currency.warnings.withdrawal) showToUser(warning);
```

### List every currency

`listAll()` fetches pages of 250 lazily as you iterate:

```ts
for await (const currency of stealthex.currencies.listAll({ rate: "fixed" })) {
  console.log(currency.symbol, currency.network);
}

// Or collect them (Node 22+):
const all = await Array.fromAsync(stealthex.currencies.listAll());
```

`list()` returns one page when you want to control `limit` and `offset` yourself.

### Find what a currency can be swapped to

```ts
const btc = await stealthex.currencies.get("btc", "mainnet", { include_available_routes: true });
btc.available_routes; // [{ symbol, network, rates, features }, ...]

// Or every pair at once:
const routes = await stealthex.currencies.availableRoutes({ direction: "deposit" });
```

### Track an exchange

```ts
const done = await stealthex.exchanges.waitFor(id, {
  intervalMs: 30_000,              // between polls (default 15 s)
  timeoutMs: 6 * 60 * 60 * 1000,   // give up after 6 h (default: never)
  onUpdate: (ex, previous) => notify(ex.status),
});

if (done.status !== "finished") {
  // failed, refunded or expired: not an exception, check and handle it
}
```

Stop at an intermediate status with `until: ["exchanging"]`, or pass a predicate: `until: (ex) => ex.deposit.tx_hash !== null`.

### Attach the user's deposit transaction

```ts
await stealthex.exchanges.setTransactionHash(exchange.id, "<deposit tx hash>");
```

### Search your exchanges

```ts
const active = await stealthex.exchanges.list({
  status: ["waiting", "confirming", "exchanging"],
  created_after: new Date(Date.now() - 24 * 60 * 60 * 1000),
});

for await (const ex of stealthex.exchanges.listAll({ withdrawal_address: address })) {
  // ...
}
```

## Error handling

Everything the SDK throws extends `StealthEXError`. The one exception is aborting through your own `AbortSignal`, which rejects with the signal's reason, as `fetch` does.

| Class | When | Useful fields |
|---|---|---|
| `StealthEXAPIError` | Any non-2xx response | `status`, `kind`, `details`, `requestId`, `body` |
| ↳ `StealthEXAuthenticationError` | 401 / 403: bad or missing API key | same |
| ↳ `StealthEXRateLimitError` | 429 after all retries | `retryAfterMs` |
| `StealthEXTimeoutError` | An attempt exceeded `timeoutMs`, or `waitFor` exceeded its `timeoutMs` | |
| `StealthEXConnectionError` | No HTTP response (DNS, TLS, reset) | `cause` |
| `StealthEXSignatureError` | A response failed `Sx-Signature` verification | `requestId` |

```ts
import { StealthEXAPIError } from "@swapzy/stealthex-sdk";

try {
  await stealthex.exchanges.create(params);
} catch (error) {
  if (error instanceof StealthEXAPIError) {
    switch (error.kind) {
      case "InvalidAmount":   /* outside rates.range() */ break;
      case "RateId":          /* fixed rate expired: estimate again */ break;
      case "ExtraId":         /* missing or bad memo / destination tag */ break;
      case "NoPair":          /* unknown pair */ break;
      case "MarketUnavailable":
      case "RouteIsDisabled": /* try again later or another route */ break;
    }
    console.error(error.message); // "StealthEX API 400: RateId: ... (request id ...)"
  }
  throw error;
}
```

`kind` is typed with every value the API documents (`Auth`, `InvalidAmount`, `RateId`, `ExtraId`, `InvalidData`, `NoUserApiKey`, `RoutesMismatch`, `NoPair`, `NotFound`, `NotAllowed`, `NoExchangeRoute`, `RouteIsDisabled`, `MarketUnavailable`) and still accepts any other string. Quote `requestId` when you contact StealthEX support.

## Retries, timeouts and cancellation

By default each attempt times out after 30 seconds and a request is retried up to 2 times.

| Failure | Retried? |
|---|---|
| `429 Too Many Requests` | Yes, for every call. It waits for `Retry-After` when that is at most 60 s, and gives up otherwise. |
| `5xx`, `408`, timeout, dropped connection | Yes, except `exchanges.create()` |
| Other `4xx` | No |
| `exchanges.create()` after a `5xx`, timeout or dropped connection | **No.** The exchange may already exist. List recent exchanges by `withdrawal_address` before trying again. |

Backoff is exponential with full jitter (up to 0.5 s, 1 s, 2 s, ..., capped at 8 s).

Every method takes an optional last argument that overrides the client for that call:

```ts
const controller = new AbortController();

await stealthex.currencies.list(
  { limit: 250 },
  { timeoutMs: 5_000, maxRetries: 0, signal: controller.signal, headers: { "X-Trace-Id": traceId } },
);
```

The API allows 600 requests a minute. Share one client across your app, and keep `waitFor` intervals sensible when you track many exchanges.

## Response signatures

StealthEX can sign responses with an `Sx-Signature` header, an HMAC-SHA256 made with a signing secret you request from partners@stealthex.io. Give the client that secret and it verifies every signed response before returning it:

```ts
const stealthex = new StealthEX({
  apiKey: process.env.STEALTHEX_API_KEY,
  signingSecret: process.env.STEALTHEX_SIGNING_SECRET,
  requireSignature: true,            // also reject responses that have a body but no signature
  signatureToleranceSeconds: 300,    // allowed clock skew (default)
});
```

While you rotate secrets, pass both: `signingSecret: [newSecret, oldSecret]`.

To verify a raw response yourself, for example in a proxy:

```ts
import { verifySignature, checkSignature } from "@swapzy/stealthex-sdk";

const body = await response.text(); // the exact bytes; never re-serialize parsed JSON
const ok = await verifySignature({
  header: response.headers.get("sx-signature"),
  body,
  secret: process.env.STEALTHEX_SIGNING_SECRET!,
});

// checkSignature() returns { valid: false, reason: "missing" | "malformed" | "expired" | "mismatch" } instead
```

Comparison is constant-time, and every `s0` in the header is checked.

## Configuration

```ts
new StealthEX({
  apiKey,                     // default: process.env.STEALTHEX_API_KEY
  baseUrl,                    // default: "https://api.stealthex.io"
  fetch,                      // default: globalThis.fetch (pass one for proxies or tests)
  timeoutMs,                  // default: 30_000, per attempt
  maxRetries,                 // default: 2
  headers,                    // extra headers on every request; Authorization can't be overridden
  signingSecret,              // string | string[]; enables Sx-Signature checks
  requireSignature,           // default: false
  signatureToleranceSeconds,  // default: 300
});
```

## API reference

| Method | Endpoint | Returns |
|---|---|---|
| `rates.range(params, opts?)` | `POST /v4/rates/range` | `Range` |
| `rates.estimate(params, opts?)` | `POST /v4/rates/estimated-amount` | `Estimate` |
| `currencies.list(params?, opts?)` | `GET /v4/currencies` | `Currency[]` |
| `currencies.listAll(params?, opts?)` | `GET /v4/currencies`, paged | `AsyncGenerator<Currency>` |
| `currencies.get(symbol, network, params?, opts?)` | `GET /v4/currencies/{symbol}/{network}` | `Currency` |
| `currencies.networks(opts?)` | `GET /v4/currencies/networks` | `string[]` |
| `currencies.availableRoutes(params?, opts?)` | `GET /v4/currencies/available-routes` | `AvailableRoute[]` |
| `exchanges.create(params, opts?)` | `POST /v4/exchanges` | `Exchange` |
| `exchanges.get(id, opts?)` | `GET /v4/exchanges/{id}` | `Exchange` |
| `exchanges.list(params?, opts?)` | `GET /v4/exchanges` | `Exchange[]` |
| `exchanges.listAll(params?, opts?)` | `GET /v4/exchanges`, paged | `AsyncGenerator<Exchange>` |
| `exchanges.setTransactionHash(id, txHash, opts?)` | `PATCH /v4/exchanges/{id}` | `void` |
| `exchanges.waitFor(id, options?)` | polls `GET /v4/exchanges/{id}` | `Exchange` |

It also exports `verifySignature`, `checkSignature`, `computeSignature`, `parseSignatureHeader`, `isTerminalStatus`, `TERMINAL_STATUSES`, `MAX_PAGE_SIZE`, every error class, and every request and response type (`Currency`, `Exchange`, `ExchangeStatus`, `CreateExchangeParams`, ...). Hover any method in your editor for its documentation and an example.

## Runtime support

| Runtime | Supported |
|---|---|
| Node.js 22+ | ✅ |
| Bun, Deno | ✅ |
| Cloudflare Workers, Vercel Edge and other fetch-based runtimes | ✅ |
| Browsers | ❌ The API blocks browser origins (CORS), and the key must stay secret. Call it from your backend. |

The build targets ES2022 and needs only `fetch`, `AbortController`, `URL`, `TextEncoder` and `crypto.subtle` (signatures only).

## Security

- **Keep the API key on the server.** Never ship it to a browser or a mobile app, and never commit it. The SDK sends it only in the `Authorization` header, never in a URL where it could end up in logs.
- **Validate addresses** with the currency's `address_regex` and ask for `extra_id` when the currency has one. A missing memo is a classic way to lose funds.
- **Always set `refund_address`**, so a failed exchange has somewhere to go.
- **Use `signingSecret`** if StealthEX issued you one.

To report a vulnerability in this SDK, see [SECURITY.md](./SECURITY.md).

## Using with AI assistants

This repository ships context files for coding assistants and LLMs:

- [`llms.txt`](./llms.txt): a short index in the [llms.txt](https://llmstxt.org) format.
- [`llms-full.txt`](./llms-full.txt): the whole SDK surface, types, errors and gotchas in one file. Paste it into a chat, or point a tool at the raw URL: `https://raw.githubusercontent.com/SwapzyCC/stealthex-sdk/main/llms-full.txt`.
- [`AGENTS.md`](./AGENTS.md): instructions for agents working on this repository (Claude Code reads it through `CLAUDE.md`).

Both `llms*.txt` files also ship inside the installed package, in `node_modules/@swapzy/stealthex-sdk/`.

## Development

```sh
git clone https://github.com/SwapzyCC/stealthex-sdk.git
cd stealthex-sdk
npm install
npm run check      # typecheck + tests + build
```

To run the examples against the live API, copy `.env.example` to `.env`, add your key, and run `npx tsx --env-file=.env examples/quickstart.ts`.

Contributions are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © 2026 Swapzy
