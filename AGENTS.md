# AGENTS.md

Guidance for AI coding agents working **on** this repository. To write code that **uses** the SDK, read [`llms-full.txt`](./llms-full.txt).

## What this is

An unofficial TypeScript client for the StealthEX exchange API v4 (`https://api.stealthex.io/v4`). It is published from GitHub as `@swapzy/stealthex-sdk`. It is not affiliated with StealthEX: never add their logo, and never word anything as if StealthEX wrote or endorses it.

## Commands

```sh
npm install         # also builds, via `prepare`
npm run typecheck   # src + test + examples, with Node types
npm test            # vitest, fully mocked; no network, no API key
npm run build       # src -> dist, without Node types
npm run check       # all three; run it before every commit
```

## Layout

```
src/
  index.ts              every public export; a new public symbol goes here
  client.ts             StealthEX class and options; wires resources to the transport
  core.ts               Transport: auth header, URL/query building, timeouts, retries, error mapping, signature checks
  errors.ts             error classes and the StealthEXErrorKind union
  signature.ts          Sx-Signature parsing and HMAC verification (Web Crypto)
  types.ts              request/response types, snake_case, mirroring the API
  version.ts            VERSION; a test keeps it equal to package.json
  resources/
    rates.ts            range, estimate
    currencies.ts       list, listAll, get, networks, availableRoutes
    exchanges.ts        create, get, list, listAll, setTransactionHash, waitFor
    pagination.ts       paginate() async generator
test/                   vitest; helpers.ts has mockFetch(), json(), apiError(), exchange()
examples/               runnable scripts against the live API (need STEALTHEX_API_KEY)
```

## Invariants

Keep these. Each one is covered by a test; if you change one on purpose, update the tests and the docs with it.

1. **Zero runtime dependencies.** Only `fetch`, `AbortController`, `URL`, `Headers`, `TextEncoder` and `crypto.subtle`. `tsconfig.build.json` sets `types: []`, so a Node-only API in `src/` fails the build. Node APIs are fine in `test/` and `examples/`.
2. **Wire-format types.** Fields stay snake_case, exactly as the API sends them. Don't add camelCase mapping.
3. **`exchanges.create()` is `idempotent: false`.** It is retried on 429 only. Never make it retry on a 5xx, a timeout or a connection error: that could create a duplicate exchange.
4. **The API key goes only in the `Authorization` header**, set last, so caller headers can't replace it. Never in a URL, an error message or a log.
5. **Every thrown error extends `StealthEXError`**, except a caller's own abort, which rejects with `signal.reason`.
6. **Signature comparison stays constant-time**, and every `s0` value is checked.
7. **ESM only**, with relative imports ending in `.js`.

## Conventions

- Strict TypeScript, with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`: use `import type` for types.
- Every public method has a TSDoc comment with the HTTP endpoint, the error kinds it can throw, and an `@example`.
- Comments say *why*, not *what*.
- Tests use `mockFetch()` from `test/helpers.ts`. Never hit the real API in tests. Backoff is zeroed by mocking `Math.random`.
- A change to the public API updates `README.md`, `llms-full.txt`, `llms.txt` (if the summary changes) and `CHANGELOG.md` in the same commit.
- No secrets, API keys or real wallet addresses anywhere in the repo, including tests and examples. Use placeholders such as `"<recipient ETH address>"`.

## Upstream API facts

- The base URL is `https://api.stealthex.io`; every path starts with `/v4`.
- Auth: `Authorization: Bearer <key>`. A missing key returns `401 {"err":{"kind":"Auth",...}}`.
- Errors look like `{"err":{"kind":string,"details":string}}`. Every response carries a `Request-Id` header.
- Rate limit: 600 requests a minute. A 429 carries `Retry-After` as an RFC 7231 date.
- Pagination: `limit` (default 50, max 250) and `offset`. A short page is the last page.
- Rates:
  - A fixed-rate estimate returns `rate.id` and `valid_until`. `create` needs that id as `rate_id`.
  - `estimation: "reversed"` is fixed-rate only.
  - `additional_fee_percent` (0-20) is floating-rate only.
- `PATCH /v4/exchanges/{id}` with `{ tx_hash }` returns 204 with no body.
- `Sx-Signature: t=<unix>,s0=<hex>[,s0=...]` is the hex HMAC-SHA256 of `${t}.${rawBody}`.

## Releasing

1. Bump `version` in `package.json` and `src/version.ts`.
2. Add a `CHANGELOG.md` entry.
3. Run `npm run check`.
4. Commit, tag `vX.Y.Z` and push the tag. Users install with `github:SwapzyCC/stealthex-sdk#vX.Y.Z`.
