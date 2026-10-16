import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/locale";

/**
 * The demo's language, kept in localStorage instead of the server's
 * preference file. The language switcher reloads after switching, so the
 * choice has to outlive the page; the edits made in the demo do not.
 *
 * Storage can be missing or blocked, e.g. in a cross-site iframe; the demo
 * then stays German.
 */
const LOCALE_KEY = "financial-planner-demo-locale";

export function readDemoLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function writeDemoLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // not remembered; the reload falls back to German
  }
}
