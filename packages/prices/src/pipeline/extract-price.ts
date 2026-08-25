import pLimit from "p-limit";
import { z } from "zod";
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

/**
 * Zod contract for argus's `POST /v1/extract-price` response.
 *
 * External API responses are validated with Zod (shared/typescript.md) rather
 * than ad-hoc `typeof` checks so the argus contract is explicit and a drifted
 * payload fails loudly instead of silently mis-shaping an `ok` result.
 *
 * `ok: true` is discriminated by `available`:
 * - `available: true` requires a price field (string or number).
 * - `available: false` permits a null/absent price.
 * `ok: false` is discriminated by `reason` (`blocked` / `extraction_failed` /
 * `fetch_failed`); unknown reasons fall through to the retryable branch.
 *
 * Price positivity is NOT enforced in the schema: a non-positive/non-finite
 * price on an `available: true` response is a degraded extraction, which the
 * original pipeline classified as a TERMINAL "Price extraction failed" (not a
 * retryable transport error). Keeping the schema permissive for the numeric
 * value and checking positivity afterward preserves that classification —
 * a schema rejection would otherwise turn it into a retryable "unexpected
 * payload" and burn the retry budget for nothing.
 */
const priceField = z
  .union([z.string(), z.number()])
  .transform((raw): number => {
    // argus returns decimal-normalized 2dp strings ("599.99") so values
    // round-trip JSON cleanly, but accept a JSON number too. Non-numeric
    // strings coerce to NaN here; the caller rejects them as a terminal
    // extraction failure below.
    return typeof raw === "number" ? raw : Number(raw);
  });

const argusOkResponseSchema = z.discriminatedUnion("available", [
  z.object({
    ok: z.literal(true),
    source: z.string().optional(),
    url: z.string(),
    available: z.literal(true),
    // `price` is accepted nullish so an `available: true` response that
    // omitted/failed the price still parses; the post-parse check below maps
    // a null/non-positive price to a terminal "Price extraction failed".
    price: priceField.nullish(),
    currency: z.string().min(1).max(16).nullish(),
    name: z.string().nullish(),
    jsonld: z.record(z.string(), z.unknown()).nullish(),
  }),
  z.object({
    ok: z.literal(true),
    source: z.string().optional(),
    url: z.string(),
    available: z.literal(false),
    price: priceField.nullish(),
    currency: z.string().min(1).max(16).nullish(),
    name: z.string().nullish(),
    jsonld: z.record(z.string(), z.unknown()).nullish(),
  }),
]);

const argusFailResponseSchema = z.object({
  ok: z.literal(false),
  reason: z.string(),
  // Present when `reason === "blocked"`: registry signature id + fresh-attempt
  // verdict. Defaults are applied defensively below.
  signature: z.string().optional(),
  retryable: z.boolean().optional(),
});

const argusResponseSchema = z.discriminatedUnion("ok", [
  argusOkResponseSchema,
  argusFailResponseSchema,
]);

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

    const parsed = argusResponseSchema.safeParse(payload);
    if (!parsed.success) {
      // Malformed/unexpected payload: transport-class, retryable — matches the
      // prior behavior for an unexpected shape.
      return { kind: "retryable-error", message: "argus returned an unexpected payload" };
    }
    const data = parsed.data;

    if (data.ok) {
      if (data.available) {
        // Available products must carry a usable positive price; a
        // null/absent, non-finite, or non-positive price (e.g. argus sent
        // null, "", "0", or a negative) is a degraded extraction — terminal,
        // not retryable — so a garbage payload never becomes a $0.00 reading
        // and a false "price dropped to $0" alert. NaN reaches here only from
        // a non-numeric string that still satisfied the schema's `string()`
        // branch.
        const price = data.price;
        if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) {
          return { kind: "terminal-error", message: "Price extraction failed" };
        }
        return {
          kind: "ok",
          url: data.url,
          available: true,
          price,
          currency: data.currency ?? null,
          name: data.name ?? null,
          jsonld: data.jsonld ?? null,
        };
      }
      return {
        kind: "ok",
        url: data.url,
        available: false,
        price: null,
        currency: null,
        name: data.name ?? null,
        jsonld: data.jsonld ?? null,
      };
    }

    // `ok: false` — classify by `reason`.
    const reason = data.reason;
    if (reason === "blocked") {
      return {
        kind: "blocked",
        // Defensive: argus sends both fields on a blocked response; fall
        // back conservatively (unknown signature → retryable) if absent.
        signature: data.signature ?? "unknown",
        retryable: data.retryable ?? true,
      };
    }
    if (reason === "extraction_failed") {
      // Terminal: the page loaded; argus's extraction already exhausted its
      // own options (JSON-LD miss + internal LLM fallback).
      return { kind: "terminal-error", message: "Price extraction failed" };
    }
    // fetch_failed and anything unrecognized: transport-class, retryable.
    return { kind: "retryable-error", message: `argus fetch failed (${reason})` };
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
