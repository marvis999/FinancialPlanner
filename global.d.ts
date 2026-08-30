import type de from "./messages/de.json";
import type { LOCALES } from "./lib/locale";

/**
 * German is the source language, so its catalogue defines the key space:
 * `t("budgets.titel")` is a compile error, not a string that quietly renders
 * as its own key at runtime. tests/messages.test.ts checks the other
 * catalogues against it, which types alone cannot do.
 */
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof de;
    Locale: (typeof LOCALES)[number];
  }
}
