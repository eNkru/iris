# Migrate price extraction to argus /v1/extract-price

## Goal

Iris stops extracting prices itself. `checkPrice` calls the standalone **argus**
service's `POST /v1/extract-price`, which returns the structured price response
(JSON-LD first, LLM fallback inside argus). The entire AI-extraction layer is
removed from iris: code, env vars, DB columns, admin/user settings APIs, and UI.

Follow-on to `08-20-migrate-camoufox-to-argus` (transport migration, archived).
No changes to argus — `/v1/extract-price` is implemented and tested there.

## Context

- argus contract (`../argus/src/argus/routes/extract.py`, `schemas.py`,
  `../argus/docs/api-spec.md`):
  - Request `{url, detectBlocked?=true, aiFallback?=true, cookies?, …}`
  - Ok: `{ok:true, source:"jsonld"|"ai", url, available, price:"599.99"`
    `(decimal STRING 2dp), currency, availability, name, jsonld:{…}|null}`
    — `jsonld` is the primary schema.org Product node (null on the AI path)
  - Fail: `{ok:false, reason:"blocked"|"fetch_failed"|"extraction_failed",
    signature?, retryable?}` — blocked short-circuits BEFORE any LLM call;
    `retryable` mirrors iris's old registry semantics
- iris today: `checkPrice` = `fetchPage` (HTML) → app-side nothing →
  `resolveAiConfig(settings)` + `aiExtractPrice({html})`; image capture pulls
  `og:image` out of the fetched HTML on first check only.

## Requirements

### R1 — New client: `packages/prices/src/pipeline/extract-price.ts`

- POST `${ARGUS_BASE_URL}/v1/extract-price` with
  `Authorization: Bearer ${ARGUS_API_TOKEN}`, body `{ url }`.
- Preserve the operational envelope: shared `pLimit(5)` budget, 45 s
  per-attempt timeout, retry/backoff via existing `backoffDelayMs`,
  `MAX_RETRIES = 3`, structured logging.
- Retry policy: `fetch_failed` → retry (transport); `blocked` → use argus's
  `retryable` flag; `extraction_failed` → NO retry (terminal).
- Return union:
  `{ kind:"ok", url, available, price:number|null, currency, name, jsonld }`
  `| { kind:"blocked", signature } | { kind:"error", message }` — transport
  failure after retries maps to `"Page fetch failed"`; extraction_failed to
  `"Price extraction failed"` (unchanged downstream strings).
- Price arrives as a decimal **string** → convert with `Number()` at the
  boundary; reject NaN as an error variant.

### R2 — Rewrite `check-price.ts`

- Replace `fetchPage` + `resolveAiConfig` + `aiExtractPrice` +
  `getGlobalSettings` with one `extractPrice(product.url)` call.
- Status mapping unchanged: `not_found` / `failed`(+reason) /
  `unavailable` / `unchanged` / `changed`. Blocked reason string stays
  `` `Anti-bot WAF deny page (${signature}) — retailer blocks automated access.` ``.
- Store price/currency/name exactly as today (`price.toFixed(2)` into
  readings/products, name/currency fill-in when null).
- Single-flight mutex, transactionality, alert evaluation: untouched.

### R3 — Image capture from the JSON-LD node (user decision: option A)

- When `!product.imagePath` and response `jsonld` node exists, derive the
  image URL from the node's `image` field — tolerant parse: URL string |
  array of strings | `{url}` / `{contentUrl}` — resolved absolute against the
  final `url`. Then download via the existing `/v1/fetch-image` path.
- `jsonld === null` (AI-source response) → skip capture with an info log.
  Failures stay best-effort warnings; never fail the check.

### R4 — Delete iris's AI layer

- Delete `packages/prices/src/pipeline/ai-extract.ts`, `ai-sdk.ts`;
  update `pipeline/index.ts` re-exports; delete `fetch-page.ts` (zero callers
  remain) and its pipeline export.
- Delete `tests/unit/ai-extract.test.ts`.

### R5 — Env cleanup

- Remove from `env.ts`: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`,
  `AI_EXTRACT_CONCURRENCY`, `AI_EXTRACT_MIN_INTERVAL_MS`, `AI_ZEN_HOST`,
  `AI_USER_AGENT`, `AI_CLIENT_HEADER`.
- Same removal from `.env.example`, local `.env`, `docker-compose.yml`
  environment, `docs/qnap-deployment.md`, READMEs. No new env vars.

### R6 — Settings schema/API/UI cleanup (+ DB migration)

- Drop `global_settings` columns: `aiBaseUrl`, `aiApiKey`, `aiModel`,
  `aiZenHost`, `aiUserAgent`, `aiClientHeader`; drop
  `user_settings.aiModelOverride`. Drizzle migration generated + applies
  cleanly to an existing DB.
- `@iris/database` queries/settings helpers lose the dropped fields.
- `packages/api`: settings + admin modules stop accepting/returning the
  dropped fields (zod schemas, procedure mappings). `scheduler.ts` keeps using
  `pollIntervalDefaultMinutes`; `telegram.ts` keeps `telegramBotToken`.
- Web UI: remove the AI section from `admin-settings-section.tsx` and any
  `aiModelOverride` control in user settings; update component tests.

### R7 — Tests

- Retarget `tests/acceptance/argus-fetch.test.ts` at `/v1/extract-price`
  (plain DataDome URL → `ok:true` shape with price fields; Akamai URL →
  `ok` or `blocked` with `/^akamai-/` signature + boolean `retryable`).
- Unit/component suites updated for the removed surfaces; add coverage for
  the extract-price client (mocked fetch: ok/blocked/retryable-retry/
  extraction_failed-no-retry/price-string conversion) and the JSON-LD image
  derivation.

## Acceptance Criteria

- [ ] AC1 — `rg "aiExtractPrice|resolveAiConfig|ai-sdk|ai-extract"` → zero
      hits in active code/tests.
- [ ] AC2 — `rg "AI_BASE_URL|AI_API_KEY|AI_MODEL|AI_ZEN_HOST|AI_USER_AGENT|
      AI_CLIENT_HEADER|AI_EXTRACT_"` → zero hits outside archives/history.
- [ ] AC3 — `checkPrice` performs no HTML fetch; the only browser-service
      calls in iris are `/v1/extract-price` and `/v1/fetch-image`.
- [ ] AC4 — Blocked checks still produce the exact legacy reason string with
      argus's signature.
- [ ] AC5 — `Page fetch failed` / `Price extraction failed` / `unavailable` /
      `changed` / `unchanged` statuses behave as before.
- [ ] AC6 — First-check image capture works off the JSON-LD node when present,
      skips cleanly when absent; no re-download once `imagePath` is set.
- [ ] AC7 — Migration applies on an existing populated DB without data loss
      beyond the intentionally dropped AI columns.
- [ ] AC8 — `pnpm typecheck && pnpm test` green; live acceptance suite vs
      running argus green; docker build + boot smoke OK.

## Out of scope

- Any change to argus (including adding og:image extraction — revisit if
  JSON-LD-less retailers prove common).
- Alert rules, scheduler cadence, notification channels.
- Removing `better-sqlite3`/Drizzle or other non-AI stack pieces.

## References

- argus extract route: `../argus/src/argus/routes/extract.py`
- argus schemas: `../argus/src/argus/schemas.py` (ExtractPriceResponse*)
- Prior task: `.trellis/tasks/archive/2026-08/08-20-migrate-camoufox-to-argus/`
