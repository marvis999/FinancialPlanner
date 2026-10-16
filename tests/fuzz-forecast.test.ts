import { describe, expect, it } from "vitest";

import { ALL_CATEGORIES, categoryByKey } from "@/lib/categories";
import {
  addMonthsClamped,
  computeDailyProjection,
  computeLoanPayoffs,
  computeMonthlyCost,
  effectiveRemaining,
  oneOffDueDate,
} from "@/lib/projection";
import type { AppState, BudgetItem, OneOffItem, RecurringItem } from "@/lib/types";
import { forAll, isoDate, round2, type Rng } from "./helpers/fuzz";

/**
 * Fuzz the forecast with random households: salaries, rents, quarterly and
 * yearly items, loans with remaining balances and extra payments, one-offs,
 * budgets, paused items and contracts that end. Every forecast is checked
 * against bookkeeping rules and an independent schedule of due dates.
 */

const CATEGORY_KEYS = ALL_CATEGORIES.map((category) => category.key);

/** Oracle: base date plus k × interval months (k ≥ 0), day clamped, via Date. */
function dueDatesOracle(base: string, interval: number, after: string, until: string): string[] {
  const [y, m, d] = base.split("-").map(Number);
  const dates: string[] = [];
  for (let k = 0; k < 2000; k++) {
    const first = new Date(Date.UTC(y, m - 1 + k * interval, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(d, last));
    const due = first.toISOString().slice(0, 10);
    if (due > until) break;
    if (due > after) dates.push(due);
  }
  return dates;
}

const money = (random: Rng, max: number) => random.int(1, max * 100) / 100;

interface Household {
  state: AppState;
  anchor: string;
  /** One-offs switched off in the chart. */
  excluded: Set<number>;
  /** Already spent per category in the anchor's budget period. */
  spent: Map<string, number>;
}

function household(random: Rng): Household {
  const anchor = isoDate(random, 2025, 2027);
  const recurring: RecurringItem[] = Array.from({ length: random.int(0, 8) }, (_, index) => {
    const kind = random.chance(0.25) ? "income" : "expense";
    const isLoan = kind === "expense" && random.chance(0.3);
    return {
      id: index + 1,
      name: `R${index + 1}`,
      amount: money(random, kind === "income" ? 4000 : 1500),
      kind,
      intervalMonths: random.pick([1, 1, 1, 3, 6, 12]),
      isContract: random.chance(0.5),
      date: isoDate(random, 2023, 2028),
      remainingAmount: isLoan ? money(random, 20_000) : null,
      remainingAsOf: isLoan ? isoDate(random, 2023, 2027) : null,
      endDate: random.chance(0.2) ? isoDate(random, 2025, 2029) : null,
      isActive: random.chance(0.9),
      category: kind === "expense" && random.chance(0.5) ? random.pick(CATEGORY_KEYS) : null,
      matchName: null,
      matchIban: null,
      skippedDues: [],
    };
  });
  const oneoff: OneOffItem[] = Array.from({ length: random.int(0, 5) }, (_, index) => ({
    id: index + 1,
    name: `O${index + 1}`,
    amount: money(random, 5000),
    kind: random.chance(0.2) ? "income" : "expense",
    date: isoDate(random, 2024, 2029),
    isContract: false,
    debtId: recurring.length && random.chance(0.4) ? random.pick(recurring).id : null,
    isActive: random.chance(0.9),
  }));
  const budgetKeys = [...new Set(Array.from({ length: random.int(0, 4) }, () => random.pick(CATEGORY_KEYS)))];
  const budgets: BudgetItem[] = budgetKeys.map((category, index) => ({
    id: index + 1,
    category,
    amount: money(random, 800),
  }));
  return {
    anchor,
    excluded: new Set(oneoff.filter(() => random.chance(0.2)).map((oneOff) => oneOff.id)),
    spent: new Map(budgets.filter(() => random.chance(0.5)).map((budget) => [budget.category, money(random, 1000)])),
    state: {
      recurring,
      oneoff,
      budgets,
      settings: {
        startingBalance: random.int(-200_000, 2_000_000) / 100,
        startDate: anchor,
        monthsAhead: random.int(1, 36),
        budgetStartDay: random.pick([1, 1, 15, random.int(1, 28)]),
      },
    },
  };
}

describe("forecast fuzz", () => {
  it("keeps the books: every day's balance is the previous one plus that day's payments", { timeout: 600_000 }, () => {
    forAll(2026, 1500, household, ({ state, anchor, excluded, spent }) => {
      const points = computeDailyProjection(state, { anchorDate: anchor, excludedOneOffIds: excluded, budgetSpent: spent });
      const horizon = Math.max(1, Math.min(600, state.settings.monthsAhead || 24));
      const end = addMonthsClamped(anchor, horizon);

      expect(points[0]).toEqual({ date: anchor, balance: state.settings.startingBalance, events: [] });
      expect(points[points.length - 1].date).toBe(end);
      for (let i = 1; i < points.length; i++) {
        const point = points[i];
        expect(point.date > points[i - 1].date).toBe(true);
        expect(point.date <= end).toBe(true);
        const moved = point.events.reduce((sum, event) => sum + event.amount, 0);
        expect(point.balance).toBeCloseTo(round2(points[i - 1].balance + moved), 2);
        for (const event of point.events) {
          expect(event.amount).not.toBe(0);
          expect(Math.sign(event.amount)).toBe(event.kind === "income" ? 1 : -1);
        }
      }
    });
  });

  it("books every recurring item on exactly the due dates of its schedule", { timeout: 600_000 }, () => {
    const seen = { quarterlyOrLonger: 0, endedEarly: 0, paused: 0, clampedDay: 0 };
    forAll(2027, 1500, household, ({ state, anchor }) => {
      const points = computeDailyProjection(state, { anchorDate: anchor });
      const end = points[points.length - 1].date;
      for (const item of state.recurring) {
        if (effectiveRemaining(item, anchor) !== null) continue; // loans: next test
        const booked = points
          .filter((point) => point.events.some((event) => event.source === "recurring" && event.name === item.name))
          .map((point) => point.date);
        const until = item.endDate && item.endDate < end ? item.endDate : end;
        const expected = item.isActive ? dueDatesOracle(item.date, item.intervalMonths, anchor, until) : [];
        expect(booked, item.name).toEqual(expected);
        if (item.intervalMonths > 1 && expected.length) seen.quarterlyOrLonger++;
        if (item.endDate && item.endDate < end && item.isActive) seen.endedEarly++;
        if (!item.isActive) seen.paused++;
        if (Number(item.date.slice(8)) > 28 && expected.some((due) => due.slice(8) !== item.date.slice(8))) seen.clampedDay++;
        // Full amount, every time.
        for (const point of points) {
          for (const event of point.events.filter((e) => e.source === "recurring" && e.name === item.name)) {
            expect(Math.abs(event.amount)).toBeCloseTo(item.amount, 2);
          }
        }
      }
    });
    // The cases that matter must actually have come up.
    expect(seen.quarterlyOrLonger).toBeGreaterThan(100);
    expect(seen.endedEarly).toBeGreaterThan(50);
    expect(seen.paused).toBeGreaterThan(50);
    expect(seen.clampedDay).toBeGreaterThan(20);
  });

  it("never pays a loan more than it owes, and pays it off exactly", { timeout: 600_000 }, () => {
    const seen = { paidOff: 0, withExtras: 0, extraClamped: 0, closedForm: 0 };
    forAll(2028, 1500, household, ({ state, anchor }) => {
      const points = computeDailyProjection(state, { anchorDate: anchor });
      const end = points[points.length - 1].date;
      const payoffs = computeLoanPayoffs(state, anchor);
      for (const loan of state.recurring) {
        const owed = effectiveRemaining(loan, anchor);
        if (owed === null) continue;
        const extras = state.oneoff.filter(
          (oneOff) => oneOff.debtId === loan.id && oneOff.kind === "expense" && oneOff.isActive && loan.kind === "expense"
        );
        const extraNames = new Set(extras.map((oneOff) => oneOff.name));
        let paid = 0;
        for (const point of points) {
          for (const event of point.events) {
            const installment = event.source === "recurring" && event.name === loan.name;
            const extra = event.source === "oneoff" && extraNames.has(event.name);
            if (!installment && !extra) continue;
            if (installment) expect(-event.amount).toBeLessThanOrEqual(loan.amount + 0.001);
            paid += -event.amount;
          }
        }
        expect(paid, `${loan.name} overpaid`).toBeLessThanOrEqual(owed + 0.01);
        const payoff = payoffs.get(loan.id);
        if (payoff) {
          expect(payoff.payoffDate > anchor).toBe(true);
          expect(payoff.lastAmount).toBeGreaterThan(0);
          if (payoff.payoffDate <= end) {
            expect(paid, `${loan.name} not paid off`).toBeCloseTo(owed, 2);
            seen.paidOff++;
          }
        }
        if (extras.length) seen.withExtras++;
        // Closed form for a plain loan: n = ceil(owed / rate) installments on
        // the schedule's next due dates, the last one covering the rest.
        if (!extras.length && loan.isActive && !loan.endDate && owed > 0) {
          const rate = loan.amount;
          // In whole cents: rounding the ratio would lose a remainder of a few cents.
          const n = Math.ceil(Math.round(owed * 100) / Math.round(rate * 100));
          const dues = dueDatesOracle(loan.date, loan.intervalMonths, anchor, "9999-12-31");
          if (n <= 1200) {
            expect(payoff, `${loan.name} payoff`).toBeDefined();
            expect(payoff!.payoffDate).toBe(dues[n - 1]);
            expect(payoff!.lastAmount).toBeCloseTo(round2(owed - (n - 1) * rate), 2);
            seen.closedForm++;
          }
        }
        // An extra payment never books more than it is worth.
        for (const oneOff of extras) {
          for (const point of points) {
            for (const event of point.events.filter((e) => e.source === "oneoff" && e.name === oneOff.name)) {
              expect(-event.amount).toBeLessThanOrEqual(oneOff.amount + 0.001);
              if (-event.amount < oneOff.amount - 0.001) seen.extraClamped++;
            }
          }
        }
      }
    });
    expect(seen.paidOff).toBeGreaterThan(50);
    expect(seen.withExtras).toBeGreaterThan(50);
    expect(seen.extraClamped).toBeGreaterThan(5);
    expect(seen.closedForm).toBeGreaterThan(50);
  });

  it("counts a loan down over time and never below zero", () => {
    forAll(2029, 3000, household, ({ state, anchor }) => {
      for (const loan of state.recurring) {
        if (loan.remainingAmount === null || !loan.remainingAsOf) continue;
        expect(effectiveRemaining(loan, loan.remainingAsOf)).toBe(loan.remainingAmount);
        const later = addMonthsClamped(anchor > loan.remainingAsOf ? anchor : loan.remainingAsOf, 1);
        const evenLater = addMonthsClamped(later, 7);
        const a = effectiveRemaining(loan, later)!;
        const b = effectiveRemaining(loan, evenLater)!;
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(a + 1e-9);
      }
    });
  });

  it("books one-offs once, in full, and budgets never above their limit", { timeout: 600_000 }, () => {
    const seen = { budgetEvents: 0, reducedBudgets: 0 };
    forAll(2030, 1500, household, ({ state, anchor, excluded, spent }) => {
      const points = computeDailyProjection(state, { anchorDate: anchor, excludedOneOffIds: excluded, budgetSpent: spent });
      const end = points[points.length - 1].date;
      const loanIds = new Set(
        state.recurring.filter((item) => item.kind === "expense" && effectiveRemaining(item, anchor) !== null).map((item) => item.id)
      );
      for (const oneOff of state.oneoff) {
        if (oneOff.debtId !== null && loanIds.has(oneOff.debtId) && oneOff.kind === "expense") continue;
        const booked = points.flatMap((point) =>
          point.events.filter((event) => event.source === "oneoff" && event.name === oneOff.name).map((event) => ({ date: point.date, event }))
        );
        const due = oneOffDueDate(oneOff, anchor);
        if (!oneOff.isActive || excluded.has(oneOff.id) || due > end) {
          expect(booked).toHaveLength(0);
        } else {
          expect(booked).toHaveLength(1);
          expect(booked[0].date).toBe(due);
          expect(Math.abs(booked[0].event.amount)).toBeCloseTo(oneOff.amount, 2);
        }
      }
      for (const budget of state.budgets) {
        const label = `Budget: ${categoryByKey(budget.category).label}`;
        for (const point of points) {
          const own = point.events.filter((event) => event.source === "budget" && event.name === label);
          expect(own.length).toBeLessThanOrEqual(1);
          for (const event of own) {
            expect(event.amount).toBeLessThan(0);
            expect(-event.amount).toBeLessThanOrEqual(budget.amount + 0.001);
            seen.budgetEvents++;
            if (-event.amount < budget.amount - 0.001) seen.reducedBudgets++;
          }
        }
      }
    });
    expect(seen.budgetEvents).toBeGreaterThan(1000);
    expect(seen.reducedBudgets).toBeGreaterThan(50);
  });

  it("states a month's cost consistently: net is income minus expenses", () => {
    forAll(2031, 3000, household, ({ state, anchor }) => {
      const { summary, budgets, items } = computeMonthlyCost(state, anchor);
      expect(summary.monthlyNet).toBeCloseTo(summary.monthlyIncome - summary.monthlyExpense, 9);
      const income = items.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amount / item.intervalMonths, 0);
      const fixed = items.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amount / item.intervalMonths, 0);
      expect(summary.monthlyIncome).toBeCloseTo(income, 6);
      expect(summary.monthlyExpense).toBeCloseTo(fixed + budgets.reduce((sum, budget) => sum + budget.amount, 0), 6);
      for (const reduced of budgets) {
        const original = state.budgets.find((budget) => budget.id === reduced.id)!;
        expect(reduced.amount).toBeGreaterThan(0);
        expect(reduced.amount).toBeLessThanOrEqual(original.amount + 1e-9);
      }
    });
  });
});
