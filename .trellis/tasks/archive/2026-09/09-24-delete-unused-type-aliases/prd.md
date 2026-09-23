# Delete unused exported API type aliases

## Goal

Remove the exported `z.infer`/interface type aliases that no file imports.
Handlers and hooks already infer their types from the oRPC client, so these are
duplicated, dead declarations.

## Confirmed Facts (verified 2026-09-24)

Repo-wide grep counts each name appearing only at its own declaration:

- `apps/web/src/hooks/use-products.ts` — `ProductListItem`
- `apps/web/src/hooks/use-settings.ts` — `UserSettings`, `GlobalSettings`
- `packages/api/src/modules/admin/types.ts` — `GlobalSettingsOutput`, `GetGlobalSettingsOutput`, `UpdateGlobalSettingsInput`
- `packages/api/src/modules/channels/types.ts` — `CreateChannelInput`, `UpdateChannelInput`, `ChannelIdInput`, `ListChannelsOutput`, `CreateChannelOutput`, `UpdateChannelOutput`, `DeleteChannelOutput`, `SendSummaryOutput`
- `packages/api/src/modules/health/types.ts` — `HealthCheckOutput`
- `packages/api/src/modules/history/types.ts` — `HistoryReading`, `ByProductInput`, `ByProductOutput`
- `packages/api/src/modules/products/types.ts` — `ListProductsInput`, `ProductIdInput`, `GetProductInput`, `UpdateProductInput`, `CheckNowInput`, `ProductListItemOutput`, `CheckPriceResultOutput`, `ListProductsOutput`, `GetProductOutput`, `UpdateProductOutput`, `DeleteProductOutput`
- `packages/api/src/modules/settings/types.ts` — `UserSettingsOutput`, `UpdateUserSettingsInput`, `GetUserSettingsOutput`
- `packages/api/src/modules/shared.ts` — `OkResult`
- `packages/prices/src/notifications/summary.ts` — `ProductSummaryItem`
- `packages/utils/src/lib/logger.ts` — `Logger`

The corresponding runtime schemas (`*Schema`, `productOutputSchema`, …) and
their inferred types actually used inside the same files MUST stay.

## Requirements

- **R1.** Delete only the type aliases listed above that still have zero
  references after re-checking with grep.
- **R2.** Keep every schema constant and every type that is referenced
  (`PriceReadingOutput`, `ProductOutput`, `ChannelOutput`, `CheckPriceResult`,
  `AlertRuleEvaluation`, etc.).
- **R3.** Do not touch `packages/utils/src/lib/schemas.ts` (owned by
  `delete-dead-utils-schemas`) or `packages/prices/src/pipeline/types.ts`
  (owned by `delete-price-extraction-schema`).
- **R4.** No behaviour change.

## Fix

For each file: remove the dead `export type X = z.infer<...>` lines, then remove
now-unused imports (`z`, schema imports) if the file has no remaining use.

## Acceptance Criteria

- [ ] **AC1.** Each removed name returns no source hits on repo-wide grep.
- [ ] **AC2.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test` pass.
- [ ] **AC3.** oRPC output validation still runs (schemas unchanged).

## Out of Scope

- Changing wire contracts or schemas.
- Adding new explicit return/parameter types.

## Risks / Technical Notes

- These types are exported but unreferenced; treat as internal (private
  monorepo). Re-run the reference check immediately before deleting each one to
  avoid removing something a sibling task just started using.
