import pLimit from "p-limit";
import { getEnv, logger } from "@iris/utils";
import { backoffDelayMs } from "./retry";

/**
 * Product-price extraction via the standalone argus service's
 * `POST /v1/extract-price`. Replaces iris's former two-step pipeline
 * (HTML fetching plus in-process LLM extraction, both removed 2026-08-25):
 * argus navigates the page through its anti-detect browser, runs the
 * blocked-signature registry, then extracts deterministically from JSON-LD —
 * falling back to its own internal LLM when configured (`aiFallback=true`
 * default). Blocked pages short-circuit BEFORE any model call, preserving the
 * exact operator-facing semantics iris's `checkPrice` documented.
 *
 * Iris keeps the orchestration envelope: the shared `pLimit(5)` budget
 * (performance.md — Shared Limiter Pattern), retry / exponential-backoff /
 * jitter (`MAX_RETRIES = 3`), and structured logging. Argus bounds its own
 * concurrency with an asyncio semaphore matching this budget.
 *
 * Retry policy (per response `reason`):
 * - `fetch_failed` / transport-class failures (network, non-2xx, non-JSON,
 *   unexpected payload) → retried with backoff; `"Page fetch failed"` after
 *   exhaustion.
 * - `blocked` → retried only when argus marks the signature `retryable`
 *   (challenge pages are evaluated per request); otherwise immediate.
 * - `extraction_failed` → terminal, never retried: the page fetched fine and
 *   argus's extraction (including its internal LLM retries) already gave up;
 *   `"Price extraction failed"` immediately.
 */

const EXTRACT_CONCURRENCY = 5;
/**
 * Per-attempt envelope. Generous by design: argus's own worst case stacks
 * navigation (up to 35s) + SPA render wait (8s) + the LLM fallback with
 * internal retries (free-tier models can be slow), and aborting mid-flight
 * would waste all of that server-side work AND trigger a duplicate full
 * extraction on retry. Argus keeps its per-request navigation timeout below
 * this so it (not our AbortSignal) owns the failure classification.
 */
const EXTRACT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

/**
 * Result of a price extraction (design.md §R1).
 *
 * - `ok`: argus produced an answer. `price` is a decimal number or `null`
 *   (only when `available === false`). `jsonld` is the primary schema.org
 *   Product node when extraction came from structured data (`source` would
 *   have been `"jsonld"`), else `null`.
 * - `blocked`: anti-bot challenge/deny page — `signature` is the registry id
 *   (e.g. `datadome-captcha`). No price exists; callers short-circuit to the
 *   clear anti-bot failure reason instead of masking it as "unavailable".
 * - `error`: terminal failure after the retry loop; `message` is one of the
 *   legacy operator-facing strings ("Page fetch failed" /
 *   "Price extraction failed").
 */
export type ExtractPriceResult =
  | {
      kind: "ok";
      url: string;
      available: true;
      /** Usable decimal price — guaranteed present when `available` is true. */
      price: number;
      currency: string | null;
      name: string | null;
      jsonld: Record<string, unknown> | null;
    }
  | {
      kind: "ok";
      url: string;
      available: false;
      price: null;
      currency: null;
      name: string | null;
      jsonld: Record<string, unknown> | null;
    }
  | { kind: "blocked"; signature: string }
  | { kind: "error"; message: string };

export interface ExtractPriceOptions {
  /** Optional caller context for structured logging. */
  productId?: string;
}

/** Module-wide limiter: all extractions share this concurrency budget. */
const extractLimiter = pLimit(EXTRACT_CONCURRENCY);

/**
 * Resolve the argus base URL + bearer token. Both are required in env, so a
 * missing value is a hard config error at first use. Trailing slashes are
 * stripped so `base + "/v1/extract-price"` always works. The token is only
 * ever placed in an Authorization header — never logged.
 */
function getArgusConfig(): { baseUrl: string; token: string } {
  const { ARGUS_BASE_URL, ARGUS_API_TOKEN } = getEnv();
  return { baseUrl: ARGUS_BASE_URL.replace(/\/+$/, ""), token: ARGUS_API_TOKEN };
}

/** Body shape of a successful argus extract-price response. */
interface ArgusExtractOkResponse {
  ok: true;
  source?: string;
  url?: unknown;
  available?: unknown;
  price?: unknown;
  currency?: unknown;
  name?: unknown;
  jsonld?: unknown;
}

/**
 * Body shape of an argus extract-price failure response (argus never throws).
 * Blocked responses carry the signature id + retryable verdict from argus's
 * registry (ported verbatim from iris's old blocked-signatures.ts).
 */
interface ArgusExtractFailResponse {
  ok: false;
  reason: "blocked" | "fetch_failed" | "extraction_failed";
  /** Present when `reason === "blocked"`: registry signature id. */
  signature?: string;
  /** Present when `reason === "blocked"`: fresh-attempt verdict. */
  retryable?: boolean;
}

/**
 * Perform a single argus extract-price attempt. POST
 * `${ARGUS_BASE_URL}/v1/extract-price` with bearer auth and a generous per-
 * attempt timeout (see EXTRACT_TIMEOUT_MS). Never throws: every outcome is a
 * well-formed ExtractAttempt — `retryable-error` feeds the caller's backoff
 * loop, `terminal-error` short-circuits it.
 */
type ExtractAttempt =
  // Reuse the public discriminated ok shapes so narrowing at the call site
  // matches ExtractPriceResult exactly.
  | Extract<ExtractPriceResult, { kind: "ok" }>
  | { kind: "blocked"; signature: string; retryable: boolean }
  | { kind: "retryable-error"; message: string }
  | { kind: "terminal-error"; message: string };

async function attemptArgusExtract(
  url: string,
): Promise<ExtractAttempt> {
  const { baseUrl, token } = getArgusConfig();
  const endpoint = `${baseUrl}/v1/extract-price`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Auth/config failures will never succeed on retry — fail fast instead
      // of burning MAX_RETRIES × backoff on a guaranteed-401 loop. Transient
      // classes (5xx, 408, 429) stay retryable like any transport error.
      const status = response.status;
      if (!(status >= 500 || status === 408 || status === 429)) {
        return {
          kind: "terminal-error",
          message: `Page fetch failed (argus HTTP ${status} ${response.statusText})`,
        };
      }
      return {
        kind: "retryable-error",
        message: `argus HTTP ${status} ${response.statusText}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "retryable-error", message: `argus non-JSON response: ${message}` };
    }

    if (
      payload &&
      typeof payload === "object" &&
      (payload as { ok?: unknown }).ok === true
    ) {
      const ok = payload as ArgusExtractOkResponse;

      const priceRaw = ok.price;
      let price: number | null = null;
      if (typeof priceRaw === "string") {
        // argus returns decimal-normalized 2dp strings ("599.99") so values
        // round-trip JSON cleanly; convert once here and reject garbage.
        // Positive-only matches the old pipeline's z.number().positive()
        // contract — Number("") === Number("0") === 0 must NOT pass as a real
        // price, or a garbage payload becomes a $0.00 reading and a false
        // "price dropped to $0" alert.
        price = Number(priceRaw);
        if (!Number.isFinite(price) || price <= 0) {
          return { kind: "terminal-error", message: "Price extraction failed" };
        }
      } else if (priceRaw !== null && priceRaw !== undefined) {
        return { kind: "terminal-error", message: "Price extraction failed" };
      }

      if (typeof ok.url !== "string" || typeof ok.available !== "boolean") {
        return {
          kind: "retryable-error",
          message: "argus extract-price returned an unexpected payload",
        };
      }

      const currency =
        typeof ok.currency === "string" ? ok.currency : null;
      const name = typeof ok.name === "string" ? ok.name : null;
      const jsonld =
        ok.jsonld && typeof ok.jsonld === "object"
          ? (ok.jsonld as Record<string, unknown>)
          : null;

      if (ok.available) {
        // Available products must carry a usable price; anything else is a
        // degraded extraction rather than a real "no price" state.
        if (price === null) {
          return { kind: "terminal-error", message: "Price extraction failed" };
        }
        return {
          kind: "ok",
          url: ok.url,
          available: true,
          price,
          currency,
          name,
          jsonld,
        };
      }
      return {
        kind: "ok",
        url: ok.url,
        available: false,
        price: null,
        currency: null,
        name,
        jsonld,
      };
    }

    if (
      payload &&
      typeof payload === "object" &&
      (payload as { ok?: unknown }).ok === false
    ) {
      const fail = payload as ArgusExtractFailResponse;
      const reason = typeof fail.reason === "string" ? fail.reason : "unknown";

      if (reason === "blocked") {
        return {
          kind: "blocked",
          // Defensive: argus sends both fields on a blocked response; fall
          // back conservatively (unknown signature → retryable) if absent.
          signature:
            typeof fail.signature === "string" ? fail.signature : "unknown",
          retryable: typeof fail.retryable === "boolean" ? fail.retryable : true,
        };
      }
      if (reason === "extraction_failed") {
        // Terminal: the page loaded; argus's extraction already exhausted its
        // own options (JSON-LD miss + internal LLM fallback).
        return { kind: "terminal-error", message: "Price extraction failed" };
      }
      // fetch_failed and anything unrecognized: transport-class, retryable.
      return { kind: "retryable-error", message: `argus fetch failed (${reason})` };
    }

    return { kind: "retryable-error", message: "argus returned an unexpected payload" };
  } catch (error) {
    // Network errors (`TypeError`), aborts, timeouts — all transport-class.
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "retryable-error", message };
  }
}

/**
 * Extract a product price via the argus service.
 *
 * Retry semantics (see module doc): transport-class failures retry up to
 * `MAX_RETRIES` with backoff and surface `"Page fetch failed"`;
 * `blocked` results honor argus's per-signature `retryable` verdict and
 * surface the signature id; `extraction_failed` is terminal as
 * `"Price extraction failed"`. The two error strings match the reasons the
 * former in-process pipeline produced, so downstream UI text is unchanged.
 */
export async function extractPrice(
  url: string,
  options: ExtractPriceOptions = {},
): Promise<ExtractPriceResult> {
  return extractLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptArgusExtract(url);

      if (result.kind === "ok") {
        return result;
      }

      if (result.kind === "blocked") {
        logger.warn("Page blocked by anti-bot challenge (argus)", {
          url,
          signature: result.signature,
          retryable: result.retryable,
          attempt,
          productId: options.productId,
        });
        if (result.retryable && attempt < MAX_RETRIES) {
          await sleep(backoffDelayMs(attempt));
          continue;
        }
        return { kind: "blocked", signature: result.signature };
      }

      if (result.kind === "terminal-error") {
        logger.warn("Price extraction failed (argus)", {
          url,
          reason: result.message,
          attempt,
          productId: options.productId,
        });
        return { kind: "error", message: result.message };
      }

      logger.warn("Price extraction argus error", {
        url,
        error: result.message,
        attempt,
        productId: options.productId,
      });
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }

      logger.error("Page fetch failed after retries", {
        url,
        error: result.message,
        productId: options.productId,
      });
      return { kind: "error", message: "Page fetch failed" };
    }

    return { kind: "error", message: "Page fetch failed" };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
