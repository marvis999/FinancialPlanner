import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { freshDb, type DbModule } from "./helpers/db-harness";
import { buildDemoDataset } from "@/lib/demo-data";
import { DATA_SOURCES } from "@/lib/data-source";
import { effectiveCategory } from "@/lib/categories";
import { todayIso } from "@/lib/utils";

afterEach(() => vi.resetModules());

const dataDir = (): string => process.env.DATA_DIR as string;
const fileFor = (source: "real" | "demo"): string =>
  path.join(dataDir(), DATA_SOURCES[source].file);

async function onDemo(): Promise<DbModule> {
  const db = await freshDb();
  db.setActiveSource("demo");
  return db;
}

describe("active source", () => {
  it("defaults to the real dataset and leaves the demo file untouched", async () => {
    const db = await freshDb();
    expect(db.activeSource()).toBe("real");
    expect(db.listTransactions()).toEqual([]);
    expect(fs.existsSync(fileFor("demo"))).toBe(false);
  });

  it("survives a reload of the module, because it is stored next to the data", async () => {
    const db = await onDemo();
    expect(db.activeSource()).toBe("demo");

    // Same DATA_DIR, fresh module registry: the choice has to come off disk.
    vi.resetModules();
    const reloaded: DbModule = await import("@/lib/db");
    expect(reloaded.activeSource()).toBe("demo");
    expect(reloaded.listTransactions().length).toBeGreaterThan(0);
  });

  it("ignores an unknown value in the source file", async () => {
    const db = await freshDb();
    fs.writeFileSync(path.join(dataDir(), "active-source"), "hackme", "utf8");
    vi.resetModules();
    const reloaded: DbModule = await import("@/lib/db");
    expect(reloaded.activeSource()).toBe("real");
    void db;
  });
});

describe("switching sources", () => {
  it("writes the demo into its own file and never into the real one", async () => {
    const db = await freshDb();
    db.addRecurring("Miete", 900, "expense", 1, false, "2026-01-01", null, null, null, "wohnen");

    db.setActiveSource("demo");
    expect(db.listRecurring().length).toBeGreaterThan(5);
    expect(db.listTransactions().length).toBeGreaterThan(100);

    db.setActiveSource("real");
    expect(db.listRecurring().map((r) => r.name)).toEqual(["Miete"]);
    expect(db.listTransactions()).toEqual([]);
    expect(fs.existsSync(fileFor("real"))).toBe(true);
    expect(fs.existsSync(fileFor("demo"))).toBe(true);
  });

  it("seeds only once, so edits made in the demo survive a round trip", async () => {
    const db = await onDemo();
    const before = db.listRecurring().length;
    db.addRecurring("Segelkurs", 60, "expense", 1, false, "2026-01-01", null, null, null, null);

    db.setActiveSource("real");
    db.setActiveSource("demo");

    const names = db.listRecurring().map((r) => r.name);
    expect(names).toContain("Segelkurs");
    expect(names.length).toBe(before + 1);
  });
});

describe("the demo dataset", () => {
  it("anchors the ledger on the newest booking, like a real import does", async () => {
    const db = await onDemo();
    const rows = db.listTransactions(); // newest first
    expect(rows.length).toBeGreaterThan(100);
    expect(db.getSettings().startingBalance).toBe(rows[0].balance);
  });

  it("keeps every running balance consistent with the amounts", async () => {
    const db = await onDemo();
    const rows = [...db.listTransactions()].reverse(); // oldest first
    for (let i = 1; i < rows.length; i++) {
      const step = Math.round((rows[i].balance - rows[i - 1].balance) * 100) / 100;
      expect(step).toBe(rows[i].amount);
    }
  });

  it("books nothing in the future", async () => {
    const db = await onDemo();
    const today = todayIso();
    expect(db.listTransactions()[0].date <= today).toBe(true);
  });

  it("plans one-off items ahead of today, including a paused one", async () => {
    const db = await onDemo();
    const today = todayIso();
    const oneoff = db.listOneOff();
    expect(oneoff.length).toBeGreaterThan(3);
    for (const o of oneoff) expect(o.date > today).toBe(true);
    expect(oneoff.some((o) => !o.isActive)).toBe(true);
  });

  it("links the Sondertilgung to the loan it pays down", async () => {
    const db = await onDemo();
    const loan = db.listRecurring().find((r) => r.name === "Autokredit");
    const extra = db.listOneOff().find((o) => o.name === "Sondertilgung Autokredit");
    expect(loan?.remainingAmount).toBeGreaterThan(0);
    expect(extra?.debtId).toBe(loan?.id);
  });

  it("resolves every booking to a real category, and none to income by accident", async () => {
    const db = await onDemo();
    const keys = new Set(db.listTransactions().map((t) => effectiveCategory(t)));
    expect(keys).toContain("lebensmittel");
    expect(keys).toContain("wohnen");
    expect(keys).toContain("tanken");
    expect(keys).toContain("kredite");
    expect(keys).toContain("einkommen");
    // Salary is the only regular income; nothing negative may land there.
    const income = db
      .listTransactions()
      .filter((t) => effectiveCategory(t) === "einkommen");
    expect(income.every((t) => t.amount > 0)).toBe(true);
  });

  it("is deterministic for a given day", () => {
    const a = buildDemoDataset("2026-08-29");
    const b = buildDemoDataset("2026-08-29");
    expect(a.transactions.map((t) => t.fingerprint)).toEqual(
      b.transactions.map((t) => t.fingerprint)
    );
    expect(a.currentBalance).toBe(b.currentBalance);
  });

  it("gives every booking a unique fingerprint", () => {
    const data = buildDemoDataset("2026-08-29");
    const seen = new Set(data.transactions.map((t) => t.fingerprint));
    expect(seen.size).toBe(data.transactions.length);
  });
});

describe("resetDemoData", () => {
  it("throws the edits away and regenerates the household", async () => {
    const db = await onDemo();
    const before = db.listTransactions().length;
    db.addRecurring("Segelkurs", 60, "expense", 1, false, "2026-01-01", null, null, null, null);
    db.deleteBudget(db.listBudgets()[0].id);

    db.resetDemoData();

    expect(db.listRecurring().map((r) => r.name)).not.toContain("Segelkurs");
    expect(db.listTransactions().length).toBe(before);
    expect(db.listBudgets().length).toBeGreaterThan(1);
  });

  it("leaves the real dataset alone even when it is the active one", async () => {
    const db = await freshDb();
    db.addRecurring("Miete", 900, "expense", 1, false, "2026-01-01", null, null, null, "wohnen");
    db.importTransactions(
      [
        {
          date: "2026-08-18",
          valuta: "2026-08-18",
          name: "Echte Buchung",
          amount: -10,
          currency: "EUR",
          type: "KARTENZAHLUNG",
          purpose: "echt",
          iban: "",
          bic: "",
          fingerprint: "real-1",
        },
      ],
      1000
    );

    expect(db.activeSource()).toBe("real");
    db.resetDemoData();

    expect(db.activeSource()).toBe("real");
    expect(db.listRecurring().map((r) => r.name)).toEqual(["Miete"]);
    expect(db.listTransactions().map((t) => t.name)).toEqual(["Echte Buchung"]);
    expect(db.getSettings().startingBalance).toBe(1000);
  });
});
