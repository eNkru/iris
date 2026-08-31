/**
 * Structured JSON logger.
 *
 * Backend code must never call `console.log` directly (logging.md); use this
 * logger instead. Each entry is a single JSON line with a timestamp and level
 * so logs stay machine-parseable in the Docker container.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function writeLog(level: LogLevel, message: string, context?: LogContext): void {
  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    writeLog("debug", message, context);
  },
  info(message: string, context?: LogContext): void {
    writeLog("info", message, context);
  },
  warn(message: string, context?: LogContext): void {
    writeLog("warn", message, context);
  },
  error(message: string, context?: LogContext): void {
    writeLog("error", message, context);
  },
};

export type Logger = typeof logger;

/**
 * Structured fields for logging an unknown error value (logging.md): the
 * message plus the stack when available, so a production failure can actually
 * be diagnosed. Usage: `logger.error("… failed", { productId, ...errorFields(err) })`.
 */
export function errorFields(error: unknown): { error: string; stack?: string } {
  return error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };
}
