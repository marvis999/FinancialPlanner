"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ALL_CATEGORIES } from "@/lib/categories";
import type { Kind } from "@/lib/types";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { todayIso } from "@/lib/utils";

/** The intervals a recurring item can run at; names come from the catalogue. */
export const INTERVAL_VALUES = [1, 3, 6, 12] as const;

/** Long names for the interval select. */
export function useIntervalOptions(): { value: number; label: string }[] {
  const msg = useTranslations("interval");
  return React.useMemo(
    () => [
      { value: 1, label: msg("monthly") },
      { value: 3, label: msg("quarterly") },
      { value: 6, label: msg("halfYearly") },
      { value: 12, label: msg("yearly") },
    ],
    [msg]
  );
}

/** Short form for tables, e.g. "vierteljährl.". */
export function useIntervalShort(): (months: number) => string {
  const msg = useTranslations("interval");
  return React.useCallback(
    (months: number) => {
      if (months === 1) return msg("shortMonthly");
      if (months === 3) return msg("shortQuarterly");
      if (months === 6) return msg("shortHalfYearly");
      if (months === 12) return msg("shortYearly");
      return msg("shortEveryNMonths", { count: months });
    },
    [msg]
  );
}

export interface EntryValues {
  name: string;
  amount: string; // raw input string
  kind: Kind;
  intervalMonths: number;
  isContract: boolean;
  date: string;
  /** Remaining amount owed as raw input; empty = runs indefinitely. */
  remainingAmount: string;
  /** Last day the contract runs; empty = open-ended. */
  endDate: string;
  /** One-off only: recurring debt this payment pays down (Sondertilgung). */
  debtId: number | null;
  /** Recurring expenses only: budget category, "" = covered by no budget. */
  category: string;
}

export interface EntrySubmit {
  name: string;
  amount: number;
  kind: Kind;
  intervalMonths: number;
  isContract: boolean;
  date: string;
  remainingAmount: number | null;
  endDate: string | null;
  debtId: number | null;
  category: string | null;
}

/** A recurring debt offered as Sondertilgung target. */
export interface DebtOption {
  id: number;
  name: string;
}

// Re-exported so the existing importers keep working; there must be exactly
// one definition, or two same-named exports disagree for two hours a day.
export { todayIso };

/**
 * `today` is passed in rather than read from the clock: emptyEntry() runs
 * during server rendering too, and a server in Europe/Berlin against a browser
 * in another zone would put two different dates in the initial HTML and the
 * first client render - a hydration mismatch.
 */
export function emptyEntry(today: string = todayIso()): EntryValues {
  return {
    name: "",
    amount: "",
    kind: "expense",
    intervalMonths: 1,
    isContract: false,
    date: today,
    remainingAmount: "",
    endDate: "",
    debtId: null,
    category: "",
  };
}

/** Radix Select forbids "" as an item value, so null needs a stand-in. */
const NO_CATEGORY = "__none__";

/** Takes the locale-bound parser: "3.850" is 3850 in German, 3.85 in English. */
function parseAmount(
  value: string,
  parse: (raw: string) => number | null
): number | null {
  const parsed = parse(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

export function EntryForm({
  variant,
  initial,
  submitLabel,
  submitIcon = "add",
  disabled,
  resetAfterSubmit,
  onSubmit,
  idPrefix,
  debtOptions,
  getDebtRemaining,
}: {
  variant: "recurring" | "oneoff";
  initial: EntryValues;
  submitLabel: string;
  submitIcon?: "add" | "save";
  disabled?: boolean;
  resetAfterSubmit?: boolean;
  onSubmit: (values: EntrySubmit) => void;
  idPrefix: string;
  /** One-off only: recurring debts a payment can be designated to. */
  debtOptions?: DebtOption[];
  /** Restschuld of a debt as of the given day (for "pay off in full"). */
  getDebtRemaining?: (debtId: number, date: string) => number | null;
}) {
  const msg = useTranslations("entryForm");
  const msgCommon = useTranslations("common");
  const intervalOptions = useIntervalOptions();
  const categoryLabel = useCategoryLabel();
  const { formatEuro, formatAmountInput, parseAmountInput } = useFormatters();
  const [values, setValues] = React.useState<EntryValues>(initial);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed when editing a different item.
  React.useEffect(() => {
    setValues(initial);
    setError(null);
  }, [initial]);

  const set = <K extends keyof EntryValues>(key: K, val: EntryValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  const parsedAmount = parseAmount(values.amount, parseAmountInput);
  const amountInvalid =
    values.amount.trim() !== "" && (parsedAmount === null || parsedAmount <= 0);
  const remainingInvalid =
    values.remainingAmount.trim() !== "" && parseAmount(values.remainingAmount, parseAmountInput) === null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!values.name.trim()) {
      setError(msg("errorName"));
      return;
    }
    const amount = parseAmount(values.amount, parseAmountInput);
    if (amount === null) {
      setError(msg("errorAmount"));
      return;
    }
    // 0 is not a harmless no-op: a recurring item with amount 0 never pays its
    // Restschuld down, so the forecast books an endless run of 0,00 EUR events
    // and the debt never reports a payoff date.
    if (amount <= 0) {
      setError(msg("errorAmountPositive"));
      return;
    }
    if (!values.date) {
      setError(msg("errorDate"));
      return;
    }
    let remainingAmount: number | null = null;
    if (variant === "recurring" && values.remainingAmount.trim() !== "") {
      remainingAmount = parseAmount(values.remainingAmount, parseAmountInput);
      if (remainingAmount === null) {
        setError(msg("errorRemaining"));
        return;
      }
    }
    if (variant === "recurring" && values.endDate && values.endDate < values.date) {
      setError(msg("errorEndBeforeDate"));
      return;
    }
    setError(null);
    onSubmit({
      name: values.name.trim(),
      amount,
      kind: values.kind,
      intervalMonths: values.intervalMonths,
      isContract: values.isContract,
      date: values.date,
      remainingAmount,
      endDate: variant === "recurring" && values.endDate ? values.endDate : null,
      debtId: values.kind === "expense" ? values.debtId : null,
      category:
        variant === "recurring" && values.kind === "expense" && values.category
          ? values.category
          : null,
    });
    if (resetAfterSubmit) setValues(initial);
  }

  const showDebtSelect =
    variant === "oneoff" && values.kind === "expense" && !!debtOptions?.length;

  // Restschuld of the selected debt on the payment day — installments and
  // other designated payments due until then are already deducted.
  const selectedDebtRemaining =
    showDebtSelect && values.debtId !== null && getDebtRemaining
      ? getDebtRemaining(values.debtId, values.date || todayIso())
      : null;

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>{msgCommon("name")}</Label>
        <Input
          id={`${idPrefix}-name`}
          placeholder={msg("namePlaceholder")}
          value={values.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-amount`}>{msgCommon("amount")}</Label>
        <CurrencyInput
          id={`${idPrefix}-amount`}
          value={values.amount}
          aria-invalid={amountInvalid}
          onChange={(val) => set("amount", val)}
          className={amountInvalid ? "border-destructive focus-visible:ring-destructive" : undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{msgCommon("kind")}</Label>
        <Select value={values.kind} onValueChange={(val) => set("kind", val as Kind)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="expense">{msgCommon("expense")}</SelectItem>
            <SelectItem value="income">{msgCommon("income")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {variant === "recurring" && (
        <div className="space-y-1.5">
          <Label>{msgCommon("interval")}</Label>
          <Select
            value={String(values.intervalMonths)}
            onValueChange={(val) => set("intervalMonths", Number(val))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {intervalOptions.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-date`}>
          {variant === "recurring" ? msg("nextPayment") : msgCommon("date")}
        </Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          value={values.date}
          onChange={(event) => set("date", event.target.value)}
        />
      </div>
      {showDebtSelect && (
        <div className="space-y-1.5">
          <Label>{msg("payOffDebt")}</Label>
          <Select
            value={values.debtId === null ? "none" : String(values.debtId)}
            onValueChange={(val) =>
              set("debtId", val === "none" ? null : Number(val))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{msgCommon("none")}</SelectItem>
              {debtOptions!.map((debt) => (
                <SelectItem key={debt.id} value={String(debt.id)}>
                  {debt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedDebtRemaining !== null && selectedDebtRemaining > 0 ? (
            <button
              type="button"
              onClick={() =>
                set("amount", formatAmountInput(selectedDebtRemaining))
              }
              className="text-[11px] leading-snug text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
            >
              {msg("payOffFully", { amount: formatEuro(selectedDebtRemaining) })}
            </button>
          ) : (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {selectedDebtRemaining !== null && selectedDebtRemaining <= 0
                ? msg("debtSettled")
                : msg("debtHint")}
            </p>
          )}
        </div>
      )}
      {variant === "recurring" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-remaining`}>{msg("remaining")}</Label>
          <CurrencyInput
            id={`${idPrefix}-remaining`}
              value={values.remainingAmount}
            aria-invalid={remainingInvalid}
            onChange={(val) => set("remainingAmount", val)}
            className={remainingInvalid ? "border-destructive focus-visible:ring-destructive" : undefined}
          />
        </div>
      )}
      {variant === "recurring" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-end`}>{msg("contractEnd")}</Label>
          <Input
            id={`${idPrefix}-end`}
            type="date"
            value={values.endDate}
            onChange={(event) => set("endDate", event.target.value)}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            {msg("contractEndHint")}
          </p>
        </div>
      )}
      {variant === "recurring" && values.kind === "expense" && (
        <div className="space-y-1.5">
          <Label>{msg("category")}</Label>
          <Select
            value={values.category || NO_CATEGORY}
            onValueChange={(val) =>
              set("category", val === NO_CATEGORY ? "" : val)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CATEGORY}>{msgCommon("none")}</SelectItem>
              {ALL_CATEGORIES.map((category) => (
                <SelectItem key={category.key} value={category.key}>
                  {categoryLabel(category.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {msg("categoryHint")}
          </p>
        </div>
      )}
      <div className="space-y-1.5 self-start">
        <Label className="invisible select-none" aria-hidden>
          {msgCommon("contract")}
        </Label>
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
          <Switch
            checked={values.isContract}
            onCheckedChange={(category) => set("isContract", category)}
          />
          {msgCommon("contract")}
        </label>
      </div>
      <div className="sm:col-span-2 sm:flex sm:items-center sm:justify-end sm:gap-4">
        {error && (
          <p className="text-sm text-destructive sm:mr-auto" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={disabled} className="w-full sm:w-auto">
          {submitIcon === "save" ? (
            <Save className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
