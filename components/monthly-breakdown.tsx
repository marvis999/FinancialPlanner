"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { BudgetItem, RecurringItem } from "@/lib/types";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

function monthlyEq(recurring: RecurringItem): number {
  return recurring.amount / (recurring.intervalMonths || 1);
}

function Row({ item }: { item: RecurringItem }) {
  const { formatEuro } = useFormatters();
  const iv = item.intervalMonths || 1;
  const eq = monthlyEq(item);
  const sign = item.kind === "income" ? "+" : "−";
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="min-w-0 truncate" title={item.name}>
        {item.name}
      </span>
      <span className="whitespace-nowrap font-mono tabular-nums">
        {iv > 1 && (
          <span className="mr-1 text-muted-foreground">
            {formatEuro(item.amount)} ÷ {iv} =
          </span>
        )}
        <span
          className={cn(
            item.kind === "income" ? "text-success" : "text-destructive"
          )}
        >
          {sign}
          {formatEuro(Math.abs(eq))}
        </span>
      </span>
    </div>
  );
}

/**
 * Wraps a displayed monthly-net value; hovering reveals how it was calculated:
 * every recurring item normalized to its monthly equivalent, subtotals, net.
 */
export function MonthlyNetHover({
  items,
  budgets = [],
  children,
}: {
  items: RecurringItem[];
  budgets?: BudgetItem[];
  children: React.ReactNode;
}) {
  const msg = useTranslations("monthlyNet");
  const { formatEuro } = useFormatters();
  const categoryLabel = useCategoryLabel();
  const income = items
    .filter((i) => i.kind === "income")
    .sort((a, b) => monthlyEq(b) - monthlyEq(a));
  const expense = items
    .filter((i) => i.kind === "expense")
    .sort((a, b) => monthlyEq(b) - monthlyEq(a));
  const budgetSum = budgets.reduce((total, budget) => total + budget.amount, 0);
  const incomeSum = income.reduce((total, item) => total + monthlyEq(item), 0);
  const expenseSum =
    expense.reduce((total, item) => total + monthlyEq(item), 0) + budgetSum;
  const net = incomeSum - expenseSum;

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="cursor-help underline decoration-muted-foreground/60 decoration-dotted underline-offset-4">
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-96 max-w-[92vw] p-0 text-xs">
        <div className="border-b px-3 py-2 font-medium text-muted-foreground">
          {msg("title")}
        </div>
        <div className="max-h-72 overflow-y-auto px-3 py-2">
          {income.length > 0 && (
            <>
              <p className="mb-0.5 font-medium text-success">{msg("income")}</p>
              {income.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </>
          )}
          {expense.length > 0 && (
            <>
              <p className="mb-0.5 mt-2 font-medium text-destructive">
                {msg("expenses")}
              </p>
              {expense.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </>
          )}
          {budgets.length > 0 && (
            <>
              <p className="mb-0.5 mt-2 font-medium text-destructive">
                {msg("budgets")}
              </p>
              {budgets.map((b) => (
                <div
                  key={b.id}
                  className="flex items-baseline justify-between gap-3 py-0.5"
                >
                  <span className="min-w-0 truncate">
                    {categoryLabel(b.category)}
                  </span>
                  <span className="whitespace-nowrap font-mono tabular-nums text-destructive">
                    −{formatEuro(b.amount)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="space-y-1 border-t px-3 py-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{msg("incomePerMonth")}</span>
            <span className="font-mono tabular-nums text-success">
              +{formatEuro(incomeSum)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{msg("expensePerMonth")}</span>
            <span className="font-mono tabular-nums text-destructive">
              −{formatEuro(expenseSum)}
            </span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{msg("netPerMonth")}</span>
            <span className="font-mono tabular-nums">{formatEuro(net)}</span>
          </div>
          <p className="pt-1 text-[10px] leading-snug text-muted-foreground">
            {msg("footnote")}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
