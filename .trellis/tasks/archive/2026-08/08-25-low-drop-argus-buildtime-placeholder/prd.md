# Drop build-time ARGUS_API_TOKEN placeholder from image ENV

## Goal

The Dockerfile sets `ARG ARGUS_API_TOKEN=build-time-placeholder` then `ENV ARGUS_API_TOKEN=${ARGUS_API_TOKEN}`. The placeholder passes `env.ts`'s `.min(1)` validation, so a misconfigured deploy (runtime token unset but build-time ENV persists) yields confusing argus 401s at runtime instead of a clear env-validation error. Remove the build-time placeholder so a missing runtime token fails fast and clearly.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `Dockerfile:41-43` — `ARG ARGUS_API_TOKEN=build-time-placeholder` then `ENV ARGUS_API_TOKEN=${ARGUS_API_TOKEN}`.
- `packages/utils/src/lib/env.ts:48` — `ARGUS_API_TOKEN: z.string().min(1, ...)`; the placeholder passes `.min(1)`.

## Requirements

- **R1.** The build-time placeholder is removed (or made such that it fails env validation). The runtime token comes only from compose/runtime env.
- **R2.** A deploy that forgets to set `ARGUS_API_TOKEN` at runtime fails fast with a clear env-validation error (not an argus 401 deep in the pipeline).
- **R3.** The build itself doesn't require `ARGUS_API_TOKEN` (it shouldn't — it's a runtime secret). If the build needs the arg for some reason, document why.

## Fix

Remove the `ARG`/`ENV` lines for `ARGUS_API_TOKEN` from the Dockerfile. The token is supplied at runtime via compose (`environment:`) or `docker run -e`. Verify the app still boots when the token is provided at runtime and fails clearly when it isn't. If the build genuinely needs the arg (unlikely), keep `ARG` but don't bake a default placeholder into `ENV`.

## Acceptance Criteria

- [ ] **AC1.** `docker build` no longer bakes `ARGUS_API_TOKEN=build-time-placeholder` into the image ENV (`docker run --rm <img> env | grep ARGUS` → absent).
- [ ] **AC2.** Running the image without `ARGUS_API_TOKEN` fails at boot with a clear env-validation error (not an argus 401 later).
- [ ] **AC3.** Running the image with `ARGUS_API_TOKEN=<real>` works as before.
- [ ] **AC4.** Compose still sets the token via `environment:` (no change to compose behavior).

## Out of Scope

- Same treatment for `BETTER_AUTH_SECRET` (that's the M2/PR #24 scope).
- Build secret management beyond removing the placeholder.

## Risks / Technical Notes

- Confirm nothing in the build (e.g. a prebuild step) actually calls argus and needs the token at build time (grep for argus usage in build scripts).
- This pairs naturally with the Docker multi-stage task (M10); consider doing both together.
