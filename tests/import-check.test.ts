import { describe, expect, it } from "vitest";

import {
  MAX_CHECK_PAYMENTS,
  buildImportCheckPrompt,
  parseImportCheckAnswer,
  toCheckPayments,
} from "@/lib/import-check";
import type { ImportTransaction, OneOffItem } from "@/lib/types";

function record(over: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    date: "2026-08-10",
    valuta: "2026-08-10",
    name: "Laden GmbH",
    amount: -12.99,
    currency: "EUR",
    type: "LASTSCHRIFT",
    purpose: "Einkauf",
    iban: "DE11",
    bic: "TESTDEFF",
    fingerprint: `fp-${Math.abs(over.amount ?? -12.99)}-${over.date ?? "2026-08-10"}-${over.name ?? ""}`,
    ...over,
  };
}

function oneOff(over: Partial<OneOffItem> = {}): OneOffItem {
  return {
    id: 1,
    name: "Zahnarzt",
    amount: 200,
    kind: "expense",
    date: "2026-08-12",
    isContract: false,
    debtId: null,
    isActive: true,
    ...over,
  };
}

describe("toCheckPayments", () => {
  it("keeps the newest rows when capping", () => {
    const records = Array.from({ length: MAX_CHECK_PAYMENTS + 5 }, (_, i) =>
      record({
        date: `2026-0${(i % 8) + 1}-15`,
        fingerprint: `fp${i}`,
      })
    );
    const payments = toCheckPayments(records);
    expect(payments).toHaveLength(MAX_CHECK_PAYMENTS);
    // Newest month must survive, and ids are stable "t1".."tN".
    expect(payments[0].record.date).toBe("2026-08-15");
    expect(payments[0].tid).toBe("t1");
    expect(payments.at(-1)!.tid).toBe(`t${MAX_CHECK_PAYMENTS}`);
  });
});

describe("buildImportCheckPrompt", () => {
  it("carries payments, one-offs, catalog and the keyword category", () => {
    const payments = toCheckPayments([
      record({ name: "Tankstelle Nord", purpose: "Tanken" }),
    ]);
    const prompt = buildImportCheckPrompt(payments, [oneOff()], "English");
    expect(prompt).toContain('"currentCategory":"tanken"');
    expect(prompt).toContain('"name":"Zahnarzt"');
    expect(prompt).toContain('"amount":-200'); // planned expense is signed
    expect(prompt).toContain("sonstiges: Sonstiges");
    expect(prompt).toContain("JSON array");
  });

  it("says so when no one-offs exist", () => {
    const prompt = buildImportCheckPrompt(
      toCheckPayments([record()]),
      [],
      "English"
    );
    expect(prompt).toContain("(none)");
  });
});

describe("parseImportCheckAnswer", () => {
  const payments = toCheckPayments([
    record({ date: "2026-08-10", name: "Apotheke", fingerprint: "fp-a" }),
    record({
      date: "2026-08-09",
      name: "Dr. Zahn",
      amount: -200,
      fingerprint: "fp-b",
    }),
    record({
      date: "2026-08-08",
      name: "Verkauf Auto",
      amount: 500,
      fingerprint: "fp-c",
    }),
  ]);
  const oneoffs = [
    oneOff({ id: 7, name: "Zahnarzt", amount: 200 }),
    oneOff({ id: 8, name: "Autoverkauf", amount: 500, kind: "income" }),
  ];

  it("keeps a valid category and a valid one-off match", () => {
    const findings = parseImportCheckAnswer(
      [
        { id: "t1", category: "lebensmittel", reason: "Pharmacy, not cash" },
        { id: "t2", oneOff: 7, oneOffReason: "Amount and date match" },
      ],
      payments,
      oneoffs
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      fingerprint: "fp-a",
      suggestedCategory: "lebensmittel",
      oneOff: null,
    });
    expect(findings[1]).toMatchObject({
      fingerprint: "fp-b",
      suggestedCategory: null,
      oneOff: { id: 7, name: "Zahnarzt" },
      oneOffReason: "Amount and date match",
    });
  });

  it("drops categories outside the catalog or equal to the current one", () => {
    const findings = parseImportCheckAnswer(
      [
        { id: "t1", category: "nonsense", reason: "?" },
        // t1's keyword category is already "sonstiges" — no change, no finding.
        { id: "t1", category: "sonstiges", reason: "?" },
      ],
      payments,
      oneoffs
    );
    expect(findings).toHaveLength(0);
  });

  it("rejects a one-off match with the wrong sign", () => {
    // t3 is +500 income; one-off 7 is an expense.
    const findings = parseImportCheckAnswer(
      [{ id: "t3", oneOff: 7 }],
      payments,
      oneoffs
    );
    expect(findings).toHaveLength(0);
  });

  it("lets each one-off and each payment be claimed only once", () => {
    const findings = parseImportCheckAnswer(
      [
        { id: "t2", oneOff: 7 },
        { id: "t1", oneOff: 7 }, // one-off already claimed
        { id: "t2", category: "wohnen" }, // payment already reported
      ],
      payments,
      oneoffs
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].fingerprint).toBe("fp-b");
  });

  it("ignores unknown ids, non-objects and unknown one-offs", () => {
    const findings = parseImportCheckAnswer(
      [null, 42, { id: "t99", category: "wohnen" }, { id: "t1", oneOff: 999 }],
      payments,
      oneoffs
    );
    expect(findings).toHaveLength(0);
  });

  it("keeps an income match with matching sign", () => {
    const findings = parseImportCheckAnswer(
      [{ id: "t3", oneOff: 8, oneOffReason: "Car sale" }],
      payments,
      oneoffs
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].oneOff).toMatchObject({ id: 8, kind: "income" });
  });
});
