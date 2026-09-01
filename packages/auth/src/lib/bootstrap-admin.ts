import { eq } from "drizzle-orm";
import { db } from "@iris/database";
import { countUsersInTx } from "@iris/database/drizzle/queries";
import { user } from "@iris/database/drizzle/schema/auth";
import { errorFields, logger } from "@iris/utils";

/**
 * R2 — the first user to sign in becomes admin.
 *
 * Called from better-auth's `user.create.after` database hook, i.e. right after
 * the user row is inserted. If this was the very first user in the table, they
 * are promoted to `admin`.
 *
 * The count-then-grant runs inside a single transaction. better-sqlite3 +
 * Drizzle transactions are `BEGIN IMMEDIATE` on the first DML, so two
 * concurrent first sign-ups serialize: the first commits (count=1 → admin
 * granted), the second then reads count=2 and skips. This guarantees exactly
 * one admin and avoids the previous race where both saw count=2 and neither
 * was promoted (leaving zero admins).
 *
 * ## Failure isolation
 *
 * A throw inside the hook would propagate into better-auth and fail the very
 * sign-up that triggered it. Since a failed bootstrap must also not silently
 * leave zero admins, failures are retried briefly and then logged loudly —
 * but NEVER rethrown (registration always wins over bootstrap).
 */
const BOOTSTRAP_ATTEMPTS = 3;
const BOOTSTRAP_RETRY_DELAY_MS = 250;

export async function bootstrapFirstUserAsAdmin(userId: string): Promise<void> {
  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt++) {
    try {
      grantAdminIfFirstUser(userId);
      return;
    } catch (error) {
      logger.error("Admin bootstrap failed", {
        userId,
        attempt,
        lastAttempt: attempt === BOOTSTRAP_ATTEMPTS,
        ...errorFields(error),
      });

      if (attempt === BOOTSTRAP_ATTEMPTS) {
        return;
      }
      // Bounded backoff: transient SQLITE_BUSY usually resolves within the
      // driver's busy_timeout, this covers the tail.
      await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_RETRY_DELAY_MS * attempt));
    }
  }
}

/**
 * The count-then-grant transaction. better-sqlite3's native transaction()
 * throws "Transaction function cannot return a promise" if fn is async /
 * returns a Promise, so the callback must stay synchronous — use the sync
 * execution terminals (.all()/.run()) and never `await` inside it.
 */
function grantAdminIfFirstUser(userId: string): void {
  db.transaction((tx) => {
    const userCount = countUsersInTx(tx);

    if (userCount !== 1) {
      return;
    }

    tx.update(user).set({ role: "admin" }).where(eq(user.id, userId)).run();

    logger.info("First user promoted to admin", { userId });
  });
}
