import { afterEach, describe, expect, it, vi } from "vitest";

import { freshDataDir, tx } from "./helpers/db-harness";

/**
 * The server actions are the only place that decides which recurring item a
 * one-off may be designated to, and which day a Restschuld figure is stamped
 * with. Both decisions are invisible to lib/projection tests, and both were
 * wrong.
 */
async function load() {
  freshDataDir();
  vi.resetModules();
  // Both modules must come from the same fresh registry, or the action would
  // write to one database while the assertion reads another.
  const db = await import("@/lib/db");
  const actions = await import("@/app/actions");
  return { actions, db };
}

afterEach(() => vi.resetModules());

describe("toDebtId (B5)", () => {
  it("refuses to designate a one-off against a recurring income", async () => {
    const { actions, db } = await load();
    await actions.addRecurringAction({
      name: "Gehalt",
      amount: 2000,
      kind: "income",
      intervalMonths: 1,
      isContract: false,
      date: "2026-01-05",
      remainingAmount: 6000,
    });
    const salary = db.listRecurring()[0];
    expect(salary.kind).toBe("income");

    await actions.addOneOffAction({
      name: "Sondertilgung",
      amount: 4000,
      kind: "expense",
      date: "2026-02-05",
      isContract: false,
      debtId: salary.id,
    });
    // Stored as an ordinary expense, not as a payment against the salary.
    expect(db.listOneOff()[0].debtId).toBeNull();
  });

  it("still accepts a designation against a recurring expense", async () => {
    const { actions, db } = await load();
    await actions.addRecurringAction({
      name: "Kredit",
      amount: 100,
      kind: "expense",
      intervalMonths: 1,
      isContract: false,
      date: "2026-01-15",
      remainingAmount: 1000,
    });
    const loan = db.listRecurring()[0];
    await actions.addOneOffAction({
      name: "Sondertilgung",
      amount: 400,
      kind: "expense",
      date: "2026-02-05",
      isContract: false,
      debtId: loan.id,
    });
    expect(db.listOneOff()[0].debtId).toBe(loan.id);
  });
});

describe("remainingAsOf stamping (B7)", () => {
  it("stamps the newest booking, not today", async () => {
    const { actions, db } = await load();
    db.importTransactions(
      [
        {
          date: "2026-08-18",
          valuta: null,
          name: "N",
          amount: -10,
          currency: "EUR",
          type: "T",
          purpose: "P",
          iban: "",
          bic: "",
          fingerprint: "f1",
        },
      ],
      0
    );
    await actions.addRecurringAction({
      name: "Kredit",
      amount: 100,
      kind: "expense",
      intervalMonths: 1,
      isContract: false,
      date: "2026-09-15",
      remainingAmount: 1000,
    });
    // The edit dialog pre-fills the balance as of the anchor, so the stored
    // as-of day has to be that same anchor. Stamping today would attach the
    // figure to a day the value was never valid for.
    expect(db.listRecurring()[0].remainingAsOf).toBe("2026-08-18");
  });

  it("falls back to the configured start date with no history", async () => {
    const { actions, db } = await load();
    db.updateSettings({
      startingBalance: 0,
      startDate: "2026-03-01",
      monthsAhead: 24,
      budgetStartDay: 1,
    });
    await actions.addRecurringAction({
      name: "Kredit",
      amount: 100,
      kind: "expense",
      intervalMonths: 1,
      isContract: false,
      date: "2026-09-15",
      remainingAmount: 500,
    });
    expect(db.listRecurring()[0].remainingAsOf).toBe("2026-03-01");
  });
});

describe("first import asks for the current balance (B1/D3)", () => {
  const csv = [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
    '"DE00";"10.08.26";"10.08.26";"LASTSCHRIFT";"Test A";"Laden";"DE11";"BIC";"-12,99";"EUR";"Umsatz gebucht"',
    '"DE00";"11.08.26";"11.08.26";"LASTSCHRIFT";"Test B";"Laden";"DE11";"BIC";"-4,99";"EUR";"Umsatz gebucht"',
  ].join("\n");

  it("imports nothing and returns a preview when the ledger is empty", async () => {
    const { actions, db } = await load();
    const res = await actions.importCsvAction(csv);
    expect(res.ok).toBe(false);
    expect(res.needsBalance).toMatchObject({
      rows: 2,
      minDate: "2026-08-10",
      maxDate: "2026-08-11",
      sum: -17.98,
    });
    // Crucially: nothing was written, so cancelling leaves the ledger empty.
    expect(db.listTransactions()).toHaveLength(0);
  });

  it("anchors the ledger so the newest booking ends at the confirmed balance", async () => {
    const { actions, db } = await load();
    // The user types what their banking app shows today, not some figure from
    // before the oldest row - that one is not obtainable from a bank.
    const res = await actions.importCsvAction(csv, 3832.68);
    expect(res.ok).toBe(true);
    expect(res.result?.newBalance).toBe(3832.68);
    expect(db.listTransactions().map((t) => [t.date, t.balance])).toEqual([
      ["2026-08-11", 3832.68],
      ["2026-08-10", 3837.67],
    ]);
    // The opening balance is derived backwards: 3832,68 + 17,98 = 3850,66.
    expect(db.getSettings().startingBalance).toBe(3832.68);
  });

  it("accepts a negative balance", async () => {
    const { actions } = await load();
    const res = await actions.importCsvAction(csv, -117.98);
    expect(res.result?.newBalance).toBe(-117.98);
  });

  it("does not ask again once history exists", async () => {
    const { actions } = await load();
    await actions.importCsvAction(csv, 1000);
    const more = [
      '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
      '"DE00";"12.08.26";"12.08.26";"LASTSCHRIFT";"Test C";"Laden";"DE11";"BIC";"-10,00";"EUR";"Umsatz gebucht"',
    ].join("\n");
    const res = await actions.importCsvAction(more);
    expect(res.needsBalance).toBeUndefined();
    expect(res.result?.newBalance).toBe(990);
  });
});

describe("recurring category round-trip (D1)", () => {
  it("stores a valid category and rejects an unknown one", async () => {
    const { actions, db } = await load();
    const base = {
      name: "Miete",
      amount: 900,
      kind: "expense" as const,
      intervalMonths: 1,
      isContract: false,
      date: "2026-09-01",
    };
    await actions.addRecurringAction({ ...base, category: "wohnen" });
    await actions.addRecurringAction({ ...base, name: "Quatsch", category: "gibtsnicht" });
    await actions.addRecurringAction({ ...base, name: "Ohne" });
    const byName = new Map(db.listRecurring().map((r) => [r.name, r.category]));
    expect(byName.get("Miete")).toBe("wohnen");
    // An unrecognised key is dropped rather than stored: a bogus category would
    // silently stop any budget from covering the item.
    expect(byName.get("Quatsch")).toBeNull();
    expect(byName.get("Ohne")).toBeNull();
  });

  it("a budget covering the category tops up to the limit instead of adding to it", async () => {
    const { actions, db } = await load();
    await actions.addRecurringAction({
      name: "Miete",
      amount: 900,
      kind: "expense",
      intervalMonths: 1,
      isContract: false,
      date: "2026-09-01",
      category: "wohnen",
    });
    await actions.addBudgetAction({ category: "wohnen", amount: 1000 });
    const { computeSummary } = await import("@/lib/projection");
    // 900 fixed + 100 variable rest, not 900 + 1000.
    expect(computeSummary(db.getAppState(), "2026-08-20").monthlyExpense).toBe(1000);
  });
});

describe("category suggestions never overwrite manual work (B14)", () => {
  async function seed(db: typeof import("@/lib/db")) {
    db.importTransactions(
      [
        // Same counterparty, two different purposes -> two categories.
        tx("2026-08-01", -4.99, "p1", { name: "PayPal Europe", purpose: "AldiTalk" }),
        tx("2026-08-02", -20, "p2", { name: "PayPal Europe", purpose: "Zalando Schuhe" }),
        tx("2026-08-03", -30, "p3", { name: "PayPal Europe", purpose: "Zalando Jacke" }),
      ],
      0
    );
    return db.listTransactions();
  }

  it("applies only to bookings still in the expected category", async () => {
    const { actions, db } = await load();
    const rows = await seed(db);
    const shopping = rows.filter((t) => t.purpose.includes("Zalando")).map((t) => t.id);
    const telefon = rows.filter((t) => t.purpose.includes("AldiTalk")).map((t) => t.id);

    // A suggestion built when everything looked like "shopping", but one
    // booking has since been recategorised by hand.
    const res = await actions.applyCategorySuggestionAction(
      [...shopping, ...telefon],
      "shopping",
      "kredite"
    );
    expect(res.applied).toBe(shopping.length);
    expect(res.skipped).toBe(telefon.length);

    const after = new Map(res.transactions.map((t) => [t.id, t.category]));
    for (const id of shopping) expect(after.get(id)).toBe("kredite");
    // Untouched: still deriving from its keywords, not overwritten.
    for (const id of telefon) expect(after.get(id)).toBeNull();
  });

  it("refuses an unknown target category rather than clearing the rows", async () => {
    const { actions, db } = await load();
    const rows = await seed(db);
    const res = await actions.applyCategorySuggestionAction(
      rows.map((t) => t.id),
      "shopping",
      "gibtsnicht"
    );
    expect(res.applied).toBe(0);
    expect(res.transactions.every((t) => t.category === null)).toBe(true);
  });
});
