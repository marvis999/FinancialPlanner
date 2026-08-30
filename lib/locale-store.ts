import "server-only";

import { readPreference, writePreference } from "./data-dir";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale";

/**
 * The interface language, stored next to the databases.
 *
 * A file rather than a row in `settings`: `i18n/request.ts` resolves the
 * locale for every route, including the ones Next prerenders at build time,
 * and opening SQLite there would create a database inside the build image.
 *
 * Read on every call, never memoised - the same lesson as the data source:
 * a server action and a server component get their own copy of this module,
 * so a cached value has one of them serving the previous language.
 */
const LOCALE_FILE = "language";

export function activeLocale(): Locale {
  const raw = readPreference(LOCALE_FILE);
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export function setActiveLocale(locale: Locale): Locale {
  writePreference(LOCALE_FILE, locale);
  return locale;
}
