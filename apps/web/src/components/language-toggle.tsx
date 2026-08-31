"use client";

import { useI18n, LANGUAGE_OPTIONS } from "../lib/i18n";
import { SegmentedControl } from "./ui";

/**
 * English / 中文 language switch for the top nav (dependency-free, mirrors the
 * theme toggle). Uses the shared SegmentedControl from ui.tsx and the shared
 * LANGUAGE_OPTIONS from lib/i18n.tsx.
 */

export function LanguageToggle() {
  const { lang, setLang, mounted, t } = useI18n();

  if (!mounted) {
    return (
      <div className="h-8 w-24 rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900" />
    );
  }

  return (
    <SegmentedControl
      label={t("nav.language")}
      options={LANGUAGE_OPTIONS}
      value={lang}
      onChange={(value) => setLang(value)}
    />
  );
}
