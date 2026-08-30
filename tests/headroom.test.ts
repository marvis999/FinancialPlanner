import { describe, expect, it } from "vitest";

import {
  computeDailyProjection,
  debtHeadroom,
  type DailyPoint,
} from "@/lib/projection";
import type { AppState, OneOffItem, RecurringItem, Settings } from "@/lib/types";

let nextId = 1;
const rec = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: nextId++,
  name: "Kredit",
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
});
const one = (over: Partial<OneOffItem> = {}): OneOffItem => ({
  id: nextId++,
  name: "Sondertilgung",
  amount: 100,
  kind: "expense",
  date: "2026-06-01",
  isContract: false,
  debtId: null,
  isActive: true,
  ...over,
});
const SETTINGS: Settings = {
  startingBalance: 1000,
  startDate: "2026-01-01",
  monthsAhead: 12,
  budgetStartDay: 1,
};
const st = (r: RecurringItem[], o: OneOffItem[] = []): AppState => ({
  recurring: r,
  oneoff: o,
  budgets: [],
  settings: SETTINGS,
});
const booked = (points: DailyPoint[], name: string) =>
  points.flatMap((p) => p.events.filter((e) => e.name === name).map((e) => -e.amount));

const anchor = "2026-08-20";

describe("debtHeadroom matches what the chart books", () => {
  it("a payment dated before the anchor: hint equals the booked amount", () => {
    // The reviewer's case: effectiveRemaining at the typed day said 800, but
    // the payment is relocated to anchor+1 where only 700 is still open.
    const l = rec({
      amount: 100,
      date: "2026-06-20",
      remainingAmount: 1000,
      remainingAsOf: "2026-06-01",
    });
    const extra = one({ debtId: l.id, amount: 700, date: "2026-08-10" });
    const state = st([l], [extra]);
    expect(
      debtHeadroom(state, l.id, "2026-08-10", anchor, undefined, extra.id)
    ).toBe(700);
    expect(booked(computeDailyProjection(state, { anchorDate: anchor }), extra.name)).toEqual([700]);
  });

  it("several payments collapsing onto anchor+1 queue up correctly", () => {
    // 300 open, two 200 EUR payments both relocated to 2026-08-21: the first
    // takes 200, the second can only take 100 - and the hint has to say 100.
    const l = rec({ amount: 100, date: "2026-09-20", remainingAmount: 300, remainingAsOf: anchor });
    const a = one({ debtId: l.id, amount: 200, date: "2026-08-05", name: "A" });
    const b = one({ debtId: l.id, amount: 200, date: "2026-08-19", name: "B" });
    const state = st([l], [a, b]);
    expect(debtHeadroom(state, l.id, "2026-08-19", anchor, undefined, b.id)).toBe(100);
    const points = computeDailyProjection(state, { anchorDate: anchor });
    expect(booked(points, "A")).toEqual([200]);
    expect(booked(points, "B")).toEqual([100]);
  });

  it("a future payment is offered the balance open on its own day", () => {
    const l = rec({ amount: 100, date: "2026-09-20", remainingAmount: 1000, remainingAsOf: anchor });
    const state = st([l], []);
    // Three installments fall before 2026-12-15.
    expect(debtHeadroom(state, l.id, "2026-12-15", anchor)).toBe(700);
  });

  it("offers nothing once the debt is settled, and null without a Restschuld", () => {
    const settled = rec({ amount: 500, date: "2026-09-01", remainingAmount: 500, remainingAsOf: anchor });
    expect(debtHeadroom(st([settled]), settled.id, "2027-01-01", anchor)).toBe(0);
    const plain = rec({ amount: 100, date: "2026-09-01" });
    expect(debtHeadroom(st([plain]), plain.id, "2026-10-01", anchor)).toBeNull();
  });

  it("ignores payments switched off in the chart (B17)", () => {
    const l = rec({ amount: 100, date: "2026-09-20", remainingAmount: 1000, remainingAsOf: anchor });
    const off = one({ debtId: l.id, amount: 400, date: "2026-09-01" });
    const state = st([l], [off]);
    expect(debtHeadroom(state, l.id, "2026-09-25", anchor)).toBe(500);
    expect(debtHeadroom(state, l.id, "2026-09-25", anchor, new Set([off.id]))).toBe(900);
  });
});
