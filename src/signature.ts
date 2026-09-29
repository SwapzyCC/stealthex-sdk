/**
 * Verification of the optional `Sx-Signature` response header.
 *
 *   Sx-Signature: t=1716214920,s0=9f86d0...
 *
 * `s0` is the hex HMAC-SHA256 of `${t}.${body}`, keyed with your signing
 * secret. While you roll a secret, StealthEX signs with every active secret,
 * so a header can carry several `s0` values: any one matching is enough.
 *
 * Uses Web Crypto, so it runs anywhere `crypto.subtle` does: Node 20+, Bun,
 * Deno, Cloudflare Workers.
 */

import { StealthEXError } from "./errors.js";

/** The response header that carries the signature. */
export const SIGNATURE_HEADER = "Sx-Signature";

/** Five minutes either way. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface ParsedSignatureHeader {
  /** Unix seconds. */
  timestamp: number;
  /** Every `s0` value, lowercase hex. */
  signatures: string[];
}

/**
 * Splits a header into its timestamp and signatures. Returns `null` when the
 * header has no valid timestamp or no signature at all. Unknown prefixes are
 * ignored, so a future signature scheme does not break parsing.
 */
export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const element of header.split(",")) {
    const at = element.indexOf("=");
    if (at === -1) continue;
    const prefix = element.slice(0, at).trim();
    const value = element.slice(at + 1).trim();

    if (prefix === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (prefix === "s0" && /^[0-9a-fA-F]+$/.test(value)) signatures.push(value.toLowerCase());
  }

  if (timestamp === undefined || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/** The hex HMAC-SHA256 of `${timestamp}.${body}`, keyed with `secret`. */
export async function computeSignature(
  secret: string,
  timestamp: number,
  body: string | Uint8Array,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StealthEXError("Signature verification needs Web Crypto (crypto.subtle), which this runtime lacks.");
  }

  const encoder = new TextEncoder();
  const prefix = encoder.encode(`${timestamp}.`);
  const payload = typeof body === "string" ? encoder.encode(body) : body;
  const message = new Uint8Array(prefix.length + payload.length);
  message.set(prefix, 0);
  message.set(payload, prefix.length);

  const key = await subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await subtle.sign("HMAC", key, message));

  let hex = "";
  for (const byte of mac) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export interface VerifySignatureInput {
  /** The `Sx-Signature` header value. `null` or `undefined` fails verification. */
  header: string | null | undefined;
  /** The raw response body, exactly as received. Do not re-serialize parsed JSON. */
  body: string | Uint8Array;
  /** Your signing secret. Pass several while rolling one; any match passes. */
  secret: string | readonly string[];
  /** Maximum clock difference, in seconds. Defaults to 300. `Infinity` skips the check. */
  toleranceSeconds?: number;
  /** The current time in milliseconds. Defaults to `Date.now()`; for tests. */
  now?: number;
}

export type SignatureCheck =
  | { valid: true; timestamp: number }
  | { valid: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

/** Like `verifySignature()`, but says why a signature failed. */
export async function checkSignature(input: VerifySignatureInput): Promise<SignatureCheck> {
  if (!input.header) return { valid: false, reason: "missing" };

  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return { valid: false, reason: "malformed" };

  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = (input.now ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) return { valid: false, reason: "expired" };

  const secrets = typeof input.secret === "string" ? [input.secret] : input.secret;
  for (const secret of secrets) {
    const expected = await computeSignature(secret, parsed.timestamp, input.body);
    // Check every candidate rather than stopping at the first hit, so the
    // time taken does not depend on which one matched.
    let matched = false;
    for (const candidate of parsed.signatures) {
      if (timingSafeEqual(expected, candidate)) matched = true;
    }
    if (matched) return { valid: true, timestamp: parsed.timestamp };
  }

  return { valid: false, reason: "mismatch" };
}

/**
 * Whether `header` is a valid, fresh signature of `body` under `secret`.
 *
 * @example
 * const ok = await verifySignature({
 *   header: response.headers.get("sx-signature"),
 *   body: await response.text(),
 *   secret: process.env.STEALTHEX_SIGNING_SECRET!,
 * });
 */
export async function verifySignature(input: VerifySignatureInput): Promise<boolean> {
  return (await checkSignature(input)).valid;
}

/** Constant-time comparison of two strings. Only their lengths leak, and a hex HMAC's length is public. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
