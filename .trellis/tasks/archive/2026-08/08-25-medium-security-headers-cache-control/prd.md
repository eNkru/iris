# Add security headers and cache-control in server.ts

## Goal

The Hono server sets no security headers and no cache-control on static assets. Add baseline security headers (CSP, `X-Content-Type-Options`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy`) and correct cache-control on `/assets/*` (immutable) and `index.html` (no-cache).

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `apps/web/server.ts` — no CSP, `X-Content-Type-Options`, `frame-ancestors`, or `Referrer-Policy` headers anywhere.
- `:107` — `/assets/*` uses `serveStatic` with no `cache-control: immutable`.
- `:155` — SPA fallback `serveStatic` for `index.html` has no `no-cache`.
- Only cache-control is `:98` on `/api/images/:id` (`private, max-age=86400`).

## Requirements

- **R1.** Add baseline security headers to all responses:
  - `Content-Security-Policy`: restrictive but functional for the app (Vite SPA + oRPC `/api` + inline styles if used; start with `'self'` for scripts/styles, allow `img-src 'self' data:` and the image-served origin).
  - `X-Content-Type-Options: nosniff`.
  - `X-Frame-Options: DENY` (or `frame-ancestors 'none'` in CSP).
  - `Referrer-Policy: strict-origin-when-cross-origin`.
- **R2.** `/assets/*` (Vite hashed bundles) get `cache-control: public, max-age=31536000, immutable`.
- **R3.** `index.html` (SPA shell) gets `cache-control: no-cache` (revalidate on every load so new deploys ship).
- **R4.** The existing `/api/images/:id` cache-control is unchanged.
- **R5.** The app still works (CSP doesn't break scripts/styles/images/oRPC).

## Fix

Add a small Hono middleware (or `setHeaders` on the relevant routes) in `server.ts` setting the security headers globally, and per-route cache-control for `/assets/*` (immutable) and the SPA fallback (no-cache). Use a CSP that fits the actual asset/connect sources (audit the app for inline scripts/styles, external connections).

## Acceptance Criteria

- [ ] **AC1.** A response from the server includes `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] **AC2.** `/assets/*.js` responses include `cache-control: public, max-age=31536000, immutable`.
- [ ] **AC3.** `index.html` response includes `cache-control: no-cache`.
- [ ] **AC4.** The app loads and works in the browser (scripts, styles, images, oRPC calls) under the new CSP — no console violations blocking functionality.
- [ ] **AC5.** `/api/images/:id` cache-control unchanged.
- [ ] **AC6.** `pnpm --filter @iris/web typecheck` and lint pass.

## Out of Scope

- HSTS (only meaningful behind TLS; note in spec for reverse-proxy deploys).
- A full CSP nonce/`'strict-dynamic'` rollout (start restrictive-simple; iterate).

## Risks / Technical Notes

- CSP is the riskiest: too strict breaks the app (inline styles from Recharts/Tailwind, `data:` image URIs, the image-served route). Test in a browser after applying; check the console for violations.
- Vite's hashed `/assets/*` are safe to mark immutable; `index.html` must revalidate.
- Keep headers minimal and reviewable; don't over-engineer.
