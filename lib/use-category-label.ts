"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { OTHER_CATEGORY } from "./categories";

/**
 * Display names for the spending categories.
 *
 * The keys in lib/categories.ts are stable identifiers and never change; the
 * name shown next to them is a translated default. When categories become
 * user-editable, a name the user has set overrides the translation and this
 * is the one place that has to learn about it - which is why every caller
 * goes through here instead of reading `Category.label`.
 *
 * Written out key by key rather than looped: the catalogue is typed, so a
 * category added without a translation fails to compile.
 */
export function useCategoryLabels(): Record<string, string> {
  const msg = useTranslations("categories");
  return React.useMemo(
    () => ({
      kredite: msg("kredite"),
      versicherungen: msg("versicherungen"),
      wohnen: msg("wohnen"),
      telefon: msg("telefon"),
      tanken: msg("tanken"),
      lebensmittel: msg("lebensmittel"),
      bargeld: msg("bargeld"),
      shopping: msg("shopping"),
      sonstiges: msg("sonstiges"),
      einkommen: msg("einkommen"),
    }),
    [msg]
  );
}

/** Look up one category's display name; an unknown key reads as "Sonstiges". */
export function useCategoryLabel(): (key: string) => string {
  const labels = useCategoryLabels();
  return React.useCallback(
    (key: string) => labels[key] ?? labels[OTHER_CATEGORY.key],
    [labels]
  );
}
