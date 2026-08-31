import "./env";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { getSessionCookie } from "better-auth/cookies";
import { Hono } from "hono";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { auth } from "@iris/auth";
import { getProductImageForUser } from "@iris/database";
import { router } from "@iris/api/orpc/router";
import { getOrGenerateLogId } from "@iris/api/orpc/procedures";
import { startScheduler, stopScheduler } from "@iris/prices";
import { getEnv, logger, errorFields } from "@iris/utils";

/**
 * Process-level failure handlers, registered before any async work starts.
 * This single Node process hosts the HTTP server, the oRPC layer and the
 * price-check scheduler; since Node ≥15 an unhandled rejection crashes the
 * process by default, taking the whole app down. Log both failure classes
 * with full stack traces so post-mortems are possible:
 * - `unhandledRejection`: a promise nobody awaited (e.g. background check
 *   work that outlived its deadline and later failed). The process can keep
 *   serving; log and continue.
 * - `uncaughtException`: a synchronous error escaped every handler. State may
 *   be inconsistent, so log and exit non-zero — the orchestrator restarts the
 *   container. The logger writes synchronously, so the record survives exit.
 */
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", errorFields(reason));
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception; exiting", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

/**
 * Resolve the server directory. In CJS (esbuild production bundle),
 * `__dirname` is available natively. In ESM (tsx dev), `import.meta.url`
 * is used instead. esbuild's CJS output leaves `import.meta.url` as
 * `undefined`, so the conditional is required.
 */
const serverDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const distRoot = join(serverDir, "..", "dist");

const app = new Hono();

/**
 * Baseline security headers applied to every response. CSP starts
 * restrictive-simple (self for scripts/styles, data: + https: for images, the
 * app's own /api for connections) and can be tightened in a follow-up.
 * `script-src 'self' 'unsafe-inline'` accommodates the inline theme-init
 * script in index.html (FOUC prevention) without a nonce/hash harness.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

app.use("*", async (c, next) => {
  await next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(key, value);
  }
});

/**
 * oRPC RPCHandler — mirrors the contract in the former Next route handler
 * (`app/api/rpc/[...path]/route.ts`). The router is mounted under `/api/rpc`;
 * the handler strips that prefix before matching, and seeds the context with
 * the request headers so `protectedProcedure` can resolve the session cookie.
 */
const rpcHandler = new RPCHandler(router);

app.on(["GET", "POST"], "/api/rpc/*", async (c) => {
  // Resolve the request id ONCE here so the request log below and every
  // procedure-level log (logIdMiddleware) share the same id. A client may
  // propagate its own `x-log-id` for distributed tracing.
  const logId = getOrGenerateLogId(c.req.raw.headers);
  const startedAt = Date.now();

  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/api/rpc",
    context: { headers: c.req.raw.headers, logId },
  });

  if (!matched) {
    return c.body("Not found", 404);
  }

  // One structured line per RPC request (logging.md): path, status, latency
  // and the request id that also appears on any error log — this is the
  // backbone for tracing a failing request across its log entries.
  logger.info("RPC request", {
    logId,
    method: c.req.method,
    path: c.req.path,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });

  return response;
});

/**
 * better-auth handler (magic-link sign-in/verify, session, sign-out).
 * `auth.handler` is a framework-agnostic fetch handler — replaces the former
 * `toNextJsHandler(auth)` in `app/api/auth/[...all]/route.ts`.
 */
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * Product image serving. Verifies the session, checks that the product
 * belongs to the authenticated user, then streams the image file from
 * the local `IMAGES_DIR`. Returns 404 when the product has no image or
 * the file is missing on disk.
 */
app.get("/api/images/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.body("Unauthorized", 401);
  }

  const productId = c.req.param("id");

  const product = await getProductImageForUser(productId, session.user.id);

  if (!product?.imagePath) {
    return c.body("Not found", 404);
  }

  const filePath = join(getEnv().IMAGES_DIR, product.imagePath);

  try {
    await stat(filePath);
  } catch {
    return c.body("Not found", 404);
  }

  const ext = product.imagePath.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  const contentType = contentTypes[ext];
  if (!contentType) {
    return c.body("Not found", 404);
  }

  const buffer = await readFile(filePath);
  return new Response(buffer, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=86400",
    },
  });
});

/**
 * Vite-built static assets (JS/CSS chunks). Served without auth — they are
 * public, fingerprinted files with no sensitive content. Hashed filenames
 * are safe to cache as immutable.
 *
 * Set the cache-control header BEFORE serveStatic and return its result.
 * Do not read `c.res.status` after calling serveStatic manually: when
 * serveStatic is invoked as a function (not via the middleware pipeline's
 * `next()`), its returned Response is NOT assigned to `c.res`, so `c.res`
 * stays as Hono's unfinalized default and materializing it (via `c.res.status`
 * / `c.header`) throws `RangeError: init["status"] must be in the range of
 * 200 to 599`. Returning the value lets Hono's pipeline finalize `c.res`.
 */
app.use("/assets/*", async (c, next) => {
  c.header("cache-control", "public, max-age=31536000, immutable");
  return serveStatic({ root: distRoot })(c, next);
});

/**
 * Root-level public files copied from `public/` into `dist/` (e.g. `/icon.svg`).
 * Served directly from disk so they are not swept up by the SPA fallback. The
 * `/`, `/api/*` and `/assets/*` paths are excluded: those must flow through the
 * auth gate / SPA fallback below (root serves `index.html` and would otherwise
 * bypass the auth gate).
 */
app.use("*", (c, next) => {
  if (c.req.path === "/" || c.req.path.startsWith("/api/") || c.req.path.startsWith("/assets/")) {
    return next();
  }
  return serveStatic({ root: distRoot })(c, next);
});

/**
 * Server-side auth gate (mirrors `middleware.ts`). For non-`/api`, non-asset
 * GET requests, check the session cookie presence:
 * - No cookie + not `/login` → redirect to `/login?redirectTo=…`
 * - Cookie + `/login` → redirect to `/` (already authenticated)
 *
 * This is a cookie-presence check only (not session validation); the client
 * `AuthGuard` and oRPC `protectedProcedure` enforce the real session.
 */
app.get("*", async (c, next) => {
  const path = c.req.path;

  // Skip the auth guard for API and asset routes (handled above).
  if (path.startsWith("/api/") || path.startsWith("/assets/")) {
    return next();
  }

  const sessionCookie = getSessionCookie(c.req.raw);

  if (!sessionCookie && path !== "/login") {
    const loginUrl = new URL("/login", c.req.url);
    loginUrl.searchParams.set("redirectTo", path);
    return c.redirect(loginUrl.toString(), 302);
  }

  if (sessionCookie && path === "/login") {
    return c.redirect(new URL("/", c.req.url).toString(), 302);
  }

  return next();
});

/**
 * SPA fallback: serve `index.html` for all remaining GET routes. React Router
 * handles client-side routing from there. The shell must revalidate on every
 * load so new deploys ship.
 *
 * Set `cache-control` before serveStatic and return its result (see the
 * `/assets/*` handler above for why reading `c.res.status` after a manual
 * serveStatic call is unsafe).
 */
app.get("*", async (c, next) => {
  c.header("cache-control", "no-cache");
  return serveStatic({ root: distRoot, path: "index.html" })(c, next);
});

/**
 * Start the in-process price-check scheduler on boot (mirrors
 * `instrumentation-node.ts`). Gated to production only — dev runs the scheduler
 * via the "Run checks" admin action to avoid duplicate ticks during HMR.
 *
 * Wrapped in try/catch so the app still boots if the scheduler can't start;
 * the loop logs per-tick failures rather than taking the process down.
 */
function startSchedulerSafely(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  try {
    startScheduler({
      onError: (error: unknown) => {
        logger.error("Scheduler tick error", errorFields(error));
      },
    });
  } catch (error) {
    logger.error("Failed to start scheduler", errorFields(error));
  }
}

const port = Number(process.env.PORT ?? 3000);

const server = serve(
  { fetch: app.fetch, port },
  () => {
    logger.info("Server started", { port });
    startSchedulerSafely();
  },
);

/**
 * Graceful shutdown: stop the scheduler loop and close the HTTP server.
 * Mirrors the `onClose()` pattern from `instrumentation.ts`. A hard deadline
 * (`SHUTDOWN_FORCE_EXIT_MS`) force-exits the process if `server.close()` is
 * stuck waiting on a hung in-flight connection — the orchestrator would
 * eventually SIGKILL, but an explicit timeout gives a cleaner, faster exit.
 */
function shutdown(): void {
  stopScheduler();

  const forceExitMs = getEnv().SHUTDOWN_FORCE_EXIT_MS;
  const forceExitTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out; forcing exit", {
      forceExitMs,
    });
    process.exit(1);
  }, forceExitMs);

  server.close(() => {
    clearTimeout(forceExitTimer);
    logger.info("Server stopped");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
