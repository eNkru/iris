"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpcClient } from "../lib/orpc";
import { orpc } from "../lib/orpc-query-utils";

/**
 * Product queries + mutations (frontend/hooks.md). Types are inferred directly
 * from the oRPC client — never redefined (shared/typescript.md). Query keys
 * use the oRPC-generated helpers (frontend/orpc-usage.md §7.1) so cache identity
 * and invalidation targets stay in sync with the router.
 */

export type CreateProductInput = Parameters<(typeof orpcClient)["products"]["create"]>[0];
export type CreateProductOutput = Awaited<ReturnType<(typeof orpcClient)["products"]["create"]>>;
export type ProductListItem = Awaited<
  ReturnType<(typeof orpcClient)["products"]["list"]>
>["products"][number];
export type ProductOutput = Awaited<
  ReturnType<(typeof orpcClient)["products"]["get"]>
>["product"];
export type ProductHistory = Awaited<
  ReturnType<(typeof orpcClient)["products"]["get"]>
>["history"];
export type CheckNowOutput = Awaited<ReturnType<(typeof orpcClient)["products"]["checkNow"]>>;

export function useProducts(active?: boolean) {
  return useQuery(
    orpc.products.list.queryOptions({
      input: active !== undefined ? { active } : {},
      // Keep the home-page list fresh while mounted (R6). Only this query opts in.
      refetchInterval: 30_000,
    }),
  );
}

export function useProduct(productId: string) {
  return useQuery({
    ...orpc.products.get.queryOptions({ input: { id: productId } }),
    enabled: productId.length > 0,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation<CreateProductOutput, Error, CreateProductInput>({
    mutationFn: (input) => orpcClient.products.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.products.list.key() });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Parameters<(typeof orpcClient)["products"]["update"]>[0]) =>
      orpcClient.products.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.products.list.key() });
      queryClient.invalidateQueries({ queryKey: orpc.products.get.key() });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => orpcClient.products.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.products.list.key() });
    },
  });
}

export function useCheckNow() {
  const queryClient = useQueryClient();

  return useMutation<CheckNowOutput, Error, { id: string }>({
    mutationFn: ({ id }) => orpcClient.products.checkNow({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.products.list.key() });
      queryClient.invalidateQueries({ queryKey: orpc.products.get.key() });
    },
  });
}
