# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-29

### Added

- `StealthEX` client covering every StealthEX API v4 endpoint:
  - `rates.range` and `rates.estimate`;
  - `currencies.list`, `listAll`, `get`, `networks` and `availableRoutes`;
  - `exchanges.create`, `get`, `list`, `listAll` and `setTransactionHash`.
- `exchanges.waitFor()` polls an exchange until it reaches a terminal status.
- Typed errors carrying the API's `kind`, `details` and `Request-Id`.
- Automatic retries with backoff:
  - `Retry-After` is honoured;
  - `exchanges.create()` is never retried after a 5xx or a network failure.
- Per-attempt timeouts, `AbortSignal` support and per-call overrides.
- `Sx-Signature` response verification: `verifySignature`, `checkSignature`, `computeSignature` and `parseSignatureHeader`, plus automatic checks via `signingSecret`.
- LLM context files: `llms.txt`, `llms-full.txt` and `AGENTS.md`.

[0.1.0]: https://github.com/SwapzyCC/stealthex-sdk/releases/tag/v0.1.0
