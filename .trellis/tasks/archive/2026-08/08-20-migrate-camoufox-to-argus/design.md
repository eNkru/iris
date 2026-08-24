# Design — Migrate Camoufox fetch transport to argus

## Boundaries

- **iris keeps**: fetch orchestration (`pLimit` budgets, retry/backoff/jitter),
  image magic-byte validation, structured logging, all pipeline semantics
  (`FetchPageResult`, `checkPrice` reason strings).
- **argus owns**: the browser engine + lifecycle, and blocked-page
  classification (registry ported verbatim from iris; signature ids and
  retryable flags confirmed identical in `../argus/src/argus/signatures.py`).
- Boundary is HTTP only: `POST /v1/fetch`, `POST /v1/fetch-image`, bearer
  token from `ARGUS_API_TOKEN`. Contract source of truth:
  `../argus/docs/api-spec.md`.

## R1 — Config (`packages/utils/src/lib/env.ts`)

Replace in `envSchema`:

```ts
// removed
CAMOUFOX_SIDECAR_URL: z.string().url("CAMOUFOX_SIDECAR_URL is required"),
// added
ARGUS_BASE_URL: z.string().url("ARGUS_BASE_URL is required"),
ARGUS_API_TOKEN: z.string().min(1, "ARGUS_API_TOKEN is required"),
```

- Both **no defaults** → `getEnv()` throws on first use when missing. Same
  hard-fail severity as the old sidecar URL (PRD R1).
- `ARGUS_API_TOKEN` is a secret: used only in the `Authorization` header;
  never logged, never included in error messages.

## R2 — `fetch-page.ts`

- `getSidecarBaseUrl()` → `getArgusConfig(): { baseUrl, token }` (single
  `getEnv()` call; trailing slashes stripped).
- `attemptSidecarFetch` → `attemptArgusFetch`: POST `${baseUrl}/v1/fetch`,
  headers `content-type: application/json` + `authorization: Bearer <token>`,
  body `{ url, detectBlocked: true }`, same 45 s `AbortSignal.timeout`,
  still never throws.
- **`FetchAttempt` union simplifies** (old `blocked` variant carried only a
  `reason` string and classification happened app-side):

```ts
type FetchAttempt =
  | { kind: "ok"; html: string; url: string }
  | { kind: "blocked"; signature: string; retryable: boolean }
  | { kind: "error"; message: string };
```

  With `detectBlocked: true`, argus runs its registry and returns
  `{ ok: false, reason: "blocked", signature, retryable }`; an `ok: true`
  payload is by contract already classified clean → the app-side
  `detectBlockedPage` pass in the retry loop is deleted.
- Defensive parsing: `signature` falls back to `"unknown"`, `retryable`
  falls back to `true` when absent (conservative, mirrors the old
  registry's unknown-signature default).
- Retry loop: replace `isBlockedSignatureRetryable(...)` with
  `attempt.retryable`. Loop shape, backoff, `MAX_RETRIES`, logging keys
  unchanged. `FetchPageResult` (`ok` | `blocked`+signature) and the
  `null`-on-transport-failure contract are **unchanged** → AC5:
  `checkPrice` reason string preserved by construction.

## R3 — `extract-image.ts`

- `attemptSidecarImageFetch`: endpoint → `${ARGUS_BASE_URL}/v1/fetch-image`,
  add the same bearer header. Response shape `{ok,contentType,data}` /
  `{ok:false,reason}` unchanged; retry/validation/limiter logic untouched.
- Internal-only identifier rename for honesty after the migration:
  `SidecarImageHttpError` → `ArgusImageHttpError`,
  `SidecarImageSchemaMismatchError` → `ArgusImageSchemaMismatchError`,
  `SidecarImage*Response` types → `ArgusImage*Response` (nothing is
  exported, so no downstream impact).

## R4 — Delete the in-repo registry

- Delete `packages/prices/src/pipeline/blocked-signatures.ts`.
- Drop its re-export from `packages/prices/src/pipeline/index.ts`.
- Only out-of-pipeline reference is the acceptance test (rewritten in R8).
  Verified: no other code imports `detectBlockedPage` /
  `isBlockedSignatureRetryable`.

## R5 — Deploy

**Decision: iris becomes a single Node process; supervisord is removed
entirely** (PRD R5 offers this option — with no second process there is
nothing left to supervise).

- `Dockerfile`:
  - Drop: all GTK/NSS/X11/font apt libs, `python3-venv`, `supervisor`, the
    entire `/opt/camoufox` venv + `camoufox fetch` + font-prune block,
    `COPY supervisord.conf`, `CMD supervisord`.
  - Keep: `build-essential` + `python3` (better-sqlite3 node-gyp build),
    `ca-certificates`, `wget` (container healthcheck).
  - Build-time env: replace `ARG CAMOUFOX_SIDECAR_URL` with
    `ARG ARGUS_BASE_URL` / `ARG ARGUS_API_TOKEN` carrying **placeholder**
    values (server-only modules validate env while building). The real
    token is injected at runtime via compose env — never baked into layers.
  - `CMD` → `["/usr/local/bin/iris-app-start"]`.
- `supervisord.conf`: delete the file.
- `docker-entrypoint.sh`: remove the Camoufox `/health` wait loop. Rationale:
  argus is an *external* service; iris must not gate its own startup on it
  (and argus `/health` is 200 even with the browser absent). When argus is
  down, scrapes fail per-product with retries → `"Page fetch failed"`; the
  web UI, DB and scheduler keep working.
- `docker-compose.yml`:
  - Drop `CAMOUFOX_SIDECAR_URL` env + build arg; drop the dev-only
    `8000:8000` port.
  - Add `ARGUS_BASE_URL: ${ARGUS_BASE_URL:-http://localhost:8000}` and
    `ARGUS_API_TOKEN: ${ARGUS_API_TOKEN:?set ARGUS_API_TOKEN in .env}`
    (fail-closed: `compose up` errors loudly without a token — no silent
    403s at first scrape).
  - argus stays out of this compose file (it is deployed from its own repo:
    `../argus/docker-compose.yml`). Documented in README/qnap docs.
- Delete `camoufox/` (server.py + `__pycache__`).

## R6 — Docs & local env

- `.env.example`: swap the camoufox block for `ARGUS_BASE_URL` +
  `ARGUS_API_TOKEN` with a pointer to the argus repo.
- Local `.env` (gitignored): swap the same line; token value = argus's
  dev token in `/Users/howard/Sources/argus/.env` (`ARGUS_API_TOKENS`).
- README.md / README.zh-CN.md: "supervised inside the container" →
  external argus service; drop `camoufox/` tree lines and the
  "run the Camoufox service separately" dev section; env table row.
- `docs/qnap-deployment.md`: build args, env, boot-time expectations.
- Specs (`AC1` requires zero `CAMOUFOX_SIDECAR_URL` hits repo-wide):
  `.trellis/spec/backend/performance.md`,
  `.trellis/spec/frontend/deployment.md` — update in the same pass
  (folds into Phase 3.3 spec update).

## R8 — Tests

- `tests/unit/{ai-extract,telegram,extract-image}.test.ts`: replace the
  `process.env.CAMOUFOX_SIDECAR_URL = ...` top-line with
  `ARGUS_BASE_URL` + `ARGUS_API_TOKEN` assignments (same pattern; these
  only exist so `getEnv()` validation passes — no network calls in unit
  tests).
- `tests/acceptance/sidecar-fetch.test.ts` → rewrite as
  `tests/acceptance/argus-fetch.test.ts` against argus's wire contract:
  - env: `ARGUS_BASE_URL` / `ARGUS_API_TOKEN` (falls back to
    `http://localhost:8000` / dev token), bearer header on every call.
  - `/health` unauthenticated readiness poll (no more 503-`starting`
    semantics).
  - plain URL → `{ ok: true, html }`, `html.length > 5_000`.
  - akamai URL → either `ok: true` real content, or
    `{ ok: false, reason: "blocked", signature: /^akamai-/, retryable: boolean }`.
  - No import of the deleted registry (classification happens in argus now).

## Image impact (estimate)

Drops the ~932 MB browser bundle, the Python venv (~300 MB), the 473 MB
GTK/NSS/X11 apt layer, and supervisor → image should land well under 1 GB
(was 1.95 GB). Runtime footprint loses the Python/uvicorn tree (~140 MB)
when argus runs elsewhere.

## Rollback

Single `git revert` of the change commit restores the sidecar image
(`camoufox/`, supervisord, env var). No data/schema migrations involved.
The acceptance test rename means old test runs need the old file — revert
covers it.
