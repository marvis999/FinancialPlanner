/**
 * The languages the interface is available in.
 *
 * Deliberately free of server-only imports: the language switcher renders on
 * the client and needs the same list the server resolves messages from.
 */

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
