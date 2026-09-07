import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCsvTransactions } from "@/lib/csv-import";
import {
  buildImportCheckPrompt,
  parseImportCheckAnswer,
  toCheckPayments,
} from "@/lib/import-check";
import type { ImportExpectedDue, ImportTransaction } from "@/lib/types";
import { freshDataDir } from "./helpers/db-harness";

/**
 * The import is where recurring charges get recognized: the check action
 * reports every new booking plus what the matcher settled and what it could
 * not, the model is asked only about the latter, and the confirm action
 * writes the accepted links and teaches each item its counterparty.
 */

const HEADER =
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";' +
  '"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";' +
  '"Betrag";"Waehrung";"Info"';

const ROW_DEFAULTS = {
  bookingDate: "01.08.26",
  valueDate: "01.08.26",
  bookingType: "SEPA-DAUERAUFTRAG",
  purpose: "Miete Wohnung 08/2026",
  name: "Hausverwaltung Musterhaus GmbH",
  iban: "DE02123456",
  bic: "TESTDEFF",
  amount: "-900,00",
  currency: "EUR",
  status: "Umsatz gebucht",
};

function row(over: Partial<typeof ROW_DEFAULTS> = {}): string {
  const fields = { ...ROW_DEFAULTS, ...over };
  return `"DE00";"${fields.bookingDate}";"${fields.valueDate}";"${fields.bookingType}";"${fields.purpose}";"${fields.name}";"${fields.iban}";"${fields.bic}";"${fields.amount}";"${fields.currency}";"${fields.status}"`;
}

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

function fp(text: string, name: string): string {
  const parsed = parseCsvTransactions(text).records.find((r) => r.name === name);
  if (!parsed) throw new Error(`no record named ${name}`);
  return parsed.fingerprint;
}

async function load() {
  freshDataDir();
  vi.resetModules();
  const db = await import("@/lib/db");
  const actions = await import("@/app/actions");
  return { actions, db };
}

afterEach(() => vi.resetModules());

const RENT = {
  name: "Miete",
  amount: 900,
  kind: "expense" as const,
  intervalMonths: 1,
  isContract: true,
  date: "2026-01-01",
  category: "wohnen",
};

describe("startCsvCheckAction summary", () => {
  it("lists every new booking and the due dates the matcher settled", async () => {
    const { actions } = await load();
    await actions.addRecurringAction(RENT);
    const text = csv(
      row(),
      row({ name: "REWE", purpose: "Einkauf", amount: "-42,10", bookingType: "KARTENZAHLUNG", bookingDate: "03.08.26", valueDate: "03.08.26" })
    );
    // First import: the balance prompt comes first, then the check starts.
    const res = await actions.startCsvCheckAction(text, 1000);
    expect(res.summary?.bookings.map((booking) => booking.name)).toEqual(["REWE", "Hausverwaltung Musterhaus GmbH"]);
    expect(res.summary?.recurringMatches).toEqual([
      expect.objectContaining({ name: "Miete", due: "2026-08-01", confidence: "heuristic" }),
    ]);
    expect(res.summary?.expected).toEqual([]);
    expect(res.summary).toMatchObject({ duplicates: 0, minDate: "2026-08-01", maxDate: "2026-08-03" });
    await actions.cancelCsvCheckAction();
  });

  it("reports a due date inside the file's span that no booking settles", async () => {
    const { actions } = await load();
    await actions.addRecurringAction(RENT);
    const text = csv(
      row({ name: "REWE", purpose: "Einkauf", amount: "-42,10", bookingDate: "30.07.26", valueDate: "30.07.26" }),
      row({ name: "REWE", purpose: "Einkauf", amount: "-12,00", bookingDate: "05.08.26", valueDate: "05.08.26" })
    );
    const res = await actions.startCsvCheckAction(text, 1000);
    expect(res.summary?.recurringMatches).toEqual([]);
    expect(res.summary?.expected).toEqual([
      { recurringId: expect.any(Number), name: "Miete", amount: 900, kind: "expense", due: "2026-08-01" },
    ]);
    await actions.cancelCsvCheckAction();
  });
});

describe("confirmCsvImportAction with recurring decisions", () => {
  it("links the accepted booking, teaches the pattern and records skipped due dates", async () => {
    const { actions, db } = await load();
    await actions.addRecurringAction(RENT);
    await actions.addRecurringAction({ ...RENT, name: "Netflix", amount: 13.99, date: "2026-01-12", category: "telefon" });
    const [netflix, rent] = db.listRecurring();
    expect(rent.name).toBe("Miete");

    const text = csv(row());
    const res = await actions.confirmCsvImportAction(
      text,
      1000,
      [{ fingerprint: fp(text, "Hausverwaltung Musterhaus GmbH"), category: null, oneOffId: null, recurringId: rent.id, recurringDue: "2026-08-01" }],
      [{ recurringId: netflix.id, due: "2026-08-12" }]
    );
    expect(res.review).toEqual({
      categoriesApplied: 0,
      oneOffsResolved: 0,
      recurringLinked: 1,
      duesSkipped: 1,
    });
    expect(res.transactions[0]).toMatchObject({ recurringId: rent.id, recurringDue: "2026-08-01" });
    const after = new Map(db.listRecurring().map((item) => [item.name, item]));
    expect(after.get("Miete")).toMatchObject({
      matchName: "hausverwaltung musterhaus gmbh",
      matchIban: "DE02123456",
    });
    expect(after.get("Netflix")?.skippedDues).toEqual(["2026-08-12"]);
  });

  it("recognizes the counterparty by pattern on the next import", async () => {
    const { actions, db } = await load();
    await actions.addRecurringAction(RENT);
    const rent = db.listRecurring()[0];
    const august = csv(row());
    await actions.confirmCsvImportAction(august, 1000, [
      { fingerprint: fp(august, "Hausverwaltung Musterhaus GmbH"), category: null, oneOffId: null, recurringId: rent.id, recurringDue: "2026-08-01" },
    ]);
    // Rent went up, and the purpose no longer says "Miete": only the learned
    // counterparty can recognize this one.
    const september = csv(
      row({ bookingDate: "01.09.26", valueDate: "01.09.26", purpose: "Wohnung Musterweg 12 09/2026", amount: "-950,00" })
    );
    const res = await actions.startCsvCheckAction(september);
    expect(res.summary?.recurringMatches).toEqual([
      expect.objectContaining({ recurringId: rent.id, due: "2026-09-01", confidence: "pattern" }),
    ]);
    await actions.cancelCsvCheckAction();
  });

  it("ignores links to unknown items, malformed dates and already settled due dates", async () => {
    const { actions, db } = await load();
    await actions.addRecurringAction(RENT);
    const rent = db.listRecurring()[0];
    const text = csv(
      row(),
      row({ name: "Zweite Zahlung", bookingDate: "02.08.26", valueDate: "02.08.26" })
    );
    const res = await actions.confirmCsvImportAction(text, 1000, [
      { fingerprint: fp(text, "Hausverwaltung Musterhaus GmbH"), category: null, oneOffId: null, recurringId: 999, recurringDue: "2026-08-01" },
      { fingerprint: fp(text, "Hausverwaltung Musterhaus GmbH"), category: null, oneOffId: null, recurringId: rent.id, recurringDue: "August" },
      { fingerprint: fp(text, "Hausverwaltung Musterhaus GmbH"), category: null, oneOffId: null, recurringId: rent.id, recurringDue: "2026-08-01" },
      { fingerprint: fp(text, "Zweite Zahlung"), category: null, oneOffId: null, recurringId: rent.id, recurringDue: "2026-08-01" },
    ]);
    expect(res.review?.recurringLinked).toBe(1);
    const linked = res.transactions.filter((transaction) => transaction.recurringId !== null);
    expect(linked.map((transaction) => transaction.name)).toEqual(["Hausverwaltung Musterhaus GmbH"]);
  });
});

describe("manual link actions", () => {
  it("links, unlinks and toggles a skipped due date", async () => {
    const { actions, db } = await load();
    await actions.addRecurringAction(RENT);
    const rent = db.listRecurring()[0];
    await actions.confirmCsvImportAction(csv(row()), 1000, []);
    const booking = db.listTransactions()[0];
    expect(booking.recurringId).toBeNull();

    let res = await actions.linkTransactionAction(booking.id, rent.id, "2026-08-01");
    expect(res.transactions[0]).toMatchObject({ recurringId: rent.id, recurringDue: "2026-08-01" });
    res = await actions.unlinkTransactionAction(booking.id);
    expect(res.transactions[0].recurringId).toBeNull();

    let state = await actions.setRecurringDueSkippedAction(rent.id, "2026-09-01", true);
    expect(state.recurring[0].skippedDues).toEqual(["2026-09-01"]);
    state = await actions.setRecurringDueSkippedAction(rent.id, "2026-09-01", false);
    expect(state.recurring[0].skippedDues).toEqual([]);
  });

  it("relinks the ledger for an item added after the import", async () => {
    const { actions, db } = await load();
    await actions.confirmCsvImportAction(csv(row()), 1000, []);
    await actions.addRecurringAction(RENT);
    const res = await actions.relinkRecurringAction();
    expect(res.linked).toBe(1);
    expect(res.transactions[0].recurringDue).toBe("2026-08-01");
    expect(db.listRecurring()[0].matchIban).toBe("DE02123456");
  });
});

/* ------------------------------------------------------------------------- */
/*  The model's recurring proposals                                           */
/* ------------------------------------------------------------------------- */

function record(over: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    date: "2026-08-02",
    valuta: "2026-08-02",
    name: "Vermieter Meier",
    amount: -900,
    currency: "EUR",
    type: "UEBERWEISUNG",
    purpose: "Wohnung",
    iban: "",
    bic: "",
    fingerprint: `fp-${over.name ?? "meier"}`,
    ...over,
  };
}

const EXPECTED: ImportExpectedDue[] = [
  { recurringId: 3, name: "Miete", amount: 900, kind: "expense", due: "2026-08-01" },
  { recurringId: 3, name: "Miete", amount: 900, kind: "expense", due: "2026-09-01" },
  { recurringId: 4, name: "Gehalt", amount: 2500, kind: "income", due: "2026-08-15" },
];

describe("parseImportCheckAnswer recurring proposals", () => {
  const payments = toCheckPayments([
    record(),
    record({ name: "Arbeitgeber", amount: 2500, date: "2026-08-14", purpose: "Lohn" }),
  ]);

  it("keeps a proposal that names an expected due date with the right sign", () => {
    const findings = parseImportCheckAnswer(
      [{ id: "t2", recurring: 3, due: "2026-08-01", recurringReason: "Landlord, rent amount" }],
      payments,
      [],
      EXPECTED
    );
    expect(findings).toEqual([
      expect.objectContaining({
        fingerprint: "fp-meier",
        recurring: { id: 3, name: "Miete", amount: 900, kind: "expense", due: "2026-08-01" },
        recurringReason: "Landlord, rent amount",
      }),
    ]);
  });

  it("needs the due date when the item has several open ones", () => {
    expect(parseImportCheckAnswer([{ id: "t2", recurring: 3 }], payments, [], EXPECTED)).toEqual([]);
    // One open due date: the date may be left out.
    expect(
      parseImportCheckAnswer([{ id: "t1", recurring: 4 }], payments, [], EXPECTED)[0]?.recurring
    ).toMatchObject({ id: 4, due: "2026-08-15" });
  });

  it("drops the wrong sign, unknown items and bookings the matcher already took", () => {
    expect(parseImportCheckAnswer([{ id: "t1", recurring: 3, due: "2026-08-01" }], payments, [], EXPECTED)).toEqual([]);
    expect(parseImportCheckAnswer([{ id: "t2", recurring: 77, due: "2026-08-01" }], payments, [], EXPECTED)).toEqual([]);
    expect(
      parseImportCheckAnswer(
        [{ id: "t2", recurring: 3, due: "2026-08-01" }],
        payments,
        [],
        EXPECTED,
        new Set(["fp-meier"])
      )
    ).toEqual([]);
  });

  it("lists the expected due dates in the prompt", () => {
    const prompt = buildImportCheckPrompt(payments, [], "Deutsch", EXPECTED);
    expect(prompt).toContain('"name":"Miete"');
    expect(prompt).toContain('"due":"2026-08-01"');
    expect(prompt).toContain('"amount":2500');
  });
});
