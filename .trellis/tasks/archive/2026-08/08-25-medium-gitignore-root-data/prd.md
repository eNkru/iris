# Gitignore the root data/ SQLite directory

## Goal

The root `./data/` directory (created by the default `DATABASE_PATH=./data/iris.db` during local dev) is not gitignored — only `apps/web/data/` is. A developer running `pnpm db:migrate`/`pnpm dev` could accidentally `git add` their local SQLite DB. Add `/data/` to `.gitignore`.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `.gitignore:14` — only `apps/web/data/` is ignored. No `data/` or `/data/` entry.
- `Dockerfile:29` sets `DATABASE_PATH=/app/data/iris.db`; local dev default creates a root `./data/` which is not gitignored.
- Not currently tracked, but a latent footgun.

## Requirements

- **R1.** The root `./data/` directory is gitignored (`/data/` — anchored to repo root so it doesn't accidentally ignore nested `data/` dirs).
- **R2.** The existing `apps/web/data/` ignore line is kept (no regression).
- **R3.** If a `data/` dir is already tracked anywhere it shouldn't be, it's untracked (verify none is tracked).

## Fix

Add `/data/` to `.gitignore` (anchored to root). Run `git status` to confirm no tracked `data/` files; if any are tracked, `git rm --cached -r data/` (verify they're actually local DBs first).

## Acceptance Criteria

- [ ] **AC1.** `git check-ignore -v data/iris.db` reports the new `/data/` rule.
- [ ] **AC2.** `apps/web/data/` ignore still works (`git check-ignore -v apps/web/data/iris.db`).
- [ ] **AC3.** `git status` is clean of any previously-tracked root `data/` files (none expected).
- [ ] **AC4.** No nested `data/` dir needed for source is accidentally ignored (sanity grep for `data/` in source-controlled dirs).

## Out of Scope

- Moving the SQLite path elsewhere.
- Gitignore for other generated dirs.

## Risks / Technical Notes

- Anchor with `/data/` (leading slash) so it matches only the repo-root `data/`, not e.g. `packages/x/data/` if such a thing existed (grep first to be safe).
- This is a one-line change; pair it with another small task or ship alone.
