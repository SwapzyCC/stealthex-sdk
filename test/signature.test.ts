import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  StealthEXSignatureError,
  checkSignature,
  computeSignature,
  parseSignatureHeader,
  verifySignature,
} from "../src/index.js";
import { client, json, mockFetch } from "./helpers.js";

const SECRET = "whsec_test_secret";
const T = 1716214920;
const BODY = JSON.stringify({ id: "abc", status: "waiting" });
/** HMAC-SHA256("whsec_test_secret", `${T}.${BODY}`), computed independently with Node's crypto. */
const VECTOR = "b47d8d4eadf7a5f93f3cf59b41b65c6db1cbb0614aa84a67bc865c792c88a6ea";
const AT_T = T * 1000;

const sign = (secret: string, t: number, body: string) =>
  createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

describe("parseSignatureHeader", () => {
  it("reads the timestamp and every s0", () => {
    expect(parseSignatureHeader(`t=${T},s0=ABC123,s0=def456,v9=ignored`)).toEqual({
      timestamp: T,
      signatures: ["abc123", "def456"],
    });
  });

  it("rejects a header with no timestamp or no signature", () => {
    expect(parseSignatureHeader("s0=abc")).toBeNull();
    expect(parseSignatureHeader(`t=${T}`)).toBeNull();
    expect(parseSignatureHeader("t=soon,s0=abc")).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
  });
});

describe("computeSignature", () => {
  it("matches a known vector", async () => {
    expect(await computeSignature(SECRET, T, BODY)).toBe(VECTOR);
  });

  it("signs bytes the same as the string they encode", async () => {
    expect(await computeSignature(SECRET, T, new TextEncoder().encode(BODY))).toBe(VECTOR);
  });
});

describe("verifySignature", () => {
  const header = `t=${T},s0=${VECTOR}`;

  it("accepts a valid, fresh signature", async () => {
    expect(await verifySignature({ header, body: BODY, secret: SECRET, now: AT_T + 10_000 })).toBe(true);
  });

  it("rejects a changed body", async () => {
    expect(await checkSignature({ header, body: BODY + " ", secret: SECRET, now: AT_T })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects the wrong secret", async () => {
    expect(await verifySignature({ header, body: BODY, secret: "other", now: AT_T })).toBe(false);
  });

  it("rejects a stale timestamp, unless tolerance allows it", async () => {
    const later = AT_T + 301_000;
    expect(await checkSignature({ header, body: BODY, secret: SECRET, now: later })).toMatchObject({ reason: "expired" });
    expect(await verifySignature({ header, body: BODY, secret: SECRET, now: later, toleranceSeconds: 400 })).toBe(true);
    expect(await verifySignature({ header, body: BODY, secret: SECRET, now: 0, toleranceSeconds: Infinity })).toBe(
      true,
    );
  });

  it("accepts any matching s0 while a secret is being rolled", async () => {
    const rolled = `t=${T},s0=${sign("new_secret", T, BODY)},s0=${VECTOR}`;
    expect(await verifySignature({ header: rolled, body: BODY, secret: SECRET, now: AT_T })).toBe(true);
    expect(await verifySignature({ header, body: BODY, secret: ["new_secret", SECRET], now: AT_T })).toBe(true);
  });

  it("reports a missing or malformed header", async () => {
    expect(await checkSignature({ header: null, body: BODY, secret: SECRET })).toMatchObject({ reason: "missing" });
    expect(await checkSignature({ header: "garbage", body: BODY, secret: SECRET })).toMatchObject({
      reason: "malformed",
    });
  });
});

describe("client signature checks", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const signed = (body: unknown, secret = SECRET) => {
    const text = JSON.stringify(body);
    const t = now();
    return json(body, 200, { "sx-signature": `t=${t},s0=${sign(secret, t, text)}` });
  };

  it("passes a correctly signed response", async () => {
    const { fetch } = mockFetch(signed(["mainnet"]));
    await expect(client(fetch, { signingSecret: SECRET }).currencies.networks()).resolves.toEqual(["mainnet"]);
  });

  it("throws on a bad signature and does not retry", async () => {
    const { fetch, calls } = mockFetch(signed(["mainnet"], "forged"));
    const error = await client(fetch, { signingSecret: SECRET }).currencies.networks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StealthEXSignatureError);
    expect(error).toMatchObject({ requestId: "req_test" });
    expect(calls).toHaveLength(1);
  });

  it("lets an unsigned response through unless requireSignature is on", async () => {
    await expect(
      client(mockFetch(json(["mainnet"])).fetch, { signingSecret: SECRET }).currencies.networks(),
    ).resolves.toEqual(["mainnet"]);

    await expect(
      client(mockFetch(json(["mainnet"])).fetch, { signingSecret: SECRET, requireSignature: true }).currencies.networks(),
    ).rejects.toBeInstanceOf(StealthEXSignatureError);
  });

  it("does not demand a signature on an empty 204", async () => {
    const { fetch } = mockFetch(new Response(null, { status: 204 }));
    await expect(
      client(fetch, { signingSecret: SECRET, requireSignature: true }).exchanges.setTransactionHash("ex_1", "0x1"),
    ).resolves.toBeUndefined();
  });

  it("ignores signatures when no secret is configured", async () => {
    const { fetch } = mockFetch(signed(["mainnet"], "anything"));
    await expect(client(fetch).currencies.networks()).resolves.toEqual(["mainnet"]);
  });
});
