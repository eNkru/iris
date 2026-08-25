# Add structured logging for SMTP send failures in auth package

## Goal

`packages/auth/src/lib/smtp.ts` calls `sendMail` with no try/catch and no structured log on failure — only success is logged. An SMTP failure (e.g. mail server down, auth rejected) throws an unstructured error with no log context. Add a structured log on failure (and rethrow or handle per existing contract).

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/auth/src/lib/smtp.ts:41` — `sendMail` call has no try/catch and no structured log on failure; only success is logged (`:46`).

## Requirements

- **R1.** SMTP send failures are caught and logged with structured context (to, from, subject, error message/code) before rethrowing (or returning an error result, per the existing contract).
- **R2.** The error is not silently swallowed (the existing behavior of surfacing magic-link send failures to the user must be preserved).
- **R3.** No secrets in the log (no SMTP password, no full email body — just metadata).
- **R4.** Success logging (`:46`) is unchanged.

## Fix

Wrap the `sendMail` call in try/catch. In the catch, log a structured error via the project's logger (check whether `packages/auth` can import `@iris/utils` logger per layering rules; if not, use whatever logging is available in the auth package). Rethrow (or convert to the existing error shape) so callers/users see the failure. Do not log secrets.

## Acceptance Criteria

- [ ] **AC1.** A simulated SMTP failure (e.g. bad host / rejected auth) produces a structured log line with error context before the error surfaces.
- [ ] **AC2.** The user-facing magic-link send failure behavior is unchanged (still reports failure).
- [ ] **AC3.** No secrets (password, token, full body) appear in the log.
- [ ] **AC4.** `pnpm --filter @iris/auth typecheck` and lint pass.

## Out of Scope

- Retrying SMTP sends.
- Switching to a queue-based mailer.

## Risks / Technical Notes

- Verify the auth package's allowed imports (don't break layering by importing `@iris/utils` if the spec forbids it; check `.trellis/spec`).
- Don't change the error shape callers rely on; this is logging only, plus preserve the throw.
