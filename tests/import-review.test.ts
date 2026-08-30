import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCsvTransactions } from "@/lib/csv-import";
import { freshDataDir } from "./helpers/db-harness";

/**
 * The pre-import review is the only path that turns accepted Claude findings
 * into writes: manual categories on the freshly inserted rows, matched
 * one-off items removed from the plan, and a matched extra repayment
 * re-anchoring its loan's remaining debt. All of that happens in
 * confirmCsvImportAction and nowhere else.
 */

const HEADER =
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";' +
  '"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";' +
  '"Betrag";"Waehrung";"Info"';

/**
 * One CSV line. The keys are ours; the values are the German strings a
 * Sparkasse export actually contains. Typed against the defaults so a
 * misspelled key is a compile error rather than a silently ignored override.
 */
const ROW_DEFAULTS = {
  bookingDate: "10.08.26",
  valueDate: "10.08.26",
  bookingType: "LASTSCHRIFT",
  purpose: "Einkauf",
  name: "Laden GmbH",
  iban: "DE11",
  bic: "TESTDEFF",
  amount: "-12,99",
  currency: "EUR",
  status: "Umsatz gebucht",
};

function row(over: Partial<typeof ROW_DEFAULTS> = {}): string {
  const fields = { ...ROW_DEFAULTS, ...over };
  return `"DE00";"${fields.bookingDate}";"${fields.valueDate}";"${fields.bookingType}";"${fields.purpose}";"${fields.name}";"${fields.iban}";"${fields.bic}";"${fields.amount}";"${fields.currency}";"${fields.status}"`;
}

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

/** Fingerprint of the row matching `name`, as the check job would report it. */
function fp(text: string, name: string): string {
  const record = parseCsvTransactions(text).records.find((r) => r.name === name);
  if (!record) throw new Error(`no record named ${name}`);
  return record.fingerprint;
}

async function load() {
  freshDataDir();
  vi.resetModules();
  const db = await import("@/lib/db");
  const actions = await import("@/app/actions");
  return { actions, db };
}

afterEach(() => vi.resetModules());

describe("confirmCsvImportAction", () => {
  it("asks for the balance on a first import instead of writing anything", async () => {
    const { actions, db } = await load();
    const res = await actions.confirmCsvImportAction(csv(row()), null, []);
    expect(res.ok).toBe(false);
    expect(res.needsBalance).toBeDefined();
    expect(db.hasTransactions()).toBe(false);
  });

  it("imports everything and applies only the accepted decisions", async () => {
    const { actions, db } = await load();
    await actions.addOneOffAction({
      name: "Zahnarzt Eigenanteil",
      amount: 200,
      kind: "expense",
      date: "2026-08-12",
      isContract: false,
    });
    const zahnarztId = db.listOneOff()[0].id;

    const text = csv(
      row({ name: "Apotheke am Markt", amount: "-30,00", purpose: "Medikamente" }),
      row({ name: "Dr. Zahn", amount: "-200,00", purpose: "Rechnung 42", bookingDate: "11.08.26", valueDate: "11.08.26" }),
      row({ name: "Unauffaellig", amount: "-5,00" })
    );
    const res = await actions.confirmCsvImportAction(text, 1000, [
      {
        fingerprint: fp(text, "Apotheke am Markt"),
        category: "lebensmittel",
        oneOffId: null,
      },
      {
        fingerprint: fp(text, "Dr. Zahn"),
        category: null,
        oneOffId: zahnarztId,
      },
    ]);

    expect(res.ok).toBe(true);
    expect(res.result?.added).toBe(3);
    expect(res.review).toEqual({ categoriesApplied: 1, oneOffsResolved: 1 });

    const byName = new Map(res.transactions.map((t) => [t.name, t]));
    expect(byName.get("Apotheke am Markt")?.category).toBe("lebensmittel");
    // Untouched rows keep the keyword fallback (category stays null).
    expect(byName.get("Unauffaellig")?.category).toBeNull();
    expect(byName.get("Dr. Zahn")?.category).toBeNull();
    // The matched plan item is gone: the payment is now a real booking.
    expect(db.listOneOff()).toHaveLength(0);
  });

  it("ignores decisions with unknown fingerprints, categories or one-offs", async () => {
    const { actions, db } = await load();
    const text = csv(row({ name: "Laden GmbH" }));
    const res = await actions.confirmCsvImportAction(text, 500, [
      { fingerprint: "not-a-fingerprint", category: "wohnen", oneOffId: 99 },
      { fingerprint: fp(text, "Laden GmbH"), category: "quatsch", oneOffId: 12345 },
    ]);
    expect(res.ok).toBe(true);
    expect(res.review).toEqual({ categoriesApplied: 0, oneOffsResolved: 0 });
    expect(res.transactions[0].category).toBeNull();
    expect(db.listOneOff()).toHaveLength(0);
  });

  it("re-anchors a loan's Restschuld when a matched Sondertilgung is removed", async () => {
    const { actions, db } = await load();
    // Anchor the ledger first so the Restschuld snapshot day is deterministic.
    const base = csv(row({ name: "Basis", bookingDate: "05.08.26", valueDate: "05.08.26", amount: "-1,00" }));
    await actions.confirmCsvImportAction(base, 1000, []);

    await actions.addRecurringAction({
      name: "Kredit",
      amount: 100,
      kind: "expense",
      intervalMonths: 1,
      isContract: false,
      date: "2026-01-15",
      remainingAmount: 1000,
    });
    const debt = db.listRecurring()[0];
    expect(debt.remainingAsOf).toBe("2026-08-05");

    await actions.addOneOffAction({
      name: "Sondertilgung Kredit",
      amount: 400,
      kind: "expense",
      date: "2026-08-20",
      isContract: false,
      debtId: debt.id,
    });
    const tilgungId = db.listOneOff()[0].id;

    // The real payment books on the 10th — before the next installment (15th).
    const text = csv(
      row({ name: "Kreditbank AG", amount: "-400,00", bookingDate: "10.08.26", valueDate: "10.08.26", purpose: "Sondertilgung" })
    );
    const res = await actions.confirmCsvImportAction(text, null, [
      { fingerprint: fp(text, "Kreditbank AG"), category: null, oneOffId: tilgungId },
    ]);

    expect(res.ok).toBe(true);
    expect(db.listOneOff()).toHaveLength(0);
    const after = db.listRecurring()[0];
    expect(after.remainingAmount).toBe(600);
    expect(after.remainingAsOf).toBe("2026-08-10");
  });

  it("counts a duplicated one-off decision only once", async () => {
    const { actions, db } = await load();
    await actions.addOneOffAction({
      name: "TÜV",
      amount: 150,
      kind: "expense",
      date: "2026-08-15",
      isContract: false,
    });
    const id = db.listOneOff()[0].id;
    const text = csv(
      row({ name: "TUEV Nord", amount: "-150,00" }),
      row({ name: "TUEV Sued", amount: "-150,00", bookingDate: "11.08.26", valueDate: "11.08.26" })
    );
    const res = await actions.confirmCsvImportAction(text, 800, [
      { fingerprint: fp(text, "TUEV Nord"), category: null, oneOffId: id },
      { fingerprint: fp(text, "TUEV Sued"), category: null, oneOffId: id },
    ]);
    expect(res.review).toEqual({ categoriesApplied: 0, oneOffsResolved: 1 });
    expect(db.listOneOff()).toHaveLength(0);
  });
});

describe("startCsvCheckAction", () => {
  it("reports nothingNew when every row is already in the ledger", async () => {
    const { actions } = await load();
    const text = csv(row());
    await actions.confirmCsvImportAction(text, 100, []);
    const res = await actions.startCsvCheckAction(text);
    expect(res).toEqual({ ok: true, nothingNew: true });
  });

  it("asks for the balance before checking a first import", async () => {
    const { actions } = await load();
    const res = await actions.startCsvCheckAction(csv(row()));
    expect(res.ok).toBe(false);
    expect(res.needsBalance?.rows).toBe(1);
  });

  it("rejects a file that is not an Umsatz CSV", async () => {
    const { actions } = await load();
    const res = await actions.startCsvCheckAction("hello;world");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Sparkassen");
  });
});
