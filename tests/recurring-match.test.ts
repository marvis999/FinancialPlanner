import { describe, expect, it } from "vitest";

import {
  dueDatesBetween,
  fixedChargesByCategory,
  linksByRecurring,
  matchRecurring,
  normalizeName,
  recurringStatus,
  settledKey,
  type MatchCandidate,
} from "@/lib/recurring-match";
import type { RecurringItem, TransactionItem } from "@/lib/types";

let nextId = 1;

function item(over: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: nextId++,
    name: "Miete",
    amount: 900,
    kind: "expense",
    intervalMonths: 1,
    isContract: true,
    date: "2026-01-01",
    remainingAmount: null,
    remainingAsOf: null,
    endDate: null,
    isActive: true,
    category: "wohnen",
    matchName: null,
    matchIban: null,
    skippedDues: [],
    ...over,
  };
}

function booking(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    key: `k${nextId++}`,
    date: "2026-08-01",
    name: "Hausverwaltung Musterhaus GmbH",
    purpose: "Miete Wohnung 08/2026",
    amount: -900,
    iban: "DE02 1234",
    ...over,
  };
}

function ledger(over: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: nextId++,
    date: "2026-08-01",
    name: "Hausverwaltung Musterhaus GmbH",
    amount: -900,
    type: "SEPA-DAUERAUFTRAG",
    purpose: "Miete",
    counterpartyIban: "DE021234",
    balance: 0,
    category: null,
    tags: [],
    recurringId: null,
    recurringDue: null,
    ...over,
  };
}

const NONE = new Set<string>();

describe("dueDatesBetween", () => {
  it("includes a due date on the first day of the window", () => {
    expect(dueDatesBetween(item(), "2026-08-01", "2026-09-30")).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);
  });

  it("stops at the end date", () => {
    expect(
      dueDatesBetween(item({ endDate: "2026-08-15" }), "2026-08-01", "2026-09-30")
    ).toEqual(["2026-08-01"]);
  });
});

describe("matchRecurring without a learned pattern", () => {
  it("proposes a booking with the exact amount and a word of the name", () => {
    const rent = item();
    const { matches, expected } = matchRecurring([rent], [booking()], NONE);
    expect(matches).toEqual([
      { key: expect.any(String), recurringId: rent.id, due: "2026-08-01", confidence: "heuristic" },
    ]);
    expect(expected).toEqual([]);
  });

  it("refuses a near amount: any 'Miete' in a purpose would claim the rent", () => {
    const { matches, expected } = matchRecurring(
      [item()],
      [booking({ amount: -890 })],
      NONE
    );
    expect(matches).toEqual([]);
    expect(expected).toEqual([{ recurringId: expect.any(Number), due: "2026-08-01" }]);
  });

  it("refuses the wrong sign", () => {
    expect(matchRecurring([item()], [booking({ amount: 900 })], NONE).matches).toEqual([]);
  });

  it("refuses a booking outside the due window", () => {
    const { matches } = matchRecurring(
      [item()],
      [booking({ date: "2026-08-15" })],
      NONE,
      { from: "2026-08-10", to: "2026-08-20" }
    );
    expect(matches).toEqual([]);
  });

  it("legal forms and banking words identify nothing", () => {
    const gym = item({ name: "Fitnessstudio GmbH", amount: 29.9 });
    const { matches } = matchRecurring(
      [gym],
      [booking({ name: "Irgendwas GmbH", purpose: "SEPA Lastschrift", amount: -29.9 })],
      NONE
    );
    expect(matches).toEqual([]);
  });
});

describe("matchRecurring with a learned pattern", () => {
  it("links by IBAN even when the amount drifted", () => {
    const power = item({ name: "Strom", amount: 92, matchIban: "DE99 0001" });
    const { matches } = matchRecurring(
      [power],
      [booking({ name: "Stadtwerke", purpose: "Abschlag", amount: -104, iban: "DE990001" })],
      NONE
    );
    expect(matches).toEqual([
      { key: expect.any(String), recurringId: power.id, due: "2026-08-01", confidence: "pattern" },
    ]);
  });

  it("links by normalized name", () => {
    const rent = item({ matchName: normalizeName("Hausverwaltung Musterhaus GmbH") });
    const { matches } = matchRecurring(
      [rent],
      [booking({ name: "HAUSVERWALTUNG MUSTERHAUS GMBH", purpose: "", amount: -900 })],
      NONE
    );
    expect(matches[0]?.confidence).toBe("pattern");
  });

  it("still refuses an amount far off the item", () => {
    const power = item({ name: "Strom", amount: 92, matchIban: "DE990001" });
    const { matches } = matchRecurring(
      [power],
      [booking({ name: "Stadtwerke", purpose: "Nachzahlung", amount: -400, iban: "DE990001" })],
      NONE
    );
    expect(matches).toEqual([]);
  });
});

describe("matchRecurring assignment", () => {
  it("settles each due date at most once and prefers the closest booking", () => {
    const rent = item();
    const late = booking({ key: "late", date: "2026-08-04" });
    const onTime = booking({ key: "ontime", date: "2026-08-01" });
    const { matches } = matchRecurring([rent], [late, onTime], NONE);
    expect(matches.map((match) => match.key)).toEqual(["ontime"]);
  });

  it("leaves a due date alone that the ledger already settled", () => {
    const rent = item();
    const settled = new Set([settledKey(rent.id, "2026-08-01")]);
    const { matches, expected } = matchRecurring([rent], [booking()], settled);
    expect(matches).toEqual([]);
    expect(expected).toEqual([]);
  });

  it("resolves two items at one insurer by the exact amount", () => {
    const home = item({ name: "Hausrat Versicherung", amount: 12.5, category: "versicherungen" });
    const car = item({ name: "Kfz Versicherung", amount: 384, intervalMonths: 12, date: "2026-01-10", category: "versicherungen" });
    const { matches } = matchRecurring(
      [home, car],
      [
        booking({ key: "a", name: "Muster Versicherung AG", purpose: "Beitrag", amount: -12.5 }),
        booking({ key: "b", name: "Muster Versicherung AG", purpose: "Beitrag", amount: -384, date: "2026-01-10" }),
      ],
      NONE,
      { from: "2026-01-01", to: "2026-08-31" }
    );
    expect(matches.map((match) => [match.key, match.recurringId])).toEqual(
      expect.arrayContaining([["a", home.id], ["b", car.id]])
    );
  });

  it("reports every unsettled due date in the window, oldest first", () => {
    const rent = item();
    const netflix = item({ name: "Netflix", amount: 13.99, date: "2026-01-12" });
    const { expected } = matchRecurring([rent, netflix], [], NONE, {
      from: "2026-07-01",
      to: "2026-08-31",
    });
    expect(expected).toEqual([
      { recurringId: rent.id, due: "2026-07-01" },
      { recurringId: netflix.id, due: "2026-07-12" },
      { recurringId: rent.id, due: "2026-08-01" },
      { recurringId: netflix.id, due: "2026-08-12" },
    ]);
  });

  it("does not expect a skipped due date or a paused item", () => {
    const rent = item({ skippedDues: ["2026-08-01"] });
    const paused = item({ name: "Alt", isActive: false });
    const { expected } = matchRecurring([rent, paused], [], NONE, {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(expected).toEqual([]);
  });
});

describe("recurringStatus", () => {
  it("is settled when the latest due date has a link", () => {
    const rent = item();
    const links = linksByRecurring([
      ledger({ id: 77, recurringId: rent.id, recurringDue: "2026-08-01", date: "2026-08-02" }),
    ]);
    expect(recurringStatus(rent, links.get(rent.id) ?? [], "2026-08-20")).toEqual({
      kind: "settled",
      due: "2026-08-01",
      date: "2026-08-02",
      amount: -900,
      transactionId: 77,
    });
  });

  it("is open with the days since the due date otherwise", () => {
    const rent = item({ matchIban: "DE1" });
    expect(recurringStatus(rent, [], "2026-08-04")).toEqual({
      kind: "open",
      due: "2026-08-01",
      daysOpen: 3,
      recognizable: true,
    });
  });

  it("cannot call an item missing that was never confirmed", () => {
    const status = recurringStatus(item(), [], "2026-08-04");
    expect(status).toMatchObject({ kind: "open", recognizable: false });
  });

  it("is upcoming for a schedule that has not started", () => {
    expect(recurringStatus(item({ date: "2026-10-01" }), [], "2026-08-04")).toEqual({
      kind: "upcoming",
      due: "2026-10-01",
    });
  });

  it("is skipped for a due date marked as such", () => {
    expect(
      recurringStatus(item({ skippedDues: ["2026-08-01"] }), [], "2026-08-04")
    ).toEqual({ kind: "skipped", due: "2026-08-01" });
  });

  it("ignores paused items", () => {
    expect(recurringStatus(item({ isActive: false }), [], "2026-08-04")).toBeNull();
  });
});

describe("fixedChargesByCategory", () => {
  const period = { start: "2026-08-01", end: "2026-08-31" };

  it("counts a linked booking as charged and an unlinked future due date as due", () => {
    const rent = item();
    const netflix = item({ name: "Netflix", amount: 13.99, date: "2026-01-12", category: "telefon" });
    const charges = fixedChargesByCategory(
      [rent, netflix],
      [ledger({ recurringId: rent.id, recurringDue: "2026-08-01" })],
      period,
      "2026-08-05"
    );
    expect(charges.get("wohnen")).toEqual({ charged: 900, due: 0, items: ["Miete"] });
    expect(charges.get("telefon")).toEqual({ charged: 0, due: 13.99, items: ["Netflix"] });
  });

  it("assumes a past unlinked charge is in the bookings only for an unconfirmed item", () => {
    const unknown = item({ name: "Miete" });
    const known = item({ name: "Strom", amount: 92, matchIban: "DE1", date: "2026-01-03" });
    const charges = fixedChargesByCategory([unknown, known], [], period, "2026-08-10");
    expect(charges.get("wohnen")).toEqual({ charged: 900, due: 92, items: ["Miete", "Strom"] });
  });

  it("leaves out skipped due dates and items without a category", () => {
    const rent = item({ skippedDues: ["2026-08-01"] });
    const loose = item({ name: "Sonst", category: null });
    expect(fixedChargesByCategory([rent, loose], [], period, "2026-08-10").size).toBe(0);
  });
});
