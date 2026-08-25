# Cap single-flight hold time for hanging extractions

## Goal

A single hanging argus extraction holds the per-product single-flight lock for up to ~6 minutes (`EXTRACT_TIMEOUT_MS = 120_000` × `MAX_RETRIES = 3` plus backoff), blocking manual "Check now" for the same product and occupying a scheduler limiter slot for the full duration. Add an overall per-product check deadline so a hung extraction aborts and surfaces a failure instead of locking the product out.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/prices/src/pipeline/check-price.ts:60-66` — `inflightChecks` Map holds the promise until `runCheckPrice` resolves/rejects; concurrent scheduler/manual calls coalesce onto the same in-flight promise.
- `packages/prices/src/pipeline/extract-price.ts:37-39` — `EXTRACT_TIMEOUT_MS = 120_000`, `MAX_RETRIES = 3`. `retry.ts` backoff ~1s+2s between attempts → worst case ≈ 3 × 120s + 3s ≈ 363s (~6 min).
- There is no overall deadline on `runCheckPrice`; the only per-attempt timeout is `EXTRACT_TIMEOUT_MS`.

## Requirements

- **R1.** An overall per-product check deadline (e.g. `CHECK_DEADLINE_MS`, suggested ~150s) that aborts the whole `runCheckPrice` regardless of which retry attempt is in flight.
- **R2.** On deadline expiry, the in-flight promise rejects with a distinct terminal reason (e.g. `"check_deadline_exceeded"`) so the scheduler logs it and manual check-now surfaces a clear error.
- **R3.** The single-flight lock is released on deadline expiry (cleanup on both resolve and reject is already correct; ensure the deadline path goes through reject).
- **R4.** Existing per-attempt timeout (`EXTRACT_TIMEOUT_MS`) and retry count (`MAX_RETRIES`) remain the inner boundaries; the new deadline is a hard outer cap.

## Fix

In `check-price.ts` `runCheckPrice`, race the extraction+update work against a `setTimeout`/`AbortSignal.timeout(CHECK_DEADLINE_MS)`. If the deadline wins, reject the in-flight promise with `check_deadline_exceeded`. Optionally thread an `AbortSignal` into `extractPrice` so the in-flight `fetch` is actually aborted (not just the promise rejected).

## Acceptance Criteria

- [ ] **AC1.** With argus hung (e.g. blocked socket), a `runCheckPrice` call rejects within `CHECK_DEADLINE_MS`, not ~6 min.
- [ ] **AC2.** The rejected reason is `"check_deadline_exceeded"` (or equivalent distinct terminal reason), surfaced in scheduler logs and (for manual) the check-now response.
- [ ] **AC3.** After a deadline rejection, a subsequent manual "Check now" is not blocked by a lingering in-flight lock.
- [ ] **AC4.** Existing retry/timeout behavior for transient failures is unchanged.
- [ ] **AC5.** `pnpm -r typecheck` and the prices test suite pass; add a unit test for the deadline path.

## Out of Scope

- Changing `EXTRACT_TIMEOUT_MS` / `MAX_RETRIES` values themselves.
- Cross-product scheduler concurrency tuning.

## Risks / Technical Notes

- If `extractPrice` is not abortable, the underlying `fetch` may continue consuming a connection after the deadline rejects; acceptable for v1 but note in code.
- Ensure the deadline timer is cleared on normal completion to avoid a dangling timer keeping the event loop alive.
- Confirm `inflightChecks` cleanup in `finally` covers the deadline-reject path.
