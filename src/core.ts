/**
 * The HTTP layer every resource goes through: authentication, timeouts,
 * retries, error mapping and signature checks. Internal; the public surface is
 * `StealthEX` and its resources.
 */

import {
  StealthEXAPIError,
  StealthEXAuthenticationError,
  StealthEXConnectionError,
  StealthEXError,
  StealthEXRateLimitError,
  StealthEXSignatureError,
  StealthEXTimeoutError,
} from "./errors.js";
import { DEFAULT_SIGNATURE_TOLERANCE_SECONDS, SIGNATURE_HEADER, checkSignature } from "./signature.js";
import { VERSION } from "./version.js";

/** Options any single call accepts as its last argument. They override the client's for that call. */
export interface RequestOptions {
  /** Aborts the request, including any wait between retries. */
  signal?: AbortSignal;
  /** Per attempt, in milliseconds. */
  timeoutMs?: number;
  /** Retries after the first attempt. `0` disables them. */
  maxRetries?: number;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  headers: Record<string, string>;
  signingSecrets: readonly string[];
  requireSignature: boolean;
  signatureToleranceSeconds: number;
}

type QueryValue = string | number | boolean | Date | readonly string[] | undefined;

export interface RequestSpec {
  method: "GET" | "POST" | "PATCH";
  /** Starts with `/v4/`. */
  path: string;
  query?: Record<string, QueryValue> | undefined;
  body?: unknown;
  /**
   * Whether repeating the request is harmless. Only then are 5xx responses,
   * timeouts and dropped connections retried: any of those could have
   * happened after the server acted. A 429 is always retried, because a
   * rate-limited request was never processed.
   */
  idempotent: boolean;
  options?: RequestOptions | undefined;
}

/** Retry-After beyond this is not waited out; the 429 is thrown instead. */
const MAX_RETRY_AFTER_MS = 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

export class Transport {
  constructor(private readonly config: TransportConfig) {}

  async request<T>(spec: RequestSpec): Promise<T> {
    const maxRetries = spec.options?.maxRetries ?? this.config.maxRetries;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send<T>(spec);
      } catch (error) {
        const delay = attempt < maxRetries ? retryDelay(error, spec.idempotent, attempt) : undefined;
        if (delay === undefined) throw error;
        await sleep(delay, spec.options?.signal);
      }
    }
  }

  private async send<T>(spec: RequestSpec): Promise<T> {
    const { config } = this;
    const signal = spec.options?.signal;
    signal?.throwIfAborted();

    // `set` replaces case-insensitively, so later layers win and no caller
    // header can smuggle in a second Authorization.
    const headers = new Headers({ Accept: "application/json", "User-Agent": `stealthex-sdk-js/${VERSION}` });
    for (const layer of [config.headers, spec.options?.headers]) {
      for (const [name, value] of Object.entries(layer ?? {})) headers.set(name, value);
    }
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    if (spec.body !== undefined) headers.set("Content-Type", "application/json");

    const timeoutMs = spec.options?.timeoutMs ?? config.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });

    let response: Response;
    let text: string;
    try {
      response = await config.fetch(buildUrl(config.baseUrl, spec.path, spec.query), {
        method: spec.method,
        headers,
        body: spec.body === undefined ? null : JSON.stringify(spec.body),
        signal: controller.signal,
      });
      // Reading the body is part of the attempt: the timeout covers it too.
      text = await response.text();
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timedOut) {
        throw new StealthEXTimeoutError(`${spec.method} ${spec.path} timed out after ${timeoutMs} ms`, {
          cause: error,
        });
      }
      throw new StealthEXConnectionError(`${spec.method} ${spec.path} failed: ${describe(error)}`, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }

    const requestId = response.headers.get("request-id") ?? undefined;
    if (!response.ok) throw toApiError(response, text, requestId);

    await this.verify(response, text, requestId);

    if (text === "") return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new StealthEXError(`StealthEX returned a ${response.status} that is not JSON`, { requestId, cause: error });
    }
  }

  private async verify(response: Response, text: string, requestId: string | undefined): Promise<void> {
    const { signingSecrets, requireSignature, signatureToleranceSeconds } = this.config;
    if (signingSecrets.length === 0) return;

    const header = response.headers.get(SIGNATURE_HEADER);
    // An empty body (a 204) has nothing to protect.
    if (!header && (!requireSignature || text === "")) return;

    const result = await checkSignature({
      header,
      body: text,
      secret: signingSecrets,
      toleranceSeconds: signatureToleranceSeconds,
    });
    if (!result.valid) {
      throw new StealthEXSignatureError(`Response signature check failed: ${result.reason}`, { requestId });
    }
  }
}

export const DEFAULTS = {
  baseUrl: "https://api.stealthex.io",
  timeoutMs: 30_000,
  maxRetries: 2,
  signatureToleranceSeconds: DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
} as const;

function buildUrl(baseUrl: string, path: string, query: RequestSpec["query"]): string {
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    let text: string;
    if (value instanceof Date) text = value.toISOString();
    else if (Array.isArray(value)) text = value.join(",");
    else text = String(value);
    url.searchParams.set(key, text);
  }
  return url.toString();
}

function toApiError(response: Response, text: string, requestId: string | undefined): StealthEXAPIError {
  let kind: string | undefined;
  let details: string | undefined;
  try {
    const parsed = JSON.parse(text) as { err?: { kind?: unknown; details?: unknown } };
    if (typeof parsed.err?.kind === "string") kind = parsed.err.kind;
    if (parsed.err?.details !== undefined) {
      details = typeof parsed.err.details === "string" ? parsed.err.details : JSON.stringify(parsed.err.details);
    }
  } catch {
    // A proxy's HTML error page, say. `body` keeps it.
  }

  const init = { status: response.status, kind, details, body: text, requestId };
  if (response.status === 429) {
    return new StealthEXRateLimitError({ ...init, retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) });
  }
  if (response.status === 401 || response.status === 403) return new StealthEXAuthenticationError(init);
  return new StealthEXAPIError(init);
}

/**
 * `Retry-After` as milliseconds from now. StealthEX sends an HTTP date; plain
 * seconds are accepted too.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/** How long to wait before retrying `error`, or `undefined` to give up. */
function retryDelay(error: unknown, idempotent: boolean, attempt: number): number | undefined {
  if (error instanceof StealthEXRateLimitError) {
    if (error.retryAfterMs === undefined) return backoff(attempt);
    return error.retryAfterMs <= MAX_RETRY_AFTER_MS ? error.retryAfterMs : undefined;
  }
  if (!idempotent) return undefined;
  if (error instanceof StealthEXAPIError) {
    return error.status >= 500 || error.status === 408 ? backoff(attempt) : undefined;
  }
  if (error instanceof StealthEXTimeoutError || error instanceof StealthEXConnectionError) return backoff(attempt);
  return undefined;
}

/** Exponential backoff with full jitter: 0-0.5 s, then 0-1 s, 0-2 s, ... up to 8 s. */
function backoff(attempt: number): number {
  return Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
    return error.message + cause;
  }
  return String(error);
}
