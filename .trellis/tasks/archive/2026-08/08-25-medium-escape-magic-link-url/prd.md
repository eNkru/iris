# HTML-escape magic-link email URL

## Goal

`smtp.ts` interpolates `params.url` raw into the HTML email body (`<a href="${params.url}">${params.url}</a>`), inconsistent with the Telegram path which escapes HTML. Although the URL is server-generated (low risk), an argus/redirect-URL quirk could inject characters. Escape it for defense-in-depth and consistency.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/auth/src/lib/smtp.ts:41` — `html: \`...<a href="${params.url}">${params.url}</a>\`` — `params.url` interpolated raw into HTML, no `escapeHtml()`.
- Telegram path (`packages/prices/src/notifications/format.ts`) escapes HTML; this path does not.

## Requirements

- **R1.** Both the `href` attribute value and the link text are HTML-escaped (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#39;`).
- **R2.** The escaped URL still works as a clickable link in email clients (escaping `&` in query params is correct; the link is still valid).
- **R3.** Reuse an existing escape helper if one exists in the repo (check `format.ts` `escapeTelegramHtml`), or add a small `escapeHtml` in the auth package. Don't import across package boundaries if it breaks layering.

## Fix

In `smtp.ts`, escape `params.url` for both the `href` and the visible text. Either reuse `escapeTelegramHtml` from `@iris/prices` if the dependency is clean, or add a minimal `escapeHtml` helper local to `packages/auth/src/lib/`. Verify the magic link still works end-to-end (send + click).

## Acceptance Criteria

- [ ] **AC1.** A magic-link URL containing `&`/`<`/`>`/`"`/`'` is escaped in the email HTML (both href and text).
- [ ] **AC2.** The escaped link is still clickable and navigates to the correct URL in a mail client.
- [ ] **AC3.** No raw unescaped user-controlled substring reaches the HTML body.
- [ ] **AC4.** `pnpm --filter @iris/auth typecheck` and lint pass.

## Out of Scope

- Switching to a templating engine.
- Revalidating SMTP auth/config.

## Risks / Technical Notes

- Double-escaping is a risk: don't escape twice. Escape once at the interpolation point.
- Prefer a local `escapeHtml` over a cross-package import to keep `packages/auth` dependency-clean (check the package's import rules in `.trellis/spec`).
- This is small; pair with another small auth/email task if convenient.
