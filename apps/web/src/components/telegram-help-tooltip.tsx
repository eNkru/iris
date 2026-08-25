"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";

/**
 * Setup guidance for connecting a Telegram bot + chat id (design.md —
 * "Send summary to Telegram"). Rendered in an on-hover/focus/click tooltip
 * next to the action that depends on a configured channel. The step keys are
 * resolved through `useI18n` (the tooltip always renders inside the language
 * provider).
 *
 * Accessibility:
 * - Hover and focus open the tooltip (existing behavior, preserved).
 * - Click/Enter/Space toggles it (touch devices have no hover).
 * - `Escape` closes and returns focus to the trigger.
 * - Clicking outside closes the tooltip.
 * - The trigger is linked to the content via `aria-describedby` so screen
 *   readers announce the help text when the trigger is focused.
 *
 * State model: `hovered`/`focused`/`pinned` are independent contributors to
 * `open`, and `forceClosed` is set when the user explicitly dismisses the
 * tooltip (toggle-to-close or Escape). It is cleared on the next genuine
 * hover-leave/blur so a later hover/focus can reopen it. This lets a click
 * close the tooltip even while the pointer is still hovering it, without the
 * hover state immediately reopening it.
 */
const STEP_KEYS = ["tooltip.step1", "tooltip.step2", "tooltip.step3", "tooltip.step4"] as const;

export function TelegramHelpTooltip({
  title,
}: {
  title?: string;
}) {
  const { t } = useI18n();
  const heading = title ?? t("tooltip.title");
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  // True when the user explicitly dismissed the tooltip; suppresses the
  // hovered/focused/pinned contributors until the next blur/mouseleave resets
  // it so the dismissal isn't immediately undone.
  const [forceClosed, setForceClosed] = useState(false);
  // Set by Escape so the focus event from returning focus to the trigger
  // doesn't immediately reopen the tooltip. Cleared on the next blur.
  const dismissedRef = useRef(false);

  const open = (hovered || focused || pinned) && !forceClosed;

  // Close on `Escape` and return focus to the trigger. Active only while open.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPinned(false);
        setForceClosed(true);
        // Returning focus to the trigger fires a focus event; the
        // `dismissedRef` guard in onFocus prevents it from reopening.
        dismissedRef.current = true;
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Close on outside click/touch. Uses mousedown so the tooltip closes before
  // the outside target's click handler runs.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      const wrapper = wrapperRef.current;
      if (wrapper && !wrapper.contains(event.target as Node)) {
        setPinned(false);
        setForceClosed(true);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /** Toggle the tooltip's pinned (sticky) state via click or keyboard.
   * Pinning adds a sticky open layer on top of hover/focus; unpinning sets
   * `forceClosed` so a lingering hover/focus doesn't immediately reopen it
   * (this is what makes "tap again to close" work on a touch device, where
   * the first tap both focuses and pins). */
  const toggle = (): void => {
    if (pinned) {
      setPinned(false);
      setForceClosed(true);
    } else {
      setForceClosed(false);
      setPinned(true);
    }
  };

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        setHovered(true);
        setForceClosed(false);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setForceClosed(false);
      }}
      onFocus={() => {
        // Skip the auto-open for the focus event that immediately follows an
        // Escape (we returned focus to the trigger to close). A real re-focus
        // (after a blur) clears the flag and reopens normally.
        if (dismissedRef.current) {
          dismissedRef.current = false;
          return;
        }
        setFocused(true);
        setForceClosed(false);
      }}
      onBlur={(event) => {
        // Only clear focus state when focus leaves the wrapper entirely (not
        // when it moves between the trigger and the tooltip content).
        if (
          !wrapperRef.current?.contains(
            event.relatedTarget as Node | null,
          )
        ) {
          setFocused(false);
          setForceClosed(false);
          dismissedRef.current = false;
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("tooltip.aria")}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 text-xs font-semibold text-stone-500 transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:focus-visible:ring-stone-400"
        onClick={toggle}
      >
        ?
      </button>
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-md border border-stone-200 bg-white p-3 text-xs text-stone-700 shadow-lg dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
        >
          <span className="mb-1.5 block font-semibold text-stone-900 dark:text-stone-100">
            {heading}
          </span>
          <ol className="list-decimal space-y-1 pl-4">
            {STEP_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </span>
      ) : null}
    </span>
  );
}
