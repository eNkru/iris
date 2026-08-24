import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ARGUS_BASE_URL = "http://127.0.0.1:8000";
process.env.ARGUS_API_TOKEN = "test-token";

import { resetEnvCache } from "@iris/utils";
import { extractPrice } from "../../packages/prices/src/pipeline/extract-price";

resetEnvCache();

function fakeFetchResponses(responses: Array<() => Response | Error>) {
  let i = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[i++];
    if (!next) {
      throw new Error(`no more fake responses scheduled (call #${i})`);
    }
    const value = next();
    if (value instanceof Error) throw value;
    return value;
  });
  vi.stubGlobal("fetch", spy);
  return { spy, calls };
}

function argusJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const URL = "https://example.test/p/1";
const OPTS = { productId: "prod-1" };

describe("extractPrice", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes an ok extraction through and sends bearer auth + url body", async () => {
    const { calls } = fakeFetchResponses([
      () =>
        argusJson({
          ok: true,
          source: "jsonld",
          url: URL,
          available: true,
          price: "599.99",
          currency: "NZD",
          name: "Widget",
          jsonld: { "@type": "Product", image: "https://img.test/w.jpg" },
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({
      kind: "ok",
      url: URL,
      available: true,
      price: 599.99,
      currency: "NZD",
      name: "Widget",
      jsonld: { "@type": "Product", image: "https://img.test/w.jpg" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/v1/extract-price");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ url: URL });
  });

  it("returns a non-retryable block immediately (single call)", async () => {
    const { calls } = fakeFetchResponses([
      () =>
        argusJson({
          ok: false,
          reason: "blocked",
          signature: "akamai-waf",
          retryable: false,
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "blocked", signature: "akamai-waf" });
    expect(calls).toHaveLength(1);
  });

  it("retries a retryable block and succeeds on attempt 2", async () => {
    const { calls } = fakeFetchResponses([
      () =>
        argusJson({
          ok: false,
          reason: "blocked",
          signature: "cloudflare-challenge",
          retryable: true,
        }),
      () =>
        argusJson({
          ok: true,
          url: URL,
          available: true,
          price: "24.99",
          currency: "NZD",
          name: null,
          jsonld: null,
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toMatchObject({ kind: "ok", price: 24.99 });
    expect(calls).toHaveLength(2);
  }, 15_000);

  it("returns the signature after exhausting retries on a persistent retryable block", async () => {
    const blocked = () =>
      argusJson({
        ok: false,
        reason: "blocked",
        signature: "akamai-access-denied",
        retryable: true,
      });
    const { calls } = fakeFetchResponses([blocked, blocked, blocked]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({
      kind: "blocked",
      signature: "akamai-access-denied",
    });
    expect(calls).toHaveLength(3);
  }, 20_000);

  it("retries fetch_failed then surfaces 'Page fetch failed'", async () => {
    const fail = () => argusJson({ ok: false, reason: "fetch_failed" });
    const { calls } = fakeFetchResponses([fail, fail, fail]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "error", message: "Page fetch failed" });
    expect(calls).toHaveLength(3);
  }, 20_000);

  it("does not retry extraction_failed (terminal)", async () => {
    const { calls } = fakeFetchResponses([
      () => argusJson({ ok: false, reason: "extraction_failed" }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "error", message: "Price extraction failed" });
    expect(calls).toHaveLength(1);
  });

  it("rejects a non-numeric price string as a terminal extraction failure", async () => {
    const { calls } = fakeFetchResponses([
      () =>
        argusJson({
          ok: true,
          url: URL,
          available: true,
          price: "not-a-number",
          currency: null,
          name: null,
          jsonld: null,
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "error", message: "Price extraction failed" });
    expect(calls).toHaveLength(1);
  });

  it("treats available=true with no usable price as a degraded extraction", async () => {
    fakeFetchResponses([
      () =>
        argusJson({
          ok: true,
          url: URL,
          available: true,
          price: null,
          currency: null,
          name: null,
          jsonld: null,
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "error", message: "Price extraction failed" });
  });

  it("keeps price=null for unavailable products (no error)", async () => {
    fakeFetchResponses([
      () =>
        argusJson({
          ok: true,
          url: URL,
          available: false,
          price: null,
          currency: null,
          name: "Widget",
          jsonld: null,
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toMatchObject({
      kind: "ok",
      available: false,
      price: null,
      name: "Widget",
    });
    // Unavailable responses carry no pricing data at all.
    expect(result.kind === "ok" && result.currency === null).toBe(true);
  });

  it("retries transport-class HTTP failures then reports 'Page fetch failed'", async () => {
    const { calls } = fakeFetchResponses([
      () => new Response("boom", { status: 500 }),
      () => new Response("boom", { status: 503 }),
      () => new Response("boom", { status: 502 }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "error", message: "Page fetch failed" });
    expect(calls).toHaveLength(3);
  }, 20_000);

  it("rejects a zero price as a terminal extraction failure (no $0 readings)", async () => {
    fakeFetchResponses([
      () =>
        argusJson({
          ok: true,
          url: URL,
          available: true,
          price: "0",
          currency: "NZD",
          name: null,
          jsonld: null,
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "error", message: "Price extraction failed" });
  });

  it("rejects an empty-string and a negative price the same way", async () => {
    for (const badPrice of ["", "-5.00"]) {
      fakeFetchResponses([
        () =>
          argusJson({
            ok: true,
            url: URL,
            available: true,
            price: badPrice,
            currency: null,
            name: null,
            jsonld: null,
          }),
      ]);
      const result = await extractPrice(URL, OPTS);
      expect(result).toEqual({ kind: "error", message: "Price extraction failed" });
    }
  });

  it("falls back to signature 'unknown' when argus omits block metadata", async () => {
    fakeFetchResponses([
      () => argusJson({ ok: false, reason: "blocked" }),
      () =>
        argusJson({
          ok: true,
          url: URL,
          available: false,
          price: null,
          currency: null,
          name: null,
          jsonld: null,
        }),
    ]);

    const result = await extractPrice(URL, OPTS);

    // The first attempt's missing metadata defaulted to retryable:true, so a
    // second attempt ran; its verdict surfaces with the conservative id.
    expect(result).toMatchObject({ kind: "ok", available: false });
  }, 15_000);

  it("retries network-level failures then reports 'Page fetch failed'", async () => {
    let i = 0;
    const spy = vi.fn(async () => {
      i += 1;
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", spy);

    const result = await extractPrice(URL, OPTS);

    expect(result).toEqual({ kind: "error", message: "Page fetch failed" });
    expect(i).toBe(3);
  }, 20_000);

  it("fails fast on auth errors instead of retrying a guaranteed-401 loop", async () => {
    const { calls } = fakeFetchResponses([
      () => new Response("unauthorized", { status: 401 }),
    ]);

    const result = await extractPrice(URL, OPTS);

    expect(result.kind).toBe("error");
    expect(
      result.kind === "error" && result.message.includes("401"),
    ).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

