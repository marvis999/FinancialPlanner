import { afterEach, describe, expect, it, vi } from "vitest";

import { freshDb, tx, type DbModule } from "./helpers/db-harness";

afterEach(() => vi.resetModules());

const SETTINGS = { startDate: "2026-08-01", monthsAhead: 24, budgetStartDay: 1 };
const ladder = (db: DbModule) =>
  db.listTransactions().map((t) => [t.date, t.amount, t.balance]);

describe("importTransactions", () => {
  it("anchors the first import on the confirmed current balance (B1/D3)", async () => {
    const db = await freshDb();
    // The figure the user can actually read off their banking app: the balance
    // AFTER the newest booking. The opening balance (3.850,66) is derived
    // backwards from it, because no bank will tell you what an account held
    // the day before the oldest row of a year-old export.
    const res = db.importTransactions(
      [tx("2026-08-18", -10, "f1"), tx("2026-08-19", -7.98, "f2")],
      3832.68
    );
    expect(res).toEqual({
      added: 2,
      skipped: 0,
      total: 2,
      newBalance: 3832.68,
      minDate: "2026-08-18",
      maxDate: "2026-08-19",
    });
    expect(db.getSettings().startingBalance).toBe(3832.68);
    expect(ladder(db)).toEqual([
      ["2026-08-19", -7.98, 3832.68],
      ["2026-08-18", -10, 3840.66],
    ]);
  });

  it("falls back to the stored balance as the current one when not prompted", async () => {
    const db = await freshDb();
    db.updateSettings({ ...SETTINGS, startingBalance: 1000 });
    const res = db.importTransactions([tx("2026-08-18", -100, "a")]);
    expect(res.newBalance).toBe(1000);
    expect(ladder(db)).toEqual([["2026-08-18", -100, 1000]]);
  });

  it("moves the balance for a booking that posted on the newest day (B2)", async () => {
    const db = await freshDb();
    const first = [tx("2026-08-18", -100, "a"), tx("2026-08-20", -50, "b")];
    db.importTransactions(first, -150);
    expect(db.getSettings().startingBalance).toBe(-150);

    const res = db.importTransactions([...first, tx("2026-08-20", -200, "c")]);
    expect(res.added).toBe(1);
    expect(res.skipped).toBe(2);
    expect(res.newBalance).toBe(-350);
    expect(ladder(db)).toEqual([
      ["2026-08-20", -200, -350],
      ["2026-08-20", -50, -150],
      ["2026-08-18", -100, -100],
    ]);
  });

  it("leaves the balance alone when older rows are back-filled", async () => {
    const db = await freshDb();
    db.importTransactions([tx("2026-08-20", -50, "a")], 950);
    expect(db.getSettings().startingBalance).toBe(950);

    const res = db.importTransactions([tx("2026-06-01", -400, "b")]);
    expect(res.added).toBe(1);
    expect(res.newBalance).toBe(950);
    expect(ladder(db)).toEqual([
      ["2026-08-20", -50, 950],
      ["2026-06-01", -400, 1000],
    ]);
  });

  it("moves the balance by the net of rows on a strictly newer date", async () => {
    const db = await freshDb();
    db.importTransactions([tx("2026-08-20", -50, "a")], 950);
    const res = db.importTransactions([
      tx("2026-08-21", -25.5, "b"),
      tx("2026-08-22", 100, "c"),
    ]);
    expect(res.newBalance).toBe(1024.5);
    expect(db.listTransactions()[0].balance).toBe(1024.5);
  });

  it("is a no-op when the same file is imported twice", async () => {
    const db = await freshDb();
    const file = [tx("2026-08-18", -100, "a"), tx("2026-08-20", -50, "b")];
    db.importTransactions(file, 450);
    const before = ladder(db);
    const res = db.importTransactions(file);
    expect(res).toMatchObject({ added: 0, skipped: 2, newBalance: 450 });
    expect(ladder(db)).toEqual(before);
  });

  it("fails loudly on an unstorable row instead of calling it a duplicate (B18)", async () => {
    const db = await freshDb();
    expect(() =>
      db.importTransactions([tx("2026-08-18", -10, "a"), tx("2026-08-19", NaN, "b")])
    ).toThrow();
    expect(db.listTransactions()).toHaveLength(0);
  });
});

describe("updateSettings re-anchors the ledger (C6)", () => {
  it("a corrected balance rewrites the running balances", async () => {
    const db = await freshDb();
    db.importTransactions(
      [tx("2026-08-18", -100, "a"), tx("2026-08-20", -50, "b")],
      850
    );
    expect(db.getSettings().startingBalance).toBe(850);

    db.updateSettings({ ...SETTINGS, startingBalance: 2000 });
    expect(db.getSettings().startingBalance).toBe(2000);
    // Ist line and forecast now start from the same number on the anchor day.
    expect(ladder(db)).toEqual([
      ["2026-08-20", -50, 2000],
      ["2026-08-18", -100, 2050],
    ]);
    expect(db.getMonthlyHistory()).toEqual([{ date: "2026-08-01", balance: 2000 }]);
  });

  it("is harmless with no imported history", async () => {
    const db = await freshDb();
    db.updateSettings({ ...SETTINGS, startingBalance: 2000 });
    expect(db.getSettings().startingBalance).toBe(2000);
    expect(db.listTransactions()).toEqual([]);
  });

  it("the next import keeps the corrected balance as its anchor", async () => {
    const db = await freshDb();
    db.importTransactions([tx("2026-08-18", -100, "a")], 900);
    db.updateSettings({ ...SETTINGS, startingBalance: 2000 });
    const res = db.importTransactions([tx("2026-08-19", -25, "b")]);
    expect(res.newBalance).toBe(1975);
  });
});

describe("recurring items carry a budget category (D1)", () => {
  it("round-trips the category and defaults to null", async () => {
    const db = await freshDb();
    db.addRecurring("Miete", 900, "expense", 1, false, "2026-09-01", null, null, null, "wohnen");
    db.addRecurring("Sonstwas", 20, "expense", 1, false, "2026-09-01", null, null, null, null);
    const items = db.listRecurring();
    expect(items.map((r) => [r.name, r.category]).sort()).toEqual([
      ["Miete", "wohnen"],
      ["Sonstwas", null],
    ]);

    const miete = items.find((r) => r.name === "Miete")!;
    db.updateRecurring(miete.id, "Miete", 900, "expense", 1, false, "2026-09-01", null, null, null, "lebensmittel");
    expect(db.listRecurring().find((r) => r.id === miete.id)!.category).toBe(
      "lebensmittel"
    );
  });
});

describe("transaction tags", () => {
  // Both functions used to name their callback parameter after the tag they
  // were given, so each compared a tag with itself: add short-circuited on any
  // non-empty list, and remove filtered everything out.
  it("adds more than one tag to the same booking", async () => {
    const db = await freshDb();
    db.importTransactions([tx("2026-08-18", -10, "f1")], 100);
    const [id] = db.listTransactions().map((t) => t.id);

    db.addTransactionsTag([id], "urlaub");
    db.addTransactionsTag([id], "spanien");

    expect(db.listTransactions()[0].tags).toEqual(["urlaub", "spanien"]);
  });

  it("de-duplicates case-insensitively rather than by identity", async () => {
    const db = await freshDb();
    db.importTransactions([tx("2026-08-18", -10, "f1")], 100);
    const [id] = db.listTransactions().map((t) => t.id);

    db.addTransactionsTag([id], "Urlaub");
    db.addTransactionsTag([id], "urlaub");

    expect(db.listTransactions()[0].tags).toEqual(["Urlaub"]);
  });

  it("removes only the named tag, not every tag", async () => {
    const db = await freshDb();
    db.importTransactions([tx("2026-08-18", -10, "f1")], 100);
    const [id] = db.listTransactions().map((t) => t.id);
    db.addTransactionsTag([id], "urlaub");
    db.addTransactionsTag([id], "spanien");

    db.removeTransactionsTag([id], "URLAUB");

    expect(db.listTransactions()[0].tags).toEqual(["spanien"]);
  });
});
