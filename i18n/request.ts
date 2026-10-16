import { getRequestConfig } from "next-intl/server";

import { activeLocale } from "@/lib/locale-store";
import { DEFAULT_LOCALE, INTL_FORMATS } from "@/lib/locale";

/**
 * There is one route, so there is no locale in the URL: the language is a
 * stored preference, resolved per request the same way the data source is.
 *
 * The read is wrapped because this also runs while Next prerenders the static
 * routes, where DATA_DIR may not exist yet - a build must not fail over a
 * missing preference file.
 */
export default getRequestConfig(async () => {
  let locale = DEFAULT_LOCALE;
  try {
    locale = activeLocale();
  } catch {
    // keep the default
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    formats: INTL_FORMATS,
  };
});
