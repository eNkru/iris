# Reset AddProductForm success banner after submit

## Goal

`AddProductForm` shows a success banner when `createProduct.data?.check.status === "changed"`, but this state is never cleared on a new submit — only `error` is reset. After a successful add, the banner lingers into the next add attempt. Reset the mutation data on a new submit.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/components/add-product-form.tsx` — success banner (`createProduct.data?.check.status === "changed"`, `:61-67`) is never cleared/reset on a new submit; only `error` is reset (`:30`); `createProduct` mutation data is never `.reset()`.
- Price formatting (previously hand-rolled) is already FIXED (uses `toFixed(2)` on numeric fields, `:65`/`:73`).

## Requirements

- **R1.** On a new submit, the previous success banner is cleared before the new attempt (so the user doesn't see a stale "added" banner while the new add is pending).
- **R2.** After a new successful (or failed) add, the banner reflects the new result only.
- **R3.** The `error` reset behavior is preserved.

## Fix

Call `createProduct.reset()` (or clear the relevant state) at the start of the submit handler, before `createProduct.mutate(...)`. Ensure resetting doesn't fl/flicker the banner (reset clears to initial, then mutate sets pending, then success/error sets the result).

## Acceptance Criteria

- [ ] **AC1.** After a successful add, starting a new add clears the success banner immediately (no stale banner during the new pending).
- [ ] **AC2.** A failed add shows the error and no lingering success banner.
- [ ] **AC3.** A subsequent successful add shows the success banner for the new add.
- [ ] **AC4.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Form-wide reset (URL field reset) — separate concern, only if desired.
- Price formatting (already fixed).

## Risks / Technical Notes

- `reset()` then `mutate()` in the same handler: verify the banner doesn't fl/no-op because reset is async. If it fl, use a local `setShowSuccess(false)` state instead.
- Small change; pair with another small frontend task if convenient.
