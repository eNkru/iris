# Evaluate removing the `migrate.ts` reimplementation

## Goal

Decide whether to keep the 163-line hand-rolled SQLite migrator or replace it
with `drizzle-kit migrate`, which already ships the same behaviour.

## Confirmed Facts (verified 2026-09-24)

- `packages/database/src/migrate.ts` (163 lines) reimplements
  `drizzle-orm`'s `SQLiteSyncDialect.migrate()` — same `__drizzle_migrations`
  table, same sha256-of-file-contents hash, same `created_at` journal millis.
  The header explicitly states it exists so the runner image does not ship
  "pnpm + drizzle-kit + esbuild + tsx (~60 MB)".
- It is wired into:
  - `packages/database/package.json` → `db:migrate:build`
    (`esbuild src/migrate.ts … --outfile=dist/migrate.cjs`).
  - `Dockerfile` → `RUN pnpm --filter @iris/database db:migrate:build`,
    `COPY …/dist/migrate.cjs`, and the runner stage.
  - `docker-entrypoint.sh` → `node /app/packages/database/dist/migrate.cjs …`.
- `drizzle-kit` is already a devDependency and a `db:migrate` script exists; it
  is simply not present in the runtime image.
- Compatibility is a stated requirement: `drizzle-kit migrate` / `studio` must
  stay interchangeable against the same DB.

## Requirements

- **R1. Decide**, with the size trade-off measured/estimated:
  - **Keep:** add a short "accepted trade-off" note; no code change; close.
  - **Remove:** run migrations with `drizzle-kit migrate` at boot (or as a
    separate step), delete `migrate.ts` + `db:migrate:build`, and update the
    Dockerfile/entrypoint accordingly.
- **R2.** If removed, the runtime image must still migrate an existing DB
  idempotently (WAL, foreign keys, same migration table).
- **R3.** Do not break `drizzle-kit generate` / `studio` interoperability.

## Acceptance Criteria

- [ ] **AC1.** Decision recorded in this PRD with the size delta (image MB).
- [ ] **AC2 (if kept).** No code change; a one-paragraph rationale is added to
      the file header or parent notes.
- [ ] **AC3 (if removed).** `docker build` succeeds; container boots, applies
      pending migrations, and serves `/api/rpc/health/check` on a fresh volume
      and on an already-migrated volume.
- [ ] **AC4.** Existing data volume migrates without re-applying old migrations.

## Out of Scope

- Changing the schema or the migration files themselves.
- Switching away from SQLite.

## Risks / Technical Notes

- The doc comment's "~60 MB" figure should be re-verified, not trusted.
- Deleting `migrate.ts` may also let the Dockerfile drop the separate migrator
  bundling step; check whether `esbuild` remains needed for `server:build`
  (it is).
- This is a decision task: closing it as "keep, documented" is a valid outcome.

## Decision (2026-09-24): KEEP the migrator

Recorded per R1/AC2 — no code change.

- Removing `migrate.ts` means shipping `drizzle-kit` (and its tsx/esbuild
  runtime needs) inside the runner image. That directly regresses two archived
  goals: `08-08-single-docker-image` (single bundled server.cjs, better-sqlite3
  as the only runtime dep) and `08-11-nas-footprint-reduction` (NAS footprint).
- The file header already documents the full trade-off and the compatibility
  contract (same `__drizzle_migrations` table, same hash logic), so the
  "accepted trade-off" note requirement is satisfied by the existing header.
- Ponytail principle: the 163-line file IS the lazy solution given the
  constraint (image size); replacing it with drizzle-kit trades 163 lines for
  ~60 MB of image.
