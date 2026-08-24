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
const TEST_TIMEOUT_MS = 30_000;

type ArgusFetchResult =
  | { ok: true; html: string; url: string }
  | { ok: false; reason: 'blocked'; signature: string; retryable: boolean }
  | { ok: false; reason: 'fetch_failed' | string };

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

async function fetchFromArgus(url: string): Promise<ArgusFetchResult> {
  const res = await fetch(`${ARGUS_BASE_URL}/v1/fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ARGUS_API_TOKEN}`,
    },
    body: JSON.stringify({ url, detectBlocked: true }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Argus fetch failed with status ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    ok?: boolean;
    html?: unknown;
    reason?: unknown;
    signature?: unknown;
    retryable?: unknown;
  };

  if (body.ok === true) {
    if (typeof body.html !== 'string') {
      throw new Error(`Argus returned non-string html: ${JSON.stringify(body)}`);
    }
    return { ok: true, html: body.html, url: typeof body.url === 'string' ? body.url : url };
  }

  const reason = typeof body.reason === 'string' ? body.reason : 'unknown';
  if (reason === 'blocked') {
    return {
      ok: false,
      reason: 'blocked',
      signature: typeof body.signature === 'string' ? body.signature : 'unknown',
      retryable: typeof body.retryable === 'boolean' ? body.retryable : true,
    };
  }
  return { ok: false, reason };
}

describe('argus-fetch acceptance tests', () => {
  beforeAll(async () => {
    if (!ARGUS_API_TOKEN) {
      throw new Error(
        'ARGUS_API_TOKEN is not set — export it (matching one of argus ARGUS_API_TOKENS) before running acceptance tests',
      );
    }
    // Reachability guard: fail fast if argus is unreachable or never healthy
    await waitForArgusReady(ARGUS_BASE_URL);
  });

  it('fetches a plain (DataDome-protected) URL successfully', async () => {
    const result = await fetchFromArgus(PLAIN_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.html).toBe('string');
    expect(result.html.length).toBeGreaterThan(5_000);
  }, TEST_TIMEOUT_MS);

  it('fetches an Akamai-protected URL and either passes or argus detects a known block', async () => {
    const result = await fetchFromArgus(AKAMAI_URL);

    if (result.ok) {
      // Real page returned; expect non-trivial content
      expect(result.html.length).toBeGreaterThan(5_000);
      return;
    }

    // Argus classified the page — it must be a recognised akamai-* signature
    // with an explicit retryable verdict (the registry's per-request verdict).
    expect(result.reason).toBe('blocked');
    if (result.reason !== 'blocked') return;
    expect(result.signature).toMatch(/^akamai-/);
    expect(typeof result.retryable).toBe('boolean');
    // Document the probabilistic pass: Akamai can also serve a real page on fresh attempts
  }, TEST_TIMEOUT_MS);
});
