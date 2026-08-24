# Migrate Camoufox fetch transport to argus service

## Goal

Move the Camoufox fetch transport out of the iris repo and into the standalone
**argus** service (sibling repo at `../argus`). Iris keeps the fetch
orchestration layer (retry / backoff / pLimit); the anti-detect browser engine
and its lifecycle move entirely to argus, which iris calls over HTTP with
bearer-token auth.

Argus is already implemented and tested (37 unit tests passing) — this task is
purely the **iris-side client migration**: point the existing fetch client at
argus, adopt argus's classification contract, and delete the now-redundant
in-repo code.

## Context

- **argus repo:** `/Users/howard/Sources/argus` (general-purpose, multi-client
  Camoufox fetch service). Ports iris's `camoufox/server.py` engine verbatim,
  reorganized into modules, with bearer auth + optional cookies/locale/UA +
  argus-owned blocked-signature registry.
- **argus API:** `POST /v1/fetch`, `POST /v1/fetch-image`, `GET /health`. All
  `/v1/*` routes require `Authorization: Bearer <token>`. Full OpenAPI:
  `../argus/docs/api-spec.md`.
- **argus blocked signatures:** the full iris registry (akamai-waf,
  akamai-access-denied, akamai-behavioral-challenge, datadome-captcha,
  cloudflare-challenge, akamai-empty-shell) is ported into
  `../argus/src/argus/signatures.py` with identical predicates, ordering, and
  retryable flags. Argus surfaces the retryable verdict directly on the
  blocked response, so iris no longer needs its own retry-decision helper.

## Requirements

### R1 — Config: replace sidecar URL with argus base URL + token

- Drop `CAMOUFOX_SIDECAR_URL` from env config (`.env`, `.env.example`,
  `packages/utils`, `docker-compose.yml`, `Dockerfile`).
- Add `ARGUS_BASE_URL` (e.g. `http://localhost:8000`) and `ARGUS_API_TOKEN`
  to the same surfaces. `ARGUS_API_TOKEN` is a secret — never log it.
- `getEnv()` must hard-fail on a missing `ARGUS_BASE_URL` / `ARGUS_API_TOKEN`
  at first use (same severity as `DATABASE_PATH` / `CAMOUFOX_SIDECAR_URL`
  today — a missing transport is a config error, not a silent skip).

### R2 — Client: `fetch-page.ts` calls argus `/v1/fetch`

- `attemptSidecarFetch` → `attemptArgusFetch`. POST
  `${ARGUS_BASE_URL}/v1/fetch` with `Authorization: Bearer ${ARGUS_API_TOKEN}`,
  body `{ url, detectBlocked: true }` (let argus classify).
- The sidecar's `{ ok: false, reason: "blocked" }` variant no longer fires
  from argus for challenge pages — argus returns the challenge HTML as
  `{ ok: true, html }` and then, after running its registry, a separate
  `{ ok: false, reason: "blocked", signature, retryable }`. Simplify the
  `FetchAttempt` discriminated union to match argus's two-way contract:
  `{ kind: "ok", html, url }` | `{ kind: "blocked", signature, retryable }`
  | `{ kind: "error", message }`.
- `fetchPage` retry loop: replace `isBlockedSignatureRetryable(signature)`
  (deleted in R4) with the `retryable` flag argus returns. Same semantics:
  retryable + attempt < MAX_RETRIES → backoff + fresh fetch; non-retryable
  → return `{ kind: "blocked", signature }` immediately.

### R3 — Client: `extract-image.ts` calls argus `/v1/fetch-image`

- Point at `${ARGUS_BASE_URL}/v1/fetch-image` with the same bearer header,
  body `{ url }`. Response shape `{ ok, contentType, data(base64) }` /
  `{ ok: false, reason }` is unchanged from the old sidecar contract — this
  is a one-line base-URL + auth-header change, no logic change.

### R4 — Delete iris's now-redundant signature registry

- Delete `packages/prices/src/pipeline/blocked-signatures.ts` (port lives in
  argus now).
- Delete `isBlockedSignatureRetryable` (argus returns `retryable` directly).
- Update `index.ts` re-exports. No other code references these (verify with
  `rg detectBlockedPage|isBlockedSignatureRetryable`).

### R5 — Deploy: remove the in-repo sidecar

- `Dockerfile`: remove the `/opt/camoufox` venv install, `camoufox fetch`,
  the GTK/NSS/X11 apt packages, and the `supervisord` program for camoufox
  (or the whole supervisord layer if iris is now a single Node process).
- `supervisord.conf` / `docker-entrypoint.sh`: drop the camoufox readiness
  wait loop (`wget /health` on `127.0.0.1:8000`). iris no longer owns that
  process.
- `docker-compose.yml`: argus becomes an external service iris calls over the
  network (either a second compose service, or `ARGUS_BASE_URL` points at a
  separately-deployed argus). Decide per-environment.
- Delete `camoufox/` directory (the `server.py` and its `__pycache__`).

### R6 — Docs / `.env.example`

- `README.md` / `README.zh-CN.md`: update the "Camoufox is supervised inside
  the Docker image" note to point at argus.
- `.env.example`: swap `CAMOUFOX_SIDECAR_URL=...` for
  `ARGUS_BASE_URL=http://localhost:8000` + `ARGUS_API_TOKEN=`.

## Acceptance Criteria

- [ ] AC1 — `rg CAMOUFOX_SIDECAR_URL` returns zero hits in the iris repo.
- [ ] AC2 — `rg detectBlockedPage|isBlockedSignatureRetryable` returns zero
      hits in the iris repo.
- [ ] AC3 — `packages/prices/src/pipeline/fetch-page.ts` POSTs to
      `${ARGUS_BASE_URL}/v1/fetch` with a `Bearer ${ARGUS_API_TOKEN}` header
      and body `{ url, detectBlocked: true }`.
- [ ] AC4 — `packages/prices/src/pipeline/extract-image.ts` POSTs to
      `${ARGUS_BASE_URL}/v1/fetch-image` with the same auth header.
- [ ] AC5 — A blocked argus response (`{ ok:false, reason:"blocked",
      signature, retryable }`) flows through `fetchPage` to a
      `{ kind:"blocked", signature }` result exactly as before — the
      downstream `checkPrice` reason string
      `"Anti-bot WAF deny page (…) — retailer blocks automated access."`
      is unchanged.
- [ ] AC6 — A non-retryable block (e.g. `akamai-waf`) returns immediately;
      a retryable block (e.g. `cloudflare-challenge`, `akamai-access-denied`)
      retries with backoff up to `MAX_RETRIES`.
- [ ] AC7 — `Dockerfile` / `supervisord.conf` / `docker-entrypoint.sh` no
      longer build or supervise the camoufox venv; the iris image is
      Node-only.
- [ ] AC8 — Existing `tests/acceptance/sidecar-fetch.test.ts` (and any
      sibling) is updated to the argus contract or deleted if it tested the
      in-repo sidecar directly. No test references the deleted env var.
- [ ] AC9 — `pnpm typecheck && pnpm test` green.

## Out of scope (do not do in this task)

- Any change to argus itself — it is complete and tested.
- Moving retry/backoff/pLimit into argus — that orchestration stays in iris.
- Moving image magic-byte validation (`extract-image.ts` validator) — stays
  in iris; argus only transports bytes.
- Persistent sessions / login orchestration — deferred in argus
  (`../argus/docs/future.md`); the optional `cookies` field on `/v1/fetch`
  already covers the Taobao login-gated use case if iris ever needs it.

## Migration notes for the implementer

- **argus response contract** (`POST /v1/fetch`):
  - Success: `{ ok: true, html, url }`
  - Blocked: `{ ok: false, reason: "blocked", signature, retryable }`
  - Transport failure: `{ ok: false, reason: "fetch_failed" }`
- argus never throws — it maps navigation/timeout errors to
  `reason:"fetch_failed"`, same as the old sidecar.
- argus always returns the challenge HTML when navigation produced a response,
  then classifies — so iris's old "sidecar returns challenge HTML verbatim,
  app classifies" path is now "argus classifies and returns blocked". The
  `FetchAttempt` union simplifies (one fewer branch).
- The retryable semantics are identical to iris's old
  `isBlockedSignatureRetryable`: `akamai-waf` → false; everything else →
  true; unknown → true.
- Bearer token: generate with
  `python -c "import secrets; print(secrets.token_urlsafe(32))"`; put the same
  value in iris's `ARGUS_API_TOKEN` and argus's `ARGUS_API_TOKENS`.

## References

- argus repo: `/Users/howard/Sources/argus`
- argus API spec: `../argus/docs/api-spec.md`
- argus architecture: `../argus/docs/architecture.md`
- argus signatures (ported from iris): `../argus/src/argus/signatures.py`
- iris files to change:
  - `packages/prices/src/pipeline/fetch-page.ts` (R2)
  - `packages/prices/src/pipeline/extract-image.ts` (R3)
  - `packages/prices/src/pipeline/blocked-signatures.ts` (delete, R4)
  - `packages/prices/src/pipeline/index.ts` (re-exports, R4)
  - `packages/utils/...` (env types, R1)
  - `Dockerfile` / `supervisord.conf` / `docker-entrypoint.sh` (R5)
  - `docker-compose.yml` (R5)
  - `.env` / `.env.example` (R1, R6)
  - `camoufox/` directory (delete, R5)
  - `tests/acceptance/sidecar-fetch.test.ts` (R8)
