import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** i18n mock: return the key so tests assert on stable strings. */
vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, lang: "en" as const }),
}));

/** Session mock: AuthGate needs `loaded` + a `user` so the page renders. */
vi.mock("../../apps/web/src/hooks/use-session", () => ({
  useSession: () => ({
    loaded: true,
    session: { user: { id: "u1", email: "a@b.test" } },
    user: { id: "u1", email: "a@b.test" },
    reloadSession: async () => {},
  }),
}));

import { ErrorBoundary } from "../../apps/web/src/components/error-boundary";
import { NotFoundPage } from "../../apps/web/src/routes/not-found";

/** A component that throws on render to exercise the boundary. */
function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeDefined();
  });

  it("renders the localized fallback when a child throws", () => {
    // Suppress the expected console.error noise from React's error logging.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("errorBoundary.title")).toBeDefined();
    expect(screen.getByText("errorBoundary.description")).toBeDefined();
    expect(screen.getByText("errorBoundary.reload")).toBeDefined();
    spy.mockRestore();
  });

  it("resets when resetKeys change (recovery on navigation)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Switchable({ broken }: { broken: boolean }) {
      if (broken) return <Boom />;
      return <div>recovered</div>;
    }
    const { rerender } = render(
      <ErrorBoundary resetKeys={["a"]}>
        <Switchable broken />
      </ErrorBoundary>,
    );
    expect(screen.getByText("errorBoundary.title")).toBeDefined();

    // Change resetKeys AND stop throwing → boundary clears and renders again.
    rerender(
      <ErrorBoundary resetKeys={["b"]}>
        <Switchable broken={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("recovered")).toBeDefined();
    spy.mockRestore();
  });
});

describe("NotFoundPage", () => {
  it("renders the not-found title and a back-home button", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/nope"]}>
          <Routes>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("notFound.title")).toBeDefined();
    expect(screen.getByText("notFound.description")).toBeDefined();
    expect(screen.getByText("notFound.backHome")).toBeDefined();
  });
});
