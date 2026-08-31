import { eq } from "drizzle-orm";
import { db } from "@iris/database";
import { countUsersInTx } from "@iris/database/drizzle/queries";
import { user } from "@iris/database/drizzle/schema/auth";
import { logger } from "@iris/utils";

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
 */
export function bootstrapFirstUserAsAdmin(userId: string): void {
  // drizzle's better-sqlite3 driver is synchronous: db.transaction(fn)
  // delegates to better-sqlite3's native transaction(), which throws
  // "Transaction function cannot return a promise" if fn is async / returns a
  // Promise. So the callback must stay synchronous — use the sync execution
  // terminals (.all()/.run()) and never `await` inside it.
  db.transaction((tx) => {
    const userCount = countUsersInTx(tx);

    if (userCount !== 1) {
      return;
    }

    tx.update(user).set({ role: "admin" }).where(eq(user.id, userId)).run();

    logger.info("First user promoted to admin", { userId });
  });
}
