# Delete unused DB query helpers and `authTables` export

## Goal

Remove database exports with zero references.

## Confirmed Facts (verified 2026-09-24)

- `packages/database/src/drizzle/queries/users.ts`:
  - `countUsers()` (async) — no references.
  - `getUserById(id)` — no references.
  - `countUsersInTx(tx)` — **used** by
    `packages/auth/src/lib/bootstrap-admin.ts:62`; keep it.
- `packages/database/src/drizzle/schema/auth.ts` exports
  `authTables = { user, session, account, verification } as const` — no
  references. The Drizzle client registers tables via `import * as schema`, not
  through this const.

## Requirements

- **R1.** Delete `countUsers` and `getUserById`; keep `countUsersInTx`.
- **R2.** Delete the `authTables` const and its comment.
- **R3.** Remove imports that become unused: `eq` (only used by `getUserById`)
  and the local `UserRow` type (only used by `getUserById`). `count` stays
  (used by `countUsersInTx`).
- **R4.** Keep `user`, `session`, `account`, `verification` table exports and all
  schema definitions.

## Acceptance Criteria

- [ ] **AC1.** `grep -rn "countUsers\b\|getUserById\|authTables" apps packages tests` returns no source hits (note `countUsersInTx` must remain).
- [ ] **AC2.** Admin bootstrap still compiles and runs
      (`countUsersInTx` import intact).
- [ ] **AC3.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test` pass.

## Out of Scope

- Changing `countUsersInTx` or the bootstrap logic.
- Any schema/migration change.

## Risks / Technical Notes

- These functions were probably kept "for later"; YAGNI — re-add when a caller
  exists.
