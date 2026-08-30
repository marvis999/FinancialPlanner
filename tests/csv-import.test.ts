import { describe, expect, it } from "vitest";

import { looksLikeUmsatzCsv, parseCsvTransactions } from "@/lib/csv-import";

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

describe("looksLikeUmsatzCsv", () => {
  it("needs both marker columns", () => {
    expect(looksLikeUmsatzCsv(HEADER)).toBe(true);
    expect(looksLikeUmsatzCsv('"Datum";"Wert"')).toBe(false);
  });
});

describe("parseDate (B15)", () => {
  it("accepts two- and four-digit years alike", () => {
    expect(parseCsvTransactions(csv(row({ bookingDate: "10.08.26" }))).records[0].date).toBe("2026-08-10");
    expect(parseCsvTransactions(csv(row({ bookingDate: "10.08.2026" }))).records[0].date).toBe("2026-08-10");
  });

  it("rejects a date that does not exist instead of normalising it", () => {
    // The old code produced "202026-08-15" for a four-digit year: lexically the
    // smallest date in the table, which reordered every running balance.
    const r = parseCsvTransactions(csv(row({ bookingDate: "31.02.26" }), row({ bookingDate: "10.13.26" })));
    expect(r.records).toHaveLength(0);
    expect(r.invalid).toBe(2);
  });

  it("never emits a six-digit year", () => {
    const r = parseCsvTransactions(csv(row({ bookingDate: "15.08.2026" })));
    expect(r.records[0].date).toBe("2026-08-15");
    expect(r.records.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date))).toBe(true);
  });
});

describe("parseAmount (B18)", () => {
  it("reads German grouping and decimals", () => {
    expect(parseCsvTransactions(csv(row({ amount: "-1.234,56" }))).records[0].amount).toBe(-1234.56);
    expect(parseCsvTransactions(csv(row({ amount: "0,01" }))).records[0].amount).toBe(0.01);
  });

  it("does not treat a decimal point as a thousands separator", () => {
    // "-1234.56" used to parse as -123456 because every dot was stripped.
    expect(parseCsvTransactions(csv(row({ amount: "-1234.56" }))).records[0].amount).toBe(-1234.56);
  });

  it("counts an unreadable amount as invalid rather than importing NaN", () => {
    const r = parseCsvTransactions(csv(row({ amount: "" }), row({ amount: "keine Zahl" })));
    expect(r.records).toHaveLength(0);
    expect(r.invalid).toBe(2);
  });
});

describe("booked filter (B20)", () => {
  it("drops pending rows", () => {
    const r = parseCsvTransactions(
      csv(row({ status: "Umsatz gebucht" }), row({ status: "Umsatz vorgemerkt", amount: "-9,99" }))
    );
    expect(r.records).toHaveLength(1);
    expect(r.invalid).toBe(0);
  });

  it("treats every row as booked when the file has no Info column", () => {
    // Previously r[-1] read "" for every row and the filter emptied the file,
    // telling the user it contained no booked transactions.
    const noInfo = [
      '"Buchungstag";"Betrag";"Waehrung"',
      '"10.08.26";"-12,99";"EUR"',
      '"11.08.26";"-4,99";"EUR"',
    ].join("\n");
    expect(parseCsvTransactions(noInfo).records).toHaveLength(2);
  });
});

describe("fingerprints", () => {
  it("distinguishes two genuinely identical bookings on the same day", () => {
    const r = parseCsvTransactions(csv(row(), row()));
    expect(r.records).toHaveLength(2);
    expect(r.records[0].fingerprint).not.toBe(r.records[1].fingerprint);
  });

  it("is stable across re-parses, and unaffected by a rejected neighbour", () => {
    const clean = parseCsvTransactions(csv(row(), row({ bookingDate: "11.08.26" })));
    const withJunk = parseCsvTransactions(
      csv(row(), row({ bookingDate: "11.08.26" }), row({ bookingDate: "31.02.26" }))
    );
    // Invalid rows are dropped BEFORE the occurrence counter, so the surviving
    // rows fingerprint exactly as they would in a clean file - which is what
    // keeps the UI and the CLI importer de-duplicating against each other.
    expect(withJunk.records.map((x) => x.fingerprint)).toEqual(
      clean.records.map((x) => x.fingerprint)
    );
    expect(withJunk.invalid).toBe(1);
  });
});
