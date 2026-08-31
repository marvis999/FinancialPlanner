"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";

import {
  addBudgetAction,
  addOneOffAction,
  addRecurringAction,
  addTransactionTagAction,
  deleteBudgetAction,
  deleteOneOffAction,
  deleteRecurringAction,
  removeTransactionTagAction,
  applyCategorySuggestionAction,
  setTransactionCategoryAction,
  toggleOneOffActiveAction,
  toggleRecurringActiveAction,
  updateBudgetAction,
  updateOneOffAction,
  updateRecurringAction,
  type CsvImportResponse,
} from "@/app/actions";
import { AnalysisTab } from "@/components/analysis-tab";
import { useCategorySuggestions } from "@/components/category-suggestions";
import { BalanceChart } from "@/components/balance-chart";
import { BrokeTraceDialog } from "@/components/broke-trace-dialog";
import { BudgetsCard, budgetsMonthLabel } from "@/components/budgets-card";
import { CsvUpload } from "@/components/csv-upload";
import {
  EntryForm,
  type EntryValues,
  emptyEntry,
} from "@/components/entry-form";
import { ItemTable, type Row } from "@/components/item-table";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MonthlyNetHover } from "@/components/monthly-breakdown";
import { OneOffTogglePanel } from "@/components/one-off-toggle-panel";
import { SettingsCard } from "@/components/settings-card";
import { SpendingPie } from "@/components/spending-pie";
import { StatCard } from "@/components/stat-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { TransactionsTable } from "@/components/transactions-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { effectiveCategory } from "@/lib/categories";
import {
  anchorAgeInDays,
  budgetPeriodOf,
  resolveAnchorDate,
} from "@/lib/period";
import {
  averageMonthlyNet,
  buildChartSeries,
  computeDailyProjection,
  computeLoanPayoffs,
  computeSummary,
  computeTrend,
  dailyActualBalances,
  debtHeadroom,
  effectiveRemaining,
  tsOf,
} from "@/lib/projection";
import type { AppState, TransactionItem } from "@/lib/types";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

interface EditState {
  variant: "recurring" | "oneoff";
  id: number;
  values: EntryValues;
}

export function Dashboard({
  initialState,
  transactions: initialTransactions,
  today,
}: {
  initialState: AppState;
  transactions: TransactionItem[];
  /** Computed on the server so SSR and the first client render agree. */
  today: string;
}) {
  const msg = useTranslations("dashboard");
  const msgCommon = useTranslations("common");
  // Same key as the browser tab, so the two names cannot drift apart.
  const msgMeta = useTranslations("meta");
  const {
    formatEuro,
    formatDate,
    formatMonthLabel,
    formatAmountInput,
    locale,
  } = useFormatters();
  const [state, setState] = React.useState<AppState>(initialState);
  const [transactions, setTransactions] = React.useState(initialTransactions);
  const [isPending, startTransition] = React.useTransition();
  const [excludedOneOffs, setExcludedOneOffs] = React.useState<Set<number>>(
    () => new Set()
  );
  const [editing, setEditing] = React.useState<EditState | null>(null);
  // Day-by-day trace of the forecast up to the first negative balance, so the
  // "Kontostand wird negativ" warning can be audited instead of trusted.
  const [showBrokeTrace, setShowBrokeTrace] = React.useState(false);
  const [deleting, setDeleting] = React.useState<{
    variant: "recurring" | "oneoff";
    id: number;
    name: string;
  } | null>(null);

  const run = React.useCallback(
    (fn: () => Promise<AppState>) => {
      startTransition(async () => {
        const next = await fn();
        setState(next);
      });
    },
    [startTransition]
  );

  const categorySuggestions = useCategorySuggestions({
    disabled: isPending,
    onApplyCategory: async (ids, expected, category) => {
      const res = await applyCategorySuggestionAction(ids, expected, category);
      setTransactions(res.transactions);
      return { applied: res.applied, skipped: res.skipped };
    },
  });

  const handleImported = React.useCallback((res: CsvImportResponse) => {
    if (res.ok) {
      setState(res.state);
      setTransactions(res.transactions);
    }
  }, []);

  // Null when the import is too short to average honestly; every consumer
  // below has to say "unknown" rather than draw a zero as if it were a fact.
  const avgNet = React.useMemo(
    () => averageMonthlyNet(transactions, today),
    [transactions, today]
  );
  const hasHistory = transactions.length > 0;
  // Day the starting balance is valid for: the newest imported transaction.
  // Without history the stored start date is always the 1st of a month, so
  // anchoring on it re-books everything already paid this month - rent and
  // salary counted twice, with no way to correct it from the settings form.
  const anchorDate = resolveAnchorDate(
    hasHistory ? transactions[0].date : null,
    state.settings.startDate,
    today
  );
  // How stale the imported history is. Everything after the anchor is drawn as
  // forecast, so a lagging import shows elapsed weeks as still ahead.
  const anchorAgeDays = hasHistory ? anchorAgeInDays(anchorDate, today) : 0;
  const anchorIsStale = anchorAgeDays > 7;
  // A hand-typed balance that no longer matches the ledger splits the Ist and
  // Prognose lines on the same day with nothing saying which one is real.
  const balanceMatchesLedger =
    !hasHistory ||
    Math.abs(state.settings.startingBalance - transactions[0].balance) < 0.005;
  const summary = React.useMemo(
    () => computeSummary(state, anchorDate),
    [state, anchorDate]
  );
  // Money already spent per category in the anchor budget period (which is
  // the calendar month for budgetStartDay 1, or e.g. 15th-to-14th), so
  // budgets only book their unspent rest for the current period. Signed:
  // discarding incoming bookings made a refund raise the reported spend
  // permanently. Salary routes to the income category, which is not
  // budgetable, so it cannot drag a category negative.
  const budgetSpent = React.useMemo(() => {
    const period = budgetPeriodOf(anchorDate, state.settings.budgetStartDay);
    const spent = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.date < period.start || transaction.date > period.end) continue;
      const cat = effectiveCategory(transaction);
      spent.set(cat, (spent.get(cat) ?? 0) + -transaction.amount);
    }
    // Clamp at the source so the budget card and the forecast agree; a
    // net-positive category has spent nothing, not a negative amount.
    for (const [k, values] of spent) if (values < 0) spent.set(k, 0);
    return spent;
  }, [transactions, anchorDate, state.settings.budgetStartDay]);

  const forecast = React.useMemo(
    () =>
      computeDailyProjection(state, {
        anchorDate,
        excludedOneOffIds: excludedOneOffs,
        budgetSpent,
      }),
    [state, anchorDate, excludedOneOffs, budgetSpent]
  );
  // Historical-average trend, shown faintly behind the plan as a reality check.
  const trend = React.useMemo(
    () =>
      avgNet !== null
        ? computeTrend(
            state.settings.startingBalance,
            anchorDate,
            state.settings.monthsAhead,
            avgNet
          )
        : undefined,
    [state.settings, anchorDate, avgNet]
  );
  const actualSeries = React.useMemo(
    () => dailyActualBalances(transactions),
    [transactions]
  );
  const series = React.useMemo(
    () => buildChartSeries(actualSeries, forecast, trend),
    [actualSeries, forecast, trend]
  );

  // Warn when the plan is far rosier (or grimmer) than the real average. With
  // no trustworthy average there is nothing to compare against, so no warning.
  const showDivergence =
    avgNet !== null &&
    (Math.abs(summary.monthlyNet - avgNet) > 100 ||
      Math.sign(summary.monthlyNet) !== Math.sign(avgNet));

  const endingBalance = forecast.length
    ? forecast[forecast.length - 1].balance
    : 0;
  const brokePoint = forecast.find((point) => point.balance < 0);

  const payoffs = React.useMemo(
    () => computeLoanPayoffs(state, anchorDate, excludedOneOffs),
    [state, anchorDate, excludedOneOffs]
  );

  // Recurring debts a one-off payment can be designated to (Sondertilgung).
  // Only expenses: a designated payment against an income would be treated by
  // the debt machinery as a balance to pay down, deleting it from the forecast.
  const debtOptions = React.useMemo(
    () =>
      state.recurring
        .filter(
          (recurring) =>
            recurring.kind === "expense" &&
            recurring.remainingAmount !== null &&
            recurring.remainingAmount > 0
        )
        .map((recurring) => ({ id: recurring.id, name: recurring.name })),
    [state.recurring]
  );
  const activeRecurring = React.useMemo(
    () =>
      state.recurring.filter(
        (recurring) => recurring.isActive && !(recurring.endDate && recurring.endDate < anchorDate)
      ),
    [state.recurring, anchorDate]
  );

  // What a payment on `date` would actually clear, for the "komplett tilgen"
  // shortcut. This asks the same walk the forecast uses instead of evaluating
  // the debt at the typed date: the two disagree whenever the payment gets
  // relocated (a date on or before the anchor moves to anchor+1), which had the
  // button offering 800 EUR where the chart booked 700.
  // `excludeOneOffId` leaves out the payment currently being edited so its own
  // amount is not deducted from the suggested maximum.
  const getDebtRemaining = React.useCallback(
    (debtId: number, date: string, excludeOneOffId?: number): number | null =>
      debtHeadroom(
        state,
        debtId,
        date,
        anchorDate,
        excludedOneOffs,
        excludeOneOffId
      ),
    [state, anchorDate, excludedOneOffs]
  );

  const toggleOneOff = React.useCallback((id: number, included: boolean) => {
    setExcludedOneOffs((prev) => {
      const next = new Set(prev);
      if (included) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function confirmDelete() {
    if (!deleting) return;
    const { variant, id } = deleting;
    run(() =>
      variant === "recurring"
        ? deleteRecurringAction(id)
        : deleteOneOffAction(id)
    );
    setDeleting(null);
  }

  function openEdit(variant: "recurring" | "oneoff", row: Row) {
    setEditing({
      variant,
      id: row.id,
      values: {
        name: row.name,
        amount: formatAmountInput(row.amount),
        kind: row.kind,
        intervalMonths: row.intervalMonths ?? 1,
        isContract: !!row.isContract,
        date: row.date || today,
        remainingAmount:
          row.remainingAmount != null && row.remainingAmount > 0
            ? formatAmountInput(row.remainingAmount)
            : "",
        endDate: row.endDate ?? "",
        debtId: row.debtId ?? null,
        category: row.category ?? "",
      },
    });
  }

  const recurringInit = React.useMemo(() => emptyEntry(today), [today]);
  const oneoffInit = React.useMemo(() => emptyEntry(today), [today]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{msgMeta("title")}</h1>
            <p className="text-sm text-muted-foreground">
              {msg("subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={msg("currentBalance")}
          value={formatEuro(state.settings.startingBalance)}
          icon={<Wallet className="h-4 w-4" />}
          note={
            hasHistory
              ? balanceMatchesLedger
                ? msg("asOf", { date: formatDate(anchorDate) })
                : msg("divergesFromLedger", {
                    balance: formatEuro(transactions[0].balance),
                    date: formatDate(anchorDate),
                  })
              : undefined
          }
          noteTone={hasHistory && !balanceMatchesLedger ? "warning" : "muted"}
        />
        <StatCard
          label={msg("incomePerMonth")}
          value={formatEuro(summary.monthlyIncome)}
          icon={<ArrowUpRight className="h-4 w-4" />}
          accent="income"
        />
        <StatCard
          label={msg("expensePerMonth")}
          value={formatEuro(summary.monthlyExpense)}
          icon={<ArrowDownRight className="h-4 w-4" />}
          accent="expense"
        />
        <StatCard
          label={msg("netPerMonth")}
          value={formatEuro(summary.monthlyNet)}
          icon={<TrendingUp className="h-4 w-4" />}
          accent={summary.monthlyNet >= 0 ? "income" : "expense"}
        />
      </section>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5">
          <TabsTrigger value="overview">{msg("tabOverview")}</TabsTrigger>
          <TabsTrigger value="monthly">{msg("tabRecurring")}</TabsTrigger>
          <TabsTrigger value="oneoff">{msg("tabOneOff")}</TabsTrigger>
          <TabsTrigger value="transactions">
            {msg("tabTransactions")}
            {transactions.length > 0 && (
              <span className="ml-1.5 hidden rounded bg-muted-foreground/15 px-1.5 text-xs tabular-nums sm:inline">
                {transactions.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="analysis">{msg("tabAnalysis")}</TabsTrigger>
        </TabsList>

        {/* ---------------------------- Overview ---------------------------- */}
        <TabsContent value="overview" className="space-y-6">
          <section>
            <SectionHeading
              title={msg("chartTitle")}
              description={hasHistory
                ? msg("chartWithHistory", {
                    from: formatMonthLabel(
                      transactions[transactions.length - 1].date
                    ),
                    months: state.settings.monthsAhead,
                  })
                : msg("chartForecastOnly", {
                    months: state.settings.monthsAhead,
                    date: formatDate(anchorDate),
                  })}
              aside={
                <div className="text-xs text-muted-foreground">
                  {msg("endingBalance")}{" "}
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      endingBalance < 0 ? "text-destructive" : "text-foreground"
                    )}
                  >
                    {formatEuro(endingBalance)}
                  </span>
                </div>
              }
            />
            <Card>
              <CardContent className="pt-6">
                <BalanceChart
                  data={series}
                  anchorTs={hasHistory ? tsOf(anchorDate) : undefined}
                  anchorLabel={msg("lastImportLabel", { date: formatDate(anchorDate) })}
                  todayTs={hasHistory ? tsOf(today) : undefined}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  {msg("chartHint")}
                  {avgNet !== null && (
                    <>
                      {msg("trendHint", { amount: formatEuro(avgNet) })}
                    </>
                  )}
                  {hasHistory && avgNet === null && (
                    <>
                      {msg("trendTooShort")}
                    </>
                  )}
                </p>
                {anchorIsStale && (
                  <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    <span className="font-medium">{msg("staleTitle")}</span>
                    {msg("staleBody", {
                      date: formatDate(anchorDate),
                      days: anchorAgeDays,
                    })}
                  </p>
                )}
                {showDivergence && (
                  <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    <span className="font-medium">{msg("realityTitle")}</span>
                    {msg("realityPlanned")}
                    <strong>
                      {msg("perMonthAmount", { amount: formatEuro(summary.monthlyNet) })}
                    </strong>
                    {msg("realityActual")}
                    <strong>
                      {msg("perMonthAmount", { amount: formatEuro(avgNet ?? 0) })}
                    </strong>
                    .{" "}
                    {summary.monthlyNet > (avgNet ?? 0)
                      ? msg("missingExpenses")
                      : msg("missingIncome")}
                  </p>
                )}
                {brokePoint && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <p>
                      {msg("goesNegative")}
                      <strong>{formatDate(brokePoint.date)}</strong>
                      {msg("goesNegativeTail", {
                        amount: formatEuro(brokePoint.balance),
                      })}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setShowBrokeTrace(true)}
                    >
                      {msg("showCalculation")}
                    </Button>
                  </div>
                )}
                {/* Mounted only while open (see the dialog note below). */}
                {showBrokeTrace && brokePoint && (
                  <BrokeTraceDialog
                    forecast={forecast}
                    brokeDate={brokePoint.date}
                    anchorDate={anchorDate}
                    startBalance={state.settings.startingBalance}
                    excludedCount={excludedOneOffs.size}
                    onClose={() => setShowBrokeTrace(false)}
                  />
                )}
                {/* Paused items are already out of the forecast; the panel only
                    offers the view-only toggle for the ones that are in it. */}
                <OneOffTogglePanel
                  items={state.oneoff.filter((oneOff) => oneOff.isActive)}
                  excluded={excludedOneOffs}
                  onToggle={toggleOneOff}
                />
              </CardContent>
            </Card>
          </section>

          <section>
            <SectionHeading
              title={msg("budgetsTitle")}
              description={msg("budgetsDescription", {
                period: budgetsMonthLabel(
                  transactions,
                  state.settings.budgetStartDay,
                  locale
                ),
              })}
            />
            <Card>
              <CardContent className="pt-6">
                <BudgetsCard
                  budgets={state.budgets}
                  transactions={transactions}
                  startDay={state.settings.budgetStartDay}
                  disabled={isPending}
                  onAdd={(category, amount) =>
                    run(() => addBudgetAction({ category, amount }))
                  }
                  onUpdate={(id, amount) =>
                    run(() => updateBudgetAction({ id, amount }))
                  }
                  onDelete={(id) => run(() => deleteBudgetAction(id))}
                />
              </CardContent>
            </Card>
          </section>

          {hasHistory && (
            <section>
              <SectionHeading
                title={msg("spendingTitle")}
                description={msg("spendingDescription")}
              />
              <Card>
                <CardContent className="pt-6">
                  <SpendingPie transactions={transactions} />
                </CardContent>
              </Card>
            </section>
          )}

          <SettingsCard
            state={state}
            run={run}
            disabled={isPending}
            hasHistory={hasHistory}
          />
        </TabsContent>

        {/* ------------------------- Recurring ------------------------------ */}
        <TabsContent value="monthly" className="space-y-6">
          <section>
            <SectionHeading
              title={msg("addRecurringTitle")}
              description={msg("addRecurringDescription")}
            />
            <Card>
              <CardContent className="pt-6">
                <EntryForm
                  variant="recurring"
                  initial={recurringInit}
                  submitLabel={msgCommon("add")}
                  disabled={isPending}
                  resetAfterSubmit
                  idPrefix="rec-add"
                  onSubmit={(values) => run(() => addRecurringAction(values))}
                />
              </CardContent>
            </Card>
          </section>

          <section>
            <SectionHeading
              title={msg("recurringTitle")}
              description={
                <>

                  {msg("recurringAverage")}
                  <MonthlyNetHover items={activeRecurring} budgets={state.budgets}>
                    {formatEuro(summary.monthlyNet)}
                  </MonthlyNetHover>
                  {msg("recurringPausedNote")}
                </>
              }
            />
            <Card>
              <CardContent className="pt-6">
                <ItemTable
                  empty={msg("recurringEmpty")}
                  rows={state.recurring.map((item) => ({
                    id: item.id,
                    name: item.name,
                    kind: item.kind,
                    amount: item.amount,
                    date: item.date,
                    intervalMonths: item.intervalMonths,
                    isContract: item.isContract,
                    // Without the one-off list, matching the walk the chart and
                    // the payoff card use: a designated payment is a planned
                    // booking applied on its due day, not something already
                    // deducted from the balance shown here.
                    remainingAmount: effectiveRemaining(item, anchorDate),
                    endDate: item.endDate,
                    isActive: item.isActive,
                    category: item.category,
                  }))}
                  payoffs={payoffs}
                  onDelete={(row) =>
                    setDeleting({ variant: "recurring", id: row.id, name: row.name })
                  }
                  onEdit={(row) => openEdit("recurring", row)}
                  onToggleActive={(row, active) =>
                    run(() => toggleRecurringActiveAction(row.id, active))
                  }
                  disabled={isPending}
                  showDate
                  showInterval
                  totals={{
                    income: summary.monthlyIncome,
                    expense: summary.monthlyExpense,
                  }}
                  totalsCell={
                    <MonthlyNetHover items={activeRecurring} budgets={state.budgets}>
                      {formatEuro(summary.monthlyNet)}
                    </MonthlyNetHover>
                  }
                />
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        {/* -------------------------- One-off ------------------------------- */}
        <TabsContent value="oneoff" className="space-y-6">
          <section>
            <SectionHeading
              title={msg("addOneOffTitle")}
              description={msg("addOneOffDescription")}
            />
            <Card>
              <CardContent className="pt-6">
                <EntryForm
                  variant="oneoff"
                  initial={oneoffInit}
                  submitLabel={msgCommon("add")}
                  disabled={isPending}
                  resetAfterSubmit
                  idPrefix="one-add"
                  debtOptions={debtOptions}
                  getDebtRemaining={getDebtRemaining}
                  onSubmit={(values) =>
                    run(() =>
                      addOneOffAction({
                        name: values.name,
                        amount: values.amount,
                        kind: values.kind,
                        date: values.date,
                        isContract: values.isContract,
                        debtId: values.debtId,
                      })
                    )
                  }
                />
              </CardContent>
            </Card>
          </section>

          <section>
            <SectionHeading
              title={msg("oneOffTitle")}
            />
            <Card>
              <CardContent className="pt-6">
                <ItemTable
                  empty={msg("oneOffEmpty")}
                  rows={state.oneoff.map((item) => ({
                    id: item.id,
                    name: item.name,
                    kind: item.kind,
                    amount: item.amount,
                    date: item.date,
                    isContract: item.isContract,
                    isActive: item.isActive,
                    debtId: item.debtId,
                    debtLabel:
                      item.debtId !== null
                        ? state.recurring.find((recurring) => recurring.id === item.debtId)?.name ??
                          null
                        : null,
                  }))}
                  onDelete={(row) =>
                    setDeleting({ variant: "oneoff", id: row.id, name: row.name })
                  }
                  onEdit={(row) => openEdit("oneoff", row)}
                  onToggleActive={(row, active) =>
                    run(() => toggleOneOffActiveAction(row.id, active))
                  }
                  disabled={isPending}
                  showDate
                />
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        {/* --------------------------- Transactions ------------------------- */}
        <TabsContent value="transactions" className="space-y-6">
          <section>
            <SectionHeading
              title={msg("transactionsTitle")}
              description={transactions.length > 0
                ? msg("transactionsCount", {
                    count: transactions.length,
                    from: formatDate(
                      transactions[transactions.length - 1].date
                    ),
                    to: formatDate(transactions[0].date),
                  })
                : msg("transactionsEmpty")}
              aside={
                <CsvUpload onImported={handleImported} />
              }
            />
            <Card>
              <CardContent className="pt-6 space-y-4">
                {categorySuggestions.panel}
                {transactions.length > 0 ? (
                  <TransactionsTable
                    action={categorySuggestions.trigger}
                    transactions={transactions}
                    onAssignCategory={(ids, category) =>
                      startTransition(async () => {
                        const res = await setTransactionCategoryAction(ids, category);
                        setTransactions(res.transactions);
                      })
                    }
                    onAddTag={(ids, tag) =>
                      startTransition(async () => {
                        const res = await addTransactionTagAction(ids, tag);
                        setTransactions(res.transactions);
                      })
                    }
                    onRemoveTag={(ids, tag) =>
                      startTransition(async () => {
                        const res = await removeTransactionTagAction(ids, tag);
                        setTransactions(res.transactions);
                      })
                    }
                  />
                ) : (
                  <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                    {msg("noImportedData")}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        {/* --------------------------- Claude analysis ---------------------- */}
        <TabsContent value="analysis" className="space-y-6">
          <AnalysisTab disabled={isPending} />
        </TabsContent>
      </Tabs>

      {/* ------------------------------- Edit dialog ---------------------- */}
      {/* Mounted only while open. Toggling `open` on a permanently mounted
          Dialog relies on Radix unmounting the portal when the exit animation
          ends; when that event does not arrive the overlay stays behind and
          blocks every click on the page until a reload. */}
      {editing !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{msg("editTitle")}</DialogTitle>
              <DialogDescription>
                {msg("editDescription")}
              </DialogDescription>
            </DialogHeader>
            {editing && (
              <EntryForm
                variant={editing.variant}
                initial={editing.values}
                submitLabel={msgCommon("save")}
                submitIcon="save"
                disabled={isPending}
                idPrefix="edit"
                debtOptions={editing.variant === "oneoff" ? debtOptions : undefined}
                getDebtRemaining={
                  editing.variant === "oneoff"
                    ? (debtId, date) => getDebtRemaining(debtId, date, editing.id)
                    : undefined
                }
                onSubmit={(values) => {
                  if (editing.variant === "recurring") {
                    run(() => updateRecurringAction({ id: editing.id, ...values }));
                  } else {
                    run(() =>
                      updateOneOffAction({
                        id: editing.id,
                        name: values.name,
                        amount: values.amount,
                        kind: values.kind,
                        date: values.date,
                        isContract: values.isContract,
                        debtId: values.debtId,
                      })
                    );
                  }
                  setEditing(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* ---------------------------- Delete confirm ---------------------- */}
      {/* Mounted only while open. Toggling `open` on a permanently mounted
          Dialog relies on Radix unmounting the portal when the exit animation
          ends; when that event does not arrive the overlay stays behind and
          blocks every click on the page until a reload. */}
      {deleting !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{msg("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {msg("deleteDescription", { name: deleting?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {msgCommon("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={isPending}
              >
                <Trash2 className="h-4 w-4" />
                {msgCommon("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
