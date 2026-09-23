# Delete leftover `priceExtractionSchema`

## Goal

Remove the dead AI-extraction schema left behind after price extraction moved to
the external argus service.

## Confirmed Facts (verified 2026-09-24)

- `packages/prices/src/pipeline/types.ts` still exports
  `priceExtractionSchema` (a Zod discriminated union) and its inferred type
  `PriceExtraction`.
- Repo-wide grep: both appear only in their own declarations — no imports.
- The file's docstring still describes "AI price extraction (design.md pipeline
  step 2, R5)", a pipeline that was removed on 2026-08-25 (extraction now lives
  in argus, see `extract-price.ts`).
- `packages/prices/src/pipeline/index.ts` does `export * from "./types"`, so the
  symbol is on the public surface — but nothing consumes it.
- `CheckPriceResult` in the same file **is** used and must stay.

## Requirements

- **R1.** Delete `priceExtractionSchema` and `PriceExtraction`.
- **R2.** Remove the now-unused `import { z } from "zod"` and the stale AI
  docstring block.
- **R3.** Keep `CheckPriceResult` and its doc comment unchanged.

## Acceptance Criteria

- [ ] **AC1.** `grep -rn "priceExtractionSchema\|PriceExtraction" apps packages tests` returns no source hits.
- [ ] **AC2.** `CheckPriceResult` still imported by `check-price.ts` and the
      notification/dispatch types.
- [ ] **AC3.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test` pass.

## Out of Scope

- Changing `ExtractPriceResult` / the argus contract.
- Removing any notification types.

## Risks / Technical Notes

- None; pure dead-code deletion. Confirm the `z` import is truly unused after the
  cut (only these two declarations use it in that file).
