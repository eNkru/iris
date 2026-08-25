# Implementation plan — Migrate price extraction to argus

## Step 1 — Client `extract-price.ts` + tests
- [x] New `packages/prices/src/pipeline/extract-price.ts` per design §R1
      (limiter, bearer, retry policy, union, string→number price).
- [x] Unit tests: ok / blocked(non)retryable / fetch_failed retries /
      extraction_failed no-retry / price NaN guard / auth header.
- Validation: `pnpm vitest run tests/unit/extract-price.test.ts`.

## Step 2 — Image derivation helper
- [x] `imageUrlFromProductNode(node, baseUrl)` export in `extract-image.ts`
      (string | array | {url} | {contentUrl}; absolute resolve; null-safe).
- [x] Shape-matrix unit tests.

## Step 3 — check-price rewrite
- [x] Swap fetchPage/settings/AI block for one `extractPrice()` call;
      map variants per design §R2; image capture via jsonld node.
- [x] `pipeline/index.ts`: remove `fetch-page`, `ai-extract`, `ai-sdk`
      exports; add `extract-price`.
- [x] Delete `ai-extract.ts`, `ai-sdk.ts`, `fetch-page.ts`,
      `tests/unit/ai-extract.test.ts`.
- Validation: `pnpm typecheck`; fix all broken imports revealed.

## Step 4 — Env cleanup
- [x] `env.ts`: drop 8 AI_* keys. `.env.example` + local `.env` +
      `docker-compose.yml` environment + qnap doc env block: drop AI lines.
- Validation: `rg "AI_BASE_URL|AI_API_KEY|AI_MODEL|AI_ZEN_HOST|AI_USER_AGENT|
  AI_CLIENT_HEADER|AI_EXTRACT_"` → zero active hits (AC2).

## Step 5 — Settings schema/API/UI (+ migration)
- [x] Drizzle schema drops (`global_settings.ai*`×6, `user_settings.aiModelOverride`)
      → `pnpm db:generate` migration; apply to a DB copy and inspect.
- [x] Queries/settings helpers, `utils/schemas.ts` AiModelOverride,
      settings API types/procedures, admin module zod/mappings trimmed.
- [x] UI: remove AI card in `admin-settings-section.tsx` + per-user override
      control if present; update component tests.
- Validation: `pnpm db:migrate` on dev DB; typecheck.

## Step 6 — Acceptance test retarget
- [x] Rename `tests/acceptance/argus-fetch.test.ts` →
      `argus-extract-price.test.ts`; hit `/v1/extract-price`; assertions:
      plain URL → `{ok:true, source, price:string|null, currency?…}`;
      akamai URL → ok or `{ok:false, reason:"blocked", signature /^akamai-/}`.
- Validation (needs argus running): `ARGUS_*` exported → suite green.

## Step 7 — Docs & specs
- [x] READMEs: features bullet ("AI-powered extraction" → extraction runs in
      argus), stack table row, config table (drop AI rows).
- [x] `.trellis/spec/backend/ai-sdk-integration.md`: mark obsolete/remove +
      index.md update; performance.md check-price snippet refresh.

## Step 8 — Quality gate
- [x] `pnpm typecheck && pnpm test` green.
- [x] AC greps (AC1/AC2) zero-hit.
- [x] Live acceptance vs running argus green.
- [x] `docker build` + boot smoke (migrations incl. new one apply).
- [x] Commit (feat): "feat(prices): extract prices via argus /v1/extract-price,
      drop iris AI layer".

## Rollback
git revert of the commit; forward-only column-drop migration is safe to keep
on a reverted build (columns return empty on fresh setups only).
