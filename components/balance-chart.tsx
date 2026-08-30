"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { intlLocale, type Locale } from "@/lib/locale";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";
import type { ChartPoint, ProjectionEvent } from "@/lib/projection";

const DAY_MS = 86_400_000;
/** Tightest zoom: two weeks across the plot. */
const MIN_SPAN_MS = 14 * DAY_MS;

function compactEuro(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// Local-time formatters: the ts values are local midnights, so going through
// toISOString would land on the previous UTC day.
function dayTick(ts: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(ts));
}

function fullDay(ts: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(ts));
}

/**
 * Ticks for the visible span: month starts while zoomed out, evenly strided
 * days once the span gets short enough that months would leave the axis
 * nearly empty.
 */
function buildTicks(
  minTs: number,
  maxTs: number,
  maxTicks = 10
): { ticks: number[]; monthly: boolean } {
  const spanDays = (maxTs - minTs) / DAY_MS;
  if (spanDays > 150) {
    const first = new Date(minTs);
    const last = new Date(maxTs);
    const ticks: number[] = [];
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    if (cursor.getTime() < first.getTime()) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor.getTime() <= last.getTime()) {
      ticks.push(cursor.getTime());
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const stride = Math.max(1, Math.ceil(ticks.length / maxTicks));
    return { ticks: ticks.filter((_, i) => i % stride === 0), monthly: true };
  }
  const strideDays = Math.max(1, Math.round(spanDays / maxTicks));
  const ticks: number[] = [];
  const cursor = new Date(minTs);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < minTs) cursor.setDate(cursor.getDate() + 1);
  while (cursor.getTime() <= maxTs) {
    ticks.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + strideDays);
  }
  return { ticks, monthly: false };
}

function EventRow({ event }: { event: ProjectionEvent }) {
  const { formatEuro } = useFormatters();
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="min-w-0 truncate text-muted-foreground">{event.name}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          event.kind === "income" ? "text-success" : "text-destructive"
        )}
      >
        {event.kind === "income" ? "+" : "−"}
        {formatEuro(Math.abs(event.amount))}
      </span>
    </div>
  );
}

function BalanceTooltip({ active, payload }: TooltipProps<number, string>) {
  const msg = useTranslations("chart");
  const { formatDate, formatEuro } = useFormatters();
  const seriesLabel: Record<string, string> = {
    actual: msg("actual"),
    forecast: msg("forecast"),
    trend: msg("trend"),
  };
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as ChartPoint | undefined;
  if (!point) return null;

  const rows = payload.filter(
    (item) => item.value !== null && item.value !== undefined
  );

  return (
    <div className="grid min-w-[11rem] max-w-[18rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{formatDate(point.date)}</div>
      {rows.map((item) => (
        <div
          key={String(item.dataKey)}
          className="flex w-full items-center justify-between gap-4"
        >
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            {seriesLabel[String(item.dataKey)] ?? String(item.dataKey)}
          </span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatEuro(Number(item.value))}
          </span>
        </div>
      ))}
      {point.events.length > 0 && (
        <div className="grid gap-1 border-t pt-1.5">
          <div className="font-medium text-muted-foreground">
            {msg("dueThisDay")}
          </div>
          {point.events.map((event, i) => (
            <EventRow key={`${event.name}-${i}`} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BalanceChart({
  data,
  anchorTs,
  anchorLabel,
  todayTs,
}: {
  data: ChartPoint[];
  /** Day the imported history ends -- where Ist stops and Prognose starts. */
  anchorTs?: number;
  anchorLabel?: string;
  /** The real current day. Distinct from the anchor whenever an import lags. */
  todayTs?: number;
}) {
  const msg = useTranslations("chart");
  const { formatMonthLabel, locale } = useFormatters();
  const chartConfig = {
    actual: { label: msg("actualFull"), color: "hsl(var(--chart-1))" },
    forecast: { label: msg("forecastFull"), color: "hsl(var(--chart-2))" },
    trend: { label: msg("trendFull"), color: "hsl(var(--muted-foreground))" },
  } satisfies ChartConfig;
  const chartData = React.useMemo(() => {
    const round = (value: number | null) =>
      value === null ? null : Math.round(value * 100) / 100;
    return data.map((point) => ({
      ...point,
      actual: round(point.actual),
      forecast: round(point.forecast),
      trend: round(point.trend),
    }));
  }, [data]);

  const fullMin = data.length ? data[0].ts : 0;
  const fullMax = data.length ? data[data.length - 1].ts : 1;
  const fullSpan = Math.max(1, fullMax - fullMin);

  // Visible time window; null = the whole series (no zoom).
  const [domain, setDomain] = React.useState<[number, number] | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ startX: number; d0: number; d1: number } | null>(
    null
  );

  // New data (fresh import, changed horizon) resets a stale window.
  React.useEffect(() => {
    setDomain(null);
  }, [fullMin, fullMax]);

  const clampWindow = React.useCallback(
    (d0: number, span: number): [number, number] | null => {
      if (span >= fullSpan) return null;
      const start = Math.min(Math.max(d0, fullMin), fullMax - span);
      return [start, start + span];
    },
    [fullMin, fullMax, fullSpan]
  );

  /** Zoom by `factor` (>1 = out), keeping `centerTs` under the cursor. */
  const zoomAt = React.useCallback(
    (centerTs: number, factor: number) => {
      setDomain((prev) => {
        const [c0, c1] = prev ?? [fullMin, fullMax];
        const span = Math.min(
          fullSpan,
          Math.max(MIN_SPAN_MS, (c1 - c0) * factor)
        );
        const fraction = (centerTs - c0) / Math.max(1, c1 - c0);
        return clampWindow(centerTs - fraction * span, span);
      });
    },
    [fullMin, fullMax, fullSpan, clampWindow]
  );

  // Wheel zoom needs a native non-passive listener: React delegates wheel as
  // passive, so preventDefault (to stop the page from scrolling) is ignored.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))
      );
      setDomain((prev) => {
        const [c0, c1] = prev ?? [fullMin, fullMax];
        const centerTs = c0 + frac * (c1 - c0);
        const factor = event.deltaY > 0 ? 1.25 : 0.8;
        const span = Math.min(
          fullSpan,
          Math.max(MIN_SPAN_MS, (c1 - c0) * factor)
        );
        const fraction = (centerTs - c0) / Math.max(1, c1 - c0);
        return clampWindow(centerTs - fraction * span, span);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fullMin, fullMax, fullSpan, clampWindow]);

  // Drag anywhere on the plot to pan the zoomed window, timeline-style.
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || domain === null) return;
    dragRef.current = { startX: event.clientX, d0: domain[0], d1: domain[1] };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = wrapRef.current;
    if (!drag || !el) return;
    const span = drag.d1 - drag.d0;
    const perPx = span / Math.max(1, el.getBoundingClientRect().width);
    const shift = (drag.startX - event.clientX) * perPx;
    setDomain(clampWindow(drag.d0 + shift, span));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  // Only the points in (and directly bordering) the window, so lines still
  // run to the plot edges instead of stopping at the first inner point.
  const visibleData = React.useMemo(() => {
    if (!domain) return chartData;
    const [domainStart, domainEnd] = domain;
    let start = chartData.findIndex((point) => point.ts >= domainStart);
    if (start === -1) start = chartData.length - 1;
    let end = chartData.length - 1;
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].ts <= domainEnd) {
        end = i;
        break;
      }
    }
    return chartData.slice(Math.max(0, start - 1), Math.min(chartData.length, end + 2));
  }, [chartData, domain]);

  const hasActual = data.some((point) => point.actual !== null);
  const hasTrend = data.some((point) => point.trend !== null);
  const [minTs, maxTs] = domain ?? [fullMin, fullMax];
  const { ticks, monthly } = React.useMemo(
    () => buildTicks(minTs, maxTs),
    [minTs, maxTs]
  );

  const zoomedDays = Math.round((maxTs - minTs) / DAY_MS);

  return (
    <div>
      <div className="mb-1 flex items-center justify-end gap-1">
        <span className="mr-auto text-[11px] text-muted-foreground">
          {domain
            ? msg("zoomWindow", {
                from: fullDay(minTs, locale),
                to: fullDay(maxTs, locale),
                days: zoomedDays,
              })
            : msg("zoomHint")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => zoomAt((minTs + maxTs) / 2, 0.6)}
          aria-label={msg("zoomIn")}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => zoomAt((minTs + maxTs) / 2, 1.7)}
          disabled={domain === null}
          aria-label={msg("zoomOut")}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setDomain(null)}
          disabled={domain === null}
          aria-label={msg("zoomReset")}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setDomain(null)}
        className={cn(
          "touch-pan-y select-none",
          domain !== null && (dragging ? "cursor-grabbing" : "cursor-grab")
        )}
      >
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[340px] w-full"
        >
          <ComposedChart
            data={visibleData}
            margin={{ left: 4, right: 12, top: 8 }}
          >
            <defs>
              <linearGradient id="fillActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-actual)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-actual)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fillForecast" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-forecast)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-forecast)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={domain ?? ["dataMin", "dataMax"]}
              allowDataOverflow={domain !== null}
              ticks={ticks}
              tickFormatter={(ts) =>
                monthly
                  ? formatMonthLabel(new Date(Number(ts)))
                  : dayTick(Number(ts), locale)
              }
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={56}
              tickFormatter={(value) => compactEuro(Number(value), locale)}
            />
            {/* extendDomain, or recharts discards the line whenever the balance
                never approaches zero - i.e. it was absent in every case except
                the one where it is least needed. */}
            <ReferenceLine
              y={0}
              stroke="hsl(var(--destructive))"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
            {hasActual && anchorTs !== undefined && (
              <ReferenceLine
                x={anchorTs}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                label={{
                  value: anchorLabel ?? msg("lastImport"),
                  position: "insideTopRight",
                  fill: "hsl(var(--muted-foreground))",
                  fontSize: 11,
                }}
              />
            )}
            {/* The real today, drawn only when it has drifted away from the
                anchor. Everything between the two has already happened but is
                still shown as forecast, because no import covers it yet. */}
            {todayTs !== undefined && todayTs !== anchorTs && (
              <ReferenceLine
                x={todayTs}
                stroke="hsl(var(--foreground))"
                strokeOpacity={0.45}
                strokeDasharray="2 4"
                label={{
                  value: msg("today"),
                  position: "insideTopLeft",
                  fill: "hsl(var(--muted-foreground))",
                  fontSize: 11,
                }}
              />
            )}
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={<BalanceTooltip />}
            />
            <Area
              dataKey="forecast"
              type="stepAfter"
              fill="url(#fillForecast)"
              stroke="var(--color-forecast)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Area
              dataKey="actual"
              type="monotone"
              fill="url(#fillActual)"
              stroke="var(--color-actual)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            {hasTrend && (
              <Line
                dataKey="trend"
                type="linear"
                stroke="var(--color-trend)"
                strokeWidth={1.5}
                strokeDasharray="2 3"
                strokeOpacity={0.7}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ChartContainer>
      </div>
    </div>
  );
}
