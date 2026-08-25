import {
  getGlobalSettings,
  upsertGlobalSettings,
  type GlobalSettingsInput,
} from "@iris/database/drizzle/queries";
import { adminProcedure } from "../../../orpc/procedures";
import {
  getGlobalSettingsOutputSchema,
  maskSecret,
  updateGlobalSettingsInputSchema,
} from "../types";

/**
 * Update the instance-level global settings (singleton row id = 1). Fields are
 * merged over the stored values, so partial updates never clobber the rest.
 * The Telegram bot token is write-only: saved only when a non-empty value is
 * submitted, and always masked in the response.
 */
export const updateGlobalSettingsProcedure = adminProcedure
  .route({
    method: "PATCH",
    path: "/admin/global-settings",
    tags: ["Administration"],
    summary: "Update global defaults",
  })
  .input(updateGlobalSettingsInputSchema)
  .output(getGlobalSettingsOutputSchema)
  .handler(async ({ input }) => {
    const row = await getGlobalSettings();

    const merged: GlobalSettingsInput = {
      pollIntervalDefaultMinutes:
        input.pollIntervalDefaultMinutes ?? row?.pollIntervalDefaultMinutes ?? 60,
    };

    // Telegram bot token write semantics (see `updateGlobalSettingsInputSchema`):
    // `null` clears the stored token, a non-empty string updates it, and
    // `undefined`/empty leaves it unchanged. The token is never returned in
    // full by GET (masked via `maskSecret`).
    if (input.telegramBotToken === null) {
      merged.telegramBotToken = null;
    } else if (input.telegramBotToken !== undefined && input.telegramBotToken.trim() !== "") {
      merged.telegramBotToken = input.telegramBotToken;
    }

    const updated = await upsertGlobalSettings(merged);

    return {
      success: true as const,
      reason: "Global settings updated",
      settings: {
        pollIntervalDefaultMinutes:
          updated?.pollIntervalDefaultMinutes ?? merged.pollIntervalDefaultMinutes ?? 60,
        telegramBotToken: maskSecret(updated?.telegramBotToken ?? null),
      },
    };
  });
