# Retry on Telegram 429/5xx instead of dropping alerts

## Goal

`sendTelegramText` catches all errors and returns, so a Telegram rate-limit (429) or transient 5xx permanently drops that alert with only a log line. Add a bounded retry that honors Telegram's `Retry-After` header (429) and retries a limited number of times for 5xx, so transient Telegram-side failures don't silently lose alerts.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/prices/src/notifications/telegram.ts:98-108` — outer `catch` logs and swallows all errors.
- Inner retry at `:88-96` only catches `status === 400` for the HTML→plaintext fallback. 429/5xx thrown → caught → logged → permanently dropped. No retry.

## Requirements

- **R1.** On HTTP 429, read `Retry-After` (seconds) from the response and wait that long (capped at a sane max, e.g. 60s) before one retry.
- **R2.** On HTTP 500/502/503/504, retry up to `MAX_TELEGRAM_RETRIES` (suggested 2) with exponential backoff.
- **R3.** On terminal errors (400 with non-retryable body, 401/403 auth failures), do not retry — log and return as today.
- **R4.** Retry budget is bounded; a alert send never blocks the dispatch loop for more than ~ (Retry-After cap) + backoff total. Document the worst-case latency.
- **R5.** The error-swallowing contract at the `dispatch` boundary is preserved: a failed send still resolves (does not throw) so other channels are unaffected. (Dispatch already uses `Promise.allSettled`; `send()` resolves on failure.)

## Fix

In `telegram.ts`, before the outer catch swallows, classify the error: if retryable (429 with/without `Retry-After`, 5xx) and attempts remain, await the backoff/`Retry-After` delay and retry. Reuse the shared `retryWithBackoff` / `backoffDelayMs` helper from `./retry` for consistency with `extract-image.ts`. For 429 `Retry-After`, prefer the header value over exponential backoff.

## Acceptance Criteria

- [ ] **AC1.** A mocked 429 with `Retry-After: 5` triggers exactly one retry ~5s later; a subsequent 200 succeeds and the alert is delivered.
- [ ] **AC2.** A mocked 503 triggers up to `MAX_TELEGRAM_RETRIES` retries with backoff, then logs and resolves (does not throw) if still failing.
- [ ] **AC3.** A 400 (non-retryable) is not retried; HTML→plaintext fallback still applies.
- [ ] **AC4.** A 401/403 is not retried (auth failure is terminal).
- [ ] **AC5.** Unit tests for 429-with-Retry-After, 5xx-retry-then-success, and no-retry-on-400 added; `pnpm test` passes.
- [ ] **AC6.** `pnpm --filter @iris/prices typecheck` and lint pass.

## Out of Scope

- Persistent alert queue / dead-letter table for alerts that exhaust retries (follow-up).
- Alert deduplication.

## Risks / Technical Notes

- `Retry-After` may be absent on some 429s; fall back to exponential backoff.
- Keep the existing 10s per-request timeout; the retry budget is additive on top.
- Ensure `p-limit` concurrency on the Telegram sender is not violated by long `Retry-After` waits (a held limiter slot during the wait is acceptable for v1).
