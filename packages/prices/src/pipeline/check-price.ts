import { eq } from "drizzle-orm";
import { db } from "@iris/database";
import { priceReadings, products } from "@iris/database/drizzle/schema/sqlite";
import { errorFields, logger } from "@iris/utils";
import { dispatchPriceAlert } from "../notifications/dispatch";
import { roundToCent, shouldAlert } from "./alert-rules";
import { extractPrice } from "./extract-price";
import { imageUrlFromProductNode, downloadProductImage } from "./extract-image";
import type { CheckPriceResult } from "./types";

type ProductRow = typeof products.$inferSelect;

const inflightChecks = new Map<string, Promise<CheckPriceResult>>();

/**
 * Overall per-product check deadline. A single hung argus extraction can
 * otherwise hold the single-flight lock for up to ~6min (120s × 3 retries),
 * blocking manual check-now and occupying a scheduler slot. When the deadline
 * fires, the check resolves as `failed: check_deadline_exceeded` so the lock
 * releases and the caller surfaces a clear error. The underlying extract work
 * is not aborted (v1); it continues and its eventual result is ignored.
 */
const CHECK_DEADLINE_MS = 150_000;

/**
 * checkPrice(productId) — the synchronous price-check pipeline (R8):
 * extract via argus → store → compare with last price → alert if changed.
 * Called by both the synchronous RPC (create/checkNow) and the scheduler.
 *
 * Since the 2026-08-25 extraction migration, argus's `POST /v1/extract-price`
 * owns the whole visit-and-extract stage (anti-detect navigation, blocked
 * classification, JSON-LD parse, internal LLM fallback); iris no longer
 * fetches HTML or runs any model itself.
 *
 * ## Transactionality
 *
 * Network calls (the extract request + image download) run OUTSIDE any
 * database transaction so a slow page does not hold a connection. The
 * read-modify-write — load the product row, insert a `price_readings` row when
 * the price changed, update `currentPrice`/`lastCheckedAt` — runs inside a
 * single transaction. Concurrent checks of the same product (scheduler tick +
 * manual check-now) are coalesced by the module-level single-flight mutex, so
 * only one extract/write pipeline runs for a product at a time.
 */
export function checkPrice(productId: string): Promise<CheckPriceResult> {
  const existing = inflightChecks.get(productId);
  if (existing) {
    return existing;
  }

  const pending = runCheckPrice(productId);
  inflightChecks.set(productId, pending);
  const cleanup = (): void => {
    inflightChecks.delete(productId);
  };
  void pending.then(cleanup, cleanup);
  return pending;
}

async function runCheckPrice(productId: string): Promise<CheckPriceResult> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineFired = false;
  const deadline = new Promise<CheckPriceResult>((resolve) => {
    deadlineTimer = setTimeout(() => {
      deadlineFired = true;
      resolve({ status: "failed", reason: "check_deadline_exceeded" });
    }, CHECK_DEADLINE_MS);
  });

  const work = runCheckPriceWork(productId);
  // When the deadline wins the race, `work` keeps running in the background
  // (v1: no abort). A rejection after that point would have no receiver and
  // surface as an unhandled rejection — which crashes the process by default
  // on Node ≥15. Only late failures/completions (deadline already fired) are
  // logged here; earlier ones propagate to the caller via the race below,
  // which already logs them, so we avoid double-reporting.
  void work.then(
    (result) => {
      if (deadlineFired) {
        logger.warn("Abandoned price check completed late", {
          productId,
          status: result.status,
        });
      }
    },
    (error: unknown) => {
      if (deadlineFired) {
        logger.error("Abandoned price check failed late", {
          productId,
          abandoned: deadlineFired,
          ...errorFields(error),
        });
      }
    },
  );

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

async function runCheckPriceWork(productId: string): Promise<CheckPriceResult> {
  const now = new Date();

  const product = await getProductForCheck(productId);
  if (!product) {
    return { status: "not_found" };
  }

  // --- Network / extraction (outside any DB transaction) ---
  const extraction = await extractPrice(product.url, { productId });

  if (extraction.kind === "error") {
    // Transport failed after retries (argus down, network error, non-JSON) or
    // argus could not extract a price. These are the legacy operator-facing
    // strings — never an anti-bot misattribution.
    await recordCheckOutcome(productId, now, "failed", extraction.message);
    return { status: "failed", reason: extraction.message };
  }

  // Anti-bot challenge / deny page (e.g. Akamai `/WAF_Deny_Page/`, DataDome
  // captcha, Cloudflare "Just a moment…") — classified inside argus before
  // any model call is spent, and surfaced here so the operator can distinguish
  // anti-bot from genuine stock-out (AC3).
  if (extraction.kind === "blocked") {
    const reason = `Anti-bot WAF deny page (${extraction.signature}) — retailer blocks automated access.`;
    await recordCheckOutcome(productId, now, "failed", reason);
    logger.warn("Page blocked by anti-bot WAF", {
      productId,
      url: product.url,
      signature: extraction.signature,
    });
    return {
      status: "failed",
      reason,
    };
  }

  if (!extraction.available) {
    // Out of stock / no visible price — record nothing, just mark checked.
    await recordCheckOutcome(productId, now, "unavailable");
    logger.info("Product reported unavailable by extraction", { productId });
    return { status: "unavailable" };
  }

  // --- Image capture (best-effort, outside the DB transaction) ---
  // Only capture when the product doesn't already have an image, so
  // routine re-checks don't re-download the same image on every tick.
  // Source is argus's returned schema.org Product node (`jsonld`) — iris no
  // longer fetches HTML; on the AI-fallback path jsonld is null and capture
  // is skipped for this round.
  let imageFilename: string | null = null;
  if (!product.imagePath) {
    const imageUrl = imageUrlFromProductNode(extraction.jsonld, extraction.url);
    if (imageUrl) {
      logger.info("Attempting product image download", {
        productId,
        imageUrl,
      });
      imageFilename = await downloadProductImage(productId, imageUrl);
      if (!imageFilename) {
        logger.warn("Product image download returned null", {
          productId,
          imageUrl,
        });
      }
    } else {
      logger.info("No product image in extraction result", {
        productId,
        url: product.url,
      });
    }
  }

  // --- Transactional read-modify-write ---
  const outcome = db.transaction((tx) => {
    const locked = tx
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .get();

    if (!locked) {
      return { kind: "not_found" as const };
    }

    const oldPrice = locked.currentPrice !== null ? Number(locked.currentPrice) : null;
    const newPrice = extraction.price;
    const changed = oldPrice === null || roundToCent(oldPrice) !== roundToCent(newPrice);

    if (!changed) {
      tx
        .update(products)
        .set({
          lastCheckedAt: now,
          lastCheckStatus: "unchanged",
          lastCheckError: null,
          updatedAt: now,
          ...(imageFilename ? { imagePath: imageFilename } : {}),
        })
        .where(eq(products.id, productId))
        .run();

      return { kind: "unchanged" as const, price: newPrice, product: locked };
    }

    // Insert history only on price change (R9); update the current price and
    // fill name/currency from the extraction when not yet known.
    //
    // The reading records the currency argus actually returned for this check
    // (null when it couldn't determine one) so history stays honest. The product
    // row, by contrast, prefers the fresh currency but falls back to the
    // previously-known value — a single transient null from argus must not
    // clobber a currency we already knew (types.ts notes currency may be null
    // on the AI-fallback path), or subsequent alerts/UI would lose the prefix.
    tx.insert(priceReadings).values({
      productId,
      price: newPrice.toFixed(2),
      currency: extraction.currency,
      checkedAt: now,
    }).run();

    tx
      .update(products)
      .set({
        currentPrice: newPrice.toFixed(2),
        currency: extraction.currency ?? locked.currency,
        name: locked.name ?? extraction.name ?? null,
        lastCheckedAt: now,
        lastCheckStatus: "changed",
        lastCheckError: null,
        updatedAt: now,
        ...(imageFilename ? { imagePath: imageFilename } : {}),
      })
      .where(eq(products.id, productId))
      .run();

    return {
      kind: "changed" as const,
      oldPrice,
      newPrice,
      currency: extraction.currency,
      product: locked,
    };
  });

  if (outcome.kind === "not_found") {
    return { status: "not_found" };
  }

  if (outcome.kind === "unchanged") {
    return { status: "unchanged", price: outcome.price };
  }

  // --- Changed: evaluate alert rules and dispatch (R10/R11) ---
  let alertDispatched = false;

  if (outcome.oldPrice !== null) {
    const evaluation = shouldAlert(
      outcome.oldPrice,
      outcome.newPrice,
      outcome.product.alertRules,
    );

    if (evaluation.shouldAlert) {
      const dispatchResult = await dispatchPriceAlert({
        productId,
        userId: outcome.product.userId,
        productName: outcome.product.name ?? extraction.name ?? null,
        productUrl: outcome.product.url,
        currency: outcome.currency,
        oldPrice: outcome.oldPrice,
        newPrice: outcome.newPrice,
        direction: evaluation.direction,
      });
      alertDispatched = dispatchResult.sent > 0;
    }
  }

  logger.info("Product price changed", {
    productId,
    oldPrice: outcome.oldPrice,
    newPrice: outcome.newPrice,
    currency: outcome.currency,
    alertDispatched,
  });

  return {
    status: "changed",
    oldPrice: outcome.oldPrice,
    newPrice: outcome.newPrice,
    currency: outcome.currency,
    alertDispatched,
  };
}

async function getProductForCheck(productId: string): Promise<ProductRow | null> {
  const [row] = await db.select().from(products).where(eq(products.id, productId));
  return row ?? null;
}

/**
 * Record the outcome of a check that terminated outside the main transaction
 * (failed extraction, anti-bot block, unavailable) so the UI can surface
 * unhealthy products instead of showing them as silently healthy. Successful
 * checks (changed/unchanged) persist their status inside the transaction.
 */
async function recordCheckOutcome(
  productId: string,
  at: Date,
  status: "failed" | "unavailable",
  error?: string,
): Promise<void> {
  await db
    .update(products)
    .set({
      lastCheckedAt: at,
      lastCheckStatus: status,
      lastCheckError: error ?? null,
      updatedAt: at,
    })
    .where(eq(products.id, productId));
}
