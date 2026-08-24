# Performance Patterns

This document covers performance optimization patterns for backend development.

## Parallel Execution with Promise.all

When operations are independent, execute them in parallel.

```typescript
// BAD - Sequential execution (slow)
const user = await getUser(userId);
const orders = await getOrders(userId);
const preferences = await getPreferences(userId);

// GOOD - Parallel execution
const [user, orders, preferences] = await Promise.all([
  getUser(userId),
  getOrders(userId),
  getPreferences(userId),
]);
```

### Promise.allSettled for Partial Failures

When some operations can fail without blocking others:

```typescript
const results = await Promise.allSettled([
  processOrderA(),
  processOrderB(),
  processOrderC(),
]);

const successful = results
  .filter((r): r is PromiseFulfilledResult<Order> => r.status === "fulfilled")
  .map(r => r.value);

const failed = results
  .filter((r): r is PromiseRejectedResult => r.status === "rejected")
  .map(r => r.reason);

logger.info("Batch processing complete", {
  successful: successful.length,
  failed: failed.length,
});
```

## Concurrency Control with p-limit

When calling external APIs, limit concurrent requests to avoid rate limiting.

```typescript
import pLimit from "p-limit";

// Create limiter with max 20 concurrent requests
const limit = pLimit(20);

const orderIds = ["order1", "order2", /* ... hundreds more */];

// Process all with controlled concurrency
const results = await Promise.all(
  orderIds.map(orderId =>
    limit(() => fetchOrderDetails(orderId))
  )
);
```

### Shared Limiter Pattern

For module-wide concurrency control:

```typescript
// lib/api-client.ts
import pLimit from "p-limit";

// External API concurrency limit
const API_CONCURRENCY = 20;

export function createApiLimiter(): ReturnType<typeof pLimit> {
  return pLimit(API_CONCURRENCY);
}

// Usage in procedure
const limiter = createApiLimiter();

const results = await Promise.allSettled(
  items.map(item =>
    limiter(async () => {
      try {
        const result = await externalApi.process(item);
        return { itemId: item.id, success: true, result };
      } catch (error) {
        return {
          itemId: item.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        };
      }
    })
  )
);
```

## Rate Limit Retry with Exponential Backoff

Handle rate limits gracefully with automatic retry.

```typescript
const MAX_RETRIES = 3;

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  context: { operation: string; itemId: string }
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimited = error?.code === 429 || error?.status === 429;

      if (isRateLimited && attempt < MAX_RETRIES) {
        // Exponential backoff: 2^attempt seconds + random jitter
        const delay = 2 ** attempt * 1000 + Math.random() * 1000;

        logger.warn("Rate limited, retrying", {
          operation: context.operation,
          itemId: context.itemId,
          attempt,
          delay: Math.round(delay),
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts`);
}

// Usage
const result = await fetchWithRetry(
  () => externalApi.getResource(resourceId),
  { operation: "getResource", itemId: resourceId }
);
```

Price extraction (`aiExtractPrice`) uses this same formula plus a process-wide
`pLimit` and a min-interval gap. Disable the AI SDK's own retries
(`maxRetries: 0`) or they burst the quota before this backoff runs. Full
contract: `ai-sdk-integration.md` §6 Scenario: Extraction throttle.

> Note: the extract path uses the uncapped formula above (`2 ** attempt * 1000 +
> random * 1000`) and does **not** apply the `RetryConfig` `maxDelay` cap below.
> The richer `RetryConfig` shape is the intended future contract for generic
> outbound HTTP; extraction deliberately stays simpler (3 attempts, ~2–9 s).
> Concurrency is boot-time only (the limiter is memoized on first use); only
> `AI_EXTRACT_MIN_INTERVAL_MS` is live-tunable.

### Backoff Configuration

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;      // Base delay in ms
  maxDelay: number;       // Maximum delay cap
  jitterFactor: number;   // Random jitter (0-1)
}

const defaultConfig: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitterFactor: 0.5,
};

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * 2 ** (attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
  const jitter = cappedDelay * config.jitterFactor * Math.random();
  return cappedDelay + jitter;
}
```

## Redis Caching (Cache-Aside Pattern)

Implement caching for expensive operations.

```typescript
import { redis } from "../../../lib/redis";
import { SpanPrefix, span } from "../../../lib/tracer";

const CACHE_TTL = 3600; // 1 hour in seconds

interface CachedUserProfile {
  id: string;
  name: string;
  preferences: Record<string, unknown>;
}

async function getUserProfile(userId: string): Promise<CachedUserProfile> {
  const cacheKey = `user:profile:${userId}`;

  // 1. Try cache first
  const cached = await span(
    `${SpanPrefix.Redis}GetUserProfile`,
    async () => {
      const data = await redis.get<string>(cacheKey);
      return data ? JSON.parse(data) as CachedUserProfile : null;
    },
    { userId }
  );

  if (cached) {
    return cached;
  }

  // 2. Cache miss - fetch from database
  const profile = await span(
    `${SpanPrefix.DB}FetchUserProfile`,
    () => db.query.user.findFirst({
      where: eq(userTable.id, userId),
      with: { preferences: true },
    }),
    { userId }
  );

  if (!profile) {
    throw new ORPCError("NOT_FOUND", { message: "User not found" });
  }

  const cacheValue: CachedUserProfile = {
    id: profile.id,
    name: profile.name,
    preferences: profile.preferences,
  };

  // 3. Store in cache
  await span(
    `${SpanPrefix.Redis}SetUserProfile`,
    () => redis.set(cacheKey, JSON.stringify(cacheValue), { ex: CACHE_TTL }),
    { userId }
  );

  return cacheValue;
}
```

### Cache Invalidation

```typescript
async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>
): Promise<void> {
  // 1. Update database
  await db.update(userTable)
    .set(updates)
    .where(eq(userTable.id, userId));

  // 2. Invalidate cache
  const cacheKey = `user:profile:${userId}`;
  await redis.del(cacheKey);

  logger.info("User profile updated and cache invalidated", { userId });
}
```

### Cache Key Patterns

```typescript
// User-specific data
`user:profile:${userId}`
`user:settings:${userId}`
`user:orders:${userId}:page:${page}`

// Resource-specific data
`product:${productId}`
`inventory:${warehouseId}:${productId}`

// Aggregated data
`stats:daily:${date}`
`leaderboard:${category}`
```

## Background Tasks with Distributed Locks

Prevent duplicate processing in distributed environments.

```typescript
const LOCK_KEY = "task:process-orders";
const LOCK_TTL = 300; // 5 minutes

async function processScheduledOrders(): Promise<void> {
  // 1. Try to acquire lock
  const lockResult = await redis.set(LOCK_KEY, Date.now(), {
    ex: LOCK_TTL,
    nx: true, // Only set if not exists
  });

  if (!lockResult) {
    logger.info("Another instance is processing orders, skipping");
    return;
  }

  try {
    // 2. Process with lock held
    logger.info("Acquired lock, processing scheduled orders");

    const pendingOrders = await db
      .select()
      .from(orderTable)
      .where(and(
        eq(orderTable.status, "SCHEDULED"),
        lte(orderTable.scheduledAt, new Date())
      ))
      .limit(100);

    for (const order of pendingOrders) {
      await processOrder(order);
    }

    logger.info("Scheduled orders processed", {
      count: pendingOrders.length
    });
  } finally {
    // 3. Release lock
    await redis.del(LOCK_KEY);
  }
}
```

### Lock with Heartbeat

For long-running tasks, extend the lock periodically:

```typescript
async function processLongRunningTask(): Promise<void> {
  const LOCK_KEY = "task:long-running";
  const LOCK_TTL = 30;
  const HEARTBEAT_INTERVAL = 10000; // 10 seconds

  const lockResult = await redis.set(LOCK_KEY, Date.now(), {
    ex: LOCK_TTL,
    nx: true,
  });

  if (!lockResult) {
    return;
  }

  // Heartbeat to extend lock
  const heartbeat = setInterval(async () => {
    await redis.expire(LOCK_KEY, LOCK_TTL);
  }, HEARTBEAT_INTERVAL);

  try {
    await doExpensiveWork();
  } finally {
    clearInterval(heartbeat);
    await redis.del(LOCK_KEY);
  }
}
```

## Batch Processing Patterns

### Chunked Processing

For large datasets, process in chunks:

```typescript
const CHUNK_SIZE = 100;

async function processAllOrders(orderIds: string[]): Promise<void> {
  // Split into chunks
  const chunks: string[][] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
    chunks.push(orderIds.slice(i, i + CHUNK_SIZE));
  }

  logger.info("Processing orders in chunks", {
    totalOrders: orderIds.length,
    chunkCount: chunks.length,
    chunkSize: CHUNK_SIZE,
  });

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    await processOrderChunk(chunk);

    logger.info("Chunk processed", {
      chunkIndex: i + 1,
      totalChunks: chunks.length,
    });
  }
}

async function processOrderChunk(orderIds: string[]): Promise<void> {
  // Batch database query
  const orders = await db
    .select()
    .from(orderTable)
    .where(inArray(orderTable.id, orderIds));

  // Parallel processing with concurrency limit
  const limiter = pLimit(10);

  await Promise.all(
    orders.map(order => limiter(() => processOrder(order)))
  );
}
```

### Progress Reporting

Track and report progress for long operations:

```typescript
interface ProgressTracker {
  total: number;
  processed: number;
  failed: number;
  startTime: number;
}

async function batchProcessWithProgress(
  items: string[],
  progressCallback?: (progress: ProgressTracker) => void
): Promise<void> {
  const progress: ProgressTracker = {
    total: items.length,
    processed: 0,
    failed: 0,
    startTime: Date.now(),
  };

  const UPDATE_INTERVAL = 20; // Report every 20 items

  for (const item of items) {
    try {
      await processItem(item);
      progress.processed++;
    } catch {
      progress.failed++;
    }

    // Report progress periodically
    if ((progress.processed + progress.failed) % UPDATE_INTERVAL === 0) {
      progressCallback?.(progress);

      logger.info("Batch progress", {
        processed: progress.processed,
        failed: progress.failed,
        total: progress.total,
        elapsedMs: Date.now() - progress.startTime,
      });
    }
  }
}
```

## Page Fetch Transport for Bot-Protected Pages

Several major NZ retailers sit behind hard anti-bot challenges that a plain
HTTP client cannot pass: DataDome (kogan.com), Cloudflare managed challenge
(noelleeming.co.nz), and Akamai Bot Manager (farmers.co.nz). The price-
extraction pipeline fetches the product page first, so a blocked fetch surfaces
as the generic "Page fetch failed" and the create flow rolls the product row
back — the user cannot add these retailers at all.

### Strategy: Camoufox is the single fetch transport (via argus)

Camoufox is an engine-level anti-detect Firefox fork (the Byparr engine); its
fingerprinting happens at the C++ engine level, not via JS patches. The
2026-08-04 spike proved a headless Camoufox pass every previously-blocked site
for free:

| Site | Plain Playwright | Camoufox (headless, free) |
|------|------------------|---------------------------|
| kogan.com (DataDome) | 403 / "Captcha Challenge" shell | 200 real PDP, price $199.98 |
| noelleeming.co.nz (Cloudflare) | 403 "Just a moment…" | 200 real PDP, price $917.00 |
| farmers.co.nz (Akamai) | /WAF_Deny_Page/ or Access Denied | 200 real PDP, $24.99 |

Strategy decision (user, 2026-08-04): **Camoufox is the only fetch transport.**
Playwright/Chromium is removed from the app entirely; there is no dual-path
orchestration. Since the 2026-08-20 argus migration the browser runs in the
standalone **argus** service (sibling repo `../argus`), not in the iris
image: iris stays a Node-only container and calls argus over HTTP. Argus is
a required dependency in every environment (dev and prod): the app reads
`ARGUS_BASE_URL` + `ARGUS_API_TOKEN` (both required in `env.ts`) and fails
fast with a logged error if they are missing or argus is unreachable.

Prior approaches evaluated and superseded:
- Plain Playwright Chromium (the old transport): fails Akamai product paths
  outright, and cannot pass DataDome/Cloudflare on the sites above.
- `playwright-extra` + `puppeteer-extra-plugin-stealth` (two rounds, 2026-08-04):
  free/local JS stealth changes the Akamai response (instant deny → behavioral
  challenge) but never delivers a real Farmers product page. Removed.
- TLS-impersonation (`wreq-js` chrome profile): Cloudflare scores a whole
  browser family as one class; profile rotation has a blind spot.
- Paid scraping API / residential proxy: was the documented next escalation
  after the stealth verdict, but Camoufox covers all three challenge classes
  for free, so no paid service is needed.

### Pattern: argus HTTP client with the shared limiter

`fetchPage` is a thin HTTP client for argus (`POST ${ARGUS_BASE_URL}/v1/fetch`
with `Authorization: Bearer ${ARGUS_API_TOKEN}`). It no longer imports
Playwright or launches a browser. The operational envelope is preserved
exactly: the shared `pLimit(5)` (Shared Limiter Pattern), retry /
exponential-backoff / jitter (`MAX_RETRIES = 3`), and structured logging.
Argus holds ONE shared `AsyncCamoufox` browser and bounds its own concurrency
with an asyncio semaphore matching `FETCH_CONCURRENCY = 5`.

```typescript
// packages/prices/src/pipeline/fetch-page.ts (abridged)
export type FetchPageResult =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; signature: string };

async function attemptArgusFetch(url: string) {
  const { baseUrl, token } = getArgusConfig();
  const response = await fetch(`${baseUrl}/v1/fetch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`, // ARGUS_API_TOKEN — never logged
    },
    body: JSON.stringify({ url, detectBlocked: true }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // 45 s
  });
  // map JSON {ok:true,html,url}
  //   | {ok:false,reason:"blocked",signature,retryable}
  //   | {ok:false,reason:"fetch_failed"} | non-JSON/network → ok/blocked/error
}

export async function fetchPage(url: string, opts: FetchPageOptions) {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptArgusFetch(url);
      if (result.kind === "ok") {
        // argus already ran its registry (detectBlocked: true) — clean by contract
        return { kind: "ok", html: result.html, url: result.url };
      }
      if (result.kind === "blocked") {
        if (result.retryable && attempt < MAX_RETRIES) {
          // challenge evaluated per request → fresh page often passes; backoff + retry
          await sleep(backoffDelayMs(attempt));
          continue;
        }
        return { kind: "blocked", signature: result.signature };
      }
      // error → backoff and retry; null on total failure
    }
    return null;
  });
}
```

Classification lives in argus now: the old app-side detection pass and its
retry-decision helper were deleted with iris's `blocked-signatures.ts` (the
registry was ported verbatim to `../argus/src/argus/signatures.py`, same ids,
same predicates, same ordering). Argus surfaces the retry verdict directly on
the blocked response (`retryable`), so iris carries no registry code at all.

### Anti-bot challenge/deny detection (shipped — now in argus)

Because Camoufox is still a single transport (a regression on a site would have
no second path), every fetched page is run through a **generic anti-bot
signature check** before the caller sees `ok`. Since the 2026-08-20 argus
migration this registry lives in **argus**
(`../argus/src/argus/signatures.py`, ported verbatim from iris's deleted
`packages/prices/src/pipeline/blocked-signatures.ts`); iris sends
`detectBlocked: true` and consumes `{ ok: false, reason: "blocked", signature,
retryable }`. A match still short-circuits to the `blocked` variant so
`checkPrice` surfaces a specific anti-bot reason instead of the generic "Page
fetch failed" (AC3). The registry covers all challenge classes confirmed live
2026-08-04. Real PDPs that only embed a Cloudflare Turnstile widget (e.g.
pbtech) contain `challenges.cloudflare.com/turnstile` but are **not**
challenge shells — the signature must not treat bare
`challenges.cloudflare.com` on large pages as a block (false positive fixed
2026-08-04).

```typescript
// ../argus/src/argus/signatures.py (ported from the former iris
// packages/prices/src/pipeline/blocked-signatures.ts)
const BLOCKED_SIGNATURES = [
  // final deny verdict — not retryable (same fingerprint → same deny)
  { id: "akamai-waf", retryable: false, test: (html) => html.includes("/WAF_Deny_Page/") },
  // title "Access Denied" + small HTML (edge block after soft home pass);
  // intermittent per live behavior → retried (see 2026-08-08 finding below)
  { id: "akamai-access-denied", retryable: true, test: (html) => /* title + len < 5e3 */ },
  // intermediate behavioral challenge page (not a real PDP) — retryable
  { id: "akamai-behavioral-challenge", retryable: true, test: (html) =>
      html.includes("sec-if-cpt-container") && html.length < 20_000 },
  // head-only shell: no <title>, no <body>, <5 KB (failed-challenge snapshot) — retryable
  { id: "akamai-empty-shell", retryable: true, test: (html) =>
      html.length < 5_000 && !/<title[\s>]/i.test(html) && !/<body[\s>]/i.test(html) },
  // DataDome captcha (kogan when the challenge is not solved) — retryable
  { id: "datadome-captcha", test: (html) => html.includes("captcha-delivery.com") },
  // Cloudflare managed-challenge shell only — NOT bare Turnstile embeds on
  // real PDPs (pbtech loads challenges.cloudflare.com/turnstile on a full page).
  { id: "cloudflare-challenge", test: (html) =>
      html.includes("_cf_chl_opt") || html.includes("cf-chl")
      || (html.length < 5_000 && (
           /just a moment/i.test(title)
           || html.includes("challenges.cloudflare.com")
         )) },
];
// argus runs this registry on every /v1/fetch (detectBlocked defaults to
// true) and returns the verdict on the response:
//   { ok: false, reason: "blocked", signature, retryable }
```

**`retryable` contract**: a blocked signature with `retryable: true` is
retried by `fetchPage` with a fresh page and backoff (see below); `false`
returns immediately. Final deny verdicts (`akamai-waf`) are fingerprint-level
outcomes — retrying them just burns latency. Challenge shells (behavioral
challenges, captchas, managed challenges) default to retryable because
anti-bot challenges are evaluated per request.

```typescript
// packages/prices/src/pipeline/check-price.ts — after fetchPage
const page = await fetchPage(product.url, { productId });
if (!page) return { status: "failed", reason: "Page fetch failed" };       // transport
if (page.kind === "blocked") {
  logger.warn("Page blocked by anti-bot WAF", { productId, url, signature: page.signature });
  return { status: "failed", reason: `Anti-bot WAF deny page (${page.signature}) — …` };
}
// page.kind === "ok" → aiExtractPrice({ url: page.url, html: page.html, ... })
// Preloaded HTML: single generateText, no multi-step tool loop (ai-sdk §1e).
```

The registry is intentionally generic (id + predicate), not per-retailer code,
and the detection runs on every fetch (no hostname branching). The create flow
surfaces `check.reason`, so an operator sees "Anti-bot WAF deny page
(datadome-captcha) — …" instead of the generic text. Detection stays even
though Camoufox passes today: a clear failure beats a silent "unavailable",
and a regression on any site is visible, not silent.

### Live findings — Akamai behavioral challenge is probabilistic (2026-08-08)

farmers.co.nz (Akamai Bot Manager) serves a **behavioral challenge that is
probabilistic, not a hard deny**. Direct headless Camoufox probes of one
farmers PDP (same browser build the 08-04 spike used):

- ~55% of fresh attempts return the real PDP (~180–214 KB, price content
  present) in ~4–5 s.
- The rest return one of two failure shapes: the `sec-if-cpt-container`
  challenge (~2.6 KB, no title, no rendered text) or a head-only empty shell
  (~1.4–1.6 KB, no `<title>`, no `<body>`).
- **The challenge never resolves in-place once served** — observed 60+ s with
  zero content change. A longer render wait does NOT help; only a fresh page
  does.
- The failed-challenge navigation is slow (Akamai delays the response; one
  `goto` took 31.5 s), so retries must stay inside the 45 s per-attempt
  envelope and the `MAX_RETRIES` budget.

Mitigations shipped with this finding:

1. `akamai-empty-shell` signature closes the detection gap (the shell was
   previously treated as a real page → wasted AI call → misleading
   "unavailable").
2. `fetchPage` retries `retryable` blocked results with a fresh page and the
   existing exponential backoff. With a ~55% per-attempt pass rate, 3 attempts
   lift the effective success rate to ~90%. **Latency tradeoff**: a retryable
   challenge that never passes now costs up to `MAX_RETRIES` × per-attempt
   fetch time (each attempt up to 45 s) before the final `blocked` reason is
   returned, versus 1 attempt before. Bounded by the shared `MAX_RETRIES`;
   scheduler batches may hold limiter slots longer while stuck-blocked
   products retry.
3. The Camoufox build is pinned in **argus** (`pyproject.toml`) so rebuilds
   cannot silently drift the fingerprint. Verify the pass-rate matrix when
   bumping.
4. Argus pins the Camoufox fingerprint OS to `linux`
   (`AsyncCamoufox(headless=True, os="linux")`) and prunes the bundled
   `macos`/`windows` font directories (~891 MB of TTCs) after `camoufox
   fetch`. Rationale (2026-08): a macOS/Windows fingerprint whose named fonts
   fontconfig cannot resolve is itself a fingerprinting tell, and those TTCs
   gzip poorly. These are now argus-image concerns — the iris image contains
   no browser since the 2026-08-20 migration.

**Note**: the single-attempt pass rate was ~55% on the day of testing; it can
shift as Akamai tunes the challenge. The retry-on-blocked behavior absorbs
moderate drift; a site that degrades to a consistent hard deny will surface
the `akamai-waf` / `akamai-access-denied` reason on the first attempt instead.

**Escalation observed live (2026-08-08)**: after ~30 sustained probes from one
container IP in ~40 minutes, farmers' Akamai block escalated from the
probabilistic behavioral challenge to a **hard edge "Access Denied"** page
(`<title>Access Denied</title>`, ~0.5 KB, `errors.edgesuite.net` reference) on
8/8 subsequent attempts. This is rate/behavioral IP scoring, not a code
regression — the same browser/fingerprint passed ~5–6 attempts earlier. Keep
`akamai-access-denied` non-retryable (a hard edge 403 is a final verdict when
served; a retry adds ~3 × 3–4 s latency with no benefit). The block is expected
to decay as the IP cools down; a low-frequency scheduler cadence (one check
per product per poll interval) typically passes even while aggressive probing
gets denied. Re-run the pass-rate matrix after a cooling-off period; if a
retailer stays hard-blocked for a user, the documented escalation remains a
paid scraping API / residential proxy (08-04 PRD).

### Required wiring (post-migration, 2026-08-20)

- `ARGUS_BASE_URL` + `ARGUS_API_TOKEN` are required fields in
  `packages/utils/src/lib/env.ts` (no defaults → hard error at first use),
  matching the transport's required-dependency status.
- `.env.example` documents both; the token must match one of argus's
  `ARGUS_API_TOKENS` values.
- `fetch-page.ts` / `extract-image.ts` import `getEnv` (from `@iris/utils`)
  to build `${ARGUS_BASE_URL}/v1/fetch(-image)` calls with a bearer header;
  no Playwright import remains anywhere in iris.
- The app `Dockerfile` is Node-only: no Python venv, no GTK/NSS/X11 browser
  libs, no supervisord. The token is never baked into an image layer —
  runtime value comes from the compose environment.
- Keep the shared `pLimit` and structured logging wrapping the transport so
  observability is consistent across all fetches.

### Deployment: argus is external (post-migration, 2026-08-20)

The fetch service is deployed from its own repo (`../argus` — Dockerfile +
compose there; `./dev.sh` for local dev). Iris-side contract:

- `docker-compose.yml` passes `ARGUS_BASE_URL` (default
  `http://localhost:8000`) and requires `ARGUS_API_TOKEN`
  (`${ARGUS_API_TOKEN:?...}` → `compose up` fails loudly without a token).
  Argus may sit on any reachable host — same NAS or elsewhere.
- The entrypoint does NOT wait for argus health: iris starts regardless, and
  scrapes retry per product once argus is reachable (a down argus surfaces as
  "Page fetch failed" per check, never a boot failure).
- Argus `/health` is unauthenticated and returns `200 {status:"ok",
  browser:"ready"|"absent"}` — the browser is lazy by design, so `absent` is
  normal at boot.
- API shapes: `POST /v1/fetch` → `{ok:true,html,url}` |
  `{ok:false,reason:"blocked",signature,retryable}` |
  `{ok:false,reason:"fetch_failed"}`; `POST /v1/fetch-image` →
  `{ok:true,contentType,data(base64)}` | `{ok:false,reason}`. Full spec:
  `../argus/docs/api-spec.md`.

### Pattern: SPA render wait (post-domcontentloaded)

Client-rendered SPA product pages (Angular/React/Next.js) inject their price
via JavaScript *after* `domcontentloaded`. Snapshotting `page.content()` at
that event yields an empty shell — `reducePageHtml` produces empty content,
the AI reports `available:false`, and product create rolls back. Confirmed
2026-08-07 on an Angular SPA PDP: body stripped-text length was **0** at
`domcontentloaded`; the real product price (`$ 39 99`) appeared only after
hydration (~5.8 s).

**Why not `networkidle`?** Experiment against the live sidecar: after
`domcontentloaded`, `wait_for_load_state("networkidle")` still returned 0 body
text. The SPA reaches network idle before (or without) putting the price in
the DOM. `networkidle` also penalizes every page (analytics/polling hang).

**Chosen approach** — generic content-stabilization wait in the fetch service
(now argus) after a successful `goto` and before `page.content()`:

```python
RENDER_WAIT_SECONDS = 8.0   # cap; well under FETCH_TIMEOUT_SECONDS (45)
RENDER_MIN_TEXT_LEN = 200   # ignore chrome stubs (<200) so they don't "stabilize"
RENDER_STABLE_SECONDS = 1.0 # return once body.innerText.length is unchanged this long

async def _wait_for_render(page) -> None:
    # Poll document.body.innerText.length every 100 ms.
    # Lengths < RENDER_MIN_TEXT_LEN do NOT start the stability clock
    # (SPA shells often render ~9 chars of chrome for ~2 s before real content).
    # Once above the floor, return when length is stable for RENDER_STABLE_SECONDS
    # OR when RENDER_WAIT_SECONDS elapses. Never raises — best-effort only.
    ...
```

Handler placement (only on the success path; failure paths unchanged):

```python
response = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
if response is None:
    _record_failure(...); return FetchResponseFail(reason="fetch_failed")
await _wait_for_render(page)   # NEW — bounded SPA wait
html = await page.content()
```

**Contracts / constraints**

| rule | detail |
|---|---|
| Generic | No retailer/host branching, no per-site selectors (anti-pattern below) |
| Bounded | Cap = 8 s; never-rendering pages still fail inside the 45 s envelope |
| Best-effort | `_wait_for_render` never raises; evaluate errors just end the wait |
| Static pages | Text already present at `domcontentloaded` → stabilizes in ~1 s once above floor |
| API | `/v1/fetch` and `/health` shapes unchanged; `FETCH_TIMEOUT_SECONDS` / `SIDECAR_CONCURRENCY` unchanged |
| Diagnostics | Failure accounting from the diagnose task is intact (wait is on the success path only) |

**Validation (assertion points)**

- SPA PDP (e.g. woolworths productdetails): returned HTML has body text length
  > 0 AND a price-bearing token; AI extraction yields `{available:true, price, …}`.
- Static/server-rendered PDP still extracts; latency not unbounded.
- No `woolworths` / hostname `if` anywhere in the fetch-service code (comments naming the
  experiment retailer are fine; code branches are not).
- The pattern is implemented in the fetch service (argus), not in iris.

**Wrong vs Correct**

```python
# Wrong — snapshot at domcontentloaded (SPA shell is empty)
await page.goto(url, wait_until="domcontentloaded", timeout=45000)
html = await page.content()  # body text len == 0 on Angular/React SPAs

# Wrong — networkidle (experimentally still empty; penalizes every page)
await page.goto(url, wait_until="domcontentloaded", timeout=45000)
await page.wait_for_load_state("networkidle")  # still 0 text on woolworths
html = await page.content()

# Wrong — per-retailer selector (anti-pattern)
if "woolworths" in url:
    await page.wait_for_selector("[data-testid=price]")

# Correct — generic content-stabilization wait
await page.goto(url, wait_until="domcontentloaded", timeout=45000)
await _wait_for_render(page)  # poll innerText length; floor + stable + cap
html = await page.content()
```

### Pattern: Lazy browser lifecycle (launch on first fetch, teardown on idle)

The shared `AsyncCamoufox` browser is the single biggest resident resource in
the container (~350-500 MB RSS across `camoufox-bin` + contentproc children).
On a lightly-loaded host (e.g. a NAS scraping once per hour) an always-on
browser is ~500 MB doing nothing for ~59 min/hour. The lifecycle is therefore
**lazy**: launched on the first `POST /v1/fetch`, reused for subsequent
fetches, and torn down after a configurable idle period with no fetch activity
(`BROWSER_IDLE_TIMEOUT_SECONDS`, default 300 s, env
`CAMOUFOX_IDLE_TIMEOUT_SECONDS`).

**Contract (code-spec)** (implemented in argus since 2026-08-20; originally
shipped as iris's `camoufox/server.py`):
- The browser is **NOT** launched in `lifespan`. `lifespan` only creates the
  semaphore, a launch `asyncio.Lock`, and an `_idle_watcher` background task.
  `/health` returns `200 {"status":"ok","browser":"ready"|"absent"}` as soon
  as the app is up — `browser` is informational, not a readiness gate (a 503
  here would block `docker-entrypoint.sh`'s boot gate forever).
- `_ensure_browser()` is the single-flight lazy launch: double-checked locking
  on `_launch_lock` so N concurrent fetches when ABSENT launch exactly one
  Firefox. Launch failure clears `_browser`/`_camoufox_ctx` to ABSENT and
  re-raises → the caller records a `fetch_failed` and the next request retries.
- `_teardown_browser_if_idle()` runs from `_idle_watcher` every
  `IDLE_POLL_SECONDS` (30 s). It is a no-op while a fetch is in-flight
  (`_active_fetches > 0`, checked unlocked then re-checked under the lock), so
  a long navigation is never killed mid-flight. Teardown nulls the handles
  **before** calling `__aexit__` so a concurrent fetch sees ABSENT and launches
  fresh rather than reusing a browser being torn down.
- `_active_fetches` is incremented in the `fetch` handler before
  `_do_fetch` and decremented in a `finally` — it gates teardown, while the
  semaphore still bounds concurrency (5).
- Teardown is normal operation: it must **not** touch the
  `_consecutive_failures` counter (only fetch success/failure does).

Verified 2026-08-12 on a 1.95 GB image: at boot (browser absent) the
container sits at ~320 MiB / <1.5% CPU; after a fetch the browser is resident
at ~720 MiB; after the idle timeout it is reaped and RAM returns to ~310 MiB.
Measured ~500 MiB idle savings vs. the old always-on lifespan launch.

### Pattern: fetch-service failure logging and degradation diagnostics

(Implemented in argus since 2026-08-20; the code excerpts below are kept from
the original iris `camoufox/server.py` implementation as the executable
contract argus ports.)
shared `AsyncCamoufox` browser silently degraded and every `page.goto` raised.
The pre-fix code logged only `str(exc)` (no exception class) and the
`response is None` path logged nothing, so the root cause was invisible.

**Contract (code-spec)**: every failure path in `POST /v1/fetch` records a
structured WARNING with `error_type` (qualified exception class name) + `error`
(message) + `consecutive_failures` (running count), and exactly one richer
"browser degraded" summary at the threshold. The counter and threshold are
LOGGING-ONLY — no browser recreation, no `asyncio.Lock`, no teardown here
(that is the self-heal task's scope; this diagnostic fires at the same point
a future self-heal would trigger, so the logs map 1:1).

```python
# fetch service (argus; originally iris camoufox/server.py)
DIAGNOSE_THRESHOLD = 3  # aligned with the self-heal task's HEAL_THRESHOLD
_consecutive_failures: int = 0  # module-level; logging-only

def _exc_type_name(exc: BaseException) -> str:
    cls = type(exc)
    module = getattr(cls, "__module__", "") or ""
    qualname = getattr(cls, "__qualname__", cls.__name__)
    return f"{module}.{qualname}" if module else qualname

def _record_failure(url: str, exc: BaseException | None, *, kind: str) -> None:
    # kind ∈ {"timeout", "error", "no_response"}; no_response has no exc object
    global _consecutive_failures
    _consecutive_failures += 1
    logger.warning("sidecar fetch %s", kind, extra={
        "url": url,
        "error": str(exc) if exc else "page.goto returned no response",
        "error_type": _exc_type_name(exc) if exc else kind,
        "consecutive_failures": _consecutive_failures,
    })
    # Rich summary (repr + traceback) fires ONCE at the threshold, not on
    # every transient timeout; suppressed for no_response (no exc to dump).
    if _consecutive_failures == DIAGNOSE_THRESHOLD and exc is not None:
        logger.warning("sidecar browser degraded — …", extra={..., "traceback": ...})

def _record_success() -> None:
    global _consecutive_failures
    _consecutive_failures = 0  # any successful fetch clears the trend
```

Handler routing (all paths return the SAME response bodies — no API change):

```python
# /v1/fetch
if response is None:
    _record_failure(request.url, None, kind="no_response")  # R3: was silent
    return FetchResponseFail(reason="fetch_failed")
# ... response.ok path ...
_record_success()  # non-2xx challenge/deny pages are per-site, NOT degradation
return FetchResponseOk(html=html, url=final_url)
except asyncio.TimeoutError as exc:
    _record_failure(request.url, exc, kind="timeout")
    return FetchResponseFail(reason="fetch_failed")
except Exception as exc:  # noqa: BLE001 — never throw to the caller
    _record_failure(request.url, exc, kind="error")  # new_page()/goto failures
    return FetchResponseFail(reason="fetch_failed")
```

**Validation & error matrix**

| condition | log | response | counter |
|---|---|---|---|
| `response.ok` (incl. non-2xx challenge HTML) | (non-2xx WARNING only) | `FetchResponseOk` | reset → 0 |
| `response is None` | WARNING `no_response` | `FetchResponseFail` | +1 |
| `asyncio.TimeoutError` | WARNING `timeout` (+`error_type`) | `FetchResponseFail` | +1 |
| any other `Exception` | WARNING `error` (+`error_type`) | `FetchResponseFail` | +1 |
| count reaches `DIAGNOSE_THRESHOLD` (3) with exc | +1 rich "degraded" summary w/ traceback | (unchanged) | keeps counting |

**Good/Base/Bad cases**

- **Good**: 1 timeout then a success → counter resets to 0; no degraded line.
- **Base**: 3 consecutive `goto` errors → exactly one "browser degraded" line with traceback; 4th failure logs per-request line only (no re-emit until reset).
- **Bad (pre-fix)**: `response is None` silent; `error` logged as bare message with no class → root cause invisible after hours of uptime.

**Tests required** (assertion points)

- Per-request failure line carries `error_type` = qualified class name (e.g. `playwright.async_api.Error`), not just the message.
- `response is None` emits a WARNING (previously silent).
- Counter increments `1→2→3→4` across consecutive failures; `_record_success` resets to 0.
- Exactly one "browser degraded" summary at count == 3; none at 4; none for `no_response` (exc is None).
- `/v1/fetch` and `/health` responses byte-identical to pre-change for ok / non-2xx / timeout / error.
- Changes to this pattern belong in the fetch service (argus), not iris.

**Wrong vs Correct**

```python
# Wrong — bare message, silent no-response path, no trend
except Exception as exc:  # noqa: BLE001
    logger.warning("sidecar fetch error", extra={"url": request.url, "error": str(exc)})
    return FetchResponseFail(reason="fetch_failed")
# response is None → return FetchResponseFail(reason="fetch_failed")  # no log at all

# Correct — type + message + counter; no-response accounted; threshold summary
except Exception as exc:  # noqa: BLE001
    _record_failure(request.url, exc, kind="error")
    return FetchResponseFail(reason="fetch_failed")
```

**Gotcha**: the fetch service runs Python stdlib `logging`, NOT the app's TS
`@iris/utils` logger. The backend `logging.md` `console.log` ban and TS logger
API do not apply there — match the existing `logger.warning(..., extra={...})`
style. These internals now live in the argus repo (`../argus`).

### Local dev

`pnpm dev` requires a reachable argus service. Start it from its own repo
(`../argus/dev.sh`, or `docker compose up` there) before starting the app.
The README and `.env.example` note this; set `ARGUS_BASE_URL=http://localhost:8000`
and copy the dev token from `../argus/.env` into iris's `.env`.

### Anti-pattern: retailer-specific code

Do NOT add a per-retailer branch like "if the URL contains pbtech.co.nz, use
transport X". The single Camoufox transport handles every retailer the same
way; any future anti-bot-protected site benefits automatically. There is no
URL allowlist and no per-hostname code path. The same rule applies to anti-bot
layers: WAF-deny detection is applied **globally** to every fetch, never keyed
off a hostname.

## Memory Optimization

### Streaming Large Datasets

For very large datasets, use streaming:

```typescript
async function* streamOrders(userId: string): AsyncGenerator<Order> {
  let cursor: string | undefined;
  const PAGE_SIZE = 100;

  while (true) {
    const orders = await db
      .select()
      .from(orderTable)
      .where(and(
        eq(orderTable.userId, userId),
        cursor ? gt(orderTable.id, cursor) : undefined
      ))
      .orderBy(asc(orderTable.id))
      .limit(PAGE_SIZE);

    if (orders.length === 0) {
      break;
    }

    for (const order of orders) {
      yield order;
    }

    const lastOrder = orders[orders.length - 1];
    cursor = lastOrder?.id;

    if (orders.length < PAGE_SIZE) {
      break;
    }
  }
}

// Usage
for await (const order of streamOrders(userId)) {
  await processOrder(order);
}
```
