"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { updateSettingsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppState } from "@/lib/types";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

export function SettingsCard({
  state,
  run,
  disabled,
  hasHistory,
}: {
  state: AppState;
  run: (fn: () => Promise<AppState>) => void;
  disabled: boolean;
  /** With imported bookings the anchor is the last import, so the
   *  "forecast from" date is irrelevant and hidden rather than greyed-out. */
  hasHistory: boolean;
}) {
  const msg = useTranslations("dashboard");
  const msgCommon = useTranslations("common");
  const { formatAmountInput, parseAmountInput } = useFormatters();
  const [balance, setBalance] = React.useState(() =>
    formatAmountInput(state.settings.startingBalance)
  );
  // A full day, not a month: anchoring on the 1st re-books everything already
  // paid this month.
  const [startDate, setStartDate] = React.useState(state.settings.startDate);
  const [months, setMonths] = React.useState(String(state.settings.monthsAhead));
  const [budgetDay, setBudgetDay] = React.useState(
    String(state.settings.budgetStartDay)
  );

  React.useEffect(() => {
    setBalance(formatAmountInput(state.settings.startingBalance));
    setStartDate(state.settings.startDate);
    setMonths(String(state.settings.monthsAhead));
    setBudgetDay(String(state.settings.budgetStartDay));
    // Deliberately keyed on state.settings alone: re-running this when the
    // formatter identity changes would overwrite what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);

  function save(event: React.FormEvent) {
    event.preventDefault();
    const parsedBalance = parseAmountInput(balance);
    const parsedMonths = Number(months);
    const parsedBudgetDay = Number(budgetDay);
    run(() =>
      updateSettingsAction({
        startingBalance: parsedBalance ?? 0,
        startDate: startDate || state.settings.startDate,
        monthsAhead: Number.isFinite(parsedMonths) ? parsedMonths : 24,
        budgetStartDay: Number.isFinite(parsedBudgetDay) ? parsedBudgetDay : 1,
      })
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{msg("settingsTitle")}</CardTitle>
        <CardDescription>
          {msg("settingsDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={save}
          className={cn(
            "grid grid-cols-1 gap-3",
            hasHistory
              ? "sm:grid-cols-[1fr_1fr_1fr_auto]"
              : "sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          )}
        >
          <div className="space-y-1.5">
            <Label htmlFor="set-balance">{msg("currentBalance")}</Label>
            <CurrencyInput
              id="set-balance"
              value={balance}
              onChange={setBalance}
            />
          </div>
          {/* With bookings the forecast anchors on the last import; the date
              would be dead weight, so it is hidden (saving keeps the stored
              value untouched). */}
          {!hasHistory && (
            <div className="space-y-1.5">
              <Label htmlFor="set-start">{msg("forecastFrom")}</Label>
              <Input
                id="set-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                {msg("startDateHint")}
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="set-months">{msg("monthsAhead")}</Label>
            <Input
              id="set-months"
              type="number"
              min="1"
              max="600"
              step="1"
              value={months}
              onChange={(event) => setMonths(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-budget-day">{msg("budgetStartDay")}</Label>
            <Input
              id="set-budget-day"
              type="number"
              min="1"
              max="28"
              step="1"
              value={budgetDay}
              onChange={(event) => setBudgetDay(event.target.value)}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              {msg("budgetStartDayHint")}
            </p>
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              variant="secondary"
              disabled={disabled}
              className="w-full sm:w-auto"
            >
              {msgCommon("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
