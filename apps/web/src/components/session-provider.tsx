"use client";

import { authClient } from "@iris/auth/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { SessionContext, type SessionContextValue } from "../lib/session-context";

/**
 * Session query key shared by the provider, hooks, and auth flows
 * (frontend/authentication.md §3 — cache invalidation after auth changes).
 */
export const sessionQueryKey = ["user", "session"] as const;

export function useSessionQuery() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const { data, error } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (error) {
        throw new Error(error.message || "Failed to fetch session");
      }
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Session provider (frontend/authentication.md §3). Wraps better-auth's session
 * in React Query so pages can render a `loaded` gate without flashing
 * unauthenticated content during static prerendering.
 *
 * `loaded` is derived from the query's settled state (`isSuccess || isError`),
 * NOT from a truthy `data` check. better-auth's `/get-session` returns `null`
 * (not `{ session: null, user: null }`) when the user is signed out, so a
 * `data`-truthy gate would never flip and an expired/revoked session (cookie
 * present, server session dead) would hang the client on a perpetual spinner
 * after the server's cookie-presence gate already served `index.html`.
 * The same is true for a `/get-session` network error: `retry: false` means
 * the query settles to `isError`.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useSessionQuery();
  const sessionData = query.data;
  const loaded = query.isSuccess || query.isError;

  const value: SessionContextValue = {
    loaded,
    session: sessionData?.session ?? null,
    user: sessionData?.user ?? null,
    reloadSession: async () => {
      const { data, error } = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (error) {
        throw new Error(error.message || "Failed to fetch session");
      }
      queryClient.setQueryData(sessionQueryKey, () => data);
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
