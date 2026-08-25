# Design — Migrate price extraction to argus /v1/extract-price

## Flow change

```
before: checkPrice → fetchPage(/v1/fetch → HTML) → resolveAiConfig(settings)
        → aiExtractPrice(html) [LLM via AI_* env / global_settings]
        → og:image from HTML (first check)

after:  checkPrice → extractPrice(product.url)   [/v1/extract-price, bearer]
        → {price,currency,name,jsonld}            [extraction inside argus]
        → image from jsonld node.image            (first check, best-effort)
```

iris keeps: single-flight mutex, transactional write, alert rules,
notifications, `/v1/fetch-image` download path. iris drops: HTML fetching,
the whole LLM layer, AI settings surface.

## R1 — `extract-price.ts` client

- `getArgusConfig()` reused pattern from the archived fetch client (env
  `ARGUS_BASE_URL` + `ARGUS_API_TOKEN`, trailing-slash strip).
- Module limiter `pLimit(5)` (matches argus `ARGUS_CONCURRENCY`), 45 s
  `AbortSignal.timeout`, `MAX_RETRIES = 3`, `backoffDelayMs(attempt)` sleeps.
- Wire parsing mirrors argus `schemas.py`:
  - `ok:true` → validate `url:string`; `available:boolean`;
    `price:null | decimal-string` → `Number(price)`, NaN ⇒ error variant;
    `currency/name: string|null`; `jsonld: object|null`.
  - `ok:false reason:"blocked"` → `{kind:"blocked", signature ?? "unknown"}`
    (retryable consumed internally by the retry loop).
  - `reason:"fetch_failed"` → retryable error; after retries → message
    `"Page fetch failed"`.
  - `reason:"extraction_failed"` → terminal immediately, message
    `"Price extraction failed"`.
- Return union:
```ts
type ExtractPriceResult =
  | { kind: "ok"; url: string; available: boolean;
      price: number | null; currency: string | null;
      name: string | null; jsonld: Record<string, unknown> | null }
  | { kind: "blocked"; signature: string }
  | { kind: "error"; message: string };
```

## R2 — check-price rewrite

- `runCheckPrice`: one `extractPrice(...)` call replaces
  fetchPage/blocked-branch/settings/aiExtract block. Mapping:
  - `error` → `touchLastCheckedAt` + `{status:"failed", reason:message}`
  - `blocked` → legacy string with signature (AC4)
  - `!available` → `{status:"unavailable"}` (no reading row — unchanged)
  - `ok && !price` → treat as extraction failure (`"Price extraction failed"`)
- Image capture block moves under `if (!product.imagePath)`:
  `imageUrl = imageUrlFromProductNode(page.jsonld, page.url)`.
- DB writes identical; `newPrice.toFixed(2)` still used for storage.

## R3 — JSON-LD node image derivation

New export in `extract-image.ts`:
`imageUrlFromProductNode(node, baseUrl): string | null`
- Accepts `node["image"]` as: URL string · array of strings ·
  `{url}` · `{contentUrl}` · array of those objects.
- First absolute-resolvable candidate wins (`resolveUrl` against final URL);
  relative URLs resolved; garbage skipped.
- Reuses the tolerant spirit of the deleted-from-HTML `matchJsonLdImage`.

## R4/R5/R6 — Deletions & schema migration

- Delete files: `ai-extract.ts`, `ai-sdk.ts`, `fetch-page.ts`,
  `tests/unit/ai-extract.test.ts`. Update `pipeline/index.ts`.
- `env.ts`: drop the eight AI_* keys (schema only — no new vars).
- Drizzle schema: drop 6 columns from `global_settings`,
  `aiModelOverride` from `user_settings`; `drizzle-kit generate` produces the
  DROP COLUMN migration (SQLite ≥3.35 supports it; better-sqlite3 bundles a
  modern SQLite). Validate on a copy of a populated DB before shipping.
- Queries layer (`queries/settings.ts`) and API modules lose the fields:
  - `modules/settings/types.ts` + `procedures/get.ts|update.ts`
    (incl. `AiModelOverride` handling in `utils/schemas.ts`),
  - `modules/admin/*-global-settings*` zod + mappings.
  Keep `pollIntervalDefaultMinutes`, `telegramBotToken` everywhere.
- Web UI: strip AI card from `admin-settings-section.tsx`, any per-user model
  override control, and their hooks/types; fix component tests.

## R7 — Tests

- Rewrite acceptance test against `/v1/extract-price` (rename to
  `argus-extract-price.test.ts`): same env-var auth pattern; assertions on
  ok-shape (price string|null, source enum) and blocked-shape.
- New unit tests: extract-price client (mocked global `fetch`):
  ok passthrough · blocked non-retryable immediate · blocked retryable
  retries then succeeds · fetch_failed retries then `"Page fetch failed"` ·
  extraction_failed no retry · price-string→number conversion + NaN guard ·
  bearer header present. And `imageUrlFromProductNode` shape matrix.
- Existing suites: telegram tests keep mocking `getGlobalSettings` (fields
  they touch remain); admin/user-settings component tests trimmed of AI.

## Risks / mitigations

- Retailers without JSON-LD rely on argus's internal AI fallback
  (`aiFallback=true` default) — coverage preserved; jsonld=null on that path
  just skips first-check image capture (logged).
- Price arrives as string — single conversion point in the client with NaN
  rejection keeps downstream math untouched.
- Migration drops stored AI credentials by design (they move to argus's
  `.env`).

## Rollback

Single revert restores the AI pipeline; the dropped-columns migration is
forward-only but harmless to keep applied on a reverted build (columns are
recreated empty by the old migrations only if re-run from scratch — document
that a full revert requires restoring from pre-migration backup).
