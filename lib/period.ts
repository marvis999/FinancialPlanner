/**
 * How long a window of days really is, in months.
 *
 * Every per-month average in the app used to divide by the number of distinct
 * YYYY-MM keys the data touched. That counts a window's partial first and last
 * month as whole ones, and since the app anchors on the newest booking, the
 * last month is essentially always partial. On a 12-month import spanning 13
 * calendar keys the result is understated by ~8%; a 3-month window that clips
 * the tail of a fourth month is understated by 25%.
 */

/** Mean length of a Gregorian month in days (365.2425 / 12). */
export const DAYS_PER_MONTH = 30.436875;

/** Whole days from `from` to `to` inclusive of both endpoints. */
export function daysInWindow(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * The window's length in months. Fractional on purpose: a 45-day window is
 * 1.48 months, not 1 and not 2.
 */
export function monthsInWindow(from: string, to: string): number {
  return daysInWindow(from, to) / DAYS_PER_MONTH;
}

/** Days in the calendar month of an ISO day. */
export function daysInMonthOf(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** The YYYY-MM keys of the `count` months before `month` (newest first). */
export function previousMonthKeys(month: string, count: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  for (let step = 1; step <= count; step++) {
    const total = y * 12 + (m - 1) - step;
    out.push(
      `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`
    );
  }
  return out;
}

/** The day after an ISO day. */
export function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Budget periods can start on any day 1–28; ≤28 exists in every month. */
export const MAX_BUDGET_START_DAY = 28;

/** Sanitize a configured budget start day (anything odd falls back to 1). */
export function clampBudgetStartDay(value: unknown): number {
  const day = Math.round(Number(value));
  return Number.isFinite(day) && day >= 1 && day <= MAX_BUDGET_START_DAY ? day : 1;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/**
 * The budget period containing `iso`, for periods beginning on `startDay` of
 * each month. With startDay 1 this is exactly the calendar month; with 15 it
 * runs from the 15th to the 14th of the next month — so someone paid on the
 * 15th can budget a salary span instead of a calendar month split across two
 * paychecks. Start and end are inclusive.
 */
export function budgetPeriodOf(
  iso: string,
  startDay: number
): { start: string; end: string } {
  const day = clampBudgetStartDay(startDay);
  const [y, m, d] = iso.split("-").map(Number);
  let sy = y;
  let sm = m;
  if ((d || 1) < day) {
    sm -= 1;
    if (sm === 0) {
      sm = 12;
      sy -= 1;
    }
  }
  const start = `${sy}-${pad2(sm)}-${pad2(day)}`;
  // End: the day before the next period's start.
  const next = new Date(Date.UTC(sy, sm - 1 + 1, day));
  next.setUTCDate(next.getUTCDate() - 1);
  return { start, end: next.toISOString().slice(0, 10) };
}

/**
 * The day the forecast starts from.
 *
 * With imported history that is the newest booking. Without it, the stored
 * start date is always the 1st of a month, and anchoring there re-books
 * everything already paid this month -- rent and salary counted a second time,
 * with no way to correct it from a month-only settings field. So a start date
 * in the past yields today instead; a deliberately future one is kept.
 */
export function resolveAnchorDate(
  newestBooking: string | null,
  settingsStartDate: string,
  today: string
): string {
  if (newestBooking) return newestBooking;
  return settingsStartDate > today ? settingsStartDate : today;
}

/** Whole days between the anchor and today; 0 when the anchor is today. */
export function anchorAgeInDays(anchor: string, today: string): number {
  return Math.max(0, daysInWindow(anchor, today) - 1);
}
