# Allow clearing the Telegram bot token via the admin API

## Goal

The admin `update-global-settings` procedure treats an empty/absent `telegramBotToken` as "unchanged" and rejects `null` (schema is `z.string().optional()`, no `.nullable()`). There is no way to clear a previously-set bot token. Allow clearing it.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/api/src/modules/admin/procedures/update-global-settings.ts:37` — token is written only `if (input.telegramBotToken !== undefined && input.telegramBotToken.trim() !== "")`. Empty/absent = unchanged.
- `packages/api/src/modules/admin/types.ts:33` — `telegramBotToken: z.string().optional()`, no `.nullable()`, so `null` is rejected.

## Requirements

- **R1.** An admin can clear the stored Telegram bot token by sending an explicit clear sentinel. Acceptable designs:
  - (a) Accept `null` (change schema to `z.string().nullable().optional()` and write `null` to the column), or
  - (b) Accept an empty string `""` as "clear" (distinguish from `undefined` = unchanged).
- **R2.** `undefined`/absent still means "unchanged" (no behavior change for partial updates that don't touch the token).
- **R3.** Clearing the token stops Telegram alerts from being attempted (the dispatch/telegram path already checks for a token; verify it handles `null`/empty cleanly and doesn't crash).

## Fix

Update the schema in `admin/types.ts` to allow clearing (prefer `null` → `z.union([z.string(), z.null()]).optional()` or `z.string().nullable().optional()`). In `update-global-settings.ts`, when the clear sentinel is received, write `null` (or `""`) to the column. Verify the telegram sender handles the cleared token without throwing.

## Acceptance Criteria

- [ ] **AC1.** Sending `telegramBotToken: null` (or the agreed clear sentinel) clears the stored token in the DB.
- [ ] **AC2.** Sending `telegramBotToken: undefined`/absent leaves the stored token unchanged.
- [ ] **AC3.** Sending a non-empty string still updates the token (no regression).
- [ ] **AC4.** With the token cleared, dispatch does not attempt/throw on Telegram sends (logs + skips cleanly).
- [ ] **AC5.** `pnpm -r typecheck` and lint pass; add/update a test for the clear path.

## Out of Scope

- Rotating the token via a separate endpoint.
- Per-channel token (it's global).

## Risks / Technical Notes

- Coordinate the sentinel choice (null vs empty string) with the frontend admin settings form so the UI "Clear" button sends the agreed shape.
- Confirm the DB column is nullable (Drizzle schema) before writing `null`; if not nullable, use `""` as the cleared state and ensure senders treat `""` as "no token".
