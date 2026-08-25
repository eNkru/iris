"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpcClient } from "../lib/orpc";
import { orpc } from "../lib/orpc-query-utils";

/**
 * User settings + admin global settings queries/mutations (R6/R7). Query keys
 * use the oRPC-generated helpers (frontend/orpc-usage.md §7.1).
 */

export type UserSettings = Awaited<ReturnType<(typeof orpcClient)["settings"]["get"]>>;
export type GlobalSettings = Awaited<
  ReturnType<(typeof orpcClient)["admin"]["globalSettings"]["get"]>
>;

export function useUserSettings() {
  return useQuery(orpc.settings.get.queryOptions({ input: {} }));
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["settings"]["update"]>[0]) =>
      orpcClient.settings.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.settings.get.key() });
    },
  });
}

export function useGlobalSettings() {
  return useQuery({
    ...orpc.admin.globalSettings.get.queryOptions({ input: {} }),
    retry: false,
  });
}

export function useUpdateGlobalSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      input: Parameters<(typeof orpcClient)["admin"]["globalSettings"]["update"]>[0],
    ) => orpcClient.admin.globalSettings.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.admin.globalSettings.get.key() });
    },
  });
}
