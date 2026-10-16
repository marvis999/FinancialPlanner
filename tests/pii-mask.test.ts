import { describe, expect, it } from "vitest";

import { createMasker } from "@/lib/pii-mask";

describe("createMasker", () => {
  it("hides account, card and contact details in a SEPA booking text", () => {
    const masker = createMasker();
    const text =
      "EREF+RG-2026-0042-7781 MREF+M0001234567 CRED+DE98ZZZ09999999999 " +
      "SVWZ+Miete Oktober IBAN DE89 3704 0044 0532 0130 00 Rueckfragen info@hausverwaltung.de 0211 9876543";
    const masked = masker.mask(text);
    expect(masked).not.toMatch(/DE89|3704|0532|DE98ZZZ|M0001234567|RG-2026-0042|info@|9876543/);
    expect(masked).toContain("SVWZ+Miete Oktober");
    expect(masked).toMatch(/EREF\+\[REF-\d\]/);
    expect(masked).toMatch(/\[IBAN-1\]/);
    expect(masked).toMatch(/\[EMAIL-1\]/);
    expect(masked).toMatch(/\[PHONE-1\]/);
  });

  it("hides card numbers, labelled codes and street addresses", () => {
    const masker = createMasker();
    const masked = masker.mask(
      "Kartenzahlung XXXX XXXX XXXX 4321 Kundennr. 7712345 Rechnung: R-99812 Musterstraße 12 50667 Koeln"
    );
    expect(masked).toBe(
      "Kartenzahlung [CARD-1] Kundennr. [REF-1] Rechnung: [REF-2] [ADDRESS-1] [REF-3] Koeln"
    );
  });

  it("hides a labelled number written in groups", () => {
    expect(createMasker().mask("Steuer-ID 12 345 678 901 Einkommensteuer 2025 1.234,56")).toBe(
      "Steuer-ID [REF-1] Einkommensteuer 2025 1.234,56"
    );
  });

  it("keeps dates, amounts and short numbers", () => {
    const masker = createMasker();
    const text = "Abschlag 15.10.2026 bis 2026-11-14 Betrag 1.020,00 EUR 6548.78 Filiale 4711 Rechnung 2026-10 Hausgeld Q4/2026";
    expect(masker.mask(text)).toBe(text);
  });

  it("hides listed names in any order and case, but leaves other names alone", () => {
    const masker = createMasker(["Max Mustermann", "Erika"]);
    expect(masker.mask("Uebertrag von MUSTERMANN, MAX an Erika fuer Edeka")).toBe(
      "Uebertrag von [NAME-1], [NAME-1] an [NAME-2] fuer Edeka"
    );
    // Part of a longer word is not a match.
    expect(masker.mask("Erikastrasse")).toBe("Erikastrasse");
  });

  it("treats an alternative payee field as a name", () => {
    const masker = createMasker();
    expect(masker.mask("ABWA+Erika Musterfrau SVWZ+Geschenk")).toBe(
      "ABWA+[NAME-1] SVWZ+Geschenk"
    );
  });

  it("gives the same value the same placeholder and restores it in the answer", () => {
    const masker = createMasker(["Max Mustermann"]);
    const first = masker.mask("Mandat M0001234567 fuer Max Mustermann");
    const second = masker.mask("Mandatsref. M0001234567");
    expect(first).toBe("Mandat [REF-1] fuer [NAME-1]");
    expect(second).toBe("Mandatsref. [REF-1]");
    expect(masker.unmask("Same mandate [REF-1] as the rent paid by [NAME-1]")).toBe(
      "Same mandate M0001234567 as the rent paid by Max Mustermann"
    );
    // Placeholders this masker never handed out stay as they are.
    expect(masker.unmask("[IBAN-7]")).toBe("[IBAN-7]");
  });

  it("starts numbering afresh for every masker", () => {
    expect(createMasker().mask("Kundennummer 123456")).toBe("Kundennummer [REF-1]");
    expect(createMasker().mask("Kundennummer 654321")).toBe("Kundennummer [REF-1]");
  });
});

describe("Masker.hidden", () => {
  it("counts distinct hidden values per kind", () => {
    const masker = createMasker(["Erika"]);
    masker.mask("Erika Kundennr. 123456 und Erika Kundennr. 123456, Vertrag 998877");
    expect(masker.hidden()).toEqual([
      { kind: "NAME", count: 1 },
      { kind: "REF", count: 2 },
    ]);
  });
});
