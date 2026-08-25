# Harden Docker image (non-root + multi-stage build)

## Goal

The Docker image runs as root in a single stage, keeping `build-essential`/`python3` (compilers) in the final image — bloat plus a real privilege-escalation surface if an attacker gets RCE. Use a multi-stage build and run as the non-root `node` user.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `Dockerfile:2` — single `FROM node:22-bookworm-slim`.
- `Dockerfile:8-13` — installs `build-essential` + `python3` (stay in the final image).
- No second `FROM` stage, no `USER node` directive anywhere.
- Final image runs as root with the full build toolchain.

## Requirements

- **R1.** Multi-stage build: a builder stage (with `build-essential`/`python3` for native deps) and a runner stage (slim, no compilers).
- **R2.** The runner stage runs as a non-root user (`USER node` — the `node` base image ships a `node` user, uid 1000).
- **R3.** The app's writable dirs (`/app/data`, any cache/log dirs) are owned by the `node` user so the process can write the SQLite DB.
- **R4.** The image still builds and the app still boots (compose healthcheck still green).
- **R5.** Image size is reduced (no `build-essential`/`python3` in final stage).

## Fix

Split the `Dockerfile` into two stages:
1. `builder`: `FROM node:22-bookworm-slim`, install `build-essential`/`python3`, `pnpm install --frozen-lockfile`, `pnpm --filter @iris/web build` (and any other build steps).
2. `runner`: `FROM node:22-slim`, `COPY --from=builder /app /app` (production deps + built artifacts), `mkdir -p /app/data && chown -R node:node /app`, `USER node`, `CMD` the existing entrypoint.

Keep `docker-entrypoint.sh` and the existing `exec node` pattern. Ensure `DATABASE_PATH` default dir is writable by `node`.

## Acceptance Criteria

- [ ] **AC1.** `docker build` succeeds; final stage contains no `build-essential`/`python3` (verify via `docker run --rm <img> dpkg -l | grep -E 'build-essential|python3'` → empty).
- [ ] **AC2.** `docker inspect` shows the container user is `node` (not root).
- [ ] **AC3.** The app boots and the compose healthcheck passes (oRPC health route 200).
- [ ] **AC4.** SQLite DB is writable under `/app/data` by the `node` user (a `checkPrice`/create product smoke works).
- [ ] **AC5.** Image size is smaller than the current single-stage image (report `docker images` size before/after).

## Out of Scope

- Distroless / `gcr.io/distroless` base (future hardening).
- Read-only root filesystem / `no-new-privileges` seccomp (future).

## Risks / Technical Notes

- pnpm's virtual-store symlink layout must survive `COPY --from=builder` (the meticulous `.dockerignore` already handles the source side; verify the built `node_modules` copies cleanly). Consider `pnpm deploy` or copying the whole `/app` to be safe.
- `chown -R` on a large `node_modules` can be slow; scope it to the dirs the runtime actually writes if image-build time matters.
- Confirm `USER node` doesn't break the `ARGUS_API_TOKEN`/`BETTER_AUTH_SECRET` env reads (env vars are not affected by user).
