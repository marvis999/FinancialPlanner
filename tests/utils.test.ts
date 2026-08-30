import { describe, expect, it } from "vitest";

import { formatDate, formatMonthLabel, localIso, todayIso } from "@/lib/utils";

describe("localIso (B16)", () => {
  it("returns the LOCAL calendar day, not the UTC one", () => {
    // 00:30 on 1 September in Berlin is still 31 August in UTC. Reading a
    // Restschuld off a statement at that hour used to stamp it with yesterday,
    // so effectiveRemaining deducted one installment too many.
    const justAfterMidnight = new Date("2026-09-01T00:30:00+02:00");
    expect(localIso(justAfterMidnight)).toBe("2026-09-01");
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  it("holds across the DST boundary", () => {
    expect(localIso(new Date("2026-03-29T02:30:00+02:00"))).toBe("2026-03-29");
    expect(localIso(new Date("2026-10-25T02:30:00+01:00"))).toBe("2026-10-25");
  });

  it("todayIso is a well-formed local day", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIso()).toBe(localIso(new Date()));
  });
});

describe("formatters do not throw (C9)", () => {
  it("returns a dash instead of throwing on unusable input", () => {
    // lib/db.ts returns minDate: "" for an empty table, and the upload card
    // interpolates it inside a try whose catch claims the file was unreadable.
    expect(formatDate("")).toBe("—");
    expect(formatMonthLabel("")).toBe("—");
    expect(formatDate("nonsense")).toBe("—");
  });

  it("rejects a date that does not exist rather than rolling it over", () => {
    // Previously rendered as 03.03.2026.
    expect(formatDate("2026-02-31")).toBe("—");
    expect(formatDate("2026-13-01")).toBe("—");
  });

  it("still formats real dates", () => {
    expect(formatDate("2026-08-18")).toBe("18.08.2026");
    expect(formatMonthLabel("2026-08")).toMatch(/2?6/);
  });
});
