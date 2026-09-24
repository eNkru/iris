# Inline trivial wrappers and trim stray exports

## Goal

Remove one-line indirection and unused exports flagged by the audit.

## Confirmed Facts (verified 2026-09-24)

- `packages/api/src/modules/shared.ts`:
  - `toNumber(value) => Number(value)` — a rename of `Number`.
  - `toNullableNumber(value) => value === null ? null : Number(value)`.
  - Callers: `packages/api/src/modules/products/lib/format.ts:20` (both),
    `packages/api/src/modules/history/procedures/by-product.ts` (`toNumber`).
- `apps/web/src/components/ui.tsx:226` re-exports
  `formatRelativeTime(date, lang)` as a wrapper that only maps `null → "—"` over
  `@iris/utils/format`'s helper. Callers: `product-list.tsx:292`,
  `routes/product.tsx:135` (always pass a real `lang`).
- `packages/utils/src/lib/env.ts`: `loadEnv` is exported but only called by
  `getEnv()` in the same file.
- `packages/auth/src/lib/smtp.ts`: `getSmtpTransporter` is exported but only
  called by `sendMagicLinkEmail` in the same file.
- `packages/auth/src/client.ts`: `export const { useSession, signIn, signOut }`
  — only `signOut` is imported (by `orpc-session-expiry.ts`); `useSession` and
  `signIn` are unused (components use `hooks/use-session` and `authClient`).
- `apps/web/server.ts` imports from `node:fs/promises` twice
  (`readFile` and `stat` in separate statements).

## Requirements

- **R1.** Inline `Number(...)` at the two call sites and delete
  `toNumber`/`toNullableNumber`.
- **R2.** Delete the `ui.tsx` `formatRelativeTime` wrapper; at the two call
  sites render `"—"` for `null` and call `@iris/utils/format` directly (or keep
  a local ternary).
- **R3.** Unexport `loadEnv` and `getSmtpTransporter` (keep the functions).
- **R4.** Reduce the auth client destructure to `export const { signOut }`.
- **R5.** Merge the duplicate `node:fs/promises` import in `server.ts`.

## Acceptance Criteria

- [ ] **AC1.** `grep -rn "toNumber\|toNullableNumber\|getSmtpTransporter\b" apps packages` shows no *exported* wrapper usage (the functions/call sites are gone or inlined).
- [ ] **AC2.** Price formatting in list/detail/history is unchanged
      (`tests/unit` + `tests/components` pass).
- [ ] **AC3.** Magic-link email still sends; `signOut` still importable from
      `@iris/auth/client`.
- [ ] **AC4.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test`,
      `pnpm --filter @iris/web server:build` pass.

## Out of Scope

- Behavioural changes to formatting or SMTP.
- The `redactFields` / `resetEnvCache` test seams (keep).

## Risks / Technical Notes

- `toNumber` conveys intent ("SQLite text → number"); if the reviewers prefer
  the name, drop only `toNullableNumber` and keep the rest. Record the choice.
- Keep the `logger`/`errorFields` exports (widely used).
