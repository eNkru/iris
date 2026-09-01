import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFields, logger, redactFields } from "@iris/utils";

/**
 * Tests for the structured logger's two mechanisms:
 *   1. LOG_LEVEL filtering — parsed from process.env at module load, so each
 *      case re-imports the module with vi.resetModules() after setting the env.
 *   2. Redaction — sensitive-looking keys are deep-replaced with [redacted]
 *      before serialization; non-plain objects (Date, Error) pass through.
 */

function captureConsole(): {
  log: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
} {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

describe("logger — LOG_LEVEL filtering", () => {
  afterEach(() => {
    delete process.env.LOG_LEVEL;
    vi.restoreAllMocks();
  });

  it("suppresses debug at the default info level", async () => {
    vi.resetModules();
    delete process.env.LOG_LEVEL;
    const { logger: scoped } = await import("@iris/utils");
    const { log } = captureConsole();

    scoped.debug("hidden");
    expect(log).not.toHaveBeenCalled();

    scoped.info("shown");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "info",
      message: "shown",
    });
  });

  it("emits debug when LOG_LEVEL=debug", async () => {
    vi.resetModules();
    process.env.LOG_LEVEL = "debug";
    const { logger: scoped } = await import("@iris/utils");
    const { log } = captureConsole();

    scoped.debug("visible");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "debug",
      message: "visible",
    });
  });

  it("falls back to info on an invalid LOG_LEVEL (warns once on stderr)", async () => {
    vi.resetModules();
    process.env.LOG_LEVEL = "loud";
    // The warning fires at module load (resolveMinLevel runs on import), so
    // the stderr spy must be attached BEFORE the dynamic import below.
    const { error, log } = captureConsole();
    const { logger: scoped } = await import("@iris/utils");

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid LOG_LEVEL "loud"'),
    );

    scoped.info("shown");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("routes error entries to stderr", async () => {
    vi.resetModules();
    delete process.env.LOG_LEVEL;
    const { logger: scoped } = await import("@iris/utils");
    const { log, error } = captureConsole();

    scoped.error("boom");
    expect(error).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("logger — redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts secret-looking keys at the top level and when nested", () => {
    const redacted = redactFields({
      productId: "prod-1",
      botToken: "123:ABC",
      nested: {
        smtpPassword: "hunter2",
        apiKey: "key-123",
        safe: "value",
      },
      list: [{ secret: "s3cret", ok: 1 }],
    });

    expect(redacted).toEqual({
      productId: "prod-1",
      botToken: "[redacted]",
      nested: { smtpPassword: "[redacted]", apiKey: "[redacted]", safe: "value" },
      list: [{ secret: "[redacted]", ok: 1 }],
    });
  });

  it("keeps non-string placeholders so 'cleared' states stay meaningful", () => {
    const redacted = redactFields({
      telegramBotToken: null,
      attempts: 2,
      enabled: false,
    });
    expect(redacted).toEqual({ telegramBotToken: null, attempts: 2, enabled: false });
  });

  it("passes Date and Error instances through untouched", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const redacted = redactFields({ at });
    expect(redacted.at).toBe(at);
  });

  it("handles circular references without crashing", () => {
    const meta: Record<string, unknown> = { name: "root" };
    meta.self = meta;
    const redacted = redactFields(meta);
    expect(redacted.name).toBe("root");
    expect(redacted.self).toBe("[redacted]");
  });

  it("redacts before serialization in the write path", async () => {
    vi.resetModules();
    delete process.env.LOG_LEVEL;
    const { logger: scoped } = await import("@iris/utils");
    const { log } = captureConsole();

    scoped.info("message sent", { chatId: "123", botToken: "123:ABC" });
    const line = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(line.botToken).toBe("[redacted]");
    expect(line.chatId).toBe("123");
  });

  it("redacts through errorFields output paths", () => {
    // errorFields itself only produces message/stack keys (never redacted),
    // but composing them into a context must stay intact.
    const fields = errorFields(new Error("boom"));
    const redacted = redactFields({ productId: "p1", ...fields });
    expect(redacted.error).toBe("boom");
    expect(String(redacted.stack)).toContain("boom");
  });
});
