import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { freshDataDir } from "./helpers/db-harness";

/** A database written by the previous release: no `recurring.category`. */
function legacyDb(names: string[]): string {
  const dir = freshDataDir("legacy-");
  const db = new Database(path.join(dir, "financial-planner.db"));
  db.exec(`
    CREATE TABLE recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL DEFAULT 'expense',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const ins = db.prepare("INSERT INTO recurring (name, amount) VALUES (?, 100)");
  for (const n of names) ins.run(n);
  db.close();
  return dir;
}

describe("recurring.category migration (D1)", () => {
  it("back-fills a recognisable name once and leaves the rest NULL", async () => {
    process.env.DATA_DIR = legacyDb(["Miete", "Wohnung Nordstadt", "Vodafone Mobilfunk"]);
    vi.resetModules();
    const db = await import("@/lib/db");

    const byName = new Map(db.listRecurring().map((r) => [r.name, r.category]));
    expect(byName.get("Miete")).toBe("wohnen");
    expect(byName.get("Vodafone Mobilfunk")).toBe("telefon");
    // "Wohnung" is not "miete" and no other keyword fits: no guess, left NULL
    // for the user to pick in the form.
    expect(byName.get("Wohnung Nordstadt")).toBeNull();

    // A category cleared by hand survives a reopen - the back-fill is one-shot.
    const miete = db.listRecurring().find((r) => r.name === "Miete")!;
    db.updateRecurring(miete.id, "Miete", 100, "expense", 1, false, "2026-09-01", null, null, null, null);
    vi.resetModules();
    const db2 = await import("@/lib/db");
    expect(db2.listRecurring().find((r) => r.name === "Miete")!.category).toBeNull();
  });
});
