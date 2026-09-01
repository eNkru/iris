import { ORPCError, os } from "@orpc/server";
import { errorFields, logger } from "@iris/utils";
import { getSessionWithCache } from "@iris/auth/lib/session-cache";
import { logIdMiddleware, getOrGenerateLogId } from "./middleware/log-id-middleware";

// Re-exported for the HTTP entrypoint (server.ts), which owns the only
// package-exports path reachable without adding new subpath entries.
export { getOrGenerateLogId };

/**
 * Public procedure — no authentication required. Every procedure starts from
 * here so it always has `{ headers, logId }` in context, and unexpected throws
 * are logged server-side before reaching the client.
 */
export const publicProcedure = os
  .$context<{ headers: Headers; logId?: string }>()
  .use(logIdMiddleware)
  .use(async ({ context, next }) => {
    try {
      return await next();
    } catch (error) {
      // Non-ORPCError throws (e.g. SQLITE_BUSY from better-sqlite3, a
      // TypeError in a handler) are wrapped by the RPC handler into a generic
      // INTERNAL_SERVER_ERROR response — client-safe, but otherwise INVISIBLE
      // server-side. Log them here with the request id and full stack so a
      // 500 is always diagnosable (logging.md). Explicit ORPCError throws are
      // intentional control flow with context logged at their throw sites.
      if (!(error instanceof ORPCError)) {
        logger.error("Unhandled procedure error", {
          logId: context.logId,
          ...errorFields(error),
        });
      }
      throw error;
    }
  });

/**
 * Protected procedure — requires a valid session (authentication.md).
 * Injects `session` and `user` into the context for downstream handlers.
 */
export const protectedProcedure = publicProcedure.use(
  async ({ context, next }) => {
    const result = await getSessionWithCache(context.headers);

    if (!result.session) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Please sign in to continue",
      });
    }

    return await next({
      context: {
        session: result.session.session,
        user: result.session.user,
      },
    });
  },
);

/**
 * Admin procedure — requires the `admin` role (R2, R6).
 */
export const adminProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    if (context.user.role !== "admin") {
      throw new ORPCError("FORBIDDEN", {
        message: "Admin access required",
      });
    }

    return await next();
  },
);
