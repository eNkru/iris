import { count } from "drizzle-orm";
import { db } from "../client";
import { user } from "../schema/auth";

/**
 * Count all users within a transaction. Used by the admin bootstrap so the
 * count is read under the same write lock that grants admin, making the
 * check-then-grant atomic against concurrent first sign-ups.
 */
export function countUsersInTx(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]): number {
  // Synchronous: this runs inside a better-sqlite3 transaction callback, which
  // must not return a Promise (see bootstrap-admin.ts). Use the sync .all()
  // terminal rather than awaiting the query.
  const [row] = tx.select({ count: count() }).from(user).all();
  return row?.count ?? 0;
}
