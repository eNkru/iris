import { priceReadings, products } from "@iris/database/drizzle/schema/sqlite";
import { toNullableNumber, toNumber } from "../../shared";
import type { PriceReadingOutput, ProductOutput } from "../types";

type ProductRow = typeof products.$inferSelect;
type ReadingRow = typeof priceReadings.$inferSelect;

/**
 * Map a `products` DB row to the API output shape. SQLite stores prices as
 * fixed-point text, so prices are normalized to numbers here (the output
 * schemas declare `z.number()`, not `z.coerce.number()`).
 */
export function toProductOutput(row: ProductRow): ProductOutput {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    name: row.name,
    currency: row.currency,
    currentPrice: toNullableNumber(row.currentPrice),
    imagePath: row.imagePath,
    lastCheckedAt: row.lastCheckedAt,
    lastCheckStatus: toCheckStatus(row.lastCheckStatus),
    lastCheckError: row.lastCheckStatus === "failed" ? row.lastCheckError : null,
    pollIntervalMinutes: row.pollIntervalMinutes,
    alertRules: row.alertRules,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Narrow a raw DB text column to the known check-status union. Defensive
 * against hand-edited databases: an unknown value surfaces as null (never
 * checked) instead of poisoning the API output.
 */
function toCheckStatus(value: string | null): ProductOutput["lastCheckStatus"] {
  return value === "changed" ||
    value === "unchanged" ||
    value === "unavailable" ||
    value === "failed"
    ? value
    : null;
}

/**
 * Map a `price_readings` DB row to the API output shape.
 */
export function toPriceReadingOutput(row: ReadingRow): PriceReadingOutput {
  return {
    id: row.id,
    productId: row.productId,
    price: toNumber(row.price),
    currency: row.currency,
    checkedAt: row.checkedAt,
  };
}
