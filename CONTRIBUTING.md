# Contributing

Thanks for helping out. Bug reports, fixes and improvements are all welcome.

## Setup

```sh
git clone https://github.com/SwapzyCC/stealthex-sdk.git
cd stealthex-sdk
npm install
npm run check   # typecheck + tests + build
```

The tests are fully mocked, so you don't need an API key. The scripts in `examples/` call the live API: copy `.env.example` to `.env`, add your key, then run `npx tsx --env-file=.env examples/quickstart.ts`.

## Pull requests

- Keep each pull request to one change, and add or update tests for it.
- `npm run check` must pass.
- If you change the public API, update `README.md`, `llms-full.txt` and `CHANGELOG.md` too.
- Never commit API keys, signing secrets or real wallet addresses.
- Read [AGENTS.md](./AGENTS.md) for the design invariants: zero runtime dependencies, snake_case wire types, and no blind retries of `exchanges.create()`.

## Reporting bugs

[Open an issue](https://github.com/SwapzyCC/stealthex-sdk/issues) with:

- the SDK version;
- your runtime and its version;
- the smallest code that reproduces the problem;
- the error's `kind`, `status` and `requestId`.

Remove your API key from anything you paste.
