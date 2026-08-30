"use client";

import * as React from "react";
import { useLocale } from "next-intl";

import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale";
import {
  formatAmountInput,
  formatDate,
  formatEuro,
  formatMonthLabel,
  formatPercent,
  parseAmountInput,
} from "./utils";

/**
 * The formatters of lib/utils, bound to the interface language.
 *
 * A module-level "current locale" would have been fewer edits, but every one
 * of these call sites lives in a client component that Next also renders on
 * the server: a global set only in the browser makes the server emit German
 * markup that the client immediately rewrites, which React reports as a
 * hydration error. Taking the locale from the provider keeps both renders
 * agreeing on one value.
 */
export interface Formatters {
  locale: Locale;
  formatEuro: (value: number) => string;
  formatDate: (date: string | Date) => string;
  formatMonthLabel: (date: string | Date) => string;
  formatAmountInput: (value: number) => string;
  formatPercent: (value: number, digits?: number) => string;
  parseAmountInput: (raw: string) => number | null;
}

export function useFormatters(): Formatters {
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return React.useMemo(
    () => ({
      locale,
      formatEuro: (value) => formatEuro(value, locale),
      formatDate: (date) => formatDate(date, locale),
      formatMonthLabel: (date) => formatMonthLabel(date, locale),
      formatAmountInput: (value) => formatAmountInput(value, locale),
      formatPercent: (value, digits) => formatPercent(value, locale, digits),
      parseAmountInput: (input) => parseAmountInput(input, locale),
    }),
    [locale]
  );
}

/** The active interface language inside a client component. */
export function useAppLocale(): Locale {
  const raw = useLocale();
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}
