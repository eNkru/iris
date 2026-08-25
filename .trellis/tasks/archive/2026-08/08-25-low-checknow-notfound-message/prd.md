# Fix check-now misleading not_found → "Product not found" message

## Goal

`check-now.ts` maps the argus "page not found" result (`check.status === "not_found"`) to `ORPCError("NOT_FOUND", { message: "Product not found" })`. But a missing *product* (DB miss) is already handled at `:37`. So this 404 conflates "argus couldn't find the product page" with "the product row doesn't exist", surfacing a misleading "Product not found" message to the user for what is really an extraction/page-fetch failure. Disambiguate.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/api/src/modules/products/procedures/check-now.ts:50` — `check.status === "not_found"` throws `ORPCError("NOT_FOUND", { message: "Product not found" })`.
- The missing-product guard at `:37` already handles DB misses, so `:50` is the argus page-not-found branch, not a missing product.

## Requirements

- **R1.** The argus "page not found" (`check.status === "not_found"`) case surfaces a distinct, accurate message (e.g. "The product page could not be found" / reason `page_not_found`), not "Product not found".
- **R2.** The DB-missing-product guard at `:37` is unchanged (still `NOT_FOUND` "Product not found" for an actually-missing product).
- **R3.** The frontend maps the new reason to a user-facing message that distinguishes "page gone" from "product gone".

## Fix

At `check-now.ts:50`, throw a distinct error — either a different oRPC code (e.g. `NOT_FOUND` with a clearer message, or a custom error code like `PAGE_NOT_FOUND`) with message "The product page could not be found". Update the frontend check-now caller to render the appropriate message. Keep the DB-missing path as-is.

## Acceptance Criteria

- [ ] **AC1.** A product whose argus page is gone (argus returns `not_found`) surfaces a message about the page being missing, not "Product not found".
- [ ] **AC2.** A genuinely missing product (DB miss) still surfaces "Product not found" (no regression at `:37`).
- [ ] **AC3.** `pnpm -r typecheck` and lint pass; any check-now test updated to assert the new message/reason.

## Out of Scope

- Auto-pausing products whose page is gone (follow-up).

## Risks / Technical Notes

- Confirm the oRPC error code set the project uses; prefer an existing code over inventing one unless a custom code is clearly better.
- This is small; pair with another check-now / extraction task if convenient.
