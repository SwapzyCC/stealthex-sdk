/**
 * Every error this SDK throws extends `StealthEXError`, so one `instanceof`
 * check catches all of them. Aborting through your own `AbortSignal` is the
 * exception: that rejects with the signal's reason, as `fetch` does.
 */

/**
 * The `err.kind` values the API documents. Other strings may appear, so a
 * `kind` is typed to accept them too.
 */
export type StealthEXErrorKind =
  // 401
  | "Auth"
  // 400
  | "InvalidAmount"
  | "RateId"
  | "ExtraId"
  | "InvalidData"
  | "NoUserApiKey"
  | "RoutesMismatch"
  // 404
  | "NoPair"
  | "NotFound"
  // 422
  | "NotAllowed"
  | "NoExchangeRoute"
  | "RouteIsDisabled"
  | "MarketUnavailable"
  | (string & {});

export class StealthEXError extends Error {
  /** The API's `Request-Id` for the response, when there was one. Quote it to StealthEX support. */
  readonly requestId: string | undefined;

  constructor(message: string, options?: { requestId?: string | undefined; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "StealthEXError";
    this.requestId = options?.requestId;
  }
}

/** The API answered with a non-2xx status. */
export class StealthEXAPIError extends StealthEXError {
  readonly status: number;
  /** `err.kind` from the body, such as `"NoPair"`. Undefined when the body was not an API error. */
  readonly kind: StealthEXErrorKind | undefined;
  /** `err.details` from the body: a human-readable explanation. */
  readonly details: string | undefined;
  /** The raw response body, for anything the fields above do not cover. */
  readonly body: string;

  constructor(init: {
    status: number;
    kind?: string | undefined;
    details?: string | undefined;
    body: string;
    requestId?: string | undefined;
  }) {
    const what = [init.kind, init.details].filter(Boolean).join(": ") || init.body.slice(0, 200) || "no body";
    const id = init.requestId ? ` (request id ${init.requestId})` : "";
    super(`StealthEX API ${init.status}: ${what}${id}`, { requestId: init.requestId });
    this.name = "StealthEXAPIError";
    this.status = init.status;
    this.kind = init.kind;
    this.details = init.details;
    this.body = init.body;
  }
}

/** 401 or 403: the API key is missing, wrong or not allowed to do this. */
export class StealthEXAuthenticationError extends StealthEXAPIError {
  constructor(init: ConstructorParameters<typeof StealthEXAPIError>[0]) {
    super(init);
    this.name = "StealthEXAuthenticationError";
  }
}

/** 429: over the rate limit (600 requests a minute) and out of retries. */
export class StealthEXRateLimitError extends StealthEXAPIError {
  /** How long the API asked to wait, from `Retry-After`. Undefined when it did not say. */
  readonly retryAfterMs: number | undefined;

  constructor(init: ConstructorParameters<typeof StealthEXAPIError>[0] & { retryAfterMs?: number | undefined }) {
    super(init);
    this.name = "StealthEXRateLimitError";
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** A request, or `exchanges.waitFor()`, ran out of time. */
export class StealthEXTimeoutError extends StealthEXError {
  constructor(message: string, options?: { requestId?: string | undefined; cause?: unknown }) {
    super(message, options);
    this.name = "StealthEXTimeoutError";
  }
}

/** The request never got an HTTP response: DNS, TLS, a reset connection. `cause` has the original. */
export class StealthEXConnectionError extends StealthEXError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StealthEXConnectionError";
  }
}

/**
 * A response failed signature verification: its `Sx-Signature` did not match
 * any signing secret, was outside the time tolerance, or was missing while
 * `requireSignature` is on. Treat the response as untrusted.
 */
export class StealthEXSignatureError extends StealthEXError {
  constructor(message: string, options?: { requestId?: string | undefined }) {
    super(message, options);
    this.name = "StealthEXSignatureError";
  }
}
