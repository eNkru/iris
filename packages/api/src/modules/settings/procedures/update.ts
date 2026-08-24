import { db } from "@iris/database";
import { userSettings } from "@iris/database/drizzle/schema/sqlite";
import { protectedProcedure } from "../../../orpc/procedures";
import {
  getUserSettingsOutputSchema,
  updateUserSettingsInputSchema,
} from "../types";

/**
 * Upsert the current user's settings.
 */
export const updateUserSettings = protectedProcedure
  .route({
    method: "PATCH",
    path: "/settings",
    tags: ["Settings"],
    summary: "Update the current user's settings",
  })
  .input(updateUserSettingsInputSchema)
  .output(getUserSettingsOutputSchema)
  .handler(async ({ input, context }) => {
    const set: Partial<typeof userSettings.$inferSelect> = { updatedAt: new Date() };
    if (input.pollIntervalDefaultMinutes !== undefined) {
      set.pollIntervalDefaultMinutes = input.pollIntervalDefaultMinutes;
    }

    const [row] = await db
      .insert(userSettings)
      .values({ userId: context.user.id, ...set })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { ...set, updatedAt: new Date() },
      })
      .returning();

    if (!row) {
      return {
        success: true as const,
        reason: "Settings updated",
        settings: {
          userId: context.user.id,
          pollIntervalDefaultMinutes: set.pollIntervalDefaultMinutes ?? null,
          createdAt: null,
          updatedAt: null,
        },
      };
    }

    return {
      success: true as const,
      reason: "Settings updated",
      settings: {
        userId: row.userId,
        pollIntervalDefaultMinutes: row.pollIntervalDefaultMinutes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  });
