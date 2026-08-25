"use client";

import { signOut as authSignOut } from "@iris/auth/client";

/**
 * Centralized session-expiry recovery (frontend/authentication.md).
 *
 * When an oRPC call returns HTTP 401 mid-session (session expired or revoked),
 * the QueryClient would otherwise surface a generic error box with no re-auth
 * path. This module signs the user out and redirects to `/login` exactly once,
 * no matter how many concurrent 401s fire on a page.
 *
 * Loop guard: if the user is already on `/login`, do nothing (the initial
 * `user`/session query 401 on a cold, never-authenticated load must not
 * bounce).
 */

let handling = false;

/**
 * Sign-out implementation. Indirected so tests can inject a spy without
 * mocking the `@iris/auth` workspace package (which has no Vite alias).
 */
let signOutImpl: () => Promise<void> = async () => {
  await authSignOut();
};

/** @internal Allows tests to inject the sign-out implementation. */
export function _setSignOutImpl(impl: () => Promise<void>): void {
  signOutImpl = impl;
}

/**
 * Reset the idempotency guard. Intended for tests that exercise
 * `handleSessionExpired` across cases; not used in production.
 */
export function _resetSessionExpiredGuard(): void {
  handling = false;
}

/**
 * Returns true if the response is an HTTP 401 (oRPC maps `UNAUTHORIZED` to
 * 401). Kept separate from `handleSessionExpired` so the interceptor can be
 * unit-tested without triggering a real navigation.
 */
export function isSessionExpired(status: number): boolean {
  return status === 401;
}

/**
 * Sign out and redirect to `/login`. Idempotent: concurrent 401s collapse to
 * a single recovery flow. No-op when already on `/login` (avoids a redirect
 * loop on cold unauthenticated loads).
 */
export async function handleSessionExpired(): Promise<void> {
  if (handling) {
    return;
  }
  if (typeof window !== "undefined" && window.location.pathname === "/login") {
    return;
  }
  handling = true;
  try {
    // signOut clears the session cookie + React Query cache best-effort; it
    // does not throw on an already-expired session.
    await signOutImpl();
  } catch {
    // Ignore — the redirect below is the authoritative recovery.
  }
  if (typeof window !== "undefined") {
    window.location.assign("/login");
  }
}

/**
 * oRPC `clientInterceptors` entry factory: after the upstream responds, if
 * it's a 401, trigger session-expiry recovery. The response is returned
 * unchanged so the calling hook still sees the error (recovery is a side
 * effect, not a transformation). Defined in `orpc.ts` where the oRPC client
 * types resolve so the interceptor matches the strict generic signature.
 */
export function makeSessionExpiryInterceptor<TResponse extends { status: number }>(
): (opts: { next: () => Promise<TResponse> }) => Promise<TResponse> {
  return async ({ next }) => {
    const response = await next();
    if (isSessionExpired(response.status)) {
      void handleSessionExpired();
    }
    return response;
  };
}
