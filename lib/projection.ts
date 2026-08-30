import { categoryByKey } from "./categories";
import {
  DAYS_PER_MONTH,
  budgetPeriodOf,
  clampBudgetStartDay,
  daysInWindow,
} from "./period";
import type {
  AppState,
  BudgetItem,
  Kind,
  OneOffItem,
  RecurringItem,
  TransactionItem,
} from "./types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A single planned cash movement booked on a specific day. */
export interface ProjectionEvent {
  name: string;
  /** Signed amount: + income, − expense. */
  amount: number;
  kind: Kind;
  source: "recurring" | "oneoff" | "budget";
}

/** Projected balance on a specific day, with the payments booked that day. */
export interface DailyPoint {
  date: string; // YYYY-MM-DD
  balance: number;
  events: ProjectionEvent[];
}

/** One merged row of the chart series (numeric time axis). */
export interface ChartPoint {
  date: string; // YYYY-MM-DD
  ts: number; // local-midnight timestamp for the numeric X axis
  actual: number | null;
  forecast: number | null;
  trend: number | null;
  events: ProjectionEvent[];
}

export interface Summary {
  monthlyIncome: number;
  monthlyExpense: number;
  monthlyNet: number;
}

/* ------------------------------------------------------------------------- */
/*  Date helpers (string-based to stay timezone-proof)                        */
/* ------------------------------------------------------------------------- */

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m || 1, d: d || 1 };
}

function daysInMonth(y: number, m: number): number {
  // m is 1-based; day 0 of the next month = last day of this month.
  return new Date(y, m, 0).getDate();
}

function isoOf(y: number, m: number, d: number): string {
  const day = Math.min(d, daysInMonth(y, m));
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Add n months, keeping the nominal day (clamped to the month's length). */
export function addMonthsClamped(iso: string, n: number): string {
  const { y, m, d } = parseIso(iso);
  const total = y * 12 + (m - 1) + n;
  return isoOf(Math.floor(total / 12), (total % 12) + 1, d);
}

function nextDayIso(iso: string): string {
  const { y, m, d } = parseIso(iso);
  if (d < daysInMonth(y, m)) return isoOf(y, m, d + 1);
  return m < 12 ? isoOf(y, m + 1, 1) : isoOf(y + 1, 1, 1);
}

/** Local-midnight timestamp for an ISO day (for the numeric chart axis). */
export function tsOf(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

/* ------------------------------------------------------------------------- */
/*  Summary (monthly averages — intentionally normalized, labeled Ø)          */
/* ------------------------------------------------------------------------- */

// Monthly-equivalent amount: a quarterly 300 € counts as 100 €/month.
function monthlyEquivalent(recurring: RecurringItem): number {
  return recurring.amount / (recurring.intervalMonths || 1);
}

/**
 * The budget category a recurring item is charged to, or null when the user
 * has not assigned one — an unassigned item is covered by no budget and is
 * therefore charged on top of every limit, as before.
 */
export function recurringCategory(recurring: RecurringItem): string | null {
  return recurring.category || null;
}

/** First due date strictly after `day`, or null if the contract ends first. */
function firstDueAfter(recurring: RecurringItem, day: string): string | null {
  for (const due of occurrencesAfter(recurring, day)) {
    return recurring.endDate && due > recurring.endDate ? null : due;
  }
  return null;
}

/**
 * Does this item still cost money on `asOf`? The same test the day-granular
 * forecast applies, so both views agree: paused items, contracts whose last
 * payment is behind us, loans already repaid and schedules that have not
 * started yet (first payment more than one interval away) cost nothing.
 */
export function isLiveOn(recurring: RecurringItem, asOf: string): boolean {
  if (!recurring.isActive || recurring.amount <= 0) return false;
  const remaining = effectiveRemaining(recurring, asOf);
  if (remaining !== null && remaining <= 0) return false;
  const first = firstDueAfter(recurring, asOf);
  return first !== null && first <= addMonthsClamped(asOf, recurring.intervalMonths || 1);
}

/** The pieces the monthly averages are built from, for the breakdown UI. */
export interface MonthlyCost {
  /** Recurring items that actually cost money on the reference day. */
  items: RecurringItem[];
  /** Budgets reduced to their variable rest; fully covered ones are dropped. */
  budgets: BudgetItem[];
  summary: Summary;
}

/**
 * The one model of "what a month costs", shared by the stat cards and the
 * forecast: every live recurring item at its monthly equivalent, plus - per
 * budget - only the part of the limit the category's fixed items do not
 * already fill. A 1.000 EUR Wohnen budget next to a 900 EUR Miete adds 100
 * EUR, not 1.000 EUR, because the budget caps *all* spending in its category.
 */
export function computeMonthlyCost(state: AppState, asOf?: string): MonthlyCost {
  const items = state.recurring.filter((recurring) =>
    asOf ? isLiveOn(recurring, asOf) : recurring.isActive
  );
  const monthlyIncome = items
    .filter((recurring) => recurring.kind === "income")
    .reduce((sum, recurring) => sum + monthlyEquivalent(recurring), 0);
  const recurringExpense = items
    .filter((recurring) => recurring.kind === "expense")
    .reduce((sum, recurring) => sum + monthlyEquivalent(recurring), 0);

  const fixedByCategory = new Map<string, number>();
  for (const recurring of items) {
    if (recurring.kind !== "expense") continue;
    const key = recurringCategory(recurring);
    if (!key) continue;
    fixedByCategory.set(key, (fixedByCategory.get(key) ?? 0) + monthlyEquivalent(recurring));
  }
  const budgets = state.budgets
    .map((budget) => ({
      ...budget,
      amount: round2(
        Math.max(0, budget.amount - (fixedByCategory.get(budget.category) ?? 0))
      ),
    }))
    .filter((budget) => budget.amount > 0);

  const monthlyExpense =
    recurringExpense + budgets.reduce((sum, b) => sum + b.amount, 0);
  return {
    items,
    budgets,
    summary: {
      monthlyIncome,
      monthlyExpense,
      monthlyNet: monthlyIncome - monthlyExpense,
    },
  };
}

/**
 * Flat monthly averages of the active recurring items plus budgets.
 * With `asOf` given, everything that costs nothing on that day is left out
 * (ended contracts, repaid loans, schedules that have not started yet).
 */
export function computeSummary(state: AppState, asOf?: string): Summary {
  return computeMonthlyCost(state, asOf).summary;
}

/* ------------------------------------------------------------------------- */
/*  Day-granular forecast                                                     */
/* ------------------------------------------------------------------------- */

/** Due dates of a recurring item strictly after `anchor`, in order. */
function* occurrencesAfter(
  recurring: RecurringItem,
  anchor: string
): Generator<string> {
  const iv = recurring.intervalMonths || 1;
  const base = recurring.date || anchor;
  const monthIdx = (iso: string) => {
    const { y, m } = parseIso(iso);
    return y * 12 + (m - 1);
  };
  let step = Math.max(0, Math.floor((monthIdx(anchor) - monthIdx(base)) / iv));
  for (;;) {
    const due = addMonthsClamped(base, step * iv);
    if (due > anchor) yield due;
    step++;
  }
}

/** One-off expenses designated to pay down the given recurring debt.
 *  Paused items pay nothing — the single filter every debt walk shares. */
function debtPayments(recurring: RecurringItem, oneoff: OneOffItem[]): OneOffItem[] {
  if (recurring.kind !== "expense") return [];
  return oneoff.filter(
    (oneOff) => oneOff.debtId === recurring.id && oneOff.kind === "expense" && oneOff.isActive
  );
}

/**
 * The day a one-off is booked in a forecast anchored at `anchor`: its own day,
 * or the day after the anchor when it is dated on or before it - those are
 * planned but not yet booked, so they must not fall into the past.
 */
export function oneOffDueDate(oneOff: OneOffItem, anchor: string): string {
  return oneOff.date > anchor ? oneOff.date : nextDayIso(anchor);
}

/** One designated payment as the forecast books it. */
interface PlannedPayment {
  id: number;
  date: string;
  amount: number;
}

/**
 * Designated payments the way the forecast books them: every non-excluded one,
 * on the day it is actually booked, in that order. Same set, same days and
 * same amounts as the cash line, so the debt and the balance cannot drift.
 */
function debtPaymentsAfter(
  recurring: RecurringItem,
  oneoff: OneOffItem[],
  anchor: string,
  excluded: ReadonlySet<number>
): PlannedPayment[] {
  return debtPayments(recurring, oneoff)
    .filter((oneOff) => !excluded.has(oneOff.id))
    .map((oneOff) => ({ id: oneOff.id, date: oneOffDueDate(oneOff, anchor), amount: oneOff.amount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Remaining amount owed as of `atDate`: the stored value minus every
 * scheduled installment between the day it was entered and `atDate`,
 * and minus one-off payments designated to this debt (Sondertilgungen).
 * Paused items pay no installments, but designated one-offs still count.
 * Null when the item has no remaining balance configured.
 */
export function effectiveRemaining(
  recurring: RecurringItem,
  atDate: string,
  oneoff: OneOffItem[] = []
): number | null {
  if (recurring.remainingAmount === null || recurring.remainingAmount === undefined) return null;
  let remaining = recurring.remainingAmount;
  const asOf = recurring.remainingAsOf;
  if (!asOf || asOf === atDate) return remaining;

  // Payments between the snapshot day and the target day. Forwards they are
  // deducted, backwards (target before the snapshot) they are added back.
  const back = atDate < asOf;
  const from = back ? atDate : asOf;
  const to = back ? asOf : atDate;

  const cuts: { date: string; amount: number }[] = [];
  if (recurring.isActive) {
    let steps = 0;
    for (const due of occurrencesAfter(recurring, from)) {
      if (due > to || (recurring.endDate && due > recurring.endDate) || ++steps > 1200) break;
      cuts.push({ date: due, amount: recurring.amount });
    }
  }
  for (const oneOff of debtPayments(recurring, oneoff)) {
    if (oneOff.date > from && oneOff.date <= to) {
      cuts.push({ date: oneOff.date, amount: oneOff.amount });
    }
  }
  if (back) {
    for (const cut of cuts) remaining = round2(remaining + cut.amount);
    return remaining;
  }
  cuts.sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const cut of cuts) {
    remaining = Math.max(0, round2(remaining - cut.amount));
    if (remaining <= 0) break;
  }
  return remaining;
}

export interface LoanPayoff {
  /** Date of the final (possibly partial) installment. */
  payoffDate: string;
  /** Amount of that final installment. */
  lastAmount: number;
}

/**
 * For every recurring item with a remaining balance: when is it paid off?
 * Future designated one-off payments (Sondertilgungen) pull the date forward;
 * paused items only ever finish through such one-offs. Keyed by item id.
 * Capped at 100 years of installments.
 */
/** What one debt has booked against it from the anchor day on. */
interface DebtSchedule {
  /** Installments in due order; the last one may be partial. */
  installments: { date: string; amount: number }[];
  /** Amount really paid per designated one-off id - clamped, 0 once settled. */
  extras: Map<number, number>;
  /** The final payment, when the debt is cleared inside the walk. */
  payoff: LoanPayoff | null;
}

/**
 * Walk one debt from `anchor` forward: installments on their due days,
 * designated one-off payments on the day the forecast books them, every
 * payment clamped to the balance still open - so nothing overpays the debt
 * and nothing is booked once it is settled. `until` bounds the walk (null
 * runs it to the payoff); installments are capped at 100 years.
 *
 * Single source of truth for the loan card and the balance chart alike.
 */
function simulateDebt(
  recurring: RecurringItem,
  start: number,
  oneoff: OneOffItem[],
  anchor: string,
  excluded: ReadonlySet<number>,
  until: string | null
): DebtSchedule {
  const queue = debtPaymentsAfter(recurring, oneoff, anchor, excluded);
  const schedule: DebtSchedule = {
    installments: [],
    extras: new Map(queue.map((oneOff) => [oneOff.id, 0])),
    payoff: null,
  };
  let rest = start;
  let qi = 0;

  // Apply the designated payments due up to `date` (all of them when null).
  const applyExtras = (date: string | null): boolean => {
    while (qi < queue.length && (date === null || queue[qi].date <= date)) {
      const oneOff = queue[qi++];
      const amount = Math.min(oneOff.amount, rest);
      if (amount <= 0) continue;
      schedule.extras.set(oneOff.id, amount);
      rest = round2(rest - amount);
      if (rest <= 0) {
        schedule.payoff = { payoffDate: oneOff.date, lastAmount: amount };
        return true;
      }
    }
    return false;
  };

  if (recurring.isActive && recurring.amount > 0 && rest > 0) {
    let steps = 0;
    for (const due of occurrencesAfter(recurring, anchor)) {
      if (++steps > 1200) break;
      if (until !== null && due > until) break;
      if (recurring.endDate && due > recurring.endDate) break;
      if (applyExtras(due)) return schedule;
      const amount = Math.min(recurring.amount, rest);
      schedule.installments.push({ date: due, amount });
      rest = round2(rest - amount);
      if (rest <= 0) {
        schedule.payoff = { payoffDate: due, lastAmount: amount };
        return schedule;
      }
    }
  }
  applyExtras(until);
  return schedule;
}

export function computeLoanPayoffs(
  state: AppState,
  anchorDate: string,
  excludedOneOffIds?: ReadonlySet<number>
): Map<number, LoanPayoff> {
  const excluded = excludedOneOffIds ?? new Set<number>();
  const result = new Map<number, LoanPayoff>();
  for (const recurring of state.recurring) {
    // Installments only: designated one-offs are plan items, applied by the
    // walk below on the very day the chart books them.
    const start = effectiveRemaining(recurring, anchorDate);
    if (start === null || start <= 0) continue;
    const { payoff } = simulateDebt(recurring, start, state.oneoff, anchorDate, excluded, null);
    if (payoff) result.set(recurring.id, payoff);
  }
  return result;
}

/**
 * The most a Sondertilgung due on `date` can actually pay off - the balance
 * still open right before the forecast books it, with the installments and
 * the other planned payments ahead of it already applied.
 *
 * This is what the "Komplett tilgen" shortcut must offer: computing it from
 * `effectiveRemaining` at the typed date instead would ignore that a payment
 * dated on or before the anchor is relocated to anchor+1, and that several
 * such payments then queue up on that one day.
 */
export function debtHeadroom(
  state: AppState,
  debtId: number,
  date: string,
  anchor: string,
  excludedOneOffIds?: ReadonlySet<number>,
  excludeOneOffId?: number
): number | null {
  const recurring = state.recurring.find((candidate) => candidate.id === debtId);
  if (!recurring) return null;
  const start = effectiveRemaining(recurring, anchor);
  if (start === null) return null;
  const excluded = new Set(excludedOneOffIds ?? []);
  if (excludeOneOffId !== undefined) excluded.add(excludeOneOffId);
  // A probe payment on the same day, big enough that the walk clamps it to
  // whatever is left: the clamped value IS the headroom.
  const probeId = -1;
  const probe: OneOffItem = {
    id: probeId,
    name: "",
    amount: Number.MAX_SAFE_INTEGER,
    kind: "expense",
    date,
    isContract: false,
    debtId,
    isActive: true,
  };
  const schedule = simulateDebt(
    recurring,
    start,
    [...state.oneoff, probe],
    anchor,
    excluded,
    null
  );
  return schedule.extras.get(probeId) ?? 0;
}

export interface DailyProjectionOptions {
  /**
   * The day the starting balance is valid for (date of the newest imported
   * transaction). Everything due strictly after this day gets booked.
   */
  anchorDate: string;
  /** One-off items to leave out of the forecast (chart toggle). */
  excludedOneOffIds?: ReadonlySet<number>;
  /**
   * Money already spent per category in the anchor budget period (positive
   * numbers). Budgets book only the unspent rest for the current period.
   */
  budgetSpent?: ReadonlyMap<string, number>;
}

/**
 * Project the balance day by day: every item is booked in full on its actual
 * due date (recurring items stepped by their interval from their own anchor
 * date, day-of-month clamped to short months). Nothing is averaged.
 *
 * One-off items dated on or before the anchor day are treated as "planned but
 * not yet booked" and land on the day after the anchor, so they are not
 * silently dropped; once the real transaction is imported, exclude them.
 */
export function computeDailyProjection(
  state: AppState,
  opts: DailyProjectionOptions
): DailyPoint[] {
  const { settings } = state;
  const horizon = Math.max(1, Math.min(600, settings.monthsAhead || 24));
  const anchor = opts.anchorDate;
  const end = addMonthsClamped(anchor, horizon);
  const excluded = opts.excludedOneOffIds ?? new Set<number>();

  const eventsByDate = new Map<string, ProjectionEvent[]>();
  const book = (date: string, ev: ProjectionEvent) => {
    const list = eventsByDate.get(date);
    if (list) list.push(ev);
    else eventsByDate.set(date, [ev]);
  };

  // Budgets run in periods that begin on a configurable day (1 = calendar
  // months, 15 = salary-to-salary). Fixed charges are keyed by the period
  // they fall into, so a rent debited on the 1st counts against the period
  // that contains that 1st — not against a calendar month the period splits.
  const startDay = clampBudgetStartDay(state.settings.budgetStartDay);
  const periodKeyOf = (iso: string) => budgetPeriodOf(iso, startDay).start;

  // What the forecast actually charges to a category in a given period; the
  // budgets below top their limit up to this, they do not add to it.
  const fixedByCatPeriod = new Map<string, number>();
  const chargeCategory = (recurring: RecurringItem, due: string, amount: number) => {
    if (recurring.kind !== "expense" || (recurring.intervalMonths || 1) !== 1) return;
    const key = recurringCategory(recurring);
    if (!key) return;
    const bucket = `${key}|${periodKeyOf(due)}`;
    fixedByCatPeriod.set(
      bucket,
      round2((fixedByCatPeriod.get(bucket) ?? 0) + amount)
    );
  };
  // Items charged less often than monthly are netted at their monthly
  // equivalent instead - the same quantity computeSummary uses - so a yearly
  // 600 EUR policy under a 100 EUR budget does not lose 500 EUR to the clamp.
  const fixedEqByCategory = new Map<string, number>();
  for (const recurring of state.recurring) {
    if (recurring.kind !== "expense" || (recurring.intervalMonths || 1) === 1) continue;
    if (!isLiveOn(recurring, anchor)) continue;
    const key = recurringCategory(recurring);
    if (!key) continue;
    fixedEqByCategory.set(
      key,
      round2((fixedEqByCategory.get(key) ?? 0) + monthlyEquivalent(recurring))
    );
  }

  // What each designated one-off really pays, taken from the debt walk below,
  // so the cash line books exactly what the debt was reduced by.
  const debtBookings = new Map<number, number>();

  for (const recurring of state.recurring) {
    // Installments only: designated one-offs are booked by the one-off loop
    // and applied to the debt by the walk, both on the same day.
    const remaining = effectiveRemaining(recurring, anchor);
    if (remaining === null) {
      if (!recurring.isActive || recurring.amount <= 0) continue;
      for (const due of occurrencesAfter(recurring, anchor)) {
        if (due > end) break;
        if (recurring.endDate && due > recurring.endDate) break;
        book(due, {
          name: recurring.name,
          amount: recurring.kind === "income" ? recurring.amount : -recurring.amount,
          kind: recurring.kind,
          source: "recurring",
        });
        chargeCategory(recurring, due, recurring.amount);
      }
      continue;
    }
    // Loans/installments: one walk decides the installments, how much of each
    // designated payment is really owed and when the item ends (the final
    // installment may be partial). A settled debt books nothing at all.
    const schedule = simulateDebt(recurring, remaining, state.oneoff, anchor, excluded, end);
    for (const [id, amount] of schedule.extras) debtBookings.set(id, amount);
    for (const i of schedule.installments) {
      book(i.date, {
        name: recurring.name,
        amount: recurring.kind === "income" ? i.amount : -i.amount,
        kind: recurring.kind,
        source: "recurring",
      });
      chargeCategory(recurring, i.date, i.amount);
    }
  }

  // Budgets cap *all* spending in their category, so every period books only
  // the rest of the limit: minus what the recurring items above already
  // charge to that category, and - in the anchor period - minus what has
  // already been spent there. One convention for every period: the rest is
  // booked on the period's last day, because variable spending accrues across
  // it. A period-end anchor leaves no room, so its rest moves to the next day
  // instead of being silently dropped.
  for (const budget of state.budgets) {
    const label = `Budget: ${categoryByKey(budget.category).label}`;
    const anchorPeriodStart = budgetPeriodOf(anchor, startDay).start;
    for (let periodIndex = 0; ; periodIndex++) {
      const periodStart = addMonthsClamped(anchorPeriodStart, periodIndex);
      const periodEnd = budgetPeriodOf(periodStart, startDay).end;
      const due = periodEnd > anchor ? periodEnd : nextDayIso(anchor);
      if (due > end) break;
      // The anchor period's real spending is already in budgetSpent; adding a
      // monthly equivalent on top of it would subtract the same money twice.
      const alreadySpent =
        periodIndex === 0 ? opts.budgetSpent?.get(budget.category) ?? 0 : 0;
      const fixed =
        (fixedByCatPeriod.get(`${budget.category}|${periodStart}`) ?? 0) +
        (periodIndex === 0 ? 0 : fixedEqByCategory.get(budget.category) ?? 0);
      const rest = round2(
        Math.max(0, budget.amount - Math.max(0, alreadySpent) - fixed)
      );
      if (rest > 0) {
        book(due, { name: label, amount: -rest, kind: "expense", source: "budget" });
      }
    }
  }

  for (const oneOff of state.oneoff) {
    if (!oneOff.isActive || excluded.has(oneOff.id)) continue;
    const due = oneOffDueDate(oneOff, anchor);
    if (due > end) continue;
    // A designated payment books what the debt walk actually applied: never
    // more than was still owed, and nothing once the debt is settled.
    const amount = debtBookings.get(oneOff.id) ?? oneOff.amount;
    if (amount <= 0) continue;
    book(due, {
      name: oneOff.name,
      amount: oneOff.kind === "income" ? amount : -amount,
      kind: oneOff.kind,
      source: "oneoff",
    });
  }

  const points: DailyPoint[] = [{ date: anchor, balance: settings.startingBalance, events: [] }];
  let balance = settings.startingBalance;
  for (const date of [...eventsByDate.keys()].sort()) {
    const events = eventsByDate.get(date)!;
    balance += events.reduce((sum, e) => sum + e.amount, 0);
    balance = Math.round(balance * 100) / 100;
    points.push({ date, balance, events });
  }
  // Extend the line to the horizon even if the last months are quiet.
  if (points[points.length - 1].date < end) {
    points.push({ date: end, balance, events: [] });
  }
  return points;
}

/* ------------------------------------------------------------------------- */
/*  Historical average trend                                                  */
/* ------------------------------------------------------------------------- */

/**
 * True average monthly net cash flow: the net divided by how long the window
 * really is, in months. Null when there is too little data to average, which
 * forces every caller to say "unknown" rather than draw a zero.
 *
 * The old version divided by the count of distinct YYYY-MM keys. That counts
 * the window's partial first and last month as whole ones, and since the app
 * anchors on the newest booking the last month is essentially always partial:
 * a 12-month import spanning 13 keys came out ~8% low. The figure feeds both
 * the grey trend line and the +/-100 EUR Realitaetscheck threshold.
 */
export function averageMonthlyNet(
  transactions: { date: string; amount: number }[],
  today?: string
): number | null {
  if (!transactions.length) return null;
  const now = today ?? "9999-12-31";
  // A future-dated row would stretch the window and dilute the average.
  const dates = transactions
    .map((transaction) => transaction.date)
    .filter((date) => date <= now)
    .sort();
  if (!dates.length) return null;
  const max = dates[dates.length - 1];
  // Bound the window: a single stale booking should not divide a year of dense
  // data across half a decade. Measured without this, twelve dense months
  // averaging +461/month collapsed to 138/month because of one 2023 row.
  const floor = addMonthsClamped(max, -24);
  const min = dates[0] > floor ? dates[0] : floor;
  const days = daysInWindow(min, max);
  // Under four weeks the divisor is mostly noise; say nothing instead.
  if (days < 28) return null;
  const net = transactions
    .filter((transaction) => transaction.date >= min && transaction.date <= max)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return net / (days / DAYS_PER_MONTH);
}

/** Straight reference line: starting balance drifting by the real Ø net. */
export function computeTrend(
  startBalance: number,
  anchorDate: string,
  monthsAhead: number,
  avgMonthlyNet: number
): { date: string; balance: number }[] {
  const horizon = Math.max(1, Math.min(600, monthsAhead || 24));
  const points: { date: string; balance: number }[] = [];
  for (let monthIndex = 0; monthIndex <= horizon; monthIndex++) {
    points.push({
      date: addMonthsClamped(anchorDate, monthIndex),
      balance: startBalance + monthIndex * avgMonthlyNet,
    });
  }
  return points;
}

/* ------------------------------------------------------------------------- */
/*  Actual history + chart series                                             */
/* ------------------------------------------------------------------------- */

/**
 * Day-end account balances from the imported transactions. Expects the rows
 * ordered newest-first (date DESC, id DESC) as delivered by the DB layer, so
 * the first row seen per day carries that day's closing balance.
 */
export function dailyActualBalances(
  transactions: TransactionItem[]
): { date: string; balance: number }[] {
  const byDay = new Map<string, number>();
  for (const transaction of transactions) {
    if (!byDay.has(transaction.date)) byDay.set(transaction.date, transaction.balance);
  }
  return [...byDay.entries()]
    .map(([date, balance]) => ({ date, balance }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Merge actual history, the day-granular forecast and the trend reference
 * into a single series for the numeric time axis. Actual and forecast share
 * the anchor day so the lines join visually.
 */
export function buildChartSeries(
  actual: { date: string; balance: number }[],
  forecast: DailyPoint[],
  trend?: { date: string; balance: number }[]
): ChartPoint[] {
  const map = new Map<string, ChartPoint>();
  const at = (date: string): ChartPoint => {
    let entry = map.get(date);
    if (!entry) {
      entry = {
        date,
        ts: tsOf(date),
        actual: null,
        forecast: null,
        trend: null,
        events: [],
      };
      map.set(date, entry);
    }
    return entry;
  };

  for (const actualPoint of actual) {
    at(actualPoint.date).actual = actualPoint.balance;
  }
  for (const point of forecast) {
    const entry = at(point.date);
    entry.forecast = point.balance;
    entry.events = point.events;
  }
  if (trend) for (const point of trend) at(point.date).trend = point.balance;

  const rows = [...map.values()].sort((a, b) => a.ts - b.ts);
  // Rows contributed only by the trend (month steps) sit between forecast
  // event days; carry the forecast balance forward so the step line and the
  // tooltip stay continuous there.
  let carried: number | null = null;
  for (const row of rows) {
    if (row.forecast !== null) carried = row.forecast;
    else if (carried !== null) row.forecast = carried;
  }
  return rows;
}
