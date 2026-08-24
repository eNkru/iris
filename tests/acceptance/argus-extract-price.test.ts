import { describe, it, expect, beforeAll } from 'vitest';

// Env-driven config (defaults can be overridden for CI). The token has no
// silent default: acceptance tests run against a live argus service and must
// fail loudly when unauthenticated.
const ARGUS_BASE_URL = process.env.ARGUS_BASE_URL ?? 'http://localhost:8000';
const ARGUS_API_TOKEN = process.env.ARGUS_API_TOKEN ?? '';
const PLAIN_URL = process.env.PLAIN_URL ?? 'https://www.thewarehouse.co.nz/p/paseo-luxury-toilet-paper-long-roll-white-3-ply-white-8-pack/R2889564.html';
const AKAMAI_URL = process.env.AKAMAI_URL ?? 'https://www.farmers.co.nz/product/sony-wh1000xm5-wireless-cancelling-headphones-black/734837';

// Increase timeout for slow network/argus responses (browser cold-start on
// the first fetch after idle adds ~3-5s inside argus).
const TEST_TIMEOUT_MS = 45_000;

type ArgusExtractResult =
  | {
      ok: true;
      source: 'jsonld' | 'ai';
      url: string;
      available: boolean;
      price: string | null;
      currency: string | null;
      name: string | null;
      jsonld: Record<string, unknown> | null;
    }
  | {
      ok: false;
      reason: 'blocked';
      signature: string;
      retryable: boolean;
    }
  | { ok: false; reason: 'fetch_failed' | 'extraction_failed' | string };

// Bounded health-poll. Argus /health is unauthenticated and returns 200 as
// soon as the service is up — the browser is lazy by design and may be
// reported as "absent" without affecting readiness.
async function waitForArgusReady(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
      }
    } catch {
      // Argus not up yet; keep polling
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`Argus at ${url} did not become healthy within ${timeoutMs}ms`);
}

async function extractFromArgus(url: string): Promise<ArgusExtractResult> {
  const res = await fetch(`${ARGUS_BASE_URL}/v1/extract-price`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ARGUS_API_TOKEN}`,
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Argus extract failed with status ${res.status}: ${text}`);
  }
  return (await res.json()) as ArgusExtractResult;
}

describe('argus-extract-price acceptance tests', () => {
  beforeAll(async () => {
    if (!ARGUS_API_TOKEN) {
      throw new Error(
        'ARGUS_API_TOKEN is not set — export it (matching one of argus ARGUS_API_TOKENS) before running acceptance tests',
      );
    }
    // Reachability guard: fail fast if argus is unreachable or never healthy
    await waitForArgusReady(ARGUS_BASE_URL);
  });

  it('extracts a price from a plain (DataDome-protected) product page', async () => {
    const result = await extractFromArgus(PLAIN_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(['jsonld', 'ai']).toContain(result.source);
    expect(typeof result.url).toBe('string');
    expect(typeof result.available).toBe('boolean');
    // argus returns decimal-normalized 2dp strings — never floats.
    if (result.price !== null) {
      expect(typeof result.price).toBe('string');
      expect(result.price).toMatch(/^\d+(\.\d{1,2})?$/);
    }
    if (result.source === 'jsonld' && typeof result.jsonld === 'object' && result.jsonld) {
      // The rich Product node rides along on the deterministic path.
      expect(Object.keys(result.jsonld).length).toBeGreaterThan(0);
    }
  }, TEST_TIMEOUT_MS);

  it('handles an Akamai-protected URL: extracts, or reports a classified block', async () => {
    const result = await extractFromArgus(AKAMAI_URL);

    if (result.ok) {
      // Real page extracted — either a usable price or an explicit
      // unavailable verdict from argus's extraction stages.
      expect(typeof result.available).toBe('boolean');
      return;
    }

    // Blocked pages short-circuit BEFORE any model call and carry the
    // registry signature + per-request retryable verdict.
    expect(result.reason).toBe('blocked');
    if (result.reason !== 'blocked') return;
    expect(result.signature).toMatch(/^akamai-/);
    expect(typeof result.retryable).toBe('boolean');
  }, TEST_TIMEOUT_MS);
});
