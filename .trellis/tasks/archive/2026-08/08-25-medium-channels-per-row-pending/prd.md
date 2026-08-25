# Track per-row pending state in Channels section

## Goal

The Channels section gates every row's enable/disable button on the shared `updateChannel.isPending` mutation state, so updating one channel disables all rows. The language `SegmentedControl` is never disabled at all. Mirror the product list's per-row pending pattern so only the row being updated shows pending state and is disabled.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/components/channels-section.tsx:130` — enable/disable `ButtonSecondary` has `disabled={updateChannel.isPending}` (shared mutation state).
- Language `SegmentedControl` at `:117-121` has no `disabled` prop at all.
- One update disables all rows' buttons; language control never disabled.
- Reference implementation: the product list (`components/product-list.tsx`) already tracks per-row pending (the R1 fix from the 2026-08-05 UI review). Reuse the same pattern.

## Requirements

- **R1.** Track the id of the channel currently being updated (e.g. `const [updatingId, setUpdatingId] = useState<string | null>(null)`), set on `.mutate({ id, ... }, { onMutate, onSettled })`.
- **R2.** An enable/disable button is disabled only when `updateChannel.isPending && updatingId === channel.id`. Other rows remain enabled and show no spinner.
- **R3.** The language `SegmentedControl` for a row is disabled while that row is updating (`updatingId === channel.id`).
- **R4.** The pending state clears in `onSettled` (not just `onSuccess`) so a failed mutation re-enables the row.

## Fix

In `channels-section.tsx`, add `updatingId` state; set it in the mutation's `onMutate`, clear in `onSettled`. Gate both the enable/disable button and the language `SegmentedControl` on `updatingId === channel.id`. Follow the product-list per-row-pending spec.

## Acceptance Criteria

- [ ] **AC1.** With ≥2 channels, clicking enable/disable on one row shows pending only on that row; every other row's enable/disable button remains enabled.
- [ ] **AC2.** The language control of the row being updated is disabled during the update; other rows' language controls remain interactive.
- [ ] **AC3.** A failed update (e.g. network error) clears pending and re-enables the row (onSettled path).
- [ ] **AC4.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Per-row pending for settings forms (separate).
- Language `SegmentedControl` accessibility (handled in its own component).

## Risks / Technical Notes

- Match the existing product-list per-row pending pattern exactly for consistency (see `.trellis/spec/frontend` per-row-pending spec if present).
- Ensure `onSettled` resets `updatingId` to `null` in all outcomes.
