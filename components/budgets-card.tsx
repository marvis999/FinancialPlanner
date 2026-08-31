"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_CATEGORIES, categoryByKey, effectiveCategory } from "@/lib/categories";
import { budgetPeriodOf, daysInWindow } from "@/lib/period";
import { addMonthsClamped } from "@/lib/projection";
import type { BudgetItem, TransactionItem } from "@/lib/types";
import { DEFAULT_LOCALE, intlLocale, type Locale } from "@/lib/locale";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { cn, formatDate as formatDateIn, todayIso } from "@/lib/utils";

/**
 * Budgets: a limit per spending category and budget period. The period is the
 * calendar month for startDay 1, or salary-to-salary (e.g. 15th to the 14th)
 * otherwise. Actual spend counts in via each booking's category; the
 * projection extrapolates the current period linearly to warn before the
 * limit is crossed.
 */
export function BudgetsCard({
  budgets,
  transactions,
  startDay,
  disabled,
  onAdd,
  onUpdate,
  onDelete,
}: {
  budgets: BudgetItem[];
  transactions: TransactionItem[];
  /** Day of month (1–28) the budget period begins; 1 = calendar months. */
  startDay: number;
  disabled: boolean;
  onAdd: (category: string, amount: number) => void;
  onUpdate: (id: number, amount: number) => void;
  onDelete: (id: number) => void;
}) {
  const msg = useTranslations("budgets");
  const msgCommon = useTranslations("common");
  const categoryLabel = useCategoryLabel();
  const { formatEuro, formatDate, formatAmountInput, parseAmountInput } =
    useFormatters();
  const [category, setCategory] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  // Budgets whose booking list is expanded (collapsed by default).
  const [openLists, setOpenLists] = React.useState<Set<number>>(() => new Set());

  // Reference period: the one containing the newest imported booking.
  const refDate = transactions[0]?.date ?? todayIso();
  const period = budgetPeriodOf(refDate, startDay);
  const totalDays = daysInWindow(period.start, period.end);
  // Elapsed days come from the calendar, not from the newest booking. Dividing
  // by the booking's day projected a 1.200 EUR rent debited on day one of the
  // period to 36.000 EUR, and any lag between the last import and today only
  // inflated it further, since that day is always <= today.
  const today = todayIso();
  const elapsedDays = Math.min(
    totalDays,
    Math.max(1, daysInWindow(period.start, today < period.end ? today : period.end))
  );
  // Under a handful of days the extrapolation is noise, not a projection.
  const MIN_DAYS_FOR_PACE = 5;
  const paceReliable = elapsedDays >= MIN_DAYS_FOR_PACE;

  const { spentByCat, avgByCat, comparableMonths } = React.useMemo(() => {
    const spent = new Map<string, number>();
    // The three periods before the reference period, for the comparison Ø.
    const prev = [1, 2, 3].map((monthsBack) => {
      const start = addMonthsClamped(period.start, -monthsBack);
      return budgetPeriodOf(start, startDay);
    });
    const perPeriod = new Map<string, number[]>(); // category -> sums per prev slot
    const hasData = prev.map(() => false);
    for (const transaction of transactions) {
      const categoryKey = effectiveCategory(transaction);
      // Current period: signed, so a refund reduces the reported spend (B11).
      if (transaction.date >= period.start && transaction.date <= period.end) {
        spent.set(categoryKey, (spent.get(categoryKey) ?? 0) + -transaction.amount);
      }
      for (let i = 0; i < prev.length; i++) {
        if (transaction.date >= prev[i].start && transaction.date <= prev[i].end) {
          hasData[i] = true;
          // The comparison average stays expense-only. Netting it would turn
          // any category that receives money into a 0,00 EUR "average".
          if (transaction.amount < 0) {
            let sums = perPeriod.get(categoryKey);
            if (!sums) perPeriod.set(categoryKey, (sums = prev.map(() => 0)));
            sums[i] += -transaction.amount;
          }
        }
      }
    }
    for (const [categoryKey, spentAmount] of spent)
      if (spentAmount < 0) spent.set(categoryKey, 0);
    // Divide by the periods that actually contain data. A fixed /3 turned a
    // single imported month of 390 EUR into an "average" of 130 EUR, exactly
    // in the first-import case where the user has least reason to doubt it.
    const comparable = hasData.filter(Boolean).length;
    const avg = new Map<string, number>();
    if (comparable > 0) {
      for (const [categoryKey, sums] of perPeriod) {
        const total = sums.reduce(
          (running, slotSum, slot) => running + (hasData[slot] ? slotSum : 0),
          0
        );
        avg.set(categoryKey, total / comparable);
      }
    }
    return { spentByCat: spent, avgByCat: avg, comparableMonths: comparable };
  }, [transactions, period.start, period.end, startDay]);

  // The bookings behind each bar: everything in the current period, grouped
  // by category — the exact rows the "spent" figure sums (incoming
  // bookings included, since a refund reduces the reported spend).
  const periodTxByCat = React.useMemo(() => {
    const map = new Map<string, TransactionItem[]>();
    for (const transaction of transactions) {
      if (transaction.date < period.start || transaction.date > period.end) continue;
      const categoryKey = effectiveCategory(transaction);
      const list = map.get(categoryKey);
      if (list) list.push(transaction);
      else map.set(categoryKey, [transaction]);
    }
    return map;
  }, [transactions, period.start, period.end]);

  const freeCategories = ALL_CATEGORIES.filter(
    (option) =>
      !budgets.some((budget) => budget.category === option.key) ||
      budgets.find((budget) => budget.id === editingId)?.category === option.key
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseAmountInput(amount);
    if (parsed === null || parsed <= 0) return;
    if (editingId !== null) {
      onUpdate(editingId, parsed);
    } else {
      if (!category) return;
      onAdd(category, parsed);
    }
    setEditingId(null);
    setCategory("");
    setAmount("");
  }

  function startEdit(b: BudgetItem) {
    setEditingId(b.id);
    setCategory(b.category);
    setAmount(formatAmountInput(b.amount));
  }

  function cancelEdit() {
    setEditingId(null);
    setCategory("");
    setAmount("");
  }

  return (
    <div className="space-y-4">
      {budgets.length > 0 && (
        <div className="space-y-4">
          {budgets.map((budget) => {
            const categoryInfo = categoryByKey(budget.category);
            const spent = spentByCat.get(budget.category) ?? 0;
            const perDay = spent / elapsedDays;
            const projected = perDay * totalDays;
            const avg = avgByCat.get(budget.category) ?? 0;
            const over = spent > budget.amount;
            const projectedOver = paceReliable && projected > budget.amount;
            const pct = Math.min(100, (spent / budget.amount) * 100);
            // Where this period's average pace lands at its end, on the
            // 0..budget scale of the bar (pinned to the edge when over).
            const projectedPct = Math.min(100, (projected / budget.amount) * 100);
            const remaining = budget.amount - spent;
            return (
              <div key={budget.id}>
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: `var(${categoryInfo.cssVar})` }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {categoryLabel(budget.category)}
                  </span>
                  <span className="font-mono text-sm tabular-nums">
                    <span className={cn(over && "font-semibold text-destructive")}>
                      {formatEuro(spent)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      {msg("ofLimit", { limit: formatEuro(budget.amount) })}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => startEdit(budget)}
                    disabled={disabled}
                    aria-label={msg("editAria", { category: categoryLabel(budget.category) })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(budget.id)}
                    disabled={disabled}
                    aria-label={msg("deleteAria", { category: categoryLabel(budget.category) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <HoverCard openDelay={100} closeDelay={50}>
                  <HoverCardTrigger asChild>
                    <div className="relative mt-1.5 h-2 cursor-help overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: over
                            ? "hsl(var(--destructive))"
                            : `var(${categoryInfo.cssVar})`,
                        }}
                      />
                      {spent > 0 && paceReliable && (
                        <div
                          className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] transition-all"
                          style={{ left: `${projectedPct}%` }}
                          aria-hidden
                        />
                      )}
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-96 max-w-[calc(100vw-2rem)] text-xs" sideOffset={6}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="font-medium">{categoryLabel(budget.category)}</span>
                      <span className="text-muted-foreground">
                        {formatDate(period.start)} - {formatDate(period.end)} ·{" "}
                        {msg("dayOfPeriod", { elapsed: elapsedDays, total: totalDays })}
                      </span>
                    </div>
                    <dl className="grid gap-1">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{msg("spent")}</dt>
                        <dd className="font-mono tabular-nums">
                          {msg("spentOf", {
                            spent: formatEuro(spent),
                            limit: formatEuro(budget.amount),
                          })}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">
                          {remaining >= 0 ? msg("freeToLimit") : msg("overLimit")}
                        </dt>
                        <dd
                          className={cn(
                            "font-mono tabular-nums",
                            remaining < 0 && "font-medium text-destructive"
                          )}
                        >
                          {formatEuro(Math.abs(remaining))}
                        </dd>
                      </div>
                      {paceReliable ? (
                        <>
                          <div className="flex justify-between gap-3 border-t pt-1">
                            <dt className="text-muted-foreground">
                              {msg("projectionAt", { date: formatDate(period.end) })}
                            </dt>
                            <dd
                              className={cn(
                                "font-mono tabular-nums",
                                projectedOver && "font-medium text-destructive"
                              )}
                            >
                              {formatEuro(projected)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">
                              Kommt bei diesem Tempo noch dazu
                            </dt>
                            <dd className="font-mono tabular-nums">
                              {formatEuro(Math.max(0, projected - spent))}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">
                              {projectedOver
                                ? msg("projectionOver")
                                : msg("projectionBuffer")}
                            </dt>
                            <dd
                              className={cn(
                                "font-mono tabular-nums",
                                projectedOver && "font-medium text-destructive"
                              )}
                            >
                              {formatEuro(Math.abs(budget.amount - projected))}
                            </dd>
                          </div>
                        </>
                      ) : (
                        <div className="border-t pt-1 text-muted-foreground">
                          {msg("tooFewDaysShort")}
                        </div>
                      )}
                    </dl>
                  </HoverCardContent>
                </HoverCard>
                <p className="mt-1 text-xs text-muted-foreground">
                  {paceReliable ? (
                    <>
                      {msg("projection")}{" "}
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          projectedOver
                            ? "font-medium text-destructive"
                            : "text-foreground"
                        )}
                      >
                        {formatEuro(projected)}
                      </span>
                      {projectedOver && (
                        <span className="text-destructive">{msg("overBudget")}</span>
                      )}
                    </>
                  ) : (
                    <>{msg("tooFewDays")}</>
                  )}
                  {spent > 0 && paceReliable && (
                    <>
                      {msg("perDay")}
                      <span className="font-mono tabular-nums">
                        {formatEuro(perDay)}
                      </span>
                    </>
                  )}
                  {avg > 0 && comparableMonths > 0 && (
                    <>
                      {msg("lastPeriods", { count: comparableMonths })}
                      <span className="font-mono tabular-nums">
                        {formatEuro(avg)}
                      </span>
                    </>
                  )}
                </p>
                <BudgetItemsPanel
                  items={periodTxByCat.get(budget.category) ?? []}
                  open={openLists.has(budget.id)}
                  onToggle={() =>
                    setOpenLists((prev) => {
                      const next = new Set(prev);
                      if (next.has(budget.id)) next.delete(budget.id);
                      else next.add(budget.id);
                      return next;
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      <form
        onSubmit={submit}
        className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center"
      >
        <Select
          value={category}
          onValueChange={setCategory}
          disabled={editingId !== null}
        >
          <SelectTrigger className="h-9 sm:w-56">
            <SelectValue placeholder={msg("categoryPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {freeCategories.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {categoryLabel(option.key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CurrencyInput
          value={amount}
          onChange={setAmount}
          className="h-9"
          containerClassName="sm:w-36"
          aria-label={msg("amountAria")}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="h-9" disabled={disabled}>
            {editingId !== null ? (
              <Save className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {editingId !== null ? msgCommon("save") : msgCommon("add")}
          </Button>
          {editingId !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={cancelEdit}
            >
              <X className="h-4 w-4" />
              {msgCommon("cancel")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/**
 * Collapsible list of the bookings a budget bar counted in the current
 * period — so the "spent" figure can be audited instead of believed.
 * Collapsed by default; incoming bookings show as green credits, since they
 * reduce the reported spend.
 */
function BudgetItemsPanel({
  items,
  open,
  onToggle,
}: {
  items: TransactionItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const msg = useTranslations("budgets");
  const { formatEuro, formatDate } = useFormatters();
  if (items.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
        {msg("counted", { count: items.length })}
      </button>
      {open && (
        <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border text-xs">
          {items.map((transaction) => (
            <li
              key={transaction.id}
              className="flex items-baseline gap-3 border-b px-3 py-1.5 last:border-b-0"
            >
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                {formatDate(transaction.date)}
              </span>
              <span className="min-w-0 flex-1 truncate" title={transaction.name}>
                {transaction.name}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono tabular-nums",
                  transaction.amount >= 0 && "text-success"
                )}
              >
                {transaction.amount >= 0 ? "+" : "−"}
                {formatEuro(Math.abs(transaction.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Label of the current budget period: the month name for calendar months,
 *  or the explicit day range for a salary-anchored period. */
export function budgetsMonthLabel(
  transactions: TransactionItem[],
  startDay: number,
  locale: Locale = DEFAULT_LOCALE
): string {
  const refDate = transactions[0]?.date ?? todayIso();
  if (startDay <= 1) {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      month: "long",
      year: "numeric",
    }).format(new Date(`${refDate}T00:00:00`));
  }
  const period = budgetPeriodOf(refDate, startDay);
  return `${formatDateIn(period.start, locale)} - ${formatDateIn(period.end, locale)}`;
}
