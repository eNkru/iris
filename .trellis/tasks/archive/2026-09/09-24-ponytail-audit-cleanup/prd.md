# Ponytail audit: reduce over-engineering (2026-09-24)

## Goal

Whole-repo over-engineering audit (ponytail-audit: dead code, unused flexibility,
single-implementation abstractions, wrappers that only delegate, dependencies the
platform already ships). This parent task owns the audit summary, the task map,
and the cross-child acceptance criteria. Each child is one independently
verifiable cut and is the actual implementation target.

Not in scope: correctness bugs, security, performance (routed to normal review).

## Source audit (ranked, biggest cut first)

| # | Tag | What to cut | Where | Child |
|---|-----|-------------|-------|-------|
| 1 | native | `migrate.ts` reimplements `drizzle-kit migrate` (163 lines) | `packages/database/src/migrate.ts` | `drop-migrate-reimplementation` |
| 2 | native/yagni | `recharts` (d3 stack) for one stepped area chart | `apps/web/src/components/price-chart.tsx` | `replace-recharts-with-svg` |
| 3 | native | `nuqs` + `NuqsAdapter` for one `?range=` param (React Router `useSearchParams` already present) | `price-chart.tsx`, `main.tsx`, `package.json` | `drop-nuqs-dependency` |
| 4 | delete | `operationResultSchema`, `paginationSchema`, `batchOperationResultSchema` — 0 refs; only `alertRulesSchema` used | `packages/utils/src/lib/schemas.ts` | `delete-dead-utils-schemas` |
| 5 | delete | ~35 exported `z.infer` type aliases never imported | `packages/api/**/types.ts`, `apps/web/src/hooks/*.ts` | `delete-unused-type-aliases` |
| 6 | delete | leftover `priceExtractionSchema` / `PriceExtraction` from removed in-process AI extraction | `packages/prices/src/pipeline/types.ts` | `delete-price-extraction-schema` |
| 7 | yagni | `getSessionWithCache` wrapper + always-false `fromCache` flag | `packages/auth/src/lib/session-cache.ts` | `collapse-session-cache-wrapper` |
| 8 | delete | `countUsers`, `getUserById`, `authTables` — 0 refs | `packages/database/src/drizzle/queries/users.ts`, `schema/auth.ts` | `delete-unused-db-queries` |
| 9 | shrink | `toNumber`/`toNullableNumber`, `formatRelativeTime` wrapper | `packages/api/src/modules/shared.ts`, `apps/web/src/components/ui.tsx` | `inline-trivial-wrappers` |
| 10 | delete | `writeLangCookie`/`LANG_COOKIE_NAME` never read; 4 unused dictionary keys | `apps/web/src/lib/i18n.tsx`, `lib/dictionary.ts` | `remove-dead-i18n-cookie-and-keys` |
| 11 | shrink | unused `loadEnv`/`getSmtpTransporter`/`useSession`/`signIn` exports; double `node:fs/promises` import | `packages/utils/src/lib/env.ts`, `packages/auth/src/lib/smtp.ts`, `packages/auth/src/client.ts`, `apps/web/server.ts` | `inline-trivial-wrappers` |

Audit net estimate: ~380 lines, -2 direct deps (`nuqs`, `recharts`).

## Task Map

- [x] `09-24-delete-dead-utils-schemas` — archived
- [x] `09-24-delete-unused-type-aliases` — archived
- [x] `09-24-delete-price-extraction-schema` — archived
- [x] `09-24-collapse-session-cache-wrapper` — archived
- [x] `09-24-delete-unused-db-queries` — archived
- [x] `09-24-drop-nuqs-dependency` — archived
- [x] `09-24-replace-recharts-with-svg` — implemented (SVG chart); archive pending
- [x] `09-24-drop-migrate-reimplementation` — archived; decision: KEEP (documented trade-off)
- [x] `09-24-remove-dead-i18n-cookie-and-keys` — archived
- [x] `09-24-inline-trivial-wrappers` — archived

Progress after the 2026-09-24 implementation pass: 10/10 done, gates green
(typecheck + lint + 194 tests + vite build + server build), -2 deps
(`nuqs`, `recharts`).

### Recharts decision (resolved 2026-09-24)

`replace-recharts-with-svg` was the one child gated on a product decision
(its PRD R1). **Decision: replace.** The hand-rolled SVG stepped area removed
`recharts` + its d3 stack (the main source of the >500 kB chunk warning) in
favour of ~190 lines of SVG/scales/tooltip code; the integrated build chunk is
now 403 kB. See the child PRD for the recorded decision and evidence.

## Requirements

- **R1.** Each child removes exactly the over-engineering named in its PRD; no
  behaviour change to the app.
- **R2.** Every removal is verified by a repo-wide reference check (grep /
  typecheck), not by assumption.
- **R3.** The full quality gate stays green after every child:
  `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test`.
- **R4.** Two dependency removals (`nuqs`, `recharts`) must update `package.json`
  and `pnpm-lock.yaml` and be proven by a successful `pnpm build`.
- **R5.** `migrate.ts` is a documented size trade-off: the child is a
  decide-then-act task, not an unconditional delete.

## Acceptance Criteria

- [ ] **AC1.** Every child is archived with its own acceptance criteria met.
- [x] **AC2.** Repo-wide grep for each deleted symbol returns no source hits.
- [x] **AC3.** `pnpm -r typecheck && pnpm -r lint && pnpm test` pass on the
      integrated result.
- [x] **AC4.** `pnpm --filter @iris/web build` and
      `pnpm --filter @iris/web server:build` still succeed (covers the
      dependency removals and `migrate.ts`).
- [ ] **AC5.** No functional/UI regression in the price chart, session/auth
      flow, or container boot path.

## Out of Scope

- Rewriting the chart or auth beyond removing the named over-engineering.
- Style-only renames.
- The untracked `iris-*.tar*` image archives in the repo root (gitignored build
  artifacts; delete manually if desired).

## Risks / Technical Notes

- `replace-recharts-with-svg` and `drop-migrate-reimplementation` carry real
  product/ops trade-offs (chart features, image size). Both are marked as
  evaluate-and-decide; record the decision in the child `prd.md` before acting.
- Do not batch the dependency removals into one PR — a recharts/`pnpm-lock`
  change is harder to review than the dead-code deletions.
