# Make ProductList image lightbox accessible

## Goal

The `ProductList` image lightbox is a `<div onClick>` overlay with no dialog semantics, no focus trap, no `Esc` handler, no scroll lock, and a hardcoded English `alt`. Make it a proper accessible dialog so keyboard and screen-reader users can use it.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/components/product-list.tsx:296-319` — overlay is `<div onClick={...}>`, no `role="dialog"`, no `aria-modal`, no focus trap, no `Esc` handler, no scroll lock.
- `<img alt="Product image">` is hardcoded English (not i18n).
- Only `aria-label="Close"` on the close button.

## Requirements

- **R1.** The overlay has `role="dialog"` and `aria-modal="true"`, with an `aria-labelledby`/`aria-label` describing it (e.g. "Product image").
- **R2.** Focus moves into the dialog when opened and returns to the triggering button when closed (focus trap).
- **R3.** `Escape` closes the lightbox.
- **R4.** Background scroll is locked while the lightbox is open (e.g. `document.body.style.overflow = 'hidden'` while open, restored on close).
- **R5.** The `<img>` `alt` is i18n-able (use the product name or a localized "Product image" string from the existing i18n setup, not hardcoded English).
- **R6.** Clicking the backdrop (outside the image) still closes the lightbox (existing behavior preserved).

## Fix

In `product-list.tsx`, replace the bare `<div onClick>` overlay with a dialog-role element. Add a small focus-trap effect (focus first/triggering element on open, restore on close; keep focus within the dialog via a keydown handler or a tiny inline trap). Add an `Escape` keydown listener and a body scroll-lock effect. Replace the hardcoded `alt` with the i18n hook's string (or the product name if available).

## Acceptance Criteria

- [ ] **AC1.** Opening the lightbox moves focus into the dialog; Tab cycles within the dialog (focus trap); closing returns focus to the triggering thumbnail.
- [ ] **AC2.** `Escape` closes the lightbox.
- [ ] **AC3.** Background scroll is locked while open and restored on close.
- [ ] **AC4.** The dialog is announced as a dialog by screen readers (`role="dialog"` + `aria-modal="true"` + accessible name).
- [ ] **AC5.** The image `alt` is no longer hardcoded English (i18n or product name).
- [ ] **AC6.** Clicking the backdrop still closes the lightbox (no regression).
- [ ] **AC7.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Replacing the hand-rolled lightbox with a library (keep it dependency-free per the ui.tsx contract).
- Full-screen image zoom/pan.

## Risks / Technical Notes

- Focus trap must not trap focus if the dialog is closed before focus settles (guard with an `isOpen` ref).
- Restore the original `body.style.overflow` value, don't assume it was `''`.
- Avoid SSR concerns: the app is a Vite SPA (client-only), so `document` access is safe inside effects.
