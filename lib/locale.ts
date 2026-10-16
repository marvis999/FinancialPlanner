/**
 * The languages the interface is available in.
 *
 * Deliberately free of server-only imports: the language switcher renders on
 * the client and needs the same list the server resolves messages from.
 */

import type { Formats } from "next-intl";

export const LOCALES = ["de", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** German is the source language: every message is written here first. */
export const DEFAULT_LOCALE: Locale = "de";

/** Endonyms - a language is named in itself, not in the current interface. */
export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The BCP-47 tag each interface language formats numbers and dates with.
 *
 * "en" resolves to en-GB, not en-US: this is a euro account kept in Europe,
 * and 08/18/2026 for a booking on the 18th is a misreading waiting to happen
 * next to amounts that are unambiguously European. Change it here if the
 * English interface should ever read American.
 */
export const INTL_LOCALES: Record<Locale, string> = {
  de: "de-DE",
  en: "en-GB",
};

export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale] ?? INTL_LOCALES[DEFAULT_LOCALE];
}

/**
 * The named formats every message and formatter refers to. Here rather than in
 * i18n/request.ts so the static demo, which has no request config, provides
 * the same ones on the client.
 *
 * The ledger is a euro account whatever the interface language is; only the
 * way the number is written follows the locale.
 */
export const INTL_FORMATS: Formats = {
  number: {
    euro: { style: "currency", currency: "EUR" },
    amountInput: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  },
  dateTime: {
    day: { day: "2-digit", month: "2-digit", year: "numeric" },
    monthLabel: { month: "short", year: "2-digit" },
  },
};
