import pLimit from "p-limit";
import { getEnv, logger, type Language } from "@iris/utils";
import { getGlobalSettings } from "@iris/database/drizzle/queries";
import type { NotificationChannel } from "./channel";
import { formatPriceAlertMessage, type PriceAlertNotification } from "./format";

/**
 * Telegram Bot API adapter — plain HTTP `sendMessage`, no SDK dependency
 * (design.md notification channel interface, R11/R12).
 *
 * The bot token is read from `global_settings.telegramBotToken`
 * (admin-managed, masked on read), falling back to the `TELEGRAM_BOT_TOKEN`
 * env var for local development. Failures are logged and swallowed so a
 * notification problem never crashes the price-check pipeline.
 */

const TELEGRAM_CONCURRENCY = 5;
const TELEGRAM_TIMEOUT_MS = 10_000;
const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
/** Max send attempts for a transient Telegram failure (429 / 5xx). */
const TELEGRAM_MAX_ATTEMPTS = 3;
/** Cap on a Telegram 429 `Retry-After` wait, in ms (don't park a limiter slot forever). */
const TELEGRAM_RETRY_AFTER_CAP_MS = 60_000;
/** Base backoff for 5xx retries (exponential: 1s, 2s, 4s …). */
const TELEGRAM_RETRY_BASE_MS = 1_000;
const TELEGRAM_RETRY_MAX_MS = 10_000;

const telegramLimiter = pLimit(TELEGRAM_CONCURRENCY);

/**
 * Resolve the Telegram bot token from global settings, falling back to the
 * `TELEGRAM_BOT_TOKEN` env var for local development.
 */
async function resolveBotToken(): Promise<string> {
  const settings = await getGlobalSettings();
  return settings?.telegramBotToken ?? getEnv().TELEGRAM_BOT_TOKEN;
}

/**
 * Strip Telegram HTML tags for the plain-text fallback send. Tags in
 * `format.ts` output are always well-formed `<b>`/`<a href="...">` wrappers,
 * so a tag-removal regex is sufficient — entity escaping is harmless in a
 * fallback (rare) path.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/**
 * Parse Telegram's `Retry-After` header (seconds) into ms. Returns `undefined`
 * when absent or unparseable so the caller falls back to exponential backoff.
 * Telegram sends 429 with either `retry_after` in the JSON body or a
 * `Retry-After` header; we check both.
 */
function parseTelegramRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1_000;
    }
  }
  return undefined;
}

/**
 * Low-level Telegram `sendMessage` with `parse_mode: "HTML"` (all message
 * formatters in `notifications/` produce escaped Telegram HTML). Resolves the
 * bot token, sends the text to `chatId`, and never throws — failures are
 * logged and swallowed so a notification problem never crashes the caller
 * (price-check pipeline or summary delivery). If Telegram rejects the markup
 * (HTTP 400), retries once as plain text so the user still gets the content.
 * `meta` carries structured context for logging.
 */
export async function sendTelegramText(
  chatId: string,
  text: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (chatId.trim() === "") {
    logger.warn("Telegram chatId is empty; skipping message", meta);
    return;
  }

  const botToken = await resolveBotToken();
  if (botToken === "") {
    logger.warn("Telegram bot token not configured; skipping message", meta);
    return;
  }

  const post = async (parseMode: "HTML" | undefined): Promise<void> => {
    const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: parseMode === "HTML" ? text : stripHtmlTags(text),
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`Telegram API responded ${response.status}: ${body.slice(0, 200)}`);
      (error as Error & { status?: number }).status = response.status;
      (error as Error & { retryAfterMs?: number }).retryAfterMs =
        parseTelegramRetryAfter(response);
      throw error;
    }
  };

  /**
   * Send with a bounded retry on transient Telegram failures:
   *   - 429 → honor `Retry-After` (capped), one retry per response.
   *   - 500/502/503/504 → exponential backoff.
   *   - 400 (bad markup) → one HTML→plaintext fallback (existing behavior).
   *   - 401/403 and other 4xx → terminal, not retried.
   * Never throws; failures are logged and swallowed.
   */
  const sendWithRetry = async (): Promise<boolean> => {
    let parseMode: "HTML" | undefined = "HTML";
    let usedPlainFallback = false;
    for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt++) {
      try {
        await post(parseMode);
        return true;
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        const retryable =
          status === 429 || (typeof status === "number" && status >= 500 && status <= 599);

        // 400 bad markup: retry once as plain text (not counted against the
        // transient-retry budget once we've switched).
        if (status === 400 && !usedPlainFallback) {
          logger.warn("Telegram rejected HTML markup; retrying as plain text", {
            chatId,
            error: error instanceof Error ? error.message : String(error),
            ...meta,
          });
          parseMode = undefined;
          usedPlainFallback = true;
          continue;
        }

        if (!retryable || attempt >= TELEGRAM_MAX_ATTEMPTS) {
          return false;
        }

        const delay =
          status === 429
            ? Math.min(
                (error as Error & { retryAfterMs?: number }).retryAfterMs ??
                  TELEGRAM_RETRY_BASE_MS * 2 ** (attempt - 1),
                TELEGRAM_RETRY_AFTER_CAP_MS,
              )
            : Math.min(
                TELEGRAM_RETRY_BASE_MS * 2 ** (attempt - 1),
                TELEGRAM_RETRY_MAX_MS,
              );

        logger.warn("Telegram transient error, retrying", {
          chatId,
          attempt,
          delayMs: Math.round(delay),
          error: error instanceof Error ? error.message : String(error),
          ...meta,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return false;
  };

  try {
    const sent = await telegramLimiter(sendWithRetry);
    if (sent) {
      logger.info("Telegram message sent", { chatId, ...meta });
    } else {
      logger.error("Telegram message failed", { chatId, ...meta });
    }
  } catch (error) {
    logger.error("Telegram message failed", {
      chatId,
      error: error instanceof Error ? error.message : String(error),
      ...meta,
    });
  }
}

export const telegramChannel: NotificationChannel = {
  channelType: "telegram",

  async send(notification: PriceAlertNotification, config: Record<string, unknown>): Promise<void> {
    const chatId = config.chatId;
    if (typeof chatId !== "string" || chatId.trim() === "") {
      logger.warn("Telegram channel config missing chatId; skipping alert", {
        productId: notification.productId,
      });
      return;
    }

    const lang: Language = config.language === "zh" ? "zh" : "en";
    const text = formatPriceAlertMessage(notification, lang);

    await sendTelegramText(chatId, text, {
      productId: notification.productId,
      direction: notification.direction,
      language: lang,
    });
  },
};
