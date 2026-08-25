# Make TelegramHelpTooltip touch and AT-friendly

## Goal

`TelegramHelpTooltip` already has `onFocus`/`onBlur` and `role="tooltip"` (better than pure hover), but it's still not touch-friendly and not fully AT-friendly: no touch/click toggle (touch devices have no hover/focus on a `<span>`), no `aria-describedby`/`aria-labelledby` linking the trigger button to the tooltip content, and no `Escape` to close. Finish the accessibility job.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/components/telegram-help-tooltip.tsx` — has `onFocus`/`onBlur` (`:22-23`), `role="tooltip"` (`:30`).
- Gaps: (a) no touch/click toggle; (b) no `aria-describedby`/`aria-labelledby` linking trigger to tooltip; (c) no `Escape` to close.

## Requirements

- **R1.** Click/Enter/Space on the trigger toggles the tooltip (works on touch devices and keyboard).
- **R2.** The trigger button is linked to the tooltip content via `aria-describedby` (or `aria-labelledby`), so screen readers announce the help text when the trigger is focused.
- **R3.** `Escape` closes the tooltip (and returns focus to the trigger).
- **R4.** Hover/focus-open behavior is preserved (don't regress the existing onFocus/onBlur).
- **R5.** Clicking outside the tooltip closes it.

## Fix

Add click/keydown handlers on the trigger to toggle `open` state; add `aria-describedby={tooltipId}` on the trigger and `id={tooltipId}` on the tooltip content; add an `Escape` listener when open; add an outside-click handler (or a backdrop) to close. Reconcile the manual `open` state with the existing hover/focus state (e.g. a single `isOpen` driven by hover, focus, and click).

## Acceptance Criteria

- [ ] **AC1.** On a touch device, tapping the trigger opens the tooltip; tapping again or outside closes it.
- [ ] **AC2.** Keyboard: focusing the trigger shows the tooltip; `Enter`/`Space` toggles; `Escape` closes and returns focus to the trigger.
- [ ] **AC3.** A screen reader announces the tooltip text when the trigger is focused (via `aria-describedby`).
- [ ] **AC4.** Hover/focus open still works (no regression).
- [ ] **AC5.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Generalizing into a shared `Tooltip` primitive (keep it local unless the pattern repeats).
- Repositioning logic (keep current positioning).

## Risks / Technical Notes

- Don't break the existing onFocus/onBlur open behavior when adding click-toggle; use a single source of truth for `isOpen`.
- Ensure the tooltip content has a stable `id` (useId) so `aria-describedby` resolves.
