# Replace `recharts` with a hand-rolled SVG chart

## Goal

Remove `recharts` (and its d3 dependency stack) from the bundle. It renders one
stepped area chart of an already-computed daily series, which a small inline SVG
path can cover — consistent with the project's dependency-free UI ethos
(no `clsx`, no icon library, inline `BrandMark`, emoji toggles).

## Confirmed Facts (verified 2026-09-24)

- `recharts` is used only in `apps/web/src/components/price-chart.tsx`
  (`AreaChart`, `Area`, `CartesianGrid`, `ResponsiveContainer`, `Tooltip`,
  `XAxis`, `YAxis`).
- The data is already computed in-file by `fillDailyGaps()` as
  `{ checkedAt: Date; price: number }[]` — a small, bounded, continuous series.
- Features actually exercised: step area path, gradient fill, X/Y axes, grid,
  hover tooltip, responsive sizing, theme colors via CSS variables
  (`--chart-*`).
- Dependency declared in `apps/web/package.json` (`"recharts": "^3.10.1"`).

## Decision (2026-09-24)

**Replace.** `recharts` + its d3 stack was removed in favour of a hand-rolled
SVG stepped area. Rationale: the chart is a single, bounded, pre-computed daily
series, and the dependency was the dominant source of the build's >500 kB chunk
warning. The rewrite is ~190 lines and keeps feature parity (stepped area,
gradient fill, grid, dated X axis, currency Y axis, nearest-point hover
 tooltip, responsive sizing, `--chart-*` theming).

## Requirements

- **R1. Decide first.** *Done — see Decision above.*
- **R2. If removing:** render an inline SVG stepped area (`<path>` built from
  `fillDailyGaps` output) inside the existing `role="img"` +
  `aria-label` container. *Done.*
- **R3.** Keep the existing empty state, the `SegmentedControl` range selector,
  and all `--chart-*` theme variables. *Done — untouched.*
- **R4.** Keep a hover affordance at least as informative as today's tooltip
  (a minimal nearest-point tooltip is acceptable) or explicitly accept its loss
  in the decision note. *Done — nearest-point tooltip kept.*
- **R5.** Remove the `recharts` dependency and update `pnpm-lock.yaml`.
  *Done — `pnpm --filter @iris/web remove recharts`.*

## Acceptance Criteria

- [x] **AC1.** Decision recorded in this PRD before any code change.
- [x] **AC2 (if removed).** `grep -rn "recharts" apps packages` returns no source
      hits; chart renders correct prices for 7d/30d/all and the existing tests
      (`tests/components/*`) still pass.
- [x] **AC3.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test`,
      `pnpm --filter @iris/web build` pass, and the built JS chunk is smaller
      (403 kB vs the previous >500 kB warning).

## Out of Scope

- Adding new chart types or interactions.
- Changing `fillDailyGaps` semantics.

## Risks / Technical Notes

- Real effort exists here (~100 lines of SVG + scales + tooltip). Only worth it
  if dependency weight matters; otherwise close as "keep, documented".
- Chart is wrapped by the top-level `ErrorBoundary`; avoid introducing render
  throws on malformed/empty series.
