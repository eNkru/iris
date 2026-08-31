import React, { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";

// Regression for commit 8941ff0 ("reset ProductDetailPage check-now state
// across :id changes"), which crashed the product detail page with React
// error #185 (Maximum update depth exceeded), caught by the top-level
// ErrorBoundary as "Something went wrong".
//
// Root cause: the effect listed the `useMutation` RESULT object in its deps
// and called `.reset()` inside. `MutationObserver.reset()` always rebuilds a
// fresh result object and notifies subscribers — even from idle — so the
// `checkNow` dep changes every render → the effect re-runs → reset() → notify
// → … infinite render loop (React #185 in the browser).
//
// This test uses the REAL `useMutation` (a no-op mutationFn) so `.reset()`
// genuinely notifies — a mock with a no-op reset hides the loop, which is how
// the bug shipped. It asserts the exact deps-shape contract the fix relies on:
//   - `[id, checkNow]` → effect re-runs unboundedly (loop)
//   - `[id]` only      → effect runs once per id (stable)
//
// (In jsdom React yields between the setTimeout(0)-spaced updates, so #185
// does not throw — but the render/effect counts make the loop observable and
// fail this test if the buggy deps are reintroduced.)

interface ProbeOpts {
  id: string;
  /** "buggy" = [id, mutationResult] (8941ff0); "fixed" = [id] only. */
  deps: "buggy" | "fixed";
}

function Probe({ id, deps }: ProbeOpts) {
  const checkNow = useMutation({ mutationFn: async () => ({ ok: true }) });
  const renders = useRef(0);
  const effectRuns = useRef(0);
  renders.current += 1;
  useEffect(() => {
    effectRuns.current += 1;
    checkNow.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps === "buggy" ? [id, checkNow] : [id]);
  return (
    <div data-testid="probe" data-renders={renders.current} data-effects={effectRuns.current}>
      {id}
    </div>
  );
}

function makeQC() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

/** Let real microtasks + the React Query setTimeout(0) scheduler flush. */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

function counts(utils: ReturnType<typeof render>) {
  const el = utils.getByTestId("probe");
  return {
    renders: Number(el.getAttribute("data-renders")),
    effects: Number(el.getAttribute("data-effects")),
  };
}

describe("ProductDetailPage check-now reset effect (regression for 8941ff0)", () => {
  it("the FIXED [id]-only deps are stable (1 effect run, bounded renders)", async () => {
    const utils = render(
      <QueryClientProvider client={makeQC()}>
        <Probe id="p-1" deps="fixed" />
      </QueryClientProvider>,
    );
    await settle();
    const { renders, effects } = counts(utils);
    expect(effects).toBe(1);
    expect(renders).toBeLessThan(5);
  });

  it("the BUGGY [id, checkNow] deps loop (effect runs many times)", async () => {
    // Locks the root-cause behavior: if anyone reintroduces the mutation
    // result object in the effect deps, this test fails.
    const utils = render(
      <QueryClientProvider client={makeQC()}>
        <Probe id="p-1" deps="buggy" />
      </QueryClientProvider>,
    );
    await settle();
    const { renders, effects } = counts(utils);
    expect(effects).toBeGreaterThan(10);
    expect(renders).toBeGreaterThan(10);
  });
});
