import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * Tests for the dependency-free SVG price chart (replaces recharts).
 *
 * The chart reads its range from the URL (React Router `useSearchParams`) and
 * localises strings via `useI18n`, so both are provided/wrapped here. Width
 * measurement goes through `ResizeObserver`, which jsdom does not implement —
 * we stub it to report a fixed 800px content box so the scales have a concrete
 * size to compute against.
 */

vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        "chart.empty": "No price changes in the selected period.",
        "chart.emptyHint": "Readings are only recorded when the price changes.",
        "chart.range": "Range",
        "chart.rangeAria": "Chart range",
        "chart.ariaLabel": "Daily price trend chart",
        "chart.7d": "7 days",
        "chart.30d": "30 days",
        "chart.all": "All",
        "chart.price": "Price",
        "chart.priceWithCurrency": "Price ({currency})",
      };
      const template = translations[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) =>
        vars[name] === undefined ? `{${name}}` : String(vars[name]),
      );
    },
    lang: "en",
    setLang: () => {},
    mounted: true,
  }),
}));

const { PriceChart } = await import("../../apps/web/src/components/price-chart");

const MS_PER_DAY = 86_400_000;
const now = Date.now();
// Readings within the last few days so `fillDailyGaps` (which always fills up
// to "today") produces a small, bounded series in the test.
const reading = (daysAgo: number, price: number) => ({
  id: `r${daysAgo}`,
  productId: "p1",
  price,
  currency: "USD",
  checkedAt: new Date(now - daysAgo * MS_PER_DAY),
});
const history = [reading(3, 100), reading(1, 120), reading(0, 110)];

class ResizeObserverMock {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback(
      [{ contentRect: { width: 800 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

function renderChart(historyValue: readonly unknown[] = history) {
  return render(
    <MemoryRouter>
      <PriceChart history={historyValue as never} currency={null} />
    </MemoryRouter>,
  );
}

describe("PriceChart", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an inline SVG chart instead of recharts", () => {
    const { container } = renderChart();

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".recharts-responsive-container")).toBeNull();

    // One stepped area fill + one stroke line = at least two `<path>`s.
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the 7d/30d/all range selector", () => {
    renderChart();

    expect(screen.getByRole("button", { name: "7 days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("shows the hovered point price and label in a tooltip", () => {
    const { container } = renderChart();
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("expected an <svg> to render");

    expect(screen.queryByTestId("chart-tooltip")).not.toBeInTheDocument();

    // x = LEFT padding (96) is the first (from day -3) gap-filled point,
    // whose forward-filled price is 100.
    fireEvent.mouseMove(svg, { clientX: 96, clientY: 20 });

    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip).toHaveTextContent("100.00");
    expect(tooltip).toHaveTextContent("Price");
  });

  it("renders the empty state when there are no readings", () => {
    render(
      <MemoryRouter>
        <PriceChart history={[]} currency={null} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No price changes in the selected period."),
    ).toBeInTheDocument();
  });
});