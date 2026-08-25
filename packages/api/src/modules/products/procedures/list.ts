import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@iris/database";
import { priceReadings, products } from "@iris/database/drizzle/schema/sqlite";
import { protectedProcedure } from "../../../orpc/procedures";
import { toPriceReadingOutput, toProductOutput } from "../lib/format";
import {
  listProductsInputSchema,
  listProductsOutputSchema,
  type PriceReadingOutput,
} from "../types";

/**
 * List the current user's products with the current price and the latest
 * stored reading. Latest readings are fetched in ONE batch query and grouped in
 * memory — no N+1 (database.md).
 */
export const listProducts = protectedProcedure
  .route({
    method: "GET",
    path: "/products",
    tags: ["Products"],
    summary: "List the user's tracked products",
  })
  .input(listProductsInputSchema)
  .output(listProductsOutputSchema)
  .handler(async ({ input, context }) => {
    const { active, limit } = input;

    const rows = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.userId, context.user.id),
          active !== undefined ? eq(products.active, active) : undefined,
        ),
      )
      .orderBy(desc(products.createdAt), desc(products.id))
      .limit(limit);

    const latestReadings =
      rows.length > 0
        ? await getLatestReadingsByProduct(rows.map((row) => row.id))
        : new Map<string, PriceReadingOutput>();

    return {
      success: true as const,
      reason: "Products fetched",
      products: rows.map((row) => ({
        ...toProductOutput(row),
        latestReading: latestReadings.get(row.id) ?? null,
      })),
    };
  });

/**
 * Bounded latest-reading lookup. Previously this loaded EVERY reading for the
 * batch and reduced to the latest per product in memory — unbounded as a price
 * tracker accumulates history (100 products × months of checks). It now runs a
 * SINGLE indexed query that keeps, per product, only the row with the greatest
 * `(checkedAt, id)` via a correlated subquery (SQLite 3.25+). The result is
 * bounded to at most one row per product, so the in-memory dedup below is
 * effectively a no-op safety net for ties and costs nothing over the bounded
 * set. Uses the `price_readings_product_id_checked_at_idx` index.
 */
async function getLatestReadingsByProduct(
  productIds: string[],
): Promise<Map<string, PriceReadingOutput>> {
  const readings = await db
    .select()
    .from(priceReadings)
    .where(
      and(
        inArray(priceReadings.productId, productIds),
        // Keep only each product's latest row: the row whose id equals the id
        // of the per-product max (checkedAt DESC, id DESC) row. Bounded to ≤ 1
        // row per product regardless of history length. Subquery column refs
        // are raw (Drizzle's column object would emit `p2."price_readings"."id"`
        // — invalid), so they're quoted camelCase per the SQLite contract.
        sql`${priceReadings.id} = (
          SELECT "p2"."id" FROM "price_readings" AS "p2"
          WHERE "p2"."productId" = ${priceReadings.productId}
          ORDER BY "p2"."checkedAt" DESC, "p2"."id" DESC
          LIMIT 1
        )`,
      ),
    );

  const latestByProduct = new Map<string, PriceReadingOutput>();
  for (const reading of readings) {
    const existing = latestByProduct.get(reading.productId);
    const mapped = toPriceReadingOutput(reading);
    if (!existing || mapped.checkedAt.getTime() > existing.checkedAt.getTime()) {
      latestByProduct.set(reading.productId, mapped);
    }
  }
  return latestByProduct;
}
