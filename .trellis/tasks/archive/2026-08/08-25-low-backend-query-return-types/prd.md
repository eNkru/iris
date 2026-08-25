# Add explicit return types to getUserById and countUsers queries

## Goal

`packages/database/src/drizzle/queries/users.ts` exports `getUserById` and `countUsers` without explicit return types, while all other query exports (`products.ts`, `settings.ts`) have them. For consistency and to avoid accidental type drift, add explicit return types.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/database/src/drizzle/queries/users.ts:16` — `export async function getUserById(id: string) {` has no explicit return type; sibling `countUsers()` (`:11`) also lacks one.
- All other query exports (`products.ts`, `settings.ts`) DO have explicit return types.

## Requirements

- **R1.** `getUserById` and `countUsers` have explicit return types (e.g. `Promise<UserRow | null>` and `Promise<number>`), inferred once and then pinned.
- **R2.** The pinned types match what callers already expect (no breaking change to call sites).
- **R3.** Consistent with the style of the other query files in the same directory.

## Fix

Read the inferred return type (via TS or by inspecting the query), then add an explicit `: Promise<...>` annotation to both functions in `users.ts`. Verify all callers still typecheck.

## Acceptance Criteria

- [ ] **AC1.** `getUserById` and `countUsers` have explicit return types.
- [ ] **AC2.** All callers typecheck unchanged (`pnpm -r typecheck`).
- [ ] **AC3.** Lint passes.

## Out of Scope

- Refactoring the query layer.
- Adding types to other already-typed files.

## Risks / Technical Notes

- If the inferred type is complex (Drizzle row types), use the project's existing type-export pattern (check how `products.ts` annotates its returns) rather than hand-writing a struct.
- Trivial change; pair with another backend cleanup task.
