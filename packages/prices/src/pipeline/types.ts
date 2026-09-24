/**
 * Result of one `checkPrice(productId)` run (design.md pipeline step 3).
 *
 * - `changed`: a new `price_readings` row was inserted and `currentPrice`
 *   updated; `oldPrice` is null on the very first successful check. Since the
 *   2026-08-25 extraction migration `currency` may be null when argus's
 *   extraction could not determine one (the notification/UI layers treat a
 *   missing currency as "no prefix").
 * - `unchanged`: price did not move; only `lastCheckedAt` was updated (R9).
 * - `unavailable`: the page loaded but extraction reported the product as
 *   out of stock / price not visible.
 * - `failed`: extraction failed; `lastCheckedAt` was still
 *   updated so the product is not re-checked on the next scheduler tick.
 * - `not_found`: no product row with this id.
 */
export type CheckPriceResult =
  | {
      status: "changed";
      oldPrice: number | null;
      newPrice: number;
      currency: string | null;
      alertDispatched: boolean;
    }
  | { status: "unchanged"; price: number }
  | { status: "unavailable" }
  | { status: "failed"; reason: string }
  | { status: "not_found" };
