import { describe, expect, it } from "vitest";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import { LOCALES } from "@/lib/locale";

type Catalogue = Record<string, Record<string, string>>;

const CATALOGUES: Record<string, Catalogue> = {
  de: de as Catalogue,
  en: en as Catalogue,
};

/** "budgets.spentOf" for every message in a catalogue. */
function paths(cat: Catalogue): string[] {
  return Object.entries(cat)
    .flatMap(([ns, entries]) => Object.keys(entries).map((k) => `${ns}.${k}`))
    .sort();
}

/**
 * The distinct arguments a message consumes: {amount}, {count, plural…}.
 *
 * Distinct, not every occurrence: German needs "{n, plural, one {wird} other
 * {werden}}" where English just writes "will be", so the same argument is
 * legitimately used twice in one language and once in another. What has to
 * match is WHICH values the message needs, not how often it reads them.
 */
function placeholders(template: string): string[] {
  // Drop the plural branches first: "one {wird} other {werden}" holds text,
  // not arguments, and reads as two placeholders to a naive scan.
  const bare = template.replace(
    /\b(zero|one|two|few|many|other|=\d+)\s*\{[^{}]*\}/g,
    ""
  );
  const names = [...bare.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

const german = paths(de as Catalogue);

describe("message catalogues", () => {
  it("covers every locale the switcher offers", () => {
    for (const locale of LOCALES) {
      expect(CATALOGUES[locale], `no catalogue for "${locale}"`).toBeDefined();
    }
  });

  /*
   * German is the source language and the TypeScript key space (global.d.ts),
   * so a key missing from de.json is already a compile error. A key missing
   * from en.json is not: next-intl falls back to rendering the key itself, so
   * an English user reads "budgets.spentOf" on the page. Only a test catches
   * that.
   */
  it("gives every German message a translation in every other locale", () => {
    for (const locale of LOCALES) {
      if (locale === "de") continue;
      const theirs = new Set(paths(CATALOGUES[locale]));
      const missing = german.filter((p) => !theirs.has(p));
      expect(missing, `missing from ${locale}.json`).toEqual([]);
    }
  });

  it("has no messages the source language does not define", () => {
    const source = new Set(german);
    for (const locale of LOCALES) {
      if (locale === "de") continue;
      const extra = paths(CATALOGUES[locale]).filter((p) => !source.has(p));
      expect(extra, `not in de.json, so never rendered`).toEqual([]);
    }
  });

  /*
   * A translation that drops {amount} loses the number silently, and one that
   * renames it throws at render time (next-intl reports a missing value).
   */
  it("keeps the same placeholders in every translation", () => {
    for (const locale of LOCALES) {
      if (locale === "de") continue;
      const cat = CATALOGUES[locale];
      for (const [ns, entries] of Object.entries(de as Catalogue)) {
        for (const [key, template] of Object.entries(entries)) {
          const theirs = cat[ns]?.[key];
          if (theirs === undefined) continue; // reported by the test above
          expect(placeholders(theirs), `${ns}.${key} in ${locale}.json`).toEqual(
            placeholders(template)
          );
        }
      }
    }
  });

  it("has no empty messages", () => {
    for (const [locale, cat] of Object.entries(CATALOGUES)) {
      for (const [ns, entries] of Object.entries(cat)) {
        for (const [key, value] of Object.entries(entries)) {
          expect(value.trim(), `${ns}.${key} in ${locale}.json`).not.toBe("");
        }
      }
    }
  });
});
