# Migrate TanStack Query keys to oRPC-generated keys

## Goal

All TanStack Query keys in the web app are hand-written strings (`["products"]`, `["product", id]`, etc.), and `@orpc/tanstack-query` is not installed. The frontend spec `orpc-usage.md §7.1` mandates oRPC-generated keys (`orpc.items.list.key()`). Migrate to generated keys so cache invalidation stays in sync with the oRPC router as it evolves.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/hooks/use-products.ts:16` — `PRODUCTS_KEY = ["products"]`; `:24` — `["product", productId]`.
- `apps/web/src/hooks/use-channels.ts:12` — `CHANNELS_KEY = ["channels"]`.
- `apps/web/src/hooks/use-settings.ts:13-14` — hand-written string keys.
- `@orpc/tanstack-query` absent from all package.json files (grep: no matches).
- Spec `.trellis/spec/frontend/orpc-usage.md:519-524` mandates `orpc.items.list.key()` generated keys.

## Requirements

- **R1.** Install `@orpc/tanstack-query` and wire the generated `orpc` client into the QueryClient via its plugin.
- **R2.** Every `useQuery`/`useMutation` in the web app uses the generated key (e.g. `orpc.products.list.key()`, `orpc.products.get.key({ id })`) instead of hand-written strings.
- **R3.** All invalidations use the generated key helpers (e.g. `queryClient.invalidateQueries({ queryKey: orpc.products.list.key() })`).
- **R4.** No behavior change: cache identity, invalidation targets, and refetch behavior are unchanged (generated keys hash to the same logical queries).
- **R5.** The hand-written `*_KEY` constants are removed (not left as dead code).

## Fix

1. `pnpm --filter @iris/web add @orpc/tanstack-query`.
2. Wire the `orpc` client into the TanStack Query plugin per `@orpc/tanstack-query` docs.
3. Update `use-products.ts`, `use-channels.ts`, `use-settings.ts`, and any other hook using `useQuery`/`useMutation` to use generated keys.
4. Update all `queryClient.invalidateQueries`/`setQueryData` call sites to use generated keys.
5. Remove the hand-written `*_KEY` exports.
6. Update the `orpc-usage.md` spec example if needed to match the new pattern.

## Acceptance Criteria

- [ ] **AC1.** No hand-written query keys remain in `apps/web/src` (grep for `["products"]`, `["product"`, `["channels"]`, `["settings"]` returns no hook usages).
- [ ] **AC2.** `@orpc/tanstack-query` is a dependency of `@iris/web`.
- [ ] **AC3.** App behavior unchanged: products/channels/settings load, mutate, and invalidate correctly (manual smoke).
- [ ] **AC4.** `pnpm --filter @iris/web typecheck` and lint pass.
- [ ] **AC5.** The `orpc-usage.md` spec's generated-keys example matches the implemented pattern.

## Out of Scope

- Refactoring the oRPC router itself.
- Changing the QueryClient defaults (staleTime etc. — separate concern, see M1 task).

## Risks / Technical Notes

- Generated key shapes may differ from the hand-written ones; verify invalidation targets still hit the right queries (e.g. a list invalidation after a create).
- `@orpc/tanstack-query` version must match the `@orpc/client` version already in use.
- This touches many files; do it as one coherent commit and smoke-test the main flows (products list + detail + create + update + delete, channels, settings).
