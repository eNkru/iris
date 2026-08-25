import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "@iris/database";
import { products } from "@iris/database/drizzle/schema/sqlite";
import { checkPrice } from "@iris/prices/pipeline";
import { protectedProcedure } from "../../../orpc/procedures";
import { checkNowInputSchema, checkNowOutputSchema } from "../types";

/**
 * Manual synchronous re-check of a product (R8 — same pipeline the scheduler
 * uses). Returns the check result so the UI can reflect a fresh price.
 */
export const checkProductNow = protectedProcedure
  .route({
    method: "POST",
    path: "/products/{id}/check-now",
    tags: ["Products"],
    summary: "Run a price check for a product now",
  })
  .input(checkNowInputSchema)
  .output(checkNowOutputSchema)
  .handler(async ({ input, context }) => {
    const { id } = input;

    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.userId, context.user.id)));

    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Product not found" });
    }

    const check = await checkPrice(id);

    if (check.status === "not_found") {
      // Argus reached the page but it's gone (HTTP 404 / blocked / delisted) —
      // distinct from the DB-missing-product guard above. The product row
      // still exists; only its source page is unreachable, so surface a
      // page-not-found message instead of the misleading "Product not found".
      throw new ORPCError("NOT_FOUND", {
        message: "The product page could not be found",
      });
    }

    return {
      success: true as const,
      reason: "Price check completed",
      check,
    };
  });
