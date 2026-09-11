import type { Language } from "./enum-types";

/**
 * Locale-aware relative time for "last checked" style metadata, shared by the
 * web UI and Telegram summaries so the two stay in lockstep.
 *
 * The sub-minute case uses a fixed label (Intl.RelativeTimeFormat would render
 * a noisy "30 seconds ago"); everything else goes through
 * `Intl.RelativeTimeFormat` so both languages get idiomatic output
 * ("5 minutes ago" / "5分钟前"). A null date yields localized prose
 * ("never" / "从未"); the web UI overrides that to an em-dash at the call site.
 */
export function formatRelativeTime(
  date: Date | null,
  lang: Language = "en",
): string {
  if (date === null) {
    return lang === "zh" ? "从未" : "never";
  }
  const locale = lang === "zh" ? "zh-CN" : "en";
  const elapsedSeconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (elapsedSeconds < 60) {
    return lang === "zh" ? "刚刚" : "just now";
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(elapsedSeconds / 60);
  if (minutes < 60) {
    return rtf.format(-minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return rtf.format(-hours, "hour");
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return rtf.format(-days, "day");
  }
  return date.toLocaleDateString(locale);
}
