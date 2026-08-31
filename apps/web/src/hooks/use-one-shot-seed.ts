"use client";

import { useEffect, useRef } from "react";

/**
 * Seeds form state from server data exactly once — the shared pattern behind
 * the settings forms (previously a `hasLoaded` state + effect copy-pasted in
 * two components). Later refetches do NOT re-seed, so user edits are never
 * clobbered by background refreshes.
 */
export function useOneShotSeed<T>(data: T | undefined, seed: (data: T) => void): void {
  const seededRef = useRef(false);
  // Keep the latest seed callback without retriggering the effect when it is
  // an inline arrow (re-created every render).
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (data !== undefined && !seededRef.current) {
      seededRef.current = true;
      seedRef.current(data);
    }
  }, [data]);
}
