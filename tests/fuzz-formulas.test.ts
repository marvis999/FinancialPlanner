import { describe, expect, it } from "vitest";

import { parseCsvTransactions } from "@/lib/csv-import";
import { budgetPeriodOf, clampBudgetStartDay, daysInWindow, nextDay } from "@/lib/period";
import {
  addMonthsClamped,
  averageMonthlyNet,
  projectBudgetSpend,
} from "@/lib/projection";
import { euroParts, formatAmountInput, formatEuro, parseAmountInput } from "@/lib/utils";
import { forAll, isoDate, type Rng } from "./helpers/fuzz";

/**
 * Fuzz the parsers and the small formulas against independent oracles:
 * amounts typed or exported in either locale, the bank CSV, budget periods,
 * month arithmetic, the monthly average and the budget pace.
 */

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOfUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Oracle for addMonthsClamped, built on Date instead of month arithmetic. */
function addMonthsOracle(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(d, lastDay));
  return isoOfUtc(firstOfTarget.getTime());
}

/** Random amount in cents, mostly everyday sizes, sometimes extreme. */
function cents(random: Rng): number {
  const size = random.pick([100, 10_000, 1_000_000, 100_000_000, 1_000_000_000]);
  const value = random.int(0, size);
  return random.chance(0.5) ? -value : value;
}

describe("amounts", () => {
  it("parses back what the input field shows, in both languages", () => {
    forAll(1, 5000, (random) => ({ value: cents(random) / 100, locale: random.pick(["de", "en"] as const) }), ({ value, locale }) => {
      const shown = formatAmountInput(value, locale);
      expect(parseAmountInput(shown, locale)).toBe(value);
      // With a euro sign and stray spaces, as people paste it.
      expect(parseAmountInput(` ${shown} € `, locale)).toBe(value);
    });
  });

  it("splits a formatted amount into sign and number without losing a digit", () => {
    forAll(2, 3000, (random) => ({ value: cents(random) / 100, locale: random.pick(["de", "en"] as const) }), ({ value, locale }) => {
      const parts = euroParts(value, locale);
      expect(parts.filter((part) => part.currency)).toHaveLength(1);
      expect(parts.map((part) => part.text).join("")).toBe(formatEuro(value, locale).replace(/\s/g, ""));
    });
  });

  it("reads the one ambiguous shape by language", () => {
    expect(parseAmountInput("3.850", "de")).toBe(3850);
    expect(parseAmountInput("3.850", "en")).toBe(3.85);
    expect(parseAmountInput("1,234", "en")).toBe(1234);
    expect(parseAmountInput("1,234", "de")).toBe(1.234);
    // Two decimals after a lone comma cannot be thousands, in either language.
    expect(parseAmountInput("12,50", "en")).toBe(12.5);
    expect(parseAmountInput("-0,01", "en")).toBe(-0.01);
    expect(parseAmountInput("1,234,567", "en")).toBe(1234567);
    for (const junk of ["", " ", "€", "abc", "1,2,3.4.5x", "--5"]) {
      expect(parseAmountInput(junk)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Bank CSV
// ---------------------------------------------------------------------------

const HEADER =
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";' +
  '"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";' +
  '"Betrag";"Waehrung";"Info"';

/** German export format: thousands dots, decimal comma, always two decimals. */
function germanAmount(valueCents: number): string {
  const sign = valueCents < 0 ? "-" : "";
  const abs = Math.abs(valueCents);
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${euros},${String(abs % 100).padStart(2, "0")}`;
}

interface CsvRow {
  line: string;
  /** null: the row is booked but unparsable and must be counted as invalid. */
  expected: { date: string; cents: number } | null;
  booked: boolean;
}

const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;

function csvRow(random: Rng): CsvRow {
  const date = isoDate(random, 2020, 2030);
  const [y, m, d] = date.split("-");
  const booked = random.chance(0.9);
  let dateText = random.chance(0.5) ? `${d}.${m}.${y.slice(2)}` : `${d}.${m}.${y}`;
  let valid = true;
  if (random.chance(0.05)) {
    dateText = random.pick(["31.02.26", "00.10.26", "15.13.26", "2026-10-15", "15/10/26", ""]);
    valid = false;
  }
  const value = cents(random);
  let amountText = germanAmount(value);
  if (random.chance(0.03)) {
    amountText = random.pick(["", "abc", "1,2,3"]);
    valid = false;
  }
  const purpose = random.pick([
    "Miete 10/2026",
    'Abo "Premium"; Monat Oktober',
    "Einkauf;Filiale 4711",
    "SVWZ+Rechnung RG-2026-001",
    "",
  ]);
  const name = random.pick(["REWE Markt", "Hausverwaltung GmbH", "Max Mustermann", "", "Stadtwerke; Netz"]);
  const line = [
    "DE00",
    dateText,
    dateText,
    random.pick(["KARTENZAHLUNG", "LASTSCHRIFT", "GUTSCHRIFT"]),
    purpose,
    name,
    random.chance(0.5) ? "DE02120300000000202051" : "",
    "BYLADEM1001",
    amountText,
    "EUR",
    booked ? "Umsatz gebucht" : "Umsatz vorgemerkt",
  ]
    .map(quote)
    .join(";");
  return { line, booked, expected: valid ? { date, cents: value } : null };
}

describe("bank CSV import", () => {
  it("reads every booked row exactly once, with the right date and amount", () => {
    forAll(3, 400, (random) => Array.from({ length: random.int(1, 40) }, () => csvRow(random)), (rows) => {
      const text = [HEADER, ...rows.map((row) => row.line)].join(random3(rows) ? "\r\n" : "\n");
      const parsed = parseCsvTransactions(text);
      const booked = rows.filter((row) => row.booked);
      const good = booked.filter((row) => row.expected);
      expect(parsed.records).toHaveLength(good.length);
      expect(parsed.invalid).toBe(booked.length - good.length);

      const got = parsed.records.map((record) => `${record.date}|${Math.round(record.amount * 100)}`).sort();
      const want = good.map((row) => `${row.expected!.date}|${row.expected!.cents}`).sort();
      expect(got).toEqual(want);

      // Fingerprints: unique, stable across parses and across row order.
      const fingerprints = parsed.records.map((record) => record.fingerprint);
      expect(new Set(fingerprints).size).toBe(fingerprints.length);
      expect(parseCsvTransactions(text).records.map((record) => record.fingerprint)).toEqual(fingerprints);
      const reversed = [HEADER, ...[...rows].reverse().map((row) => row.line)].join("\n");
      expect(new Set(parseCsvTransactions(reversed).records.map((record) => record.fingerprint))).toEqual(
        new Set(fingerprints)
      );
    });
  });
});

/** Some files use Windows line endings; decided by the rows, so it is seeded too. */
function random3(rows: CsvRow[]): boolean {
  return rows.length % 3 === 0;
}

// ---------------------------------------------------------------------------
// Dates and periods
// ---------------------------------------------------------------------------

describe("month arithmetic and budget periods", () => {
  it("adds months like the calendar does, clamping to short months", () => {
    forAll(4, 5000, (random) => ({ date: isoDate(random, 1999, 2101), months: random.int(-1300, 1300) }), ({ date, months }) => {
      expect(addMonthsClamped(date, months)).toBe(addMonthsOracle(date, months));
    });
  });

  it("puts every day in exactly one budget period of the right shape", () => {
    forAll(
      5,
      5000,
      (random) => ({ date: isoDate(random, 1999, 2101), startDay: random.pick([random.int(1, 28), random.int(-5, 40), Number.NaN, 2.5]) }),
      ({ date, startDay }) => {
        const day = clampBudgetStartDay(startDay);
        const period = budgetPeriodOf(date, startDay);
        expect(period.start <= date && date <= period.end).toBe(true);
        expect(Number(period.start.slice(8))).toBe(day);
        // The next period starts the day after this one ends, on the same day of month.
        const next = budgetPeriodOf(nextDay(period.end), startDay);
        expect(next.start).toBe(nextDay(period.end));
        expect(next.start).toBe(addMonthsOracle(period.start, 1));
        const length = daysInWindow(period.start, period.end);
        expect(length).toBeGreaterThanOrEqual(28);
        expect(length).toBeLessThanOrEqual(31);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// Averages and the budget pace
// ---------------------------------------------------------------------------

/** Oracle for averageMonthlyNet: the documented formula, written out again. */
function averageOracle(rows: { date: string; amount: number }[], today: string): number | null {
  const dates = rows.map((row) => row.date).filter((date) => date <= today).sort();
  if (!dates.length) return null;
  const max = dates[dates.length - 1];
  const floor = addMonthsOracle(max, -24);
  const min = dates[0] > floor ? dates[0] : floor;
  const days = Math.round((utc(max) - utc(min)) / DAY_MS) + 1;
  if (days < 28) return null;
  const net = rows.filter((row) => row.date >= min && row.date <= max).reduce((sum, row) => sum + row.amount, 0);
  return net / (days / 30.436875);
}

describe("monthly average and budget pace", () => {
  it("averages the net over the real length of the window, at most 24 months", () => {
    forAll(
      6,
      2000,
      (random) => ({
        today: isoDate(random, 2025, 2027),
        rows: Array.from({ length: random.int(0, 60) }, () => ({
          date: isoDate(random, 2021, 2028),
          amount: cents(random) / 100,
        })),
      }),
      ({ today, rows }) => {
        const got = averageMonthlyNet(rows, today);
        const want = averageOracle(rows, today);
        if (want === null) expect(got).toBeNull();
        else expect(got).toBeCloseTo(want, 6);
        // Doubling every amount doubles the average.
        const doubled = averageMonthlyNet(rows.map((row) => ({ ...row, amount: row.amount * 2 })), today);
        if (got === null) expect(doubled).toBeNull();
        else expect(doubled).toBeCloseTo(got * 2, 6);
      }
    );
  });

  it("extrapolates only the variable spend and never projects below the fixed charges", () => {
    forAll(
      7,
      5000,
      (random) => ({
        spent: cents(random) / 100,
        charged: cents(random) / 100,
        due: cents(random) / 100,
        elapsed: random.int(-3, 31),
        total: random.int(28, 31),
      }),
      ({ spent, charged, due, elapsed, total }) => {
        const pace = projectBudgetSpend(spent, { charged, due }, elapsed, total);
        const fixed = Math.max(0, charged) + Math.max(0, due);
        expect(pace.fixed).toBeCloseTo(fixed, 9);
        expect(pace.variable).toBeGreaterThanOrEqual(0);
        expect(pace.variable).toBeLessThanOrEqual(Math.max(0, spent) + 1e-9);
        expect(pace.perDay * Math.max(1, elapsed)).toBeCloseTo(pace.variable, 6);
        expect(pace.projected).toBeCloseTo(fixed + pace.perDay * total, 6);
        expect(pace.projected).toBeGreaterThanOrEqual(fixed - 1e-9);
        // What is already charged is not extrapolated: spending exactly the
        // fixed charges projects exactly them.
        if (charged > 0) {
          expect(projectBudgetSpend(charged, { charged, due: 0 }, elapsed, total).projected).toBeCloseTo(charged, 6);
        }
      }
    );
  });
});

