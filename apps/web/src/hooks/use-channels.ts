"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpcClient } from "../lib/orpc";
import { orpc } from "../lib/orpc-query-utils";

/**
 * Alert channel queries + mutations (R11/R12). Query keys use the
 * oRPC-generated helpers (frontend/orpc-usage.md §7.1).
 */

export type Channel = Awaited<
  ReturnType<(typeof orpcClient)["channels"]["list"]>
>["channels"][number];

export function useChannels() {
  return useQuery(orpc.channels.list.queryOptions({ input: {} }));
}

export function useCreateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["channels"]["create"]>[0]) =>
      orpcClient.channels.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.channels.list.key() });
    },
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["channels"]["update"]>[0]) =>
      orpcClient.channels.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.channels.list.key() });
    },
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpcClient.channels.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.channels.list.key() });
    },
  });
}

export function useSendSummary() {
  return useMutation({
    mutationFn: () => orpcClient.channels.sendSummary(),
  });
}
