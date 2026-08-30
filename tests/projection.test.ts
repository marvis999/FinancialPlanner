import { describe, expect, it } from "vitest";

import {
  addMonthsClamped,
  averageMonthlyNet,
  buildChartSeries,
  computeDailyProjection,
  computeLoanPayoffs,
  computeMonthlyCost,
  computeSummary,
  dailyActualBalances,
  effectiveRemaining,
  type DailyPoint,
} from "../lib/projection";
import type {
  AppState,
  OneOffItem,
  RecurringItem,
  Settings,
} from "../lib/types";

/* ------------------------------------------------------------------------- */
/*  Builders                                                                 */
/* ------------------------------------------------------------------------- */

let nextId = 1;

function rec(over: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: nextId++,
    name: "Posten",
    amount: 100,
    kind: "expense",
    intervalMonths: 1,
    isContract: false,
    date: "2026-01-15",
    remainingAmount: null,
    remainingAsOf: null,
    endDate: null,
    isActive: true,
    category: null,
    ...over,
  };
}

function one(over: Partial<OneOffItem> = {}): OneOffItem {
  return {
    id: nextId++,
    name: "One-off",
    amount: 100,
    kind: "expense",
    date: "2026-06-01",
    isContract: false,
    debtId: null,
    isActive: true,
    ...over,
  };
}

const SETTINGS: Settings = {
  startingBalance: 1000,
  startDate: "2026-01-01",
  monthsAhead: 12,
  budgetStartDay: 1,
};

function st(
  recurring: RecurringItem[] = [],
  oneoff: OneOffItem[] = [],
  budgets: AppState["budgets"] = [],
  settings: Settings = SETTINGS
): AppState {
  return { recurring, oneoff, budgets, settings };
}

/** All projected events as flat {date, name, amount} rows. */
function flatEvents(points: DailyPoint[]) {
  return points.flatMap((p) =>
    p.events.map((e) => ({ date: p.date, name: e.name, amount: e.amount }))
  );
}

function eventsFor(points: DailyPoint[], name: string) {
  return flatEvents(points).filter((e) => e.name === name);
}

/* ------------------------------------------------------------------------- */
/*  Date arithmetic                                                          */
/* ------------------------------------------------------------------------- */

describe("addMonthsClamped", () => {
  it("keeps the nominal day when it exists", () => {
    expect(addMonthsClamped("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonthsClamped("2026-01-15", 3)).toBe("2026-04-15");
  });

  it("clamps the 31st into short months", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("respects leap years", () => {
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("wraps across year boundaries in both directions", () => {
    expect(addMonthsClamped("2026-11-10", 3)).toBe("2027-02-10");
    expect(addMonthsClamped("2026-02-10", -3)).toBe("2025-11-10");
  });
});

/* ------------------------------------------------------------------------- */
/*  Monthly summary                                                          */
/* ------------------------------------------------------------------------- */

describe("computeSummary", () => {
  it("normalizes intervals to monthly equivalents", () => {
    const s = computeSummary(
      st([
        rec({ kind: "income", amount: 2400, intervalMonths: 12 }),
        rec({ kind: "expense", amount: 300, intervalMonths: 3 }),
        rec({ kind: "expense", amount: 50, intervalMonths: 1 }),
      ])
    );
    expect(s.monthlyIncome).toBeCloseTo(200);
    expect(s.monthlyExpense).toBeCloseTo(150);
    expect(s.monthlyNet).toBeCloseTo(50);
  });

  it("adds budgets to the expenses", () => {
    const s = computeSummary(
      st([], [], [{ id: 1, category: "lebensmittel", amount: 450 }])
    );
    expect(s.monthlyExpense).toBe(450);
    expect(s.monthlyNet).toBe(-450);
  });

  it("skips paused items", () => {
    const s = computeSummary(
      st([rec({ amount: 100 }), rec({ amount: 40, isActive: false })])
    );
    expect(s.monthlyExpense).toBe(100);
  });

  it("skips contracts already ended at asOf, keeps future-ending ones", () => {
    const ended = rec({ amount: 30, endDate: "2026-05-31" });
    const running = rec({ amount: 70, endDate: "2026-12-31" });
    expect(computeSummary(st([ended, running]), "2026-08-01").monthlyExpense).toBe(70);
    // Without a reference day nothing is dropped.
    expect(computeSummary(st([ended, running])).monthlyExpense).toBe(100);
  });
});

/* ------------------------------------------------------------------------- */
/*  Effective remaining debt                                                 */
/* ------------------------------------------------------------------------- */

describe("effectiveRemaining", () => {
  const loan = (over: Partial<RecurringItem> = {}) =>
    rec({
      amount: 100,
      date: "2026-01-15",
      remainingAmount: 1000,
      remainingAsOf: "2026-01-01",
      ...over,
    });

  it("is null without a configured remaining amount", () => {
    expect(effectiveRemaining(rec(), "2026-06-01")).toBeNull();
  });

  it("returns the stored value before or at the as-of day", () => {
    expect(effectiveRemaining(loan(), "2026-01-01")).toBe(1000);
    expect(effectiveRemaining(loan(), "2025-12-01")).toBe(1000);
  });

  it("deducts every installment due between as-of and the target day", () => {
    // Installments on 15.01., 15.02., 15.03.
    expect(effectiveRemaining(loan(), "2026-03-20")).toBe(700);
    // Day before the third installment: only two are due.
    expect(effectiveRemaining(loan(), "2026-03-14")).toBe(800);
  });

  it("never goes below zero", () => {
    expect(
      effectiveRemaining(loan({ remainingAmount: 150 }), "2026-12-31")
    ).toBe(0);
  });

  it("counts designated one-off payments (Sondertilgung)", () => {
    const l = loan();
    const extra = one({ debtId: l.id, amount: 500, date: "2026-02-01" });
    // 15.01. installment (100) + 500 extra = 400 remaining on 05.02.
    expect(effectiveRemaining(l, "2026-02-05", [extra])).toBe(400);
  });

  it("ignores one-off payments outside the window or for other debts", () => {
    const l = loan();
    const later = one({ debtId: l.id, amount: 500, date: "2026-09-01" });
    const other = one({ debtId: 99999, amount: 500, date: "2026-02-01" });
    expect(effectiveRemaining(l, "2026-02-05", [later, other])).toBe(900);
  });

  it("paused loans pay no installments but Sondertilgungen still count", () => {
    const l = loan({ isActive: false });
    const extra = one({ debtId: l.id, amount: 250, date: "2026-03-01" });
    expect(effectiveRemaining(l, "2026-06-01", [extra])).toBe(750);
    expect(effectiveRemaining(l, "2026-06-01")).toBe(1000);
  });

  it("stops deducting installments after the contract end", () => {
    // Ends after the February installment: only 15.01. and 15.02. count.
    const l = loan({ endDate: "2026-02-28" });
    expect(effectiveRemaining(l, "2026-12-31")).toBe(800);
  });

  it("stays on clean cents through repeated subtraction", () => {
    const l = loan({ amount: 33.1, remainingAmount: 529.68 });
    // 16 installments of 33,10 = 529,60 -> 0,08 left.
    // Exact, not approximate: round2 guarantees clean cents, so assert them.
    // toBeCloseTo(_, 10) passed with the rounding removed (0.07999999999979934
    // is ~250x inside its tolerance), which made the guard inert.
    expect(effectiveRemaining(l, "2027-04-20")).toBe(0.08);
  });
});

/* ------------------------------------------------------------------------- */
/*  Loan payoff dates                                                        */
/* ------------------------------------------------------------------------- */

describe("computeLoanPayoffs", () => {
  const anchor = "2026-08-20";
  const loan = (over: Partial<RecurringItem> = {}) =>
    rec({
      amount: 100,
      date: "2026-09-15",
      remainingAmount: 250,
      remainingAsOf: anchor,
      ...over,
    });

  it("finds the final, possibly partial installment", () => {
    const l = loan();
    const p = computeLoanPayoffs(st([l]), anchor).get(l.id);
    expect(p).toEqual({ payoffDate: "2026-11-15", lastAmount: 50 });
  });

  it("handles an exact multiple with a full final installment", () => {
    const l = loan({ remainingAmount: 300 });
    const p = computeLoanPayoffs(st([l]), anchor).get(l.id);
    expect(p).toEqual({ payoffDate: "2026-11-15", lastAmount: 100 });
  });

  it("skips items without remaining amount or with amount 0", () => {
    const noRest = rec();
    const zero = loan({ amount: 0 });
    const map = computeLoanPayoffs(st([noRest, zero]), anchor);
    expect(map.size).toBe(0);
  });

  it("a Sondertilgung between installments pulls the date forward", () => {
    const l = loan({ remainingAmount: 529.68, amount: 33.1 });
    const extra = one({ debtId: l.id, amount: 500, date: "2026-08-22" });
    const p = computeLoanPayoffs(st([l], [extra]), anchor).get(l.id);
    // 500 on 22.08. leaves 29,68 -> cleared by the 15.09. installment.
    expect(p).toEqual({ payoffDate: "2026-09-15", lastAmount: 29.68 });
  });

  it("a Sondertilgung covering everything finishes on its own date", () => {
    const l = loan();
    const extra = one({ debtId: l.id, amount: 400, date: "2026-08-25" });
    const p = computeLoanPayoffs(st([l], [extra]), anchor).get(l.id);
    expect(p).toEqual({ payoffDate: "2026-08-25", lastAmount: 250 });
  });

  it("excluded one-offs are ignored", () => {
    const l = loan();
    const extra = one({ debtId: l.id, amount: 400, date: "2026-08-25" });
    const p = computeLoanPayoffs(
      st([l], [extra]),
      anchor,
      new Set([extra.id])
    ).get(l.id);
    expect(p).toEqual({ payoffDate: "2026-11-15", lastAmount: 50 });
  });

  it("paused loans only finish through designated payments", () => {
    const l = loan({ isActive: false });
    const map1 = computeLoanPayoffs(st([l]), anchor);
    expect(map1.has(l.id)).toBe(false);
    const extra = one({ debtId: l.id, amount: 250, date: "2026-10-01" });
    const p = computeLoanPayoffs(st([l], [extra]), anchor).get(l.id);
    expect(p).toEqual({ payoffDate: "2026-10-01", lastAmount: 250 });
  });

  it("installments stop at the contract end; later one-offs still finish it", () => {
    const l = loan({ endDate: "2026-09-30" });
    // Only the 15.09. installment fits before the end -> 150 left.
    const extra = one({ debtId: l.id, amount: 200, date: "2026-12-01" });
    const p = computeLoanPayoffs(st([l], [extra]), anchor).get(l.id);
    expect(p).toEqual({ payoffDate: "2026-12-01", lastAmount: 150 });
  });
});

/* ------------------------------------------------------------------------- */
/*  Daily projection                                                         */
/* ------------------------------------------------------------------------- */

describe("computeDailyProjection", () => {
  const anchor = "2026-08-20";
  const opts = { anchorDate: anchor };

  it("starts at the starting balance on the anchor day", () => {
    const points = computeDailyProjection(st([]), opts);
    expect(points[0]).toEqual({ date: anchor, balance: 1000, events: [] });
  });

  it("books recurring items on their actual due days with running balance", () => {
    const r = rec({ amount: 100, date: "2026-08-15", kind: "expense" });
    const points = computeDailyProjection(st([r]), opts);
    const evts = eventsFor(points, r.name);
    expect(evts[0]).toEqual({ date: "2026-09-15", name: r.name, amount: -100 });
    expect(evts).toHaveLength(12);
    const sept = points.find((p) => p.date === "2026-09-15")!;
    expect(sept.balance).toBe(900);
  });

  it("books income positively and respects intervals", () => {
    const r = rec({
      kind: "income",
      amount: 300,
      intervalMonths: 3,
      date: "2026-09-01",
    });
    const points = computeDailyProjection(st([r]), opts);
    const evts = eventsFor(points, r.name);
    expect(evts.map((e) => e.date)).toEqual([
      "2026-09-01",
      "2026-12-01",
      "2027-03-01",
      "2027-06-01",
    ]);
    expect(evts.every((e) => e.amount === 300)).toBe(true);
  });

  it("ends a loan at zero with a partial final installment", () => {
    const r = rec({
      amount: 100,
      date: "2026-09-15",
      remainingAmount: 250,
      remainingAsOf: anchor,
    });
    const points = computeDailyProjection(st([r]), opts);
    const evts = eventsFor(points, r.name);
    expect(evts.map((e) => e.amount)).toEqual([-100, -100, -50]);
  });

  it("total booked for a loan incl. Sondertilgung equals the remaining debt", () => {
    const r = rec({
      amount: 33.1,
      date: "2026-09-15",
      remainingAmount: 529.68,
      remainingAsOf: anchor,
    });
    const extra = one({ debtId: r.id, amount: 500, date: "2026-08-22" });
    const points = computeDailyProjection(st([r], [extra]), opts);
    const paid =
      eventsFor(points, r.name).reduce((s, e) => s - e.amount, 0) +
      eventsFor(points, extra.name).reduce((s, e) => s - e.amount, 0);
    expect(paid).toBe(529.68);
    // The sum alone cannot catch a dropped round2 - the residue is two orders
    // of magnitude below the ulp of 529.68, so it rounds away. Assert the
    // final installment itself, which is where the fractional cent would show.
    expect(eventsFor(points, r.name).map((e) => e.amount)).toEqual([-29.68]);
  });

  it("skips paused items entirely", () => {
    const r = rec({ isActive: false });
    const points = computeDailyProjection(st([r]), opts);
    expect(eventsFor(points, r.name)).toHaveLength(0);
  });

  it("books nothing after the contract end date", () => {
    const r = rec({ amount: 100, date: "2026-08-15", endDate: "2026-10-31" });
    const points = computeDailyProjection(st([r]), opts);
    const evts = eventsFor(points, r.name);
    expect(evts.map((e) => e.date)).toEqual(["2026-09-15", "2026-10-15"]);
  });

  it("books future one-offs on their date, past ones the day after anchor", () => {
    const future = one({ date: "2026-09-10", amount: 200 });
    const past = one({ date: "2026-08-01", amount: 50, name: "Alt" });
    const points = computeDailyProjection(st([], [future, past]), opts);
    expect(eventsFor(points, future.name)[0].date).toBe("2026-09-10");
    expect(eventsFor(points, "Alt")[0].date).toBe("2026-08-21");
  });

  it("leaves out excluded one-offs", () => {
    const o = one({ date: "2026-09-10" });
    const points = computeDailyProjection(st([], [o]), {
      ...opts,
      excludedOneOffIds: new Set([o.id]),
    });
    expect(eventsFor(points, o.name)).toHaveLength(0);
  });

  it("budgets book the unspent rest this month, full amounts afterwards", () => {
    const budgets = [{ id: 1, category: "lebensmittel", amount: 450 }];
    const points = computeDailyProjection(st([], [], budgets), {
      ...opts,
      budgetSpent: new Map([["lebensmittel", 300]]),
    });
    const evts = flatEvents(points).filter((e) => e.name.startsWith("Budget"));
    // Rest of August: 450 - 300 = 150 on the 31st, then 450 at every month end.
    expect(evts[0]).toMatchObject({ date: "2026-08-31", amount: -150 });
    expect(evts[1]).toMatchObject({ date: "2026-09-30", amount: -450 });
    expect(evts.slice(1).every((e) => e.amount === -450)).toBe(true);
    // Never on the 1st, where it would pile onto the rent.
    expect(evts.some((e) => e.date.endsWith("-01"))).toBe(false);
  });

  it("books no budget rest when the month is already overspent", () => {
    const budgets = [{ id: 1, category: "lebensmittel", amount: 450 }];
    const points = computeDailyProjection(st([], [], budgets), {
      ...opts,
      budgetSpent: new Map([["lebensmittel", 600]]),
    });
    const evts = flatEvents(points).filter((e) => e.name.startsWith("Budget"));
    expect(evts[0].date).toBe("2026-09-30");
  });

  it("stays within the horizon and extends the final point to it", () => {
    const r = rec({ amount: 100, date: "2026-08-15" });
    const points = computeDailyProjection(st([r]), opts);
    const end = addMonthsClamped(anchor, SETTINGS.monthsAhead);
    expect(points[points.length - 1].date).toBe(end);
    expect(points.every((p) => p.date <= end)).toBe(true);
  });

  it("the final balance equals start plus the sum of all booked events", () => {
    const state = st(
      [
        rec({ kind: "income", amount: 2000, date: "2026-08-13" }),
        rec({ amount: 560, date: "2026-08-31" }),
        rec({
          amount: 100,
          date: "2026-09-15",
          remainingAmount: 250,
          remainingAsOf: anchor,
        }),
      ],
      [one({ amount: 300, date: "2026-10-01" })],
      [{ id: 1, category: "shopping", amount: 200 }]
    );
    const points = computeDailyProjection(state, opts);
    const total = flatEvents(points).reduce((s, e) => s + e.amount, 0);
    expect(points[points.length - 1].balance).toBeCloseTo(1000 + total, 8);
  });
});

/* ------------------------------------------------------------------------- */
/*  History helpers                                                          */
/* ------------------------------------------------------------------------- */

describe("averageMonthlyNet", () => {
  it("divides by the length of the window, not by distinct month keys", () => {
    // 10.01. to 15.02. is 37 days = 1.216 months, not 2. Counting keys was the
    // old behaviour and it understated every average, because the window's
    // first and last month are almost never whole.
    const avg = averageMonthlyNet([
      { date: "2026-01-10", amount: 100 },
      { date: "2026-01-20", amount: -40 },
      { date: "2026-02-15", amount: 60 },
    ]);
    expect(avg).toBeCloseTo(120 / (37 / 30.436875), 6);
  });

  it("is honest about a 12-month import that spans 13 calendar keys", () => {
    // The shape of the repository's own export: salary on the 20th for twelve
    // months, then a stub of a thirteenth month. Key-counting divided by 13.
    const tx: { date: string; amount: number }[] = [];
    for (let k = 0; k < 12; k++) {
      const abs = 2025 * 12 + 7 + k;
      tx.push({
        date: `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}-20`,
        amount: 2000,
      });
    }
    tx.push({ date: "2026-08-05", amount: -50 });
    const avg = averageMonthlyNet(tx, "2026-08-18")!;
    // 2025-08-20 .. 2026-08-05 is 351 days = 11.53 months; 23.950 / 11.53.
    expect(avg).toBeCloseTo(23950 / (351 / 30.436875), 4);
    // The old key divisor would have been 13 -> 1.842,31.
    expect(avg).toBeGreaterThan(2000);
  });

  it("returns null rather than a number it cannot support", () => {
    expect(averageMonthlyNet([])).toBeNull();
    // A fortnight of data is not a monthly average.
    expect(
      averageMonthlyNet([
        { date: "2026-01-10", amount: -100 },
        { date: "2026-01-20", amount: -100 },
      ])
    ).toBeNull();
  });

  it("caps how far one stale booking can stretch the window", () => {
    const dense: { date: string; amount: number }[] = [];
    for (let k = 0; k < 12; k++) {
      const abs = 2025 * 12 + 8 + k;
      dense.push({
        date: `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}-15`,
        amount: 500,
      });
    }
    const a = averageMonthlyNet(dense, "2026-08-18")!;
    const stale = averageMonthlyNet(
      [{ date: "2019-01-01", amount: 0 }, ...dense],
      "2026-08-18"
    )!;
    // The cap bounds the damage rather than removing it: the window can grow
    // to 24 months but no further, so a 2019 row and a 2023 row dilute
    // identically instead of one of them dividing by seven years.
    const from2023 = averageMonthlyNet(
      [{ date: "2023-01-01", amount: 0 }, ...dense],
      "2026-08-18"
    )!;
    expect(stale).toBeCloseTo(from2023, 6);
    // Without the cap a 2019 row would divide by ~91 months; with it, ~24.
    expect(stale).toBeGreaterThan(a / 2.5);
  });

  it("ignores rows dated after today", () => {
    const dense: { date: string; amount: number }[] = [];
    for (let k = 0; k < 12; k++) {
      const abs = 2025 * 12 + 8 + k;
      dense.push({
        date: `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}-15`,
        amount: 500,
      });
    }
    const a = averageMonthlyNet(dense, "2026-08-18")!;
    // A future-dated row would stretch the window and dilute the average.
    const withFuture = [...dense, { date: "2027-06-01", amount: 0 }];
    expect(averageMonthlyNet(withFuture, "2026-08-18")!).toBeCloseTo(a, 6);
  });
});


describe("dailyActualBalances", () => {
  it("takes the first (newest) row per day from a DESC-ordered list", () => {
    const rows = [
      { date: "2026-01-02", balance: 500 },
      { date: "2026-01-01", balance: 300 }, // day close
      { date: "2026-01-01", balance: 250 }, // earlier same day
    ];
    const out = dailyActualBalances(
      rows.map((r) => ({
        id: 0, name: "", amount: 0, type: "", purpose: "",
        counterpartyIban: "", category: null, tags: [], ...r,
      }))
    );
    expect(out).toEqual([
      { date: "2026-01-01", balance: 300 },
      { date: "2026-01-02", balance: 500 },
    ]);
  });
});

describe("buildChartSeries", () => {
  it("joins actual and forecast and carries forecast over trend-only days", () => {
    const actual = [
      { date: "2026-01-01", balance: 100 },
      { date: "2026-01-10", balance: 200 },
    ];
    const forecast: DailyPoint[] = [
      { date: "2026-01-10", balance: 200, events: [] },
      { date: "2026-02-01", balance: 150, events: [] },
    ];
    const trend = [{ date: "2026-01-20", balance: 175 }];
    const rows = buildChartSeries(actual, forecast, trend);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    // Anchor day carries both series so the lines join.
    expect(byDate.get("2026-01-10")).toMatchObject({ actual: 200, forecast: 200 });
    // Trend-only day inherits the last forecast value for a continuous line.
    expect(byDate.get("2026-01-20")).toMatchObject({ trend: 175, forecast: 200 });
    expect(rows.map((r) => r.date)).toEqual(
      [...rows.map((r) => r.date)].sort()
    );
  });
});

/* ------------------------------------------------------------------------- */
/*  Merged behaviour: one model for the cards and the chart                   */
/* ------------------------------------------------------------------------- */

describe("summary and forecast agree on what a month costs", () => {
  const anchor = "2026-08-20";
  const opts = { anchorDate: anchor };

  it("drops a loan already paid off at asOf, like the forecast does (B4)", () => {
    const loan = rec({
      amount: 300,
      date: "2026-01-15",
      remainingAmount: 600,
      remainingAsOf: "2026-06-01",
    });
    expect(computeSummary(st([loan]), "2026-08-22").monthlyExpense).toBe(0);
    expect(flatEvents(computeDailyProjection(st([loan]), opts))).toEqual([]);
    expect(computeSummary(st([loan]), "2026-06-20").monthlyExpense).toBe(300);
  });

  it("ignores items whose schedule starts after the coming period (B12)", () => {
    const newJob = rec({ kind: "income", amount: 3000, date: "2027-01-01" });
    const rent = rec({ amount: 850, date: "2026-08-25" });
    const s = computeSummary(st([newJob, rent]), anchor);
    expect(s.monthlyIncome).toBe(0);
    expect(s.monthlyExpense).toBe(850);
  });

  it("counts a yearly item whose first due date is inside the year", () => {
    const ins = rec({ amount: 240, intervalMonths: 12, date: "2027-06-01" });
    expect(computeSummary(st([ins]), anchor).monthlyExpense).toBe(20);
  });

  it("books no phantom events for an amount of 0 (B19)", () => {
    const plain = rec({ amount: 0, date: "2026-08-15", name: "Null" });
    const loan = rec({
      amount: 0,
      date: "2026-08-15",
      name: "Nullkredit",
      remainingAmount: 500,
      remainingAsOf: anchor,
    });
    expect(flatEvents(computeDailyProjection(st([plain, loan]), opts))).toEqual([]);
    expect(computeSummary(st([plain, loan]), anchor).monthlyExpense).toBe(0);
  });
});

describe("budgets cap their category instead of adding to it (D1)", () => {
  const anchor = "2026-08-20";
  const opts = { anchorDate: anchor };

  it("nets a categorised recurring item against its budget (B3)", () => {
    const miete = rec({ name: "Miete", amount: 900, date: "2026-09-01", category: "wohnen" });
    const budgets = [{ id: 1, category: "wohnen", amount: 1000 }];
    const state = st([miete], [], budgets);
    expect(computeSummary(state, anchor).monthlyExpense).toBe(1000);
    const sept = flatEvents(computeDailyProjection(state, opts)).filter(
      (e) => e.date.slice(0, 7) === "2026-09"
    );
    expect(sept).toEqual([
      { date: "2026-09-01", name: "Miete", amount: -900 },
      { date: "2026-09-30", name: "Budget: Wohnen & Energie", amount: -100 },
    ]);
  });

  it("a budget swallowed by its fixed items books nothing", () => {
    const miete = rec({ name: "Miete", amount: 1200, date: "2026-09-01", category: "wohnen" });
    const budgets = [{ id: 1, category: "wohnen", amount: 1000 }];
    const state = st([miete], [], budgets);
    expect(computeSummary(state, anchor).monthlyExpense).toBe(1200);
    const later = flatEvents(computeDailyProjection(state, opts)).filter(
      (e) => e.name.startsWith("Budget") && e.date > "2026-08-31"
    );
    expect(later).toHaveLength(0);
  });

  it("an item with NO category is charged on top of every budget", () => {
    const misc = rec({ name: "Wohnung Nordstadt", amount: 900, date: "2026-09-01", category: null });
    const budgets = [{ id: 1, category: "wohnen", amount: 1000 }];
    const state = st([misc], [], budgets);
    expect(computeSummary(state, anchor).monthlyExpense).toBe(1900);
    const sept = flatEvents(computeDailyProjection(state, opts)).filter(
      (e) => e.name.startsWith("Budget") && e.date.slice(0, 7) === "2026-09"
    );
    expect(sept).toEqual([
      { date: "2026-09-30", name: "Budget: Wohnen & Energie", amount: -1000 },
    ]);
  });

  it("a yearly item is netted at its monthly equivalent, not its charge", () => {
    // 600 EUR/year under a 100 EUR budget. Netting the 600 in November only
    // would clamp 500 EUR away there and book the full 100 in every other
    // month: 1.700 EUR/year against the 1.200 EUR computeSummary reports.
    const state = st(
      [rec({ name: "AXA", amount: 600, intervalMonths: 12, date: "2026-11-01", category: "versicherungen" })],
      [],
      [{ id: 1, category: "versicherungen", amount: 100 }],
      { ...SETTINGS, monthsAhead: 24 }
    );
    const points = computeDailyProjection(state, opts);
    expect(eventsFor(points, "AXA")).toEqual([
      { date: "2026-11-01", name: "AXA", amount: -600 },
      { date: "2027-11-01", name: "AXA", amount: -600 },
    ]);
    const budgetEvts = flatEvents(points).filter(
      (e) => e.name.startsWith("Budget") && e.date > "2026-08-31"
    );
    expect(budgetEvts.every((e) => e.amount === -50)).toBe(true);
    // Sep 2026 .. Aug 2027 is a full year of both.
    const year = flatEvents(points)
      .filter((e) => e.date > "2026-08-31" && e.date <= "2027-08-31")
      .reduce((sum, e) => sum + e.amount, 0);
    expect(year).toBeCloseTo(12 * computeSummary(state, anchor).monthlyNet, 6);
    expect(year).toBe(-1200);
  });

  it("a full forecast month sums to the average computeSummary reports", () => {
    const state = st(
      [
        rec({ name: "Gehalt", kind: "income", amount: 2400, date: "2026-09-05" }),
        rec({ name: "Miete", amount: 900, date: "2026-09-01", category: "wohnen" }),
      ],
      [],
      [
        { id: 1, category: "wohnen", amount: 1000 },
        { id: 2, category: "lebensmittel", amount: 400 },
      ]
    );
    const sept = flatEvents(computeDailyProjection(state, opts))
      .filter((e) => e.date.slice(0, 7) === "2026-09")
      .reduce((sum, e) => sum + e.amount, 0);
    expect(sept).toBe(1000);
    expect(sept).toBeCloseTo(computeSummary(state, anchor).monthlyNet, 8);
  });

  it("keeps the anchor month rest when the anchor is the last day (B10)", () => {
    const budgets = [{ id: 1, category: "lebensmittel", amount: 800 }];
    const points = computeDailyProjection(st([], [], budgets), {
      anchorDate: "2026-06-30",
      budgetSpent: new Map([["lebensmittel", 200]]),
    });
    const evts = flatEvents(points).filter((e) => e.name.startsWith("Budget"));
    expect(evts[0]).toMatchObject({ date: "2026-07-01", amount: -600 });
    expect(evts[1]).toMatchObject({ date: "2026-07-31", amount: -800 });
  });

  it("a refund raises the rest; a net-positive category books the full limit (B11)", () => {
    const budgets = [{ id: 1, category: "shopping", amount: 400 }];
    const rest = (spent: number) =>
      flatEvents(
        computeDailyProjection(st([], [], budgets), {
          ...opts,
          budgetSpent: new Map([["shopping", spent]]),
        })
      ).filter((e) => e.name.startsWith("Budget"))[0];
    expect(rest(330.23)).toMatchObject({ date: "2026-08-31", amount: -69.77 });
    expect(rest(-300.07)).toMatchObject({ date: "2026-08-31", amount: -400 });
  });

  it("exposes the live items and the netted budgets for the breakdown", () => {
    const cost = computeMonthlyCost(
      st(
        [
          rec({ name: "Miete", amount: 900, category: "wohnen" }),
          rec({ name: "Alt", isActive: false }),
        ],
        [],
        [
          { id: 1, category: "wohnen", amount: 1000 },
          { id: 2, category: "tanken", amount: 200 },
        ]
      ),
      "2026-08-20"
    );
    expect(cost.items.map((i) => i.name)).toEqual(["Miete"]);
    expect(cost.budgets.map((b) => [b.category, b.amount])).toEqual([
      ["wohnen", 100],
      ["tanken", 200],
    ]);
    expect(cost.summary.monthlyExpense).toBe(1200);
  });
});

describe("one debt window: chart and loan card never disagree", () => {
  const anchor = "2026-08-20";
  const opts = { anchorDate: anchor };
  const loan = (over: Partial<RecurringItem> = {}) =>
    rec({ amount: 100, date: "2026-09-20", remainingAmount: 1000, remainingAsOf: anchor, ...over });

  it("a payment dated on the anchor day is booked once and pays the debt down (B6)", () => {
    const l = loan();
    const extra = one({ debtId: l.id, amount: 500, date: anchor, name: "Sondertilgung" });
    const state = st([l], [extra]);
    const points = computeDailyProjection(state, opts);
    expect(eventsFor(points, "Sondertilgung")).toEqual([
      { date: "2026-08-21", name: "Sondertilgung", amount: -500 },
    ]);
    expect(eventsFor(points, l.name)).toHaveLength(5);
    expect(flatEvents(points).reduce((s, e) => s - e.amount, 0)).toBe(1000);
    expect(computeLoanPayoffs(state, anchor).get(l.id)).toEqual({
      payoffDate: "2027-01-20",
      lastAmount: 100,
    });
  });

  it("an oversized Sondertilgung books only what is still owed (B17)", () => {
    const a = "2026-02-01";
    const l = rec({ amount: 200, date: "2026-02-15", remainingAmount: 1000, remainingAsOf: a });
    const extra = one({ debtId: l.id, amount: 5000, date: "2026-03-15", name: "Sondertilgung" });
    const state = st([l], [extra]);
    expect(flatEvents(computeDailyProjection(state, { anchorDate: a }))).toEqual([
      { date: "2026-02-15", name: l.name, amount: -200 },
      { date: "2026-03-15", name: "Sondertilgung", amount: -800 },
    ]);
    expect(computeLoanPayoffs(state, a).get(l.id)).toEqual({
      payoffDate: "2026-03-15",
      lastAmount: 800,
    });
  });

  it("a Sondertilgung after the payoff books nothing at all (B13)", () => {
    const a = "2026-01-05";
    const l = rec({ amount: 500, date: "2026-01-10", remainingAmount: 1000, remainingAsOf: "2026-01-01" });
    const extra = one({ debtId: l.id, amount: 400, date: "2026-09-01" });
    expect(flatEvents(computeDailyProjection(st([l], [extra]), { anchorDate: a }))).toEqual([
      { date: "2026-01-10", name: l.name, amount: -500 },
      { date: "2026-02-10", name: l.name, amount: -500 },
    ]);
  });

  it("a payment designated to an item without a Restschuld is booked in full", () => {
    const r = rec({ amount: 100, date: "2026-09-01" });
    const extra = one({ debtId: r.id, amount: 400, date: "2026-09-05" });
    expect(eventsFor(computeDailyProjection(st([r], [extra]), opts), extra.name)).toEqual([
      { date: "2026-09-05", name: extra.name, amount: -400 },
    ]);
  });

  it("excluding a payment removes the cash and the debt reduction together (B17)", () => {
    const l = loan({ remainingAsOf: "2026-08-01" });
    const extra = one({ debtId: l.id, amount: 500, date: "2026-08-10" });
    const state = st([l], [extra]);
    const excludedOneOffIds = new Set([extra.id]);
    const points = computeDailyProjection(state, { ...opts, excludedOneOffIds });
    expect(eventsFor(points, extra.name)).toHaveLength(0);
    expect(eventsFor(points, l.name)).toHaveLength(10);
    expect(computeLoanPayoffs(state, anchor, excludedOneOffIds).get(l.id)).toEqual({
      payoffDate: "2027-06-20",
      lastAmount: 100,
    });
  });

  it("the cash booked for a debt always equals the debt outstanding at the anchor", () => {
    for (const extraDate of ["2026-08-10", anchor, "2026-08-25", "2026-11-01"]) {
      for (const extraAmount of [0.5, 400, 5000]) {
        const l = rec({ amount: 100, date: "2026-09-20", name: "Kredit", remainingAmount: 1000, remainingAsOf: anchor });
        const extra = one({ debtId: l.id, amount: extraAmount, date: extraDate, name: "Extra" });
        const state = st([l], [extra]);
        const evts = flatEvents(computeDailyProjection(state, opts));
        expect(evts.reduce((s, e) => s - e.amount, 0)).toBeCloseTo(1000, 8);
        const payoff = computeLoanPayoffs(state, anchor).get(l.id)!;
        const last = evts[evts.length - 1];
        expect(payoff.payoffDate).toBe(last.date);
        expect(payoff.lastAmount).toBeCloseTo(-last.amount, 8);
      }
    }
  });

  it("a one-off can not pay down an income item (B5)", () => {
    const inc = rec({
      kind: "income", name: "Gehalt", amount: 2000,
      date: "2026-09-01", remainingAmount: 6000, remainingAsOf: anchor,
    });
    const extra = one({ debtId: inc.id, amount: 4000, date: "2026-09-05", name: "Anschaffung" });
    const points = computeDailyProjection(st([inc], [extra]), opts);
    expect(eventsFor(points, "Gehalt").map((e) => e.amount)).toEqual([2000, 2000, 2000]);
    expect(eventsFor(points, "Anschaffung")).toEqual([
      { date: "2026-09-05", name: "Anschaffung", amount: -4000 },
    ]);
  });
});

describe("effectiveRemaining before the as-of day (B7)", () => {
  it("adds the installments back when the target day is earlier", () => {
    const l = rec({ amount: 100, date: "2026-08-20", remainingAmount: 1000, remainingAsOf: "2026-08-22" });
    expect(effectiveRemaining(l, "2026-08-18")).toBe(1100);
    expect(effectiveRemaining(l, "2026-08-22")).toBe(1000);
  });

  it("adds designated one-off payments back as well", () => {
    const l = rec({ amount: 100, date: "2026-08-20", remainingAmount: 1000, remainingAsOf: "2026-08-22" });
    const extra = one({ debtId: l.id, amount: 200, date: "2026-08-21" });
    expect(effectiveRemaining(l, "2026-08-18", [extra])).toBe(1300);
  });

  it("ignores designated payments on an income item", () => {
    const inc = rec({ kind: "income", amount: 100, date: "2026-01-15", remainingAmount: 1000, remainingAsOf: "2026-01-01" });
    const extra = one({ debtId: inc.id, amount: 200, date: "2026-02-01" });
    expect(effectiveRemaining(inc, "2026-03-01", [extra])).toBe(800);
  });
});

/* ------------------------------------------------------------------------- */
/*  Anchor geometry (A2)                                                     */
/* ------------------------------------------------------------------------- */

describe.each([
  ["month start", "2026-08-01"],
  ["mid month", "2026-08-20"],
  ["month end", "2026-08-31"],
])("anchored at %s", (_label, anchor) => {
  const opts = { anchorDate: anchor };

  it("never books anything on or before the anchor day", () => {
    // Everything up to and including the anchor is already in the imported
    // history; booking it again double-counts a month that is already paid.
    const state = st(
      [
        rec({ name: "Miete", amount: 900, date: "2026-08-01" }),
        rec({ name: "Gehalt", kind: "income", amount: 2400, date: "2026-08-20" }),
        rec({ name: "Rate", amount: 100, date: "2026-08-31" }),
      ],
      [one({ name: "Alt", amount: 50, date: "2026-07-01" })],
      [{ id: 1, category: "lebensmittel", amount: 400 }]
    );
    const points = computeDailyProjection(state, opts);
    expect(points.every((p) => p.date >= anchor)).toBe(true);
    expect(flatEvents(points).every((e) => e.date > anchor)).toBe(true);
  });

  it("the final balance equals start plus everything booked", () => {
    const state = st(
      [
        rec({ name: "Miete", amount: 900, date: "2026-08-05" }),
        rec({
          name: "Kredit",
          amount: 100,
          date: "2026-09-15",
          remainingAmount: 250,
          remainingAsOf: anchor,
        }),
      ],
      [one({ amount: 300, date: "2026-10-01" })],
      [{ id: 1, category: "shopping", amount: 200 }]
    );
    const points = computeDailyProjection(state, opts);
    const total = flatEvents(points).reduce((s, e) => s + e.amount, 0);
    expect(points[points.length - 1].balance).toBeCloseTo(1000 + total, 8);
  });

  it("books the anchor month's rest once, then one full limit per month", () => {
    const budgets = [{ id: 1, category: "lebensmittel", amount: 400 }];
    const points = computeDailyProjection(st([], [], budgets), {
      ...opts,
      budgetSpent: new Map([["lebensmittel", 100]]),
    });
    const evts = flatEvents(points).filter((e) => e.name.startsWith("Budget"));
    // The anchor month's unspent rest is booked exactly once and never
    // dropped - a month-end anchor used to lose it entirely, because the
    // end-of-month booking day had already passed.
    const rests = evts.filter((e) => e.amount === -300);
    expect(rests).toHaveLength(1);
    expect(rests[0].date > anchor).toBe(true);
    // Every other booking is a full month's limit, one per calendar month.
    const fulls = evts.filter((e) => e.amount === -400);
    expect(fulls).toHaveLength(evts.length - 1);
    const fullMonths = fulls.map((e) => e.date.slice(0, 7));
    expect(new Set(fullMonths).size).toBe(fullMonths.length);
    expect(evts.length).toBeGreaterThanOrEqual(SETTINGS.monthsAhead);
  });

  it("a loan pays down to exactly its remaining balance", () => {
    const r = rec({
      name: "Kredit",
      amount: 100,
      date: "2026-09-15",
      remainingAmount: 250,
      remainingAsOf: anchor,
    });
    const points = computeDailyProjection(st([r]), opts);
    const paid = -eventsFor(points, "Kredit").reduce((s, e) => s + e.amount, 0);
    expect(paid).toBe(250);
  });
});

describe("remainingAsOf relative to the anchor (A2)", () => {
  it("agrees with the anchor whether the as-of day is before, on, or after it", () => {
    const anchor = "2026-08-20";
    const mk = (asOf: string) =>
      rec({ amount: 100, date: "2026-08-25", remainingAmount: 500, remainingAsOf: asOf });
    // As-of ON the anchor: nothing has been paid yet, so the full 500 is due.
    expect(effectiveRemaining(mk(anchor), anchor)).toBe(500);
    // As-of BEFORE the anchor, with no installment in between: unchanged.
    expect(effectiveRemaining(mk("2026-08-10"), anchor)).toBe(500);
    // As-of AFTER the anchor: the installments in between are added back, so
    // the debt at the anchor is higher than the stored figure.
    expect(effectiveRemaining(mk("2026-10-01"), anchor)).toBe(700);
  });
});

/* ------------------------------------------------------------------------- */
/*  Paused one-offs and salary-anchored budget periods                       */
/* ------------------------------------------------------------------------- */

describe("paused one-off items", () => {
  const anchor = "2026-08-20";

  it("books nothing for a paused one-off", () => {
    const o = one({ name: "Unsicher", amount: 500, date: "2026-09-01", isActive: false });
    const points = computeDailyProjection(st([], [o]), { anchorDate: anchor });
    expect(eventsFor(points, "Unsicher")).toHaveLength(0);
    // Resumed, it books normally.
    const active = computeDailyProjection(st([], [{ ...o, isActive: true }]), {
      anchorDate: anchor,
    });
    expect(eventsFor(active, "Unsicher")).toHaveLength(1);
  });

  it("does not let a paused Sondertilgung pay down a debt", () => {
    const r = rec({
      amount: 100,
      date: "2026-01-15",
      remainingAmount: 1000,
      remainingAsOf: anchor,
    });
    const paused = one({
      name: "Sondertilgung",
      amount: 400,
      date: "2026-09-01",
      debtId: r.id,
      isActive: false,
    });
    // Paused: only installments count, so after 3 due dates 700 remain.
    expect(effectiveRemaining(r, "2026-11-20", [paused])).toBe(700);
    expect(effectiveRemaining(r, "2026-11-20", [{ ...paused, isActive: true }])).toBe(300);
    // The payoff walk ignores it too: 1000/100 = 10 installments when paused.
    const payoffPaused = computeLoanPayoffs(st([r], [paused]), anchor).get(r.id);
    const payoffActive = computeLoanPayoffs(
      st([r], [{ ...paused, isActive: true }]),
      anchor
    ).get(r.id);
    expect(payoffPaused!.payoffDate > payoffActive!.payoffDate).toBe(true);
  });
});

describe("budget periods anchored on a salary day", () => {
  const anchor = "2026-08-20";
  const budget = { id: 1, category: "lebensmittel", amount: 300 };

  it("books the budget rest on the period's last day (15th-to-14th)", () => {
    const points = computeDailyProjection(
      st([], [], [budget], { ...SETTINGS, budgetStartDay: 15 }),
      { anchorDate: anchor }
    );
    const evts = eventsFor(points, "Budget: Lebensmittel & Drogerie");
    // The anchor sits in the 15.08.–14.09. period, so the first rest books
    // on 14.09., the next on 14.10., and so on.
    expect(evts[0].date).toBe("2026-09-14");
    expect(evts[1].date).toBe("2026-10-14");
    expect(evts[0].amount).toBe(-300);
  });

  it("still books at calendar month end for start day 1", () => {
    const points = computeDailyProjection(
      st([], [], [budget], { ...SETTINGS, budgetStartDay: 1 }),
      { anchorDate: anchor }
    );
    const evts = eventsFor(points, "Budget: Lebensmittel & Drogerie");
    expect(evts[0].date).toBe("2026-08-31");
  });

  it("charges a monthly fixed cost against the period that contains its due day", () => {
    // Rent due on the 1st falls into the 15.07.–14.08. and 15.08.–14.09.
    // periods; with a 15th start the budget rest must shrink by it.
    const r = rec({
      name: "Miete",
      amount: 200,
      date: "2026-01-01",
      category: "lebensmittel",
    });
    const points = computeDailyProjection(
      st([r], [], [budget], { ...SETTINGS, budgetStartDay: 15 }),
      { anchorDate: anchor }
    );
    const evts = eventsFor(points, "Budget: Lebensmittel & Drogerie");
    // 01.09. is inside 15.08.–14.09.: rest = 300 − 200.
    expect(evts[0]).toEqual({
      date: "2026-09-14",
      name: "Budget: Lebensmittel & Drogerie",
      amount: -100,
    });
  });
});
