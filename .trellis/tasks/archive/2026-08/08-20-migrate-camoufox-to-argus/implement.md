# Implementation plan — Migrate Camoufox fetch transport to argus

All decisions in `design.md`. Steps are ordered so the repo typechecks at
the end; steps 1–6 land together in one commit boundary.

## Step 1 — Env config (R1)
File: `packages/utils/src/lib/env.ts`
- [x] Remove `CAMOUFOX_SIDECAR_URL` field + its comment block.
- [x] Add `ARGUS_BASE_URL: z.string().url("ARGUS_BASE_URL is required")` and
      `ARGUS_API_TOKEN: z.string().min(1, "ARGUS_API_TOKEN is required")`
      (no defaults) with a comment: argus is the single fetch transport,
      required in every env, token never logged.
- Validation: `pnpm --filter @iris/utils build` (or typecheck) compiles.

## Step 2 — `fetch-page.ts` (R2)
File: `packages/prices/src/pipeline/fetch-page.ts`
- [x] Remove `detectBlockedPage` / `isBlockedSignatureRetryable` imports.
- [x] `getSidecarBaseUrl()` → `getArgusConfig(): { baseUrl, token }`;
      update its doc comment (hard config error at first use).
- [x] `FetchAttempt`: replace `{ kind: "blocked"; reason: string }` with
      `{ kind: "blocked"; signature: string; retryable: boolean }`.
- [x] `attemptSidecarFetch` → `attemptArgusFetch`: add
      `authorization: Bearer ${token}` header, body
      `{ url, detectBlocked: true }`. Parse blocked responses into
      `{ kind: "blocked", signature (fallback "unknown"), retryable
      (fallback true) }`; `reason: "fetch_failed"` (or any other non-blocked
      fail reason) → `{ kind: "error" }`.
- [x] Retry loop: `ok` branch returns the payload directly (no app-side
      classification); `blocked` branch uses `result.retryable` instead of
      `isBlockedSignatureRetryable`; keep backoff/`MAX_RETRIES`/log keys.
- [x] Update module doc comments (sidecar → argus; argus owns
      classification). `FetchPageResult` and `null` contract unchanged.
- Validation: `pnpm typecheck`.

## Step 3 — `extract-image.ts` (R3)
File: `packages/prices/src/pipeline/extract-image.ts`
- [x] `attemptSidecarImageFetch` → `attemptArgusImageFetch`: endpoint from
      `getArgusConfig`-style resolution of `ARGUS_BASE_URL`, add bearer
      header. Rename internal `SidecarImage*` types/errors to `ArgusImage*`;
      update the doc comments that say "sidecar". No logic change.
- Validation: `pnpm typecheck`.

## Step 4 — Delete the registry (R4)
- [x] `git rm packages/prices/src/pipeline/blocked-signatures.ts`
- [x] `packages/prices/src/pipeline/index.ts`: drop the re-export line.
- [x] `rg detectBlockedPage|isBlockedSignatureRetryable` → only the
      acceptance test remains (fixed in step 6).

## Step 5 — Unit-test env setup
Files: `tests/unit/ai-extract.test.ts`, `tests/unit/telegram.test.ts`,
`tests/unit/extract-image.test.ts`
- [x] Replace `process.env.CAMOUFOX_SIDECAR_URL = "http://127.0.0.1:8000";`
      with `process.env.ARGUS_BASE_URL = "http://127.0.0.1:8000";` and
      `process.env.ARGUS_API_TOKEN = "test-token";` (same top-of-file
      position, before any module import that calls `getEnv()`).

## Step 6 — Acceptance test (R8)
- [x] `git mv tests/acceptance/sidecar-fetch.test.ts
      tests/acceptance/argus-fetch.test.ts` and rewrite: bearer auth from
      `process.env.ARGUS_BASE_URL ?? 'http://localhost:8000'` /
      `process.env.ARGUS_API_TOKEN` (no silent default token — skip-guard
      with a clear message if unset); `/health` poll keeps; assertions per
      design §R8 (ok shape / blocked shape with `signature`, `retryable`).
- [x] No reference to the deleted registry or old env var anywhere:
      `rg CAMOUFOX_SIDECAR_URL tests/` → zero hits.

## Step 7 — Docker image (R5)
File: `Dockerfile`
- [x] Remove GTK/NSS/X11/font apt libs, `python3-venv`, `supervisor` from
      the apt list (keep `build-essential`, `ca-certificates`, `python3`,
      `wget`); update the leading comments.
- [x] Delete the camoufox venv RUN block.
- [x] Replace `ARG/ENV CAMOUFOX_SIDECAR_URL` with `ARG/ENV ARGUS_BASE_URL`
      (`http://localhost:8000`) + `ARGUS_API_TOKEN` (build-time placeholder,
      e.g. `build-time-placeholder`) with a comment that the runtime value
      comes from compose env.
- [x] Drop `COPY supervisord.conf`; `CMD` → `["/usr/local/bin/iris-app-start"]`.
- [x] `git rm supervisord.conf`
- [x] `docker-entrypoint.sh`: delete the "waiting for Camoufox" loop.
- Validation: `docker build -t iris-argus .` succeeds (heavy; run once at
      the end, not per step).

## Step 8 — Compose (R5)
File: `docker-compose.yml`
- [x] Remove `CAMOUFOX_SIDECAR_URL` from build args + environment; remove
      the `8000:8000` port + its comment.
- [x] Add `ARGUS_BASE_URL: ${ARGUS_BASE_URL:-http://localhost:8000}` and
      `ARGUS_API_TOKEN: ${ARGUS_API_TOKEN:?set ARGUS_API_TOKEN in .env}`.

## Step 9 — Delete the in-repo sidecar
- [x] `git rm -r camoufox` (server.py + __pycache__).

## Step 10 — Env files (R1, R6)
- [x] `.env.example`: replace the camoufox block with `ARGUS_BASE_URL` +
      `ARGUS_API_TOKEN` (comment: point at the argus service, token must
      match one of argus's `ARGUS_API_TOKENS`).
- [x] Local `.env` (gitignored): same swap; token = the dev token in
      `/Users/howard/Sources/argus/.env`.

## Step 11 — Docs (R6)
- [x] `README.md` / `README.zh-CN.md`: anti-bot bullet, stack table, repo
      tree (`camoufox/`, supervisord lines), dev-run section (drop
      "run the Camoufox service separately"), env table row.
- [x] `docs/qnap-deployment.md`: build args, env block, boot-sequence note.
- [x] Specs: `.trellis/spec/backend/performance.md` (sidecar transport
      section → argus contract) and `.trellis/spec/frontend/deployment.md`
      (build args / internal contracts) — repo-wide zero-hit requirement.

## Step 12 — Quality gate
- [x] `pnpm typecheck` green.
- [x] `pnpm test` green (unit).
- [x] `rg CAMOUFOX_SIDECAR_URL` → zero hits repo-wide (AC1).
- [x] `rg detectBlockedPage|isBlockedSignatureRetryable` → zero hits (AC2).

## Step 13 — Optional live validation (needs network + argus running)
- [x] Start argus locally: `cd ../argus && ./dev.sh` (dev token in its `.env`).
- [x] `pnpm vitest run tests/acceptance/argus-fetch.test.ts` with
      `ARGUS_BASE_URL`/`ARGUS_API_TOKEN` exported — exercises the real
      wire contract end to end.
- [x] `docker run` smoke: `pnpm dev`-equivalent or compose up against the
      built image; create a product, confirm a real fetch returns HTML.

## Rollback
`git revert` of the commit; `camoufox/`, supervisord.conf, and the old env
var all return from history. No DB/image-state migration.
