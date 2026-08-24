import "./env";
import { logger } from "@iris/utils";
import { upsertGlobalSettings } from "./drizzle/queries/settings";

/**
 * Seed the `global_settings` singleton row (id = 1). Since the 2026-08-25
 * extraction migration there is no in-app AI config — extraction runs in the
 * external argus service — so only operational defaults are seeded.
 *
 * Usage: `pnpm db:seed` (after `pnpm db:migrate`).
 */
async function main(): Promise<void> {
  const row = await upsertGlobalSettings({
    pollIntervalDefaultMinutes: 60,
  });

  logger.info("Seeded global_settings singleton row", {
    id: row?.id ?? null,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error("Failed to seed global_settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
