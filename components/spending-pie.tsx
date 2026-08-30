"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Cell, Pie, PieChart, Tooltip, type TooltipProps } from "recharts";
import { Search, Tag as TagIcon } from "lucide-react";

import { ChartContainer } from "@/components/ui/chart";
import { CheckboxDropdown } from "@/components/ui/checkbox-dropdown";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_CATEGORIES, categoryByKey, effectiveCategory } from "@/lib/categories";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { addMonthsClamped } from "@/lib/projection";
import { monthsInWindow, nextDay } from "@/lib/period";
import type { TransactionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Labels are built in the component: they are translated, these are not. */
const PERIOD_VALUES = ["3", "6", "12", "all"] as const;

/** Validated categorical slots, reused for ad-hoc keyword slices. */
const SLOT_VARS = [
  "--cat-wohnen",
  "--cat-shopping",
  "--cat-lebensmittel",
  "--cat-tanken",
  "--cat-telefon",
  "--cat-bargeld",
  "--cat-versicherungen",
  "--cat-kredite",
];

interface Slice {
  key: string;
  label: string;
  value: number;
  count: number;
  color: string; // CSS color
}

function PieSliceTooltip({ active, payload }: TooltipProps<number, string>) {
  const msg = useTranslations("spending");
  const { formatEuro, formatPercent } = useFormatters();
  if (!active || !payload?.length) return null;
  const slice = payload[0]?.payload as (Slice & { total: number; months: number }) | undefined;
  if (!slice) return null;
  const pct = slice.total > 0 ? (slice.value / slice.total) * 100 : 0;
  return (
    <div className="grid min-w-[11rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-center gap-1.5 font-medium">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: slice.color }}
        />
        {slice.label}
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{msg("tooltipSum")}</span>
        <span className="font-mono font-medium tabular-nums">
          {formatEuro(slice.value)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{msg("tooltipShare")}</span>
        <span className="font-mono tabular-nums">{formatPercent(pct)} %</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{msg("tooltipBookings")}</span>
        <span className="font-mono tabular-nums">{slice.count}</span>
      </div>
      {slice.months > 1 && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{msg("tooltipAvgPerMonth")}</span>
          <span className="font-mono tabular-nums">
            {formatEuro(slice.value / slice.months)}
          </span>
        </div>
      )}
    </div>
  );
}

export function SpendingPie({
  transactions,
}: {
  transactions: TransactionItem[];
}) {
  const msg = useTranslations("spending");
  const { formatDate, formatEuro, formatPercent } = useFormatters();
  const categoryLabel = useCategoryLabel();
  const [period, setPeriod] = React.useState("12");
  const [keyword, setKeyword] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(ALL_CATEGORIES.map((category) => category.key))
  );
  const [tagFilter, setTagFilter] = React.useState<Set<string>>(
    () => new Set()
  );

  // Every tag currently in use; the dropdown is hidden while none exist.
  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const transaction of transactions) for (const tag of transaction.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [transactions]);

  // Drop filter entries whose tag no longer exists on any booking.
  React.useEffect(() => {
    setTagFilter((prev) => {
      const next = new Set([...prev].filter((tag) => allTags.includes(tag)));
      return next.size === prev.size ? prev : next;
    });
  }, [allTags]);

  const { slices, total, months, range } = React.useMemo(() => {
    // Expenses within the selected period (relative to the newest booking).
    const newest = transactions[0]?.date;
    const cutoff =
      period === "all" || !newest
        ? ""
        : addMonthsClamped(newest, -Number(period));
    let expenses = transactions.filter(
      (transaction) => transaction.amount < 0 && (!cutoff || transaction.date > cutoff)
    );
    // Tag filter applies in both modes, before grouping.
    if (tagFilter.size > 0) {
      expenses = expenses.filter((transaction) =>
        transaction.tags.some((tag) => tagFilter.has(tag))
      );
    }

    const needle = keyword.trim().toLowerCase();
    const groups = new Map<string, Slice>();
    if (needle) {
      // Keyword mode: matching bookings, grouped by counterparty.
      expenses = expenses.filter((transaction) =>
        (transaction.name + " " + transaction.purpose).toLowerCase().includes(needle)
      );
    }
    if (needle) {
      for (const transaction of expenses) {
        const key = transaction.name.trim() || "—";
        const group = groups.get(key);
        if (group) {
          group.value += -transaction.amount;
          group.count++;
        } else {
          groups.set(key, {
            key,
            label: key.length > 28 ? key.slice(0, 27) + "…" : key,
            value: -transaction.amount,
            count: 1,
            color: "",
          });
        }
      }
    } else {
      // Category mode: fixed entity colors, filtered by the checkbox dropdown.
      for (const transaction of expenses) {
        const key = effectiveCategory(transaction);
        if (!selected.has(key)) continue;
        const group = groups.get(key);
        if (group) {
          group.value += -transaction.amount;
          group.count++;
        } else {
          const cat = categoryByKey(key);
          groups.set(key, {
            key,
            label: categoryLabel(key),
            value: -transaction.amount,
            count: 1,
            color: `var(${cat.cssVar})`,
          });
        }
      }
    }

    let list = [...groups.values()].sort((a, b) => b.value - a.value);
    // Keyword mode draws from SLOT_VARS and indexes it modulo its length, so a
    // 9th group would silently reuse the largest slice's colour - two
    // identically coloured arcs and two identical legend dots. Category mode
    // has a fixed colour per category and never needs folding.
    const maxSlices = needle ? SLOT_VARS.length : ALL_CATEGORIES.length;
    if (list.length > maxSlices) {
      const tail = list.slice(maxSlices);
      list = list.slice(0, maxSlices);
      list.push({
        key: "__rest",
        label: msg("moreSlices", { count: tail.length }),
        value: tail.reduce((running, group) => running + group.value, 0),
        count: tail.reduce((running, group) => running + group.count, 0),
        color: "var(--cat-sonstiges)",
      });
    }
    if (needle) {
      // Ad-hoc slices: assign the validated slots in order; "Übrige" stays gray.
      list.forEach((slice, index) => {
        if (slice.key !== "__rest")
          slice.color = `var(${SLOT_VARS[index % SLOT_VARS.length]})`;
      });
    }

    const sum = list.reduce((running, group) => running + group.value, 0);
    const included = expenses.filter((transaction) =>
      needle ? true : selected.has(effectiveCategory(transaction))
    );
    // Transactions arrive newest-first, so the range is first..last element.
    const dateRange = included.length
      ? { from: included[included.length - 1].date, to: included[0].date }
      : null;
    // Divide by the length of the SELECTED WINDOW, not by the months the
    // filter happened to touch. Counting month keys was wrong twice over: a
    // 3-month window clipping the tail of a fourth month read 25% low, and a
    // keyword hitting 4 of 12 months divided by 4, tripling the average.
    const windowFrom = cutoff && newest ? nextDay(cutoff) : dateRange?.from;
    const windowTo = newest ?? dateRange?.to;
    const windowMonths =
      windowFrom && windowTo ? Math.max(1 / 31, monthsInWindow(windowFrom, windowTo)) : 1;
    return { slices: list, total: sum, months: windowMonths, range: dateRange };
  }, [transactions, period, keyword, selected, tagFilter, msg, categoryLabel]);

  const chartData = slices.map((slice) => ({ ...slice, total, months }));
  const catOptions = ALL_CATEGORIES.map((category) => ({
    key: category.key,
    label: categoryLabel(category.key),
    checked: selected.has(category.key),
    color: `var(${category.cssVar})`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={msg("keywordPlaceholder")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_VALUES.map((periodValue) => (
                <SelectItem key={periodValue} value={periodValue}>
                  {periodValue === "all"
                    ? msg("periodAll")
                    : msg("periodMonths", { count: Number(periodValue) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CheckboxDropdown
            label={msg("categoriesLabel", {
              selected: selected.size,
              total: ALL_CATEGORIES.length,
            })}
            options={catOptions}
            onToggle={(key, checked) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (checked) next.add(key);
                else next.delete(key);
                return next;
              })
            }
            className={cn(keyword.trim() && "pointer-events-none opacity-50")}
          />
          {allTags.length > 0 && (
            <CheckboxDropdown
              label={
                <span className="flex items-center gap-1.5">
                  <TagIcon className="h-3.5 w-3.5" />
                  {tagFilter.size > 0
                    ? msg("tagsWithCount", { count: tagFilter.size })
                    : msg("tags")}
                </span>
              }
              options={allTags.map((tag) => ({
                key: tag,
                label: tag,
                checked: tagFilter.has(tag),
              }))}
              onToggle={(key, checked) =>
                setTagFilter((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
            />
          )}
        </div>
        {range && (
          <span className="text-xs text-muted-foreground sm:ml-auto">
            {msg("range", {
              from: formatDate(range.from),
              to: formatDate(range.to),
            })}
          </span>
        )}
      </div>

      {slices.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          {keyword.trim() ? msg("emptyForKeyword") : msg("empty")}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
          <div className="relative h-[240px] w-[240px] shrink-0">
            <ChartContainer config={{}} className="aspect-square h-full w-full">
              <PieChart>
                {/* Above the centered sum overlay, which follows in DOM order
                    and would otherwise paint over the tooltip. */}
                <Tooltip content={<PieSliceTooltip />} wrapperStyle={{ zIndex: 10 }} />
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="64%"
                  outerRadius="98%"
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {chartData.map((slice) => (
                    <Cell key={slice.key} fill={slice.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-semibold tabular-nums">
                {formatEuro(total)}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {months > 1
                  ? msg("avgPerMonth", { amount: formatEuro(total / months) })
                  : msg("expenses")}
              </span>
            </div>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-1 text-sm">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="min-w-0 flex-1 truncate" title={slice.label}>
                  {slice.label}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {total > 0 ? formatPercent((slice.value / total) * 100) : "0"}
                  %
                </span>
                <span className="w-24 text-right font-mono font-medium tabular-nums">
                  {formatEuro(slice.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
