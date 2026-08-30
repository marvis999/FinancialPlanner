import { describe, expect, it } from "vitest";

import {
  ALL_CATEGORIES,
  CATEGORIES,
  categorize,
  categoryByKey,
  effectiveCategory,
  INCOME_CATEGORY,
  OTHER_CATEGORY,
} from "../lib/categories";

describe("the keyword lists stay publishable", () => {
  const everyPattern = [...CATEGORIES, INCOME_CATEGORY].flatMap((c) => c.patterns);

  /*
   * This file used to carry a creditor number and two cash-machine location
   * fragments lifted straight off one person's statements. They matched
   * exactly one household, were worthless to anyone else, and shipped to
   * everyone who cloned the repository. These two rules catch that shape of
   * mistake mechanically; the judgement of "is this keyword public" still
   * belongs to whoever adds it.
   */

  it("has no contract, customer or account numbers", () => {
    for (const p of everyPattern) {
      expect(p, `"${p}" looks like an identifier, not a keyword`).not.toMatch(/^[\d\s-]+$/);
      expect(p, `"${p}" embeds a long number`).not.toMatch(/\d{5}/);
    }
  });

  it("has no card-terminal location fragments", () => {
    // Card bookings carry "TERMINAL//TOWN-DISTRICT/DE". Lifting one into a
    // pattern encodes where somebody actually shops.
    for (const p of everyPattern) {
      expect(p, `"${p}" is a booking-text location, not a merchant`).not.toContain("//");
    }
  });
});

describe("categorize", () => {
  it("matches name and purpose case-insensitively", () => {
    expect(categorize({ name: "LIDL SAGT DANKE", purpose: "" })).toBe("lebensmittel");
    expect(categorize({ name: "X", purpose: "Ihr Einkauf bei Netflix.com" })).toBe("telefon");
  });

  it("earlier categories win (specificity-first ordering)", () => {
    // telefon (index 3) beats shopping (index 7): the purpose matches
    // "alditalk", the payer matches "paypal". The grocery patterns are
    // "aldi sagt"/"aldi nord"/"aldi sued" and cannot match here at all.
    expect(
      categorize({ name: "PAYPAL", purpose: "AldiTalk, Ihr Einkauf bei AldiTalk" })
    ).toBe("telefon");
  });

  it("matches ALDI TALK on the spaced pattern, apart from the grocery entries", () => {
    // First coverage of the "aldi talk" pattern. Note this pins the patterns,
    // not their order: the two families share no substring, so neither
    // assertion can change if CATEGORIES is reordered.
    expect(categorize({ name: "ALDI TALK Aufladung", purpose: "" })).toBe("telefon");
    expect(categorize({ name: "ALDI SAGT DANKE", purpose: "" })).toBe("lebensmittel");
  });

  it("falls back to Sonstiges when nothing matches", () => {
    expect(categorize({ name: "Unbekannter Laden", purpose: "" })).toBe(
      OTHER_CATEGORY.key
    );
  });
});

describe("effectiveCategory", () => {
  it("prefers a valid manual assignment over keywords", () => {
    expect(
      effectiveCategory({ name: "LIDL", purpose: "", category: "tanken" })
    ).toBe("tanken");
  });

  it("ignores unknown manual categories and derives from keywords", () => {
    expect(
      effectiveCategory({ name: "LIDL", purpose: "", category: "gibtsnicht" })
    ).toBe("lebensmittel");
  });
});

describe("category registry", () => {
  it("resolves every key and falls back to Sonstiges for unknown keys", () => {
    for (const c of ALL_CATEGORIES) {
      expect(categoryByKey(c.key)).toBe(c);
    }
    expect(categoryByKey("nope")).toBe(OTHER_CATEGORY);
  });

  it("has unique keys and lowercase patterns", () => {
    const keys = ALL_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CATEGORIES) {
      for (const p of c.patterns) expect(p).toBe(p.toLowerCase());
    }
  });
});

describe("word-boundary matching (A3)", () => {
  it("does not match a pattern buried inside a longer word", () => {
    // "esso" inside ESPRESSO and "miete" inside Automiete were the two the
    // audit measured; both used to land in Tanken and Wohnen respectively.
    expect(categorize({ name: "ESPRESSO HOUSE", purpose: "" })).toBe("sonstiges");
    expect(categorize({ name: "SIXT Automiete Koeln", purpose: "" })).toBe("sonstiges");
    expect(categorize({ name: "LOTTO Annahmestelle", purpose: "" })).toBe("sonstiges");
  });

  it("files a premium collected by a lender as insurance, not as credit", () => {
    // The bank debits the premium, so its name is on the booking too. Kredite
    // used to be checked first and claimed all 42 of these in the real ledger.
    expect(
      categorize({
        name: "ING-DiBa AG",
        purpose: "Versicherungsbeitrag 01.09. - 30.09. zur AXA Vertragsnummer",
      })
    ).toBe("versicherungen");
    // A plain instalment from the same bank is still credit. No "Darlehen" in
    // the text, or this would pass without the lender keyword doing anything.
    expect(categorize({ name: "ING-DiBa AG", purpose: "ING-DIBA AG 09/26" })).toBe("kredite");
  });

  it("does not read a town called Stromberg as an electricity bill", () => {
    expect(categorize({ name: "Getraenkemarkt Stromberg", purpose: "" })).toBe("sonstiges");
    expect(categorize({ name: "Stadtwerke", purpose: "Stromabschlag 09/26" })).toBe("wohnen");
  });

  it("still matches at the start of a German compound", () => {
    // Only the left edge is anchored, or these would stop working.
    expect(categorize({ name: "Nebenkostenabrechnung", purpose: "" })).toBe("wohnen");
    expect(categorize({ name: "Mietzahlung 08/26", purpose: "" })).toBe("sonstiges");
    expect(categorize({ name: "ESSO Station 42", purpose: "" })).toBe("tanken");
    expect(categorize({ name: "Miete August", purpose: "" })).toBe("wohnen");
  });
});

describe("income category", () => {
  it("routes a positive booking to Einnahmen, not to a spending bucket", () => {
    expect(categorize({ name: "Arbeitgeber AG", purpose: "Gehalt 08/26", amount: 2400 }))
      .toBe("einkommen");
    // The same text as an expense is not income.
    expect(categorize({ name: "Arbeitgeber AG", purpose: "Gehalt 08/26", amount: -50 }))
      .toBe("sonstiges");
  });

  it("is not offered as a budget", () => {
    expect(ALL_CATEGORIES.some((c) => c.key === "einkommen")).toBe(false);
    // …but it still resolves to a real label and colour where it is displayed.
    expect(categoryByKey("einkommen").label).toBe("Einnahmen");
  });
});
