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
export async function bootstrapFirstUserAsAdmin(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const userCount = await countUsersInTx(tx);

    if (userCount !== 1) {
      return;
    }

    await tx.update(user).set({ role: "admin" }).where(eq(user.id, userId));

    logger.info("First user promoted to admin", { userId });
  });
}
