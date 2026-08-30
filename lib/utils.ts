import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { DEFAULT_LOCALE, intlLocale, type Locale } from "./locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Intl objects are expensive to build and these run per table row, so one
 * instance is kept per locale and kind rather than per call. Two locales and
 * four kinds: the cache never grows past eight entries.
 */
const formatterCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(
  key: string,
  build: () => T
): T {
  const hit = formatterCache.get(key);
  if (hit) return hit as T;
  const made = build();
  formatterCache.set(key, made);
  return made;
}

/** Format a number as a EUR amount, e.g. 1234.5 -> "1.234,50 €" in German. */
export function formatEuro(value: number, locale: Locale = DEFAULT_LOCALE): string {
  const tag = intlLocale(locale);
  return cached(
    `euro:${tag}`,
    () => new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" })
  ).format(value) as string;
}

/**
 * Local calendar day of a Date, as "YYYY-MM-DD". toISOString() would give the
 * UTC day, which in Germany is the PREVIOUS day between midnight and 02:00 -
 * long enough for a Restschuld entered just after midnight to be stamped with
 * yesterday and have an extra installment deducted from it.
 */
export function localIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today as "YYYY-MM-DD" in the local timezone. The one definition. */
export function todayIso(): string {
  return localIso();
}

/** Parse a date-only string ("YYYY-MM-DD"/"YYYY-MM") as LOCAL midnight so the
 *  displayed day/month never shifts in negative-UTC timezones. Null when the
 *  string is not a real date, so the formatters can print a dash instead of
 *  throwing RangeError mid-render. */
function toLocalDate(date: string | Date): Date | null {
  if (date instanceof Date) return Number.isNaN(date.getTime()) ? null : date;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(date)) {
    const iso = date.length === 7 ? `${date}-01` : date;
    const d = new Date(`${iso}T00:00:00`);
    // Rejects 2026-02-31, which JS would otherwise roll over to 03.03.
    return Number.isNaN(d.getTime()) || localIso(d) !== iso ? null : d;
  }
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format an ISO date (or Date) as a short month label, e.g. "Aug. 26". */
export function formatMonthLabel(
  date: string | Date,
  locale: Locale = DEFAULT_LOCALE
): string {
  const d = toLocalDate(date);
  if (!d) return "—";
  const tag = intlLocale(locale);
  return cached(
    `month:${tag}`,
    () => new Intl.DateTimeFormat(tag, { month: "short", year: "2-digit" })
  ).format(d) as string;
}

/** Format an ISO date as a full date, e.g. "18.08.2026" in German. */
export function formatDate(
  date: string | Date,
  locale: Locale = DEFAULT_LOCALE
): string {
  const d = toLocalDate(date);
  if (!d) return "—";
  const tag = intlLocale(locale);
  return cached(
    `date:${tag}`,
    () => new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric" })
  ).format(d) as string;
}

/** Format a percentage, e.g. 37.6 -> "37,6" in German and "37.6" in English. */
export function formatPercent(
  value: number,
  locale: Locale = DEFAULT_LOCALE,
  digits = 1
): string {
  const tag = intlLocale(locale);
  return cached(
    `pct:${tag}:${digits}`,
    () =>
      new Intl.NumberFormat(tag, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
  ).format(value) as string;
}

/** Format a number for an amount input field, e.g. 3850.66 -> "3.850,66". */
export function formatAmountInput(
  value: number,
  locale: Locale = DEFAULT_LOCALE
): string {
  const tag = intlLocale(locale);
  return cached(
    `amount:${tag}`,
    () =>
      new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  ).format(value) as string;
}

/**
 * Parse a user-entered amount that may use German or English number formats:
 * "12,50" -> 12.5, "1.234,56" -> 1234.56, "12.50" -> 12.5, "1,234.56" -> 1234.56.
 * Returns null if the input isn't a finite number.
 *
 * `locale` only decides the one genuinely ambiguous shape, "3.850": German
 * thousands (3850) or an English amount with three decimals (3.85 rounded).
 * Everything else is unambiguous and parses the same either way, so a German
 * user pasting an English figure still gets the right number.
 */
export function parseAmountInput(
  raw: string,
  locale: Locale = DEFAULT_LOCALE
): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Whichever separator comes last is the decimal separator.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    // A lone comma is a decimal point in German and a thousands separator in
    // English: "1,234" is 1,234 there and 1234 here.
    s = locale === "de" ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (hasDot && locale === "de" && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    // German thousands separators without decimals: "3.850" means 3850.
    s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
