"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router";
import type { ProductHistory } from "../hooks/use-products";
import { useI18n } from "../lib/i18n";
import { formatPrice, SegmentedControl } from "./ui";

const RANGE_VALUES = ["7d", "30d", "all"] as const;
type RangeValue = (typeof RANGE_VALUES)[number];

function isRangeValue(value: string | null): value is RangeValue {
  return (RANGE_VALUES as readonly string[]).includes(value ?? "");
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DailyPoint = { checkedAt: Date; price: number };

/**
 * Expand the compact change-point series into a continuous daily series.
 * The DB only stores a reading when the price changes (R9), so days with no
 * change are missing. This helper fills those gaps by carrying forward the
 * last known price, giving the chart a continuous daily X-axis.
 *
 * The range start is the earliest reading within the selected window (or the
 * cutoff date for 7d/30d). The end is today. If the first reading is after the
 * cutoff, the series starts from that reading's date (no synthetic prices
 * before the first known reading).
 */
function fillDailyGaps(
  readings: ProductHistory,
  cutoff: number | null,
): DailyPoint[] {
  if (readings.length === 0) return [];

  const today = startOfDay(new Date()).getTime();
  const firstReading = readings[0];
  if (!firstReading) return [];

  const firstTs = firstReading.checkedAt.getTime();
  const startTs =
    cutoff != null
      ? Math.max(startOfDay(new Date(firstTs)).getTime(), cutoff)
      : startOfDay(new Date(firstTs)).getTime();

  const result: DailyPoint[] = [];

  // Walk day-by-day from start to today (inclusive). For each day, find the
  // most recent reading on or before that day (forward-fill).
  let readingIdx = 0;
  let currentPrice = firstReading.price;

  for (let day = startTs; day <= today; ) {
    // Advance through all readings that fall on or before this day
    while (readingIdx < readings.length) {
      const reading = readings[readingIdx];
      if (!reading || reading.checkedAt.getTime() > endOfDay(new Date(day)).getTime()) {
        break;
      }
      currentPrice = reading.price;
      readingIdx++;
    }

    result.push({ checkedAt: new Date(day), price: currentPrice });

    // Re-derive midnight instead of adding 24h: on 25-hour DST-fallback days
    // a fixed +24h step would land mid-day and produce a duplicate calendar
    // day on the X-axis.
    day = startOfDay(new Date(day + MS_PER_DAY)).getTime();
  }

  return result;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// SVG layout, sized for the `h-72` (288px) container and reusing the
// `--chart-*` palette already defined in index.css (light + dark).
const PADDING = { top: 8, right: 16, bottom: 28, left: 96 } as const;
const CHART_HEIGHT = 288;

/**
 * Round up on a 1/2/5×10ⁿ lattice so Y axis ticks land on "clean" values
 * (e.g. 100/105/110 instead of 99.4/103.7/108.0) — the auto-scaled Y-domain
 * the chart library used to provide for free.
 */
function niceTicks(min: number, max: number, count: number): number[] {
  if (min > max) return [];
  if (min === max) return [min];
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep =
    (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) *
    magnitude;
  const start = Math.ceil(min / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let value = start; value <= max + niceStep * 1e-6; value += niceStep) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

interface ChartGeometry {
  xAt: (index: number) => number;
  yAt: (price: number) => number;
  linePath: string;
  areaPath: string;
  yTicks: number[];
  xTickIndices: number[];
  n: number;
  innerW: number;
  innerH: number;
}

/**
 * Compute every SVG coordinate from the (already gap-filled, daily) data.
 * A stepped area uses `stepAfter` semantics: each point extends horizontally
 * to the next X first, then vertically to the next Y.
 */
function makeGeometry(data: DailyPoint[], width: number): ChartGeometry {
  const n = data.length;
  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const xAt = (index: number) =>
    PADDING.left + (n <= 1 ? innerW / 2 : (index / (n - 1)) * innerW);
  const bottomY = PADDING.top + innerH;

  const empty: ChartGeometry = {
    xAt,
    yAt: () => bottomY,
    linePath: "",
    areaPath: "",
    yTicks: [],
    xTickIndices: [],
    n,
    innerW,
    innerH,
  };

  const first = data[0];
  if (!first) return empty;

  const prices = data.map((point) => point.price);
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (min === max) {
    // Flat series (single price): keep the line visible mid-plot instead of
    // collapsing the Y-domain into a division by zero.
    min -= 0.5;
    max += 0.5;
  } else {
    const pad = (max - min) * 0.05;
    min -= pad;
    max += pad;
  }

  const yAt = (price: number) =>
    PADDING.top + (1 - (price - min) / (max - min)) * innerH;

  let linePath = `M ${xAt(0).toFixed(2)} ${yAt(first.price).toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    if (!prev || !curr) continue;
    linePath += ` L ${xAt(i).toFixed(2)} ${yAt(prev.price).toFixed(2)} L ${xAt(i).toFixed(2)} ${yAt(curr.price).toFixed(2)}`;
  }
  const areaPath = `${linePath} L ${xAt(n - 1).toFixed(2)} ${bottomY.toFixed(2)} L ${xAt(0).toFixed(2)} ${bottomY.toFixed(2)} Z`;

  const yTicks = niceTicks(min, max, 4);

  const xTickIndices: number[] = [];
  if (n <= 1) {
    xTickIndices.push(0);
  } else {
    const target = Math.min(5, n);
    const seen = new Set<number>();
    for (let k = 0; k < target; k++) {
      const index = Math.round((k * (n - 1)) / (target - 1));
      if (!seen.has(index)) {
        seen.add(index);
        xTickIndices.push(index);
      }
    }
  }

  return { xAt, yAt, linePath, areaPath, yTicks, xTickIndices, n, innerW, innerH };
}

/**
 * Measure the chart container's width so the SVG fills it responsively.
 * Falls back graciously when
 * `ResizeObserver` is absent (e.g. old browsers / test environments without a
 * mock).
 */
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/**
 * Daily price trend chart (R13) with a URL-backed time-range selector
 * (React Router `useSearchParams`: 7d/30d/all). Readings are the compact
 * change-point series; the chart fills daily gaps (carrying forward the last
 * known price) and renders a dependency-free stepped area chart so flat
 * periods and change points are visually clear. `currency` (when known) is
 * shown in the tooltip and Y-axis ticks (R11/R9).
 */
export function PriceChart({
  history,
  currency,
}: {
  history: ProductHistory;
  currency: string | null;
}) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawRange = searchParams.get("range");
  const range: RangeValue = isRangeValue(rawRange) ? rawRange : "30d";

  // Write the selection to the URL; omit the param at the default so a plain
  // product URL stays clean (invalid/absent `range` falls back to 30d).
  const setRange = (value: RangeValue): void => {
    setSearchParams(value === "30d" ? {} : { range: value }, { replace: true });
  };

  const rangeOptions = [
    { value: "7d", label: t("chart.7d") },
    { value: "30d", label: t("chart.30d") },
    { value: "all", label: t("chart.all") },
  ] as const;

  const data = useMemo(() => {
    if (range === "all") {
      return fillDailyGaps(history, null);
    }
    const cutoff = Date.now() - (range === "7d" ? 7 : 30) * MS_PER_DAY;
    const filtered = history.filter(
      (reading) => reading.checkedAt.getTime() >= cutoff,
    );
    return fillDailyGaps(filtered, cutoff);
  }, [history, range]);

  const [containerRef, width] = useContainerWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");

  const geometry = useMemo(() => makeGeometry(data, width), [data, width]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-stone-500 dark:text-stone-400">
        <span>{t("chart.empty")}</span>
        <span className="text-xs">{t("chart.emptyHint")}</span>
      </div>
    );
  }

  const hoveredPoint = hovered === null ? null : (data[hovered] ?? null);

  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>): void => {
    if (geometry.innerW <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = (x - PADDING.left) / geometry.innerW;
    const index = Math.round(ratio * (geometry.n - 1));
    setHovered(Math.max(0, Math.min(geometry.n - 1, index)));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
          {t("chart.range")}
        </span>
        <SegmentedControl
          options={rangeOptions}
          value={range}
          onChange={setRange}
          label={t("chart.rangeAria")}
        />
      </div>

      <div
        ref={containerRef}
        className="relative h-72 w-full"
        role="img"
        aria-label={t("chart.ariaLabel")}
      >
        <svg
          width="100%"
          height={CHART_HEIGHT}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-area)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-area)" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          {/* Horizontal grid lines. */}
          {geometry.yTicks.map((tick) => (
            <line
              key={`grid-${tick}`}
              x1={PADDING.left}
              x2={PADDING.left + geometry.innerW}
              y1={geometry.yAt(tick)}
              y2={geometry.yAt(tick)}
              stroke="var(--chart-grid)"
              strokeDasharray="3 3"
            />
          ))}

          {geometry.areaPath ? (
            <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
          ) : null}
          {geometry.linePath ? (
            <path
              d={geometry.linePath}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth={2}
            />
          ) : null}

          {/* Y-axis tick labels, right-aligned in the left padding. */}
          {geometry.yTicks.map((tick) => (
            <text
              key={`y-${tick}`}
              x={PADDING.left - 8}
              y={geometry.yAt(tick) + 4}
              textAnchor="end"
              fill="var(--chart-axis)"
              fontSize={12}
            >
              {formatPrice(tick, currency)}
            </text>
          ))}

          {/* X-axis date labels. */}
          {geometry.xTickIndices.map((index) => {
            const point = data[index];
            if (!point) return null;
            return (
              <text
                key={`x-${index}`}
                x={geometry.xAt(index)}
                y={PADDING.top + geometry.innerH + 18}
                textAnchor="middle"
                fill="var(--chart-axis)"
                fontSize={12}
              >
                {point.checkedAt.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            );
          })}

          {hovered !== null && hoveredPoint ? (
            <circle
              cx={geometry.xAt(hovered)}
              cy={geometry.yAt(hoveredPoint.price)}
              r={5}
              fill="var(--chart-dot)"
            />
          ) : null}
        </svg>

        {hovered !== null && hoveredPoint ? (
          <div
            data-testid="chart-tooltip"
            className="pointer-events-none absolute z-10 rounded-lg border px-2 py-1 text-xs shadow-sm"
            style={{
              left: geometry.xAt(hovered),
              top: geometry.yAt(hoveredPoint.price),
              transform: "translate(-50%, calc(-100% - 10px))",
              backgroundColor: "var(--surface)",
              borderColor: "var(--chart-grid)",
              color: "var(--text)",
            }}
          >
            <div style={{ color: "var(--text-muted)" }}>
              {hoveredPoint.checkedAt.toLocaleString()}
            </div>
            <div>
              {formatPrice(hoveredPoint.price, currency)}{" "}
              {currency ? t("chart.priceWithCurrency", { currency }) : t("chart.price")}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}