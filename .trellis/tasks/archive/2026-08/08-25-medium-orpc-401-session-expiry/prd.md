# Add centralized 401/session-expiry handling in oRPC client

## Goal

When a user's session expires mid-session (better-auth magic-link session times out, or token is revoked), in-flight oRPC queries and mutations fail with a generic `ErrorBox` and there is no path to re-authenticate. Add centralized 401 detection in the oRPC client that signs the user out and redirects to `/login`, so an expired session is recovered gracefully instead of leaving the UI stuck on opaque errors.

## Background / Confirmed Facts

Verified against current code (2026-08-25, post Critical/High PR merges):

- `apps/web/src/lib/orpc.ts:14-22` — bare `RPCLink` with no `interceptors`/`onError`. No 401 handling anywhere in `src/lib`.
- `apps/web/src/components/session-provider.tsx:26-27` — QueryClient defaults `staleTime: Infinity` + `refetchOnWindowFocus: false`.
- `apps/web/src/main.tsx:27` — global `refetchOnWindowFocus: false`.
- Net effect: once a `user` query resolves, it is cached forever with no refetch, so an expired session keeps showing stale `user` and every subsequent oRPC call 401s into a generic error box.

## Requirements

- **R1.** Centralized 401 handling in the oRPC client: any oRPC response with HTTP 401 (or the oRPC error code mapping to `UNAUTHORIZED`) triggers a single shared recovery routine — call `signOut({ autoRedirect: false })` (or the existing session-clear path) then redirect to `/login`.
- **R2.** The recovery routine must be idempotent: many concurrent 401s on a page must trigger sign-out + redirect exactly once, not N times.
- **R3.** A 401 on the initial `user`/session query (cold load, never authenticated) must NOT loop — if already on `/login`, do nothing.
- **R4.** Non-401 errors must continue to surface to the calling hook's `error` state as today (no behavior change for 4xx/5xx that are not auth).

## Fix

Add an error interceptor to the oRPC client link (or a QueryClient `onError`/mutation error handler) in `apps/web/src/lib/orpc.ts` that:
1. Inspects the error for 401 status / `UNAUTHORIZED` code.
2. Guards against redirect loops (already-on-`/login`).
3. Calls the existing sign-out helper and `window.location.assign('/login')` (or React Router `navigate`) via a shared module-level `handleSessionExpired()` guarded by an `isHandling` flag.

## Acceptance Criteria

- [ ] **AC1.** Simulate an expired session (clear session cookie / stub `signOut` to force 401 on next call): the first oRPC query/mutation 401 triggers exactly one redirect to `/login`; no generic ErrorBox flashes for the user.
- [ ] **AC2.** Triggering 5 concurrent 401s fires the sign-out + redirect once (idempotent guard).
- [ ] **AC3.** A cold load on `/login` where the `user` query 401s does NOT redirect (no loop).
- [ ] **AC4.** A 500 / network error still surfaces as a normal error to the calling hook (no redirect, no sign-out).
- [ ] **AC5.** `pnpm --filter @iris/web typecheck` and `pnpm --filter @iris/web lint` pass.

## Out of Scope

- Changing `staleTime` / window-focus refetch policy (separate concern; covered by a refreshed-session UX discussion).
- Token refresh / silent re-auth (better-auth magic-link model doesn't use refresh tokens).

## Key Decisions

- Intercept at the oRPC link layer (single chokepoint) rather than per-hook, so all queries and mutations are covered without touching every hook.
- Use a module-level `isHandling` boolean (or a deferrable Promise) so concurrent 401s collapse to one recovery flow.

## Risks / Technical Notes

- oRPC client error shape: confirm whether 401 surfaces as `error.status === 401` or an oRPC error code (`UNAUTHORIZED`). Verify against `@orpc/client` version in use.
- Avoid hard reload if React Router is available; but a full reload to `/login` is acceptable and simplest.
- Existing `AuthGate`/session provider already redirects unauthenticated users on mount — the new handler covers the *mid-session expiry* case, not the initial-load case.
