import { os } from "@orpc/server";

function generateLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Resolve (or create) the request id for an incoming request. Exported so the
 * HTTP entrypoint (server.ts) can generate the id ONCE, log it on the request
 * line, and pass it into the procedure context — keeping the same id across
 * the handler-level request log and every procedure-level log.
 */
export function getOrGenerateLogId(headers: Headers): string {
  // Prefer a client-provided x-log-id for distributed tracing.
  const existingLogId = headers.get("x-log-id");
  if (existingLogId) {
    return existingLogId;
  }
  return generateLogId();
}

/**
 * Makes the request id available in the procedure context for structured
 * logging (logging.md). The HTTP entrypoint may pre-generate the id and pass
 * it via the handler context; otherwise one is generated here.
 */
export const logIdMiddleware = os
  .$context<{ headers: Headers; logId?: string }>()
  .middleware(async ({ context, next }) => {
    const logId = context.logId ?? getOrGenerateLogId(context.headers);

    return await next({
      context: { logId },
    });
  });
