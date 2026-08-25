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
   * Telegram bot token write semantics:
   * - `undefined` (absent): leave the stored token unchanged.
   * - non-empty string: store the new token.
   * - empty string `""`: leave the stored token unchanged (treated like
   *   `undefined` so a partial submit that omits the token never clears it).
   * - `null`: clear the stored token (explicit clear sentinel).
   *
   * The token is never returned in full by GET (outputs return a masked
   * placeholder via `maskSecret`).
   */
  telegramBotToken: z.union([z.string(), z.null()]).optional(),
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
