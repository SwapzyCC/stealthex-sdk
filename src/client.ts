import { DEFAULTS, Transport } from "./core.js";
import { StealthEXError } from "./errors.js";
import { Currencies } from "./resources/currencies.js";
import { Exchanges } from "./resources/exchanges.js";
import { Rates } from "./resources/rates.js";

export interface StealthEXOptions {
  /**
   * Your StealthEX API key (register at https://stealthex.io/pp/). Falls back
   * to the `STEALTHEX_API_KEY` environment variable where one exists.
   */
  apiKey?: string;
  /** Defaults to `https://api.stealthex.io`. */
  baseUrl?: string;
  /** A `fetch` to use instead of the global one: a proxy agent, a mock in tests. */
  fetch?: typeof fetch;
  /** Per attempt, in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /** Retries after the first attempt, for rate limits and transient failures. Defaults to 2. */
  maxRetries?: number;
  /** Extra headers on every request. `Authorization` cannot be overridden. */
  headers?: Record<string, string>;
  /**
   * Your response signing secret (ask partners@stealthex.io). When set, every
   * response that carries an `Sx-Signature` is verified, and a bad one throws
   * `StealthEXSignatureError`. Pass several while rolling a secret.
   */
  signingSecret?: string | readonly string[];
  /** Also reject responses that have a body but no signature. Needs `signingSecret`. Defaults to false. */
  requireSignature?: boolean;
  /** How far a signature's timestamp may be from now, in seconds. Defaults to 300. */
  signatureToleranceSeconds?: number;
}

/**
 * A client for the StealthEX API v4.
 *
 * Server-side only: the API refuses browser origins (CORS), and your API key
 * must never reach a user's browser.
 *
 * @example
 * import { StealthEX } from "@swapzy/stealthex-sdk";
 *
 * const client = new StealthEX({ apiKey: process.env.STEALTHEX_API_KEY });
 * const currencies = await client.currencies.list({ limit: 10 });
 */
export class StealthEX {
  /** Minimum and maximum amounts, and estimates. */
  readonly rates: Rates;
  /** Supported currencies, networks and routes. */
  readonly currencies: Currencies;
  /** Creating and tracking swaps. */
  readonly exchanges: Exchanges;

  constructor(options: StealthEXOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("STEALTHEX_API_KEY");
    if (!apiKey) {
      throw new StealthEXError(
        "No StealthEX API key: pass { apiKey } or set STEALTHEX_API_KEY. Get one at https://stealthex.io/pp/.",
      );
    }

    if (typeof (options.fetch ?? globalThis.fetch) !== "function") {
      throw new StealthEXError("No fetch in this runtime: pass { fetch } or use Node 22+.");
    }

    const signingSecrets =
      options.signingSecret === undefined
        ? []
        : typeof options.signingSecret === "string"
          ? [options.signingSecret]
          : [...options.signingSecret];
    if (options.requireSignature && signingSecrets.length === 0) {
      throw new StealthEXError("requireSignature needs a signingSecret to verify with.");
    }

    const transport = new Transport({
      apiKey,
      baseUrl: options.baseUrl ?? DEFAULTS.baseUrl,
      // Called unbound, some runtimes' fetch throws "Illegal invocation".
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
      headers: { ...options.headers },
      signingSecrets,
      requireSignature: options.requireSignature ?? false,
      signatureToleranceSeconds: options.signatureToleranceSeconds ?? DEFAULTS.signatureToleranceSeconds,
    });

    this.rates = new Rates(transport);
    this.currencies = new Currencies(transport);
    this.exchanges = new Exchanges(transport);
  }
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name] || undefined;
}
