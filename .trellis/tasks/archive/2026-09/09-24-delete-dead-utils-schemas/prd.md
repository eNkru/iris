# Delete dead zod schemas in `@iris/utils`

## Goal

Remove the unused standard-response / pagination schemas from
`packages/utils/src/lib/schemas.ts`. Only `alertRulesSchema` is used.

## Confirmed Facts (verified 2026-09-24)

- `packages/utils/src/lib/schemas.ts` exports `operationResultSchema`,
  `paginationSchema`, `batchOperationResultSchema` (and their inferred types
  `OperationResult`, `Pagination`, `BatchOperationResult`).
- Repo-wide grep (`apps packages tests`): **zero** references outside the
  declaring file for all three schemas and all three types.
- `alertRulesSchema` / `AlertRules` **is** used — by
  `packages/api/src/modules/products/types.ts:2,35,60,95`.
- The API layer already has its own equivalent `okResultSchema` in
  `packages/api/src/modules/shared.ts` (used for delete outputs), so the utils
  copy is a duplicate that is not wired up.

## Requirements

- **R1.** Delete `operationResultSchema`, `paginationSchema`,
  `batchOperationResultSchema`, and the `OperationResult`, `Pagination`,
  `BatchOperationResult` types.
- **R2.** Keep `alertRulesSchema` + `AlertRules` and the `z` import (still used).
- **R3.** Update the file header comment, which currently describes the removed
  "standard API response format" schemas.
- **R4.** No behaviour change elsewhere.

## Acceptance Criteria

- [ ] **AC1.** `grep -rn "operationResultSchema\|paginationSchema\|batchOperationResultSchema" apps packages tests` returns no source hits.
- [ ] **AC2.** `alertRulesSchema` and `AlertRules` still exported and still
      imported unchanged by `packages/api`.
- [ ] **AC3.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test` pass.

## Out of Scope

- Changing `okResultSchema` in `packages/api/src/modules/shared.ts`.
- Any other schema in `@iris/utils`.

## Risks / Technical Notes

- None; pure dead-code deletion.
