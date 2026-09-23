# Remove dead i18n language cookie and unused dictionary keys

## Goal

Delete i18n artifacts that are written/declared but never read.

## Confirmed Facts (verified 2026-09-24)

- `apps/web/src/lib/i18n.tsx` defines `writeLangCookie(lang)` and calls it in
  `setLang`; it writes an `iris.lang` cookie. Nothing reads that cookie:
  - The server (`apps/web/server.ts`) only serves the static SPA shell and never
    reads the cookie (the former Next.js server components that did are gone —
    see the note in `routes/home.tsx`).
  - `<html lang>` is set client-side in a `useEffect` in the same file.
- `LANG_COOKIE_NAME` (`apps/web/src/lib/dictionary.ts:13`) is used only by
  `writeLangCookie`.
- `LANG_VALUES` (`dictionary.ts:12`) has no references.
- Unused dictionary keys (present in both `en` and `zh`):
  `nav.language.en`, `nav.language.zh`, `channels.language.en`,
  `channels.language.zh`. The language toggles use `LANGUAGE_OPTIONS` with
  hardcoded labels instead.
- `LANG_STORAGE_KEY` **is** used (localStorage persistence) — keep it.

## Requirements

- **R1.** Remove `writeLangCookie`, its call in `setLang`, and
  `LANG_COOKIE_NAME`.
- **R2.** Remove `LANG_VALUES`.
- **R3.** Remove the four unused keys from **both** `en` and `zh` dictionaries
  (the `Dictionary = Record<DictKey, string>` type keeps them in sync).
- **R4.** Keep localStorage persistence and the `<html lang>` effect working.

## Acceptance Criteria

- [ ] **AC1.** `grep -rn "LANG_COOKIE_NAME\|LANG_VALUES\|writeLangCookie\|nav.language.en\|channels.language.en" apps` returns no source hits.
- [ ] **AC2.** Switching language still persists across reload (localStorage) and
      still updates `document.documentElement.lang`.
- [ ] **AC3.** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm test` pass
      (the `zh` dictionary type-check proves no key was missed).

## Out of Scope

- Changing language options or translations that are actually used.
- Migrating/clearing any `iris.lang` cookies already set in browsers (harmless).

## Risks / Technical Notes

- If a future server-rendered heading needs the cookie, re-introduce it then
  (YAGNI now).
