"use client";

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { orpcClient } from "./orpc";

/**
 * oRPC + TanStack Query integration (frontend/orpc-usage.md §7.1).
 *
 * `orpc` exposes generated query keys (`orpc.products.list.key()`,
 * `orpc.products.get.queryKey({ id })`) and query-option helpers that stay in
 * sync with the oRPC router. Hooks use these instead of hand-written string
 * keys so cache identity and invalidation targets can't drift from the
 * router contract.
 */
export const orpc = createTanstackQueryUtils(orpcClient);
