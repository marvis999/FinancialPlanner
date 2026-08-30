import { describe, expect, it } from "vitest";

import {
  anchorAgeInDays,
  budgetPeriodOf,
  clampBudgetStartDay,
  DAYS_PER_MONTH,
  daysInMonthOf,
  daysInWindow,
  monthsInWindow,
  nextDay,
  previousMonthKeys,
  resolveAnchorDate,
} from "@/lib/period";

describe("daysInWindow", () => {
  it("counts both endpoints", () => {
    expect(daysInWindow("2026-08-10", "2026-08-10")).toBe(1);
    expect(daysInWindow("2026-08-10", "2026-08-11")).toBe(2);
  });

  it("crosses months, years and a leap day", () => {
    expect(daysInWindow("2026-01-31", "2026-02-01")).toBe(2);
    expect(daysInWindow("2025-12-31", "2026-01-01")).toBe(2);
    expect(daysInWindow("2024-02-28", "2024-03-01")).toBe(3); // 29 Feb exists
    expect(daysInWindow("2025-02-28", "2025-03-01")).toBe(2);
  });

  it("is zero for a reversed or unusable window", () => {
    expect(daysInWindow("2026-08-11", "2026-08-10")).toBe(0);
    expect(daysInWindow("", "2026-08-10")).toBe(0);
  });
});

describe("monthsInWindow", () => {
  it("is fractional, because most windows are", () => {
    // The whole point: a window that clips the tail of a fourth calendar month
    // is three months long, not four.
    expect(monthsInWindow("2026-05-23", "2026-08-22")).toBeCloseTo(92 / DAYS_PER_MONTH, 6);
    expect(monthsInWindow("2026-05-23", "2026-08-22")).toBeGreaterThan(3);
    expect(monthsInWindow("2026-05-23", "2026-08-22")).toBeLessThan(3.1);
  });

  it("a full non-leap year is almost exactly twelve", () => {
    expect(monthsInWindow("2025-01-01", "2025-12-31")).toBeCloseTo(12, 1);
  });
});

describe("daysInMonthOf", () => {
  it("knows short months and leap years", () => {
    expect(daysInMonthOf("2026-02-10")).toBe(28);
    expect(daysInMonthOf("2024-02-10")).toBe(29);
    expect(daysInMonthOf("2026-04-30")).toBe(30);
    expect(daysInMonthOf("2026-12-01")).toBe(31);
  });
});

describe("previousMonthKeys", () => {
  it("walks back across the year boundary", () => {
    expect(previousMonthKeys("2026-02", 3)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });
});

describe("nextDay", () => {
  it("rolls over months, years and leap days", () => {
    expect(nextDay("2026-08-10")).toBe("2026-08-11");
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2025-12-31")).toBe("2026-01-01");
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
  });
});

describe("resolveAnchorDate (B8)", () => {
  it("uses the newest booking when there is history", () => {
    expect(resolveAnchorDate("2026-06-28", "2026-08-01", "2026-08-22")).toBe(
      "2026-06-28"
    );
  });

  it("uses today, not the 1st, when there is none", () => {
    // The stored start date is always a -01, so anchoring on it re-books rent
    // and salary that are already paid: every projected balance too high.
    expect(resolveAnchorDate(null, "2026-08-01", "2026-08-22")).toBe("2026-08-22");
  });

  it("keeps a deliberately future start date", () => {
    expect(resolveAnchorDate(null, "2027-01-01", "2026-08-22")).toBe("2027-01-01");
  });
});

describe("anchorAgeInDays (C1)", () => {
  it("is zero on the day itself and counts whole days after", () => {
    expect(anchorAgeInDays("2026-08-22", "2026-08-22")).toBe(0);
    expect(anchorAgeInDays("2026-08-21", "2026-08-22")).toBe(1);
    expect(anchorAgeInDays("2026-06-28", "2026-08-22")).toBe(55);
  });

  it("never goes negative for an anchor in the future", () => {
    expect(anchorAgeInDays("2026-09-01", "2026-08-22")).toBe(0);
  });
});

describe("budgetPeriodOf", () => {
  it("is the calendar month for start day 1", () => {
    expect(budgetPeriodOf("2026-08-25", 1)).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    expect(budgetPeriodOf("2026-02-10", 1)).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("runs salary-to-salary for start day 15", () => {
    // On/after the 15th: this month's 15th to next month's 14th.
    expect(budgetPeriodOf("2026-08-15", 15)).toEqual({
      start: "2026-08-15",
      end: "2026-09-14",
    });
    expect(budgetPeriodOf("2026-08-25", 15)).toEqual({
      start: "2026-08-15",
      end: "2026-09-14",
    });
    // Before the 15th: still the period that began last month.
    expect(budgetPeriodOf("2026-08-14", 15)).toEqual({
      start: "2026-07-15",
      end: "2026-08-14",
    });
  });

  it("crosses year boundaries", () => {
    expect(budgetPeriodOf("2026-01-05", 15)).toEqual({
      start: "2025-12-15",
      end: "2026-01-14",
    });
    expect(budgetPeriodOf("2025-12-20", 15)).toEqual({
      start: "2025-12-15",
      end: "2026-01-14",
    });
  });

  it("covers every day exactly once (consecutive periods touch)", () => {
    const a = budgetPeriodOf("2026-03-10", 15);
    const b = budgetPeriodOf(nextDay(a.end), 15);
    expect(nextDay(a.end)).toBe(b.start);
  });
});

describe("clampBudgetStartDay", () => {
  it("keeps 1..28 and falls back to 1 otherwise", () => {
    expect(clampBudgetStartDay(15)).toBe(15);
    expect(clampBudgetStartDay(28)).toBe(28);
    expect(clampBudgetStartDay(29)).toBe(1);
    expect(clampBudgetStartDay(0)).toBe(1);
    expect(clampBudgetStartDay("x")).toBe(1);
    expect(clampBudgetStartDay(undefined)).toBe(1);
  });
});
