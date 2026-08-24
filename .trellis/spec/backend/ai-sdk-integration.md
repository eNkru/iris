# AI SDK Backend Integration — REMOVED FROM IRIS (2026-08-25)

> **Status: obsolete.** Price extraction no longer runs in Iris. The entire
> Vercel AI SDK layer (`ai`, `@ai-sdk/openai-compatible`), `ai-extract.ts`,
> `ai-sdk.ts`, the `AI_*` env vars, and the `global_settings` /
> `user_settings` AI columns were removed when `checkPrice` switched to the
> external **argus** service (`POST /v1/extract-price`).

## Where things live now

- Page fetching + blocked classification + price extraction all happen in the
  standalone **argus** repo (`../argus`). Its contract:
  - Request: `{ url, detectBlocked?=true, aiFallback?=true, … }`
  - Ok: `{ ok:true, source:"jsonld"|"ai", url, available, price:"599.99"`
    `(decimal string), currency, name, jsonld }`
  - Fail: `{ ok:false, reason:"blocked"|"fetch_failed"|"extraction_failed",
    signature?, retryable? }`
- The LLM fallback is configured on the **argus side** via `ARGUS_AI_*`
  settings in its `.env` (base URL / API key / model / concurrency /
  min-interval). The old iris-side throttle pattern (process-wide `pLimit` +
  min-interval gap + disabled SDK retries) is implemented there as
  `ARGUS_AI_CONCURRENCY` / `ARGUS_AI_MIN_INTERVAL_MS` / `ARGUS_AI_MAX_RETRIES`.

## What still applies in Iris

- Retry/backoff orchestration around the extract call stays in
  `packages/prices/src/pipeline/extract-price.ts`: transport-class failures
  retry with backoff; blocked responses honor argus's per-signature
  `retryable`; `extraction_failed` is terminal. See
  `performance.md` → "Page Fetch Transport".
- Never log `ARGUS_API_TOKEN`; it only ever goes into an Authorization header.

The pre-migration content of this file (AI SDK pinning guidance, provider
model, extraction throttle contract §6) is preserved in git history if the
capability is ever brought back.
