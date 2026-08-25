# Add force-exit timeout to graceful shutdown

## Goal

`server.ts` `shutdown()` calls `stopScheduler()` then `server.close(() => process.exit(0))` with no hard timeout. If `server.close()` waits for an in-flight connection that never closes, the process hangs on SIGTERM (container orchestrator eventually SIGKILLs, but a hard timeout gives a cleaner exit). Add a force-exit timeout.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/server.ts:206-212` — `shutdown()` calls `stopScheduler()` then `server.close(() => process.exit(0))`, no hard timeout. A hanging in-flight request keeps the process alive.

## Requirements

- **R1.** After `server.close()` is called, a hard timeout (suggested 5–10s) forces `process.exit(1)` if the graceful close hasn't completed.
- **R2.** The normal graceful path (`server.close` callback → `process.exit(0)`) is unchanged when it completes in time.
- **R3.** The timeout is cleared on successful exit (no dangling timer).
- **R4.** `stopScheduler()` still runs before `server.close()` (order unchanged).

## Fix

In `shutdown()`, after calling `server.close(cb)`, add `const t = setTimeout(() => process.exit(1), FORCE_EXIT_MS)`. Clear `t` in the `server.close` callback before `process.exit(0)`. Make the timeout duration configurable via env (optional) with a sensible default.

## Acceptance Criteria

- [ ] **AC1.** Normal SIGTERM with no hanging requests exits with code 0 within the timeout (no behavior change).
- [ ] **AC2.** A hanging in-flight connection that never closes is force-exited (code 1) after the timeout, not hung forever.
- [ ] **AC3.** The timeout timer is cleared on successful exit.
- [ ] **AC4.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- Per-request deadlines (separate from shutdown).
- Drain logic beyond `server.close`.

## Risks / Technical Notes

- `server.close()` stops accepting new connections and waits for in-flight to finish; it does NOT forcibly kill in-flight requests. The force-exit is the only escape for a stuck connection.
- Unref the timer (`t.unref()` is not needed here since we want it to keep the process alive precisely to force exit; just clear it on success).
- Small change; pair with another small infra task if convenient.
