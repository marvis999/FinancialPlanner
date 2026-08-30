import crypto from "node:crypto";

import type { Kind, Settings } from "./types";

/**
 * A completely fictional household, generated from "today" so the demo always
 * shows a current ledger and a forecast that starts now.
 *
 * Every name, merchant and amount here is invented. Nothing in this file comes
 * from a real account. It exists so the app can be shown to someone without
 * opening real finances, and so screenshots are not personal.
 *
 * The generator is deterministic apart from `today`: the same day always
 * produces the same dataset, so a reset restores exactly what was there.
 */

// ---------------------------------------------------------------------------
// Shapes the seeder writes
// ---------------------------------------------------------------------------

export interface DemoRecurring {
  name: string;
  amount: number;
  kind: Kind;
  intervalMonths: number;
  isContract: boolean;
  date: string;
  remainingAmount: number | null;
  remainingAsOf: string | null;
  endDate: string | null;
  category: string | null;
}

export interface DemoOneOff {
  name: string;
  amount: number;
  kind: Kind;
  date: string;
  isContract: boolean;
  /** Name of the recurring debt this pays down; resolved to an id on insert. */
  debtName: string | null;
  isActive: boolean;
}

export interface DemoBudget {
  category: string;
  amount: number;
}

export interface DemoTransaction {
  date: string;
  valuta: string;
  name: string;
  amount: number; // signed: + income, - expense
  currency: string;
  type: string;
  purpose: string;
  iban: string;
  bic: string;
  fingerprint: string;
  /** Explicit category where the keyword fallback would guess wrong. */
  category: string | null;
}

export interface DemoDataset {
  settings: Settings;
  recurring: DemoRecurring[];
  oneoff: DemoOneOff[];
  budgets: DemoBudget[];
  transactions: DemoTransaction[];
  /** Balance after the newest booking; the ledger is anchored to it. */
  currentBalance: number;
}

// ---------------------------------------------------------------------------
// Small helpers (local-date safe: never parses "YYYY-MM-DD" as UTC)
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** "YYYY-MM-DD" for the given day, clamped to the last day of that month. */
function iso(year: number, month: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

interface Month {
  year: number;
  month: number; // 1-12
}

function addMonths({ year, month }: Month, delta: number): Month {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function monthOf(isoDate: string): Month {
  return { year: Number(isoDate.slice(0, 4)), month: Number(isoDate.slice(5, 7)) };
}

/** xorshift32: deterministic, so the same day always yields the same demo. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// The fictional household
// ---------------------------------------------------------------------------

/** Months of ledger history the demo carries. */
const HISTORY_MONTHS = 15;

/** Balance the oldest booking starts from; the anchor is derived forwards. */
const OPENING_BALANCE = 2400;

const SALARY = 2980;
const RENT = 1020;
const LOAN_RATE = 249;
/** Installments still to run on the demo car loan. */
const LOAN_REMAINING_RATES = 27;

const EMPLOYER = "Musterfirma GmbH & Co. KG";
const LANDLORD = "Hausverwaltung Musterhaus GmbH";
const INSURER = "Muster Versicherung AG";
const LOAN_BANK = "Autobank Finanzierung AG";

interface Merchant {
  name: string;
  type: string;
  purpose: string;
  min: number;
  max: number;
}

const GROCERS: Merchant[] = [
  { name: "REWE Markt GmbH", type: "KARTENZAHLUNG", purpose: "REWE SAGT DANKE", min: 16, max: 94 },
  { name: "EDEKA Musterstadt", type: "KARTENZAHLUNG", purpose: "EDEKA//MUSTERSTADT", min: 14, max: 88 },
  { name: "ALDI SAGT DANKE", type: "KARTENZAHLUNG", purpose: "ALDI SAGT DANKE", min: 11, max: 72 },
  { name: "LIDL Dienstleistung", type: "KARTENZAHLUNG", purpose: "LIDL SAGT DANKE", min: 12, max: 76 },
  { name: "PENNY Markt", type: "KARTENZAHLUNG", purpose: "PENNY MUSTERSTADT", min: 9, max: 54 },
  { name: "dm drogerie markt", type: "KARTENZAHLUNG", purpose: "DM DROGERIE MARKT", min: 7, max: 46 },
  { name: "ROSSMANN Drogerie", type: "KARTENZAHLUNG", purpose: "ROSSMANN 1234", min: 6, max: 41 },
];

const FUEL: Merchant[] = [
  { name: "ARAL Tankstelle", type: "KARTENZAHLUNG", purpose: "ARAL MUSTERSTADT", min: 42, max: 88 },
  { name: "Shell Deutschland", type: "KARTENZAHLUNG", purpose: "SHELL MUSTERSTADT", min: 40, max: 92 },
  { name: "JET Tankstelle", type: "KARTENZAHLUNG", purpose: "JET DANKT MUSTERSTADT", min: 38, max: 84 },
];

const SHOPPING: Merchant[] = [
  { name: "AMAZON.DE", type: "SEPA-LASTSCHRIFT", purpose: "AMAZON.DE Bestellung", min: 12, max: 148 },
  { name: "PayPal Europe", type: "SEPA-LASTSCHRIFT", purpose: "PAYPAL Mustershop", min: 9, max: 132 },
  { name: "IKEA Deutschland", type: "KARTENZAHLUNG", purpose: "IKEA MUSTERSTADT", min: 24, max: 210 },
  { name: "ZALANDO SE", type: "SEPA-LASTSCHRIFT", purpose: "ZALANDO Bestellung", min: 19, max: 165 },
  { name: "TEDi GmbH", type: "KARTENZAHLUNG", purpose: "TEDI MUSTERSTADT", min: 5, max: 38 },
];

const MISC: Merchant[] = [
  { name: "Baeckerei Musterstadt", type: "KARTENZAHLUNG", purpose: "BAECKEREI MUSTERSTADT", min: 4, max: 22 },
  { name: "Ristorante Da Vinci", type: "KARTENZAHLUNG", purpose: "RISTORANTE DA VINCI", min: 22, max: 78 },
  { name: "Kino Musterstadt", type: "KARTENZAHLUNG", purpose: "KINO MUSTERSTADT", min: 11, max: 34 },
  { name: "Apotheke am Markt", type: "KARTENZAHLUNG", purpose: "APOTHEKE AM MARKT", min: 8, max: 52 },
  { name: "Friseur Salon Meier", type: "KARTENZAHLUNG", purpose: "SALON MEIER", min: 18, max: 44 },
];

/** One-time bookings in the past, so the actual balance line is not a ramp. */
const PAST_EVENTS: Array<{
  monthsAgo: number;
  day: number;
  name: string;
  type: string;
  purpose: string;
  amount: number;
  category: string | null;
}> = [
  {
    monthsAgo: 11,
    day: 18,
    name: "Autohaus Musterstadt",
    type: "SEPA-UEBERWEISUNG",
    purpose: "Reparatur Kupplung Rechnung 2291",
    amount: -1240,
    category: null,
  },
  {
    monthsAgo: 8,
    day: 9,
    name: "Finanzamt Musterstadt",
    type: "SEPA-GUTSCHRIFT",
    purpose: "Einkommensteuererstattung",
    amount: 840,
    category: null,
  },
  {
    monthsAgo: 5,
    day: 22,
    name: "AMAZON.DE",
    type: "SEPA-LASTSCHRIFT",
    purpose: "AMAZON.DE Notebook Bestellung",
    amount: -1499,
    category: null,
  },
  {
    monthsAgo: 3,
    day: 6,
    name: "Hotel Fjordblick",
    type: "KARTENZAHLUNG",
    purpose: "HOTEL FJORDBLICK BERGEN",
    amount: -680,
    category: null,
  },
  {
    monthsAgo: 3,
    day: 2,
    name: "Deutsche Bahn AG",
    type: "SEPA-LASTSCHRIFT",
    purpose: "DB Fernverkehr Buchung",
    amount: -128,
    category: null,
  },
];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function between(rng: () => number, min: number, max: number): number {
  return round2(min + rng() * (max - min));
}

/**
 * Same shape as the CSV importer's fingerprint, prefixed with "demo" so a
 * generated row can never collide with a real imported booking.
 */
function fingerprintOf(row: {
  date: string;
  amount: number;
  name: string;
  purpose: string;
  occurrence: number;
}): string {
  return crypto
    .createHash("sha256")
    .update(["demo", row.date, row.amount.toFixed(2), row.name, row.purpose, row.occurrence].join("|"))
    .digest("hex");
}

/** Build the whole fictional dataset for a given "today" (YYYY-MM-DD). */
export function buildDemoDataset(today: string): DemoDataset {
  const rng = makeRng(0x5eed1234);
  const nowMonth = monthOf(today);
  const firstMonth = addMonths(nowMonth, -(HISTORY_MONTHS - 1));

  const rows: Array<Omit<DemoTransaction, "fingerprint">> = [];

  const add = (
    date: string,
    name: string,
    amount: number,
    type: string,
    purpose: string,
    category: string | null = null
  ): void => {
    // The ledger is history: a demo generated mid-month must not book the
    // rest of the month, or the "current balance" would be in the future.
    if (date > today) return;
    rows.push({
      date,
      valuta: date,
      name,
      amount: round2(amount),
      currency: "EUR",
      type,
      purpose,
      iban: "",
      bic: "",
      category,
    });
  };

  for (let i = 0; i < HISTORY_MONTHS; i++) {
    const { year, month } = addMonths(firstMonth, i);
    const label = `${String(month).padStart(2, "0")}/${year}`;

    // -- fixed monthly bookings -------------------------------------------
    add(iso(year, month, 1), LANDLORD, -RENT, "SEPA-DAUERAUFTRAG", `Miete Wohnung Musterweg 12 ${label}`);
    add(iso(year, month, 2), INSURER, -12.5, "SEPA-LASTSCHRIFT", "Hausratversicherung Beitrag");
    add(iso(year, month, 3), "Stadtwerke Musterstadt", -92, "SEPA-LASTSCHRIFT", `Abschlag Strom ${label}`);
    add(iso(year, month, 5), "Vodafone GmbH", -39.99, "SEPA-LASTSCHRIFT", "Internet & Telefon");
    add(iso(year, month, 7), "Telefonica Germany", -24.99, "SEPA-LASTSCHRIFT", "Mobilfunk Rechnung");
    add(iso(year, month, 8), "Fitnessstudio Musterstadt", -29.9, "SEPA-LASTSCHRIFT", "Mitgliedsbeitrag");
    add(iso(year, month, 12), "NETFLIX INTERNATIONAL", -13.99, "SEPA-LASTSCHRIFT", "Netflix Abo");
    add(iso(year, month, 15), EMPLOYER, SALARY, "SEPA-GUTSCHRIFT", `Gehalt ${label}`);
    add(iso(year, month, 15), "Musterbroker Sparplan", -150, "SEPA-LASTSCHRIFT", "ETF-Sparplan Ausfuehrung");
    add(iso(year, month, 20), "Spotify AB", -10.99, "SEPA-LASTSCHRIFT", "Spotify Premium");
    add(iso(year, month, 28), LOAN_BANK, -LOAN_RATE, "SEPA-LASTSCHRIFT", "Rate Autokredit Vertrag 4711", "kredite");

    // -- periodic ----------------------------------------------------------
    if (month % 3 === 1) {
      add(iso(year, month, 15), "Rundfunk ARD ZDF", -55.08, "SEPA-LASTSCHRIFT", "Rundfunkbeitrag Quartal");
    }
    if (month === 1) {
      add(iso(year, month, 10), INSURER, -384, "SEPA-LASTSCHRIFT", "Kfz-Versicherung Jahresbeitrag");
    }
    if (month === 12) {
      // No income keyword matches "Weihnachtsgeld", so it is assigned by hand.
      add(iso(year, month, 1), EMPLOYER, 1200, "SEPA-GUTSCHRIFT", "Weihnachtsgeld", "einkommen");
    }

    // -- variable spending --------------------------------------------------
    const groceryRuns = 8 + Math.floor(rng() * 6);
    for (let g = 0; g < groceryRuns; g++) {
      const merchant = pick(rng, GROCERS);
      add(iso(year, month, 2 + Math.floor(rng() * 26)), merchant.name, -between(rng, merchant.min, merchant.max), merchant.type, merchant.purpose);
    }
    const fuelRuns = 2 + Math.floor(rng() * 2);
    for (let f = 0; f < fuelRuns; f++) {
      const merchant = pick(rng, FUEL);
      add(iso(year, month, 3 + Math.floor(rng() * 25)), merchant.name, -between(rng, merchant.min, merchant.max), merchant.type, merchant.purpose);
    }
    const shopRuns = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < shopRuns; s++) {
      const merchant = pick(rng, SHOPPING);
      add(iso(year, month, 2 + Math.floor(rng() * 26)), merchant.name, -between(rng, merchant.min, merchant.max), merchant.type, merchant.purpose);
    }
    const miscRuns = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < miscRuns; s++) {
      const merchant = pick(rng, MISC);
      add(iso(year, month, 2 + Math.floor(rng() * 26)), merchant.name, -between(rng, merchant.min, merchant.max), merchant.type, merchant.purpose);
    }
    add(
      iso(year, month, 16 + Math.floor(rng() * 8)),
      "Geldautomat Musterstadt",
      -(50 + Math.floor(rng() * 3) * 50),
      "BARGELDAUSZAHLUNG",
      "Bargeldauszahlung GA MUSTERSTADT"
    );
  }

  for (const event of PAST_EVENTS) {
    const { year, month } = addMonths(nowMonth, -event.monthsAgo);
    add(iso(year, month, event.day), event.name, event.amount, event.type, event.purpose, event.category);
  }

  // Ledger order, then stable fingerprints for repeated (day, merchant, amount).
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const seen = new Map<string, number>();
  const transactions: DemoTransaction[] = rows.map((row) => {
    const base = [row.date, row.amount.toFixed(2), row.name, row.purpose].join("|");
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { ...row, fingerprint: fingerprintOf({ ...row, occurrence }) };
  });

  const net = transactions.reduce((sum, row) => round2(sum + row.amount), 0);
  const currentBalance = round2(OPENING_BALANCE + net);

  const newest = transactions.length ? transactions[transactions.length - 1].date : today;

  // Recurring anchors sit in the first history month, so every schedule has a
  // real past due date to step forward from.
  const a = firstMonth;
  const recurring: DemoRecurring[] = [
    plan("Gehalt", SALARY, "income", 1, false, iso(a.year, a.month, 15), null),
    plan("Miete", RENT, "expense", 1, true, iso(a.year, a.month, 1), "wohnen"),
    plan("Strom", 92, "expense", 1, true, iso(a.year, a.month, 3), "wohnen"),
    plan("Internet & Telefon", 39.99, "expense", 1, true, iso(a.year, a.month, 5), "telefon"),
    plan("Mobilfunk", 24.99, "expense", 1, true, iso(a.year, a.month, 7), "telefon"),
    plan("Netflix", 13.99, "expense", 1, true, iso(a.year, a.month, 12), "telefon"),
    plan("Spotify", 10.99, "expense", 1, true, iso(a.year, a.month, 20), "telefon"),
    plan("Hausratversicherung", 12.5, "expense", 1, true, iso(a.year, a.month, 2), "versicherungen"),
    plan("Fitnessstudio", 29.9, "expense", 1, true, iso(a.year, a.month, 8), "sonstiges"),
    plan("ETF-Sparplan", 150, "expense", 1, false, iso(a.year, a.month, 15), "sonstiges"),
    plan("Rundfunkbeitrag", 55.08, "expense", 3, true, iso(a.year, a.month, 15), "telefon"),
    plan("Kfz-Versicherung", 384, "expense", 12, true, iso(a.year, 1, 10), "versicherungen"),
    {
      name: "Autokredit",
      amount: LOAN_RATE,
      kind: "expense",
      intervalMonths: 1,
      isContract: true,
      date: iso(a.year, a.month, 28),
      remainingAmount: round2(LOAN_RATE * LOAN_REMAINING_RATES),
      remainingAsOf: today,
      endDate: null,
      category: "kredite",
    },
  ];

  const ahead = (months: number, day: number): string => {
    const merchant = addMonths(nowMonth, months);
    return iso(merchant.year, merchant.month, day);
  };

  const oneoff: DemoOneOff[] = [
    once("Zahnarzt Zuzahlung", 320, "expense", ahead(1, 12)),
    once("Urlaub Norwegen", 1450, "expense", ahead(2, 8)),
    once("Winterreifen", 480, "expense", ahead(3, 20)),
    { ...once("Sondertilgung Autokredit", 1000, "expense", ahead(4, 15)), debtName: "Autokredit" },
    once("Bonus Arbeitgeber", 900, "income", ahead(5, 15)),
    // Paused, so the demo also shows an item that is planned but not counted.
    { ...once("Neues Fahrrad", 900, "expense", ahead(6, 10)), isActive: false },
  ];

  const budgets: DemoBudget[] = [
    { category: "lebensmittel", amount: 450 },
    { category: "tanken", amount: 180 },
    { category: "shopping", amount: 200 },
    { category: "telefon", amount: 110 },
    { category: "bargeld", amount: 150 },
    { category: "sonstiges", amount: 250 },
  ];

  return {
    settings: {
      startingBalance: currentBalance,
      startDate: `${newest.slice(0, 7)}-01`,
      monthsAhead: 24,
      // The salary lands on the 15th, so budget periods run salary to salary.
      budgetStartDay: 15,
    },
    recurring,
    oneoff,
    budgets,
    transactions,
    currentBalance,
  };
}

function plan(
  name: string,
  amount: number,
  kind: Kind,
  intervalMonths: number,
  isContract: boolean,
  date: string,
  category: string | null
): DemoRecurring {
  return {
    name,
    amount,
    kind,
    intervalMonths,
    isContract,
    date,
    remainingAmount: null,
    remainingAsOf: null,
    endDate: null,
    category,
  };
}

function once(name: string, amount: number, kind: Kind, date: string): DemoOneOff {
  return { name, amount, kind, date, isContract: false, debtName: null, isActive: true };
}
