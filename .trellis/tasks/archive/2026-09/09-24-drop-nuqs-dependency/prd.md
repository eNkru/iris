# Drop the `nuqs` dependency

## Goal

Remove `nuqs` (and the `NuqsAdapter` provider). It is used to read/write a
single `?range=` query param, while React Router's `useSearchParams` — already a
dependency and already used elsewhere — does the same thing.

## Confirmed Facts (verified 2026-09-24)

- `nuqs` usage is exactly:
  - `apps/web/src/main.tsx:2,` — `NuqsAdapter` wrapping the provider stack.
  - `apps/web/src/components/price-chart.tsx:3,113` —
    `useQueryState<RangeValue>("range", { defaultValue: "30d", parse, serialize })`.
- `react-router`'s `useSearchParams` is already used in
  `apps/web/src/routes/login.tsx` (`redirectTo`).
- Dependency declared in `apps/web/package.json` (`"nuqs": "^2.9.3"`).

## Requirements

- **R1.** Replace `useQueryState` in `PriceChart` with `useSearchParams`:
  read `range`, fall back to `"30d"` via the existing `isRangeValue` guard, and
  write with `setSearchParams` (use `{ replace: true }` to avoid history spam).
- **R2.** Remove `NuqsAdapter` and its import from `main.tsx`; remove it from the
  provider-stack doc comment.
- **R3.** Remove the `nuqs` dependency and update `pnpm-lock.yaml`
  (`pnpm install`).
- **R4.** Preserve behaviour: default `30d`, valid values `7d | 30d | all`,
  selection reflected in the URL and preserved across reload/back-forward.

## Acceptance Criteria

- [ ] **AC1.** `grep -rn "nuqs" apps packages` returns no source hits.
- [ ] **AC2.** Selecting a chart range updates the URL and the chart; an
      invalid/absent `range` renders `30d`.
- [ ] **AC3.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test`,
      `pnpm --filter @iris/web build` pass.

## Out of Scope

- Changing the chart rendering library (see `replace-recharts-with-svg`).
- Any other URL state.

## Risks / Technical Notes

- If `drop-nuqs-dependency` and `replace-recharts-with-svg` touch
  `price-chart.tsx` concurrently, coordinate or land sequentially to avoid
  conflicts.
- Keep the parser tolerant of unknown values; do not throw on a bad param.
