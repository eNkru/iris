# Make first-user admin bootstrap race-safe

## Goal

The first-user admin bootstrap has a TOCTOU race: two concurrent first sign-ups can both observe `countUsers() === 1` (well, both see "not the first"), both skip the admin grant, and the instance ends up with **zero admins** — locking the owner out of the admin panel. The existing code comment acknowledges a race but incorrectly claims it "only downgrades the second" sign-up. Make the bootstrap race-safe.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/auth/src/lib/bootstrap-admin.ts:15-21` — `countUsers()` → `if (userCount !== 1) return` → `db.update(... admin)`. No transaction/lock.
- Two concurrent first sign-ups: both insert, both see `count=2`, both `return`, both skip → zero admins.
- The code comment at `:11` acknowledges the race but mischaracterizes the outcome.

## Requirements

- **R1.** Exactly one of the first N users is granted admin; it is impossible to end up with zero admins due to concurrent first sign-ups.
- **R2.** The fix must work on SQLite (the project's DB). Acceptable approaches:
  - (a) Serialize the check+grant inside a single transaction with a write lock (`BEGIN IMMEDIATE`), or
  - (b) Use a `uniqueIndex` on a sentinel (e.g. a `meta` row `admin_bootstrap_done`) and grant admin only on the first successful insert of that sentinel, or
  - (c) Grant admin on the *first insert only* via a conditional insert.
- **R3.** Existing behavior for the normal case (single first sign-up) is unchanged: that user becomes admin.
- **R4.** No new DB migration is strictly required if approach (a)/(c) is used; if a sentinel table/row is used, include the migration.

## Fix

Recommended: wrap the count+grant in an immediate transaction so the count is read under a write lock and the grant is atomic. Concretely: `db.transaction(async (tx) => { const n = await tx.countUsers(); if (n === 1) await tx.update(...admin); })` with `BEGIN IMMEDIATE` semantics (Drizzle exposes this via `db.transaction` on better-sqlite3 which uses immediate by default under DML). Verify Drizzle/better-sqlite3 transaction isolation gives the required serialization; if not, fall back to a sentinel `INSERT ... ON CONFLICT DO NOTHING` + grant only when the sentinel insert returned a row.

## Acceptance Criteria

- [ ] **AC1.** Simulating two concurrent first sign-ups (two requests in flight) results in exactly one admin; never zero.
- [ ] **AC2.** A lone first sign-up still grants admin to that user (no regression).
- [ ] **AC3.** Second and later sign-ups are never granted admin by the bootstrap path.
- [ ] **AC4.** Add a test (in-memory SQLite, two concurrent sign-ups) proving exactly one admin. `pnpm test` passes.
- [ ] **AC5.** `pnpm -r typecheck` and lint pass.

## Out of Scope

- Admin demotion / multi-admin management UI.
- Changing who "the first user" is after the race is resolved.

## Risks / Technical Notes

- SQLite `BEGIN IMMEDIATE` serializes writers; under better-sqlite3 + Drizzle, `db.transaction` runs in a single connection and acquires a write lock on first DML — confirm this blocks the second concurrent transaction until the first commits, which is the desired serialization.
- Avoid introducing a long-held lock that degrades sign-up throughput under normal operation (the transaction is tiny).
- Fix the misleading comment at `bootstrap-admin.ts:11`.
