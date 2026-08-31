"use client";

import { useEffect, useState } from "react";

/**
 * A boolean flag that clears itself after `durationMs` — the shared pattern
 * behind the transient "Saved." feedback in the settings and edit forms
 * (previously copy-pasted as a `savedAt` timestamp + setTimeout effect in
 * three components).
 *
 * Returns the flag and a `trigger()` that (re)starts the window; calling
 * `trigger()` again while active restarts the timer.
 */
export function useTransientFlag(
  durationMs = 3000,
): [active: boolean, trigger: () => void] {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setTimeout(() => setActive(false), durationMs);
    return () => clearTimeout(timer);
  }, [active, durationMs]);

  const trigger = (): void => setActive(true);
  return [active, trigger];
}
