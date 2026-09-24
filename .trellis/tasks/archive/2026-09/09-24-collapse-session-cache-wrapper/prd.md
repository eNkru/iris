# Collapse the `session-cache` wrapper

## Goal

Remove the pass-through session helper. `getSessionWithCache` only delegates to
`auth.api.getSession` and returns an always-`false` `fromCache` flag, so it adds
an interface with a single implementation and a dead field.

## Confirmed Facts (verified 2026-09-24)

- `packages/auth/src/lib/session-cache.ts` defines:
  - `SessionWithUser`, `GetSessionResult` (with `fromCache: boolean` documented
    "Always false: SQLite is the authoritative local session store").
  - `getSessionWithCache(headers)` → `{ session: await auth.api.getSession({ headers }), fromCache: false }`.
- Single caller: `packages/api/src/orpc/procedures.ts`
  (`protectedProcedure`) reads `result.session` only; `fromCache` is never read
  anywhere.
- Re-exported from `packages/auth/src/index.ts` and via
  `package.json` `exports["./lib/session-cache"]`.
- The wrapper's own docstring admits an external cache "would add failure modes
  without meaningful benefit" — i.e. the abstraction has no second use.

## Requirements

- **R1.** Replace the call site with a direct
  `auth.api.getSession({ headers: context.headers })`.
- **R2.** Delete `packages/auth/src/lib/session-cache.ts`, its
  `packages/auth/package.json` export entry, and the `index.ts` re-export.
- **R3.** Preserve `protectedProcedure` semantics: 401 `UNAUTHORIZED` when no
  session; inject `{ session, user }` into context when present.
- **R4.** Resolve the `auth` import without pulling the React client into the
  server path — prefer a server-only subpath export (e.g. `./auth`) over the
  `@iris/auth` root if the root re-exports `client.ts`.

## Acceptance Criteria

- [ ] **AC1.** `grep -rn "getSessionWithCache\|fromCache\|GetSessionResult\|SessionWithUser" apps packages tests` returns no source hits.
- [ ] **AC2.** Unauthenticated oRPC calls still return 401; authenticated calls
      still receive `context.user` / `context.session`.
- [ ] **AC3.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test` pass.

## Out of Scope

- Adding a real session cache.
- Changing better-auth config.

## Risks / Technical Notes

- Watch for an import cycle: `@iris/api` already depends on `@iris/auth`. Import
  `auth` from a server-only entrypoint to avoid bundling `better-auth/react`.
- Unit tests reference the session flow indirectly (`orpc-session-expiry` is
  client-side); verify no test imports the deleted module.
