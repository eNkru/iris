import { z } from "zod";

/**
 * Admin global settings module schemas (R6/R7 — instance defaults, managed by
 * the admin via `adminProcedure`). Since the 2026-08-25 extraction migration
 * price extraction runs in the external argus service; there is no in-app AI
 * config anymore. Only operational defaults remain.
 *
 * The Telegram bot token is write-only from the API's perspective: it is saved
 * on update and NEVER returned in full — outputs return a masked placeholder
 * (`••••••` + last 4 chars) via `maskSecret`.
 */

export const globalSettingsShapeSchema = z.object({
  pollIntervalDefaultMinutes: z.number().int(),
  telegramBotToken: z.string().nullable(),
});
export type GlobalSettingsOutput = z.infer<typeof globalSettingsShapeSchema>;

export const getGlobalSettingsOutputSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
  settings: globalSettingsShapeSchema,
});
export type GetGlobalSettingsOutput = z.infer<typeof getGlobalSettingsOutputSchema>;

export const updateGlobalSettingsInputSchema = z.object({
  pollIntervalDefaultMinutes: z.number().int().min(1).max(10080).optional(),
  /**
   * When present and non-empty the token is saved; when absent/empty the stored
   * token is left unchanged (never returned by GET).
   */
  telegramBotToken: z.string().optional(),
});
export type UpdateGlobalSettingsInput = z.infer<typeof updateGlobalSettingsInputSchema>;

/**
 * Mask a stored secret (API key, bot token) for API responses. Short/empty
 * values degrade to a fixed placeholder; longer values keep the last 4 chars
 * for recognition. The real value never leaves the server.
 */
export function maskSecret(value: string | null): string | null {
  if (!value || value === "") {
    return null;
  }
  if (value.length <= 4) {
    return "••••••";
  }
  return `••••••${value.slice(-4)}`;
}
