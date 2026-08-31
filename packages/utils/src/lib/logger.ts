/**
 * Structured JSON logger.
 *
 * Backend code must never call `console.log` directly (logging.md); use this
 * logger instead. Each entry is a single JSON line with a timestamp and level
 * so logs stay machine-parseable in the Docker container.
 *
 * ## Level control
 *
 * `LOG_LEVEL` (debug | info | warn | error) filters output; default `info`.
 * Parsed from `process.env` directly — NOT via `getEnv()` — so the logger
 * still works when environment validation itself fails at boot. An invalid
 * value falls back to `info` with a one-time warning.
 *
 * ## Redaction
 *
 * Every context is deep-scanned before serialization: values under keys that
 * look secret-bearing (token, password, secret, authorization, cookie,
 * api-key, …) are replaced with `[redacted]`. Secrets are thus safe by
 * mechanism, not by convention only. Non-plain objects (Date, Error, …) pass
 * through untouched so existing log shapes stay byte-identical.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (!raw) {
    return "info";
  }
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  console.error(
    `[iris] Invalid LOG_LEVEL "${process.env.LOG_LEVEL}" — falling back to "info"`,
  );
  return "info";
}

const minLevel = resolveMinLevel();

/** Key names whose values must never reach the log file. */
const SENSITIVE_KEY_PATTERN =
  /token|password|passwd|secret|authorization|cookie|api[-_]?key/i;

const REDACTED = "[redacted]";

/** Depth cap for nested context objects; deep enough for log meta shapes. */
const MAX_REDACT_DEPTH = 5;

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  // Primitives (and null) are kept as-is. Secret VALUES are only ever
  // strings in this codebase; null/boolean placeholders like
  // `telegramBotToken: null` ("cleared") stay meaningful in logs.
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value) || depth >= MAX_REDACT_DEPTH) {
    return REDACTED;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }

  // Dates, Errors and other class instances pass through untouched —
  // JSON.stringify serializes them exactly as it did before redaction.
  if (!isPlainObject(value)) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && typeof val === "string" && val !== "") {
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(val, seen, depth + 1);
    }
  }
  return out;
}

/**
 * Deep-copy a log context with sensitive-looking string values replaced by
 * `[redacted]`. Exported for tests and for callers that pre-sanitize reusable
 * meta objects.
 */
export function redactFields(context: LogContext): LogContext {
  return redactValue(context, new WeakSet(), 0) as LogContext;
}

function writeLog(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
    return;
  }

  const entry: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...redactFields(context ?? {}),
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
