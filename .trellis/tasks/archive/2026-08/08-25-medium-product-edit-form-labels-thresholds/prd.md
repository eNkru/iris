# Associate ProductEditForm labels and validate thresholds > 0

## Goal

`ProductEditForm` has two accessibility/correctness gaps: (1) form labels are not associated with their inputs (no `htmlFor`/`id`), so clicking a label doesn't focus the field and screen readers don't announce association; (2) the four threshold fields (`risePct`/`fallPct`/`riseAbs`/`fallAbs`) accept `0` and negative values client-side, which the server rejects with a generic message. Associate labels and validate thresholds client-side so invalid input is caught before submit.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/src/components/product-edit-form.tsx:86-96` — `numberField` helper: `<Label>{label}</Label>` with no `htmlFor`, `<Input>` with no `id`.
- Threshold fields (`risePct`/`fallPct`/`riseAbs`/`fallAbs`) have only `min="0"` HTML attr (a browser hint, not enforced); no JS validation — typed `-5` or `0` passes to server.
- The `interval` field at `:62-66` DOES validate `< 1`; thresholds do not.

## Requirements

- **R1.** Every label in `ProductEditForm` is associated with its input via `htmlFor`/`id` (generate stable ids, e.g. `useId()` per field).
- **R2.** The four threshold fields reject `<= 0` client-side with an inline validation message; the submit is blocked while invalid.
- **R3.** Server-side validation remains the source of truth (do not remove it); client validation is a UX improvement only.
- **R4.** Existing behavior for valid thresholds is unchanged.
- **R5.** Empty threshold fields remain valid (thresholds are optional — empty means "no threshold").

## Fix

In `product-edit-form.tsx` `numberField` helper: accept an `id` (or generate via `useId()`), pass `htmlFor={id}` to `Label` and `id={id}` to `Input`. Add client-side validation for the four threshold fields: parse the number, if present and `<= 0`, show an inline error and disable submit. Reuse the existing inline-error pattern in the form.

## Acceptance Criteria

- [ ] **AC1.** Clicking a label focuses its input (label-input association works).
- [ ] **AC2.** Typing `0` or `-5` into a threshold field shows an inline error and blocks submit; a positive value clears the error.
- [ ] **AC3.** An empty threshold field is valid (no error, submit allowed).
- [ ] **AC4.** Valid thresholds submit successfully (no regression).
- [ ] **AC5.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Changing the alert-rules silent-config warning (separate, already implemented).
- Server-side threshold validation changes.

## Risks / Technical Notes

- Use React's `useId()` for stable, SSR-safe ids (the app is a Vite SPA, but `useId` is still best practice).
- Ensure the generated id doesn't collide across multiple instances of the form on one page (unlikely here, but `useId` handles it).
- Don't break the existing `numberField` helper's other call sites (check all callers when changing the signature).
