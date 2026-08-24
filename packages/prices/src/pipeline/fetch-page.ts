import pLimit from "p-limit";
import { getEnv, logger } from "@iris/utils";
import { backoffDelayMs } from "./retry";

/**
 * Page fetching via the standalone argus service — a general-purpose
 * anti-detect-browser (Camoufox) fetch transport reached over HTTP with
 * bearer auth. Replaces the prior in-process Playwright Chromium transport:
 * several major NZ retailers sit behind hard anti-bot challenges (DataDome /
 * Cloudflare managed / Akamai Bot Manager) that plain Chromium cannot pass,
 * so `create` failed with the generic "Page fetch failed".
 *
 * Camoufox is an engine-level anti-detect Firefox fork; the 2026-08-04 spike
 * proved it passes all three challenge classes for free. It is now the SINGLE
 * fetch transport — there is no Playwright/Chromium in the app anymore, and
 * no dual-path orchestration. Argus is a required dependency in every
 * environment (env.ts: missing ARGUS_BASE_URL / ARGUS_API_TOKEN is a hard
 * config error at first use).
 *
 * This module is a thin HTTP client for argus. It preserves the operational
 * envelope of the prior transport: the shared `pLimit` (performance.md —
 * Shared Limiter Pattern), the retry / exponential-backoff / jitter loop, and
 * the structured logging. Argus holds ONE shared `AsyncCamoufox` browser
 * (lazy-launched, idle-torn-down) and bounds concurrency with its own asyncio
 * semaphore matching `FETCH_CONCURRENCY`.
 *
 * Anti-bot classification lives in argus now: its blocked-signature registry
 * (ported from iris's old blocked-signatures.ts) runs on every fetched page
 * (request sends `detectBlocked: true`) and returns the signature id plus a
 * `retryable` verdict directly on the blocked response.
 *
 * `fetchPage` returns a discriminated union so callers can distinguish a real
 * page from a detected challenge/deny page (AC3) and from a transport failure
 * (the generic "Page fetch failed").
 */

const FETCH_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 3;

/**
 * Discriminated result of a page fetch (design.md §fetchPage return type).
 *
 * - `ok`: the page loaded and argus's blocked-signature registry found no
 *   challenge marker (argus runs the registry itself; `detectBlocked: true`).
 * - `blocked`: argus classified the returned HTML as a known challenge /
 *   deny page — no real content. `signature` is the registry id (e.g.
 *   `datadome-captcha`), surfaced in the failure reason.
 * - `null`: the transport itself failed after retries (network error, argus
 *   unreachable, non-JSON response). Callers map this to "Page fetch failed".
 */
export type FetchPageResult =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; signature: string };

export interface FetchPageOptions {
  /** Optional caller context for structured logging. */
  productId?: string;
}

/** Module-wide limiter: all page fetches share this concurrency budget. */
const pageFetchLimiter = pLimit(FETCH_CONCURRENCY);

/**
 * Resolve the argus base URL + bearer token. Both are required in env, so a
 * missing value is a hard config error at first use (matching
 * `DATABASE_PATH`). Trailing slashes are stripped so `base + "/v1/fetch"`
 * always works. The token is only ever placed in an Authorization header —
 * never logged.
 */
function getArgusConfig(): { baseUrl: string; token: string } {
  const { ARGUS_BASE_URL, ARGUS_API_TOKEN } = getEnv();
  return { baseUrl: ARGUS_BASE_URL.replace(/\/+$/, ""), token: ARGUS_API_TOKEN };
}

/** Body shape of a successful argus fetch response. */
interface ArgusOkResponse {
  ok: true;
  html: string;
  url: string;
}

/**
 * Body shape of an argus fetch failure response (argus never throws). A
 * blocked page carries the signature id + retryable verdict from argus's
 * registry (ported verbatim from iris's old blocked-signatures.ts).
 */
interface ArgusFailResponse {
  ok: false;
  reason: "blocked" | "fetch_failed";
  /** Present when `reason === "blocked"`: registry signature id. */
  signature?: string;
  /** Present when `reason === "blocked"`: fresh-attempt verdict. */
  retryable?: boolean;
}

/**
 * Outcome of a single argus attempt. `error` covers any transport-level
 * failure (network error, non-2xx status, non-JSON body, timeout) so the
 * retry loop can back off and try again. Argus classifies anti-bot blocks
 * itself (the request sends `detectBlocked: true`), so an `ok` payload is
 * clean by contract and no app-side classification remains.
 */
type FetchAttempt =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; signature: string; retryable: boolean }
  | { kind: "error"; message: string };

/**
 * Perform a single argus fetch. POST `ARGUS_BASE_URL + /v1/fetch` with bearer
 * auth and a 45 s timeout. Never throws: any failure (network error,
 * non-JSON, non-2xx, timeout, schema mismatch) is mapped to
 * `{ kind: "error" }` so the retry loop owns all backoff decisions.
 */
async function attemptArgusFetch(url: string): Promise<FetchAttempt> {
  const { baseUrl, token } = getArgusConfig();
  const endpoint = `${baseUrl}/v1/fetch`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url, detectBlocked: true }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        kind: "error",
        message: `argus HTTP ${response.status} ${response.statusText}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "error", message: `argus non-JSON response: ${message}` };
    }

    if (
      payload &&
      typeof payload === "object" &&
      (payload as { ok?: unknown }).ok === true
    ) {
      const ok = payload as ArgusOkResponse;
      if (typeof ok.html === "string" && typeof ok.url === "string") {
        return { kind: "ok", html: ok.html, url: ok.url };
      }
    }

    if (
      payload &&
      typeof payload === "object" &&
      (payload as { ok?: unknown }).ok === false
    ) {
      const fail = payload as ArgusFailResponse;
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
      return { kind: "error", message: `argus fetch failed (${reason})` };
    }

    return { kind: "error", message: "argus returned an unexpected payload" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message };
  }
}

/**
 * Fetch a product page via the argus service (Camoufox transport).
 *
 * Returns `null` when the transport ultimately fails after retries (so callers
 * map it to "Page fetch failed"), or a `blocked` variant when a challenge/deny
 * page was detected (AC3: a specific anti-bot reason, never "Page fetch
 * failed").
 *
 * Anti-bot challenges are evaluated per request, so a `blocked` result whose
 * signature is `retryable` (behavioral challenges, captchas, managed
 * challenges) is retried with a fresh page and backoff — confirmed live
 * 2026-08-08: farmers.co.nz's Akamai behavioral challenge passes ~55% of
 * fresh attempts, so retrying lifts the effective success rate well above the
 * single-attempt pass rate. Final deny signatures (`retryable: false`) return
 * immediately.
 *
 * This loop is custom (not the shared `retryWithBackoff` helper) because the
 * per-attempt outcome is a 3-way discriminated union rather than a thrown /
 * not-thrown pair: a `blocked` result that is `retryable: true` must trigger a
 * retry the same way a transport `error` does, while a non-retryable block
 * returns immediately.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult | null> {
  return pageFetchLimiter(async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await attemptArgusFetch(url);

      if (result.kind === "ok") {
        // Argus already ran the blocked-signature registry (detectBlocked:
        // true) — an `ok` payload is classified clean by contract.
        return { kind: "ok", html: result.html, url: result.url };
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

      logger.warn("Page fetch argus error", {
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
      return null;
    }

    return null;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
