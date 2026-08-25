# Reset ProductDetailPage mutation state across :id changes

## Goal

`ProductDetailPage` calls `useCheckNow()` at the component level, and when the user navigates between products (the `:id` param changes), the mutation's stale `.data` from the previous product persists — the user sees the previous product's check-now result on the new product. Reset the mutation state when `id` changes.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/routes/product.tsx:16` — `const checkNow = useCheckNow();` at module-level in the component; `useParams` changes `id` but `checkNow` (and its `.data`) is never reset on `id` change. No `useEffect` keyed on `id` calls `checkNow.reset()`.

## Requirements

- **R1.** When the `id` param changes, `checkNow.reset()` (and any other mutation used on the page, e.g. update/delete) is called so stale `.data`/`.error` from the previous product doesn't render.
- **R2.** In-flight mutation state is handled gracefully (reset doesn't abort a running mutation the user just triggered on the *current* product).
- **R3.** The query data for the new product refetches as today (no change to the query invalidation).

## Fix

Add a `useEffect(() => { checkNow.reset(); /* other mutations */ }, [id])` in the product detail component. Reset only on `id` change, not on every render. Verify React Query's `reset()` semantics (it resets to initial state, doesn't abort in-flight by default).

## Acceptance Criteria

- [ ] **AC1.** Trigger check-now on product A (success), then navigate to product B: product B does not show product A's check-now result/banner.
- [ ] **AC2.** Trigger check-now on product A (error), then navigate to product B: product B does not show product A's error.
- [ ] **AC3.** Triggering check-now on the current product still works (reset on mount/id-change doesn't wipe a fresh mutation).
- [ ] **AC4.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Cross-page query caching changes.
- Migrating to generated query keys (see M9 task — that may indirectly help here).

## Risks / Technical Notes

- `reset()` resets internal state but not in-flight promises by default; if a mutation is in flight when `id` changes, its eventual resolve/reject applies to the (reset) state — acceptable since the user navigated away.
- Apply the same reset pattern to any other mutation hooks used on the detail page (update, delete, pause/resume).
