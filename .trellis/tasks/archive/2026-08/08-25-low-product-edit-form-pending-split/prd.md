# Separate ProductEditForm pause/resume pending from Save

## Goal

`ProductEditForm`'s pause/resume button uses the same `updateProduct.mutate()` (and thus `updateProduct.isPending`) as the Save button, so saving disables the pause button and vice versa. Separate the pending state so the two actions don't disable each other.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/components/product-edit-form.tsx:141` — pause/resume uses `updateProduct.mutate()` (`:137`), sharing the same `useUpdateProduct()` hook instance.
- Save button `disabled={updateProduct.isPending}` (`:136`) and pause button `disabled={updateProduct.isPending}` (`:142`) share identical pending state.

## Requirements

- **R1.** Pause/resume and Save have independent pending state: saving doesn't disable the pause button, pausing doesn't disable Save.
- **R2.** Each action's own button is disabled while that action is pending (still prevent double-submit of the same action).
- **R3.** Both still hit the same `products.update` endpoint; the separation is client-side pending state only (or use two mutation instances).

## Fix

Either:
- (a) Use two `useUpdateProduct()` instances (one for save, one for pause/resume) so their `isPending` is independent, or
- (b) Track a local `pendingAction: 'save' | 'pause'` state and gate each button on `pendingAction === itsAction`.

Prefer (a) for clarity (matches the per-row-pending pattern in product list). Verify invalidation still works correctly with two instances (both should invalidate the product query).

## Acceptance Criteria

- [ ] **AC1.** While Save is pending, the pause/resume button is enabled (and vice versa).
- [ ] **AC2.** Each button is disabled while its own action is pending (no double-submit).
- [ ] **AC3.** Both actions still update the product and invalidate the query (no stale data).
- [ ] **AC4.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Merging pause/resume into a dedicated endpoint (keep `products.update`).
- ProductEditForm label/threshold fixes (see M7 task).

## Risks / Technical Notes

- Two mutation instances both calling `products.update` both invalidate the same query key — harmless (idempotent invalidation).
- Ensure the local-state option (b) clears `pendingAction` in `onSettled` so a failed mutation re-enables the button.
