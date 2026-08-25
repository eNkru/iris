import { count, eq } from "drizzle-orm";
import { db } from "../client";
import { user } from "../schema/auth";

type UserRow = typeof user.$inferSelect;

/**
 * Count all users. Used by the first-user-becomes-admin bootstrap (R2).
 */
export async function countUsers(): Promise<number> {
  const [row] = await db.select({ count: count() }).from(user);
  return row?.count ?? 0;
}

/**
 * Count all users within a transaction. Used by the admin bootstrap so the
 * count is read under the same write lock that grants admin, making the
 * check-then-grant atomic against concurrent first sign-ups.
 */
export async function countUsersInTx(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<number> {
  const [row] = await tx.select({ count: count() }).from(user);
  return row?.count ?? 0;
}

/**
 * Fetch a user by id.
 */
export async function getUserById(id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.id, id));
  return row ?? null;
}
