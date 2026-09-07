import { isLiveOn, occurrencesAfter } from "./projection";
import type { RecurringItem, TransactionItem } from "./types";

/**
 * Which real booking settles which due date of a recurring item.
 *
 * The forecast knows when the rent is due; the ledger knows what was paid.
 * Nothing used to connect the two, so a missing rent looked like a month
 * that was going well. The link lives on the booking (`recurringId` +
 * `recurringDue`): one booking realizes one due date, the schedule itself
 * stays untouched.
 *
 * Matching is deterministic and runs without the model. An item whose
 * counterparty was confirmed once (`matchName` / `matchIban`) is recognized
 * by that pattern; an item never confirmed is only proposed when the amount
 * is exact and a word of its name appears in the booking. Everything here is
 * pure, so the whole contract is testable without a database.
 */

/** Days either side of a due date a booking may post and still settle it. */
export const DUE_WINDOW_DAYS = 7;

/** A booking as the matcher sees it: an imported row or a ledger entry. */
export interface MatchCandidate {
  /** Fingerprint of a new row, or the ledger id as a string. */
  key: string;
  date: string;
  name: string;
  purpose: string;
  /** Signed: + income, - expense. */
  amount: number;
  iban: string;
}

/**
 * "pattern": the counterparty was confirmed before, the link is applied
 * without asking. "heuristic": exact amount plus a name word, proposed for
 * confirmation - and the confirmation teaches the pattern.
 */
export type MatchConfidence = "pattern" | "heuristic";

export interface RecurringMatch {
  key: string;
  recurringId: number;
  due: string;
  confidence: MatchConfidence;
}

/** A due date inside the window that no booking settles. */
export interface ExpectedDue {
  recurringId: number;
  due: string;
}

export interface MatchResult {
  matches: RecurringMatch[];
  /** Oldest first. Only live items; skipped due dates are left out. */
  expected: ExpectedDue[];
}

/** Map key for a settled due date. */
export function settledKey(recurringId: number, due: string): string {
  return `${recurringId}|${due}`;
}

/* ------------------------------------------------------------------------- */
/*  Day arithmetic (UTC-based on ISO days, so no timezone can shift a day)    */
/* ------------------------------------------------------------------------- */

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function dayDiff(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function shiftDays(iso: string, days: number): string {
  const date = new Date((dayNumber(iso) + days) * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** Due dates of an item inside [from, to], respecting its end date. */
export function dueDatesBetween(
  recurring: RecurringItem,
  from: string,
  to: string
): string[] {
  const out: string[] = [];
  if (from > to) return out;
  for (const due of occurrencesAfter(recurring, shiftDays(from, -1))) {
    if (due > to) break;
    if (recurring.endDate && due > recurring.endDate) break;
    out.push(due);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/*  Counterparty identity                                                     */
/* ------------------------------------------------------------------------- */

/** Legal forms and banking noise that identify nothing. */
const STOPWORDS = new Set([
  "gmbh", "ag", "kg", "co", "ohg", "ug", "se", "ev", "und", "the",
  "sepa", "lastschrift", "basislastschrift", "dauerauftrag", "ueberweisung",
  "gutschrift", "einzug", "mandat", "mandatsref", "ref", "glaeubiger",
  "der", "die", "das", "fuer", "fur", "von", "zum", "zur", "bei",
  "bank", "konto", "zahlung", "rate", "beitrag", "monat", "monatlich",
  "abschlag", "rechnung", "vertrag", "kunde", "kundennr", "nr",
]);

/** Lower-case ASCII words, umlauts folded, punctuation dropped. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function tokens(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

type Identity = "strong" | "weak" | "none";

/**
 * How sure we are that the booking comes from the item's counterparty. A
 * learned IBAN or name is certain; a shared word ("miete", "netflix") is a
 * hint that needs the exact amount to become a proposal.
 */
function identityOf(recurring: RecurringItem, booking: MatchCandidate): Identity {
  const iban = normalizeIban(booking.iban);
  if (recurring.matchIban && iban && iban === normalizeIban(recurring.matchIban)) {
    return "strong";
  }
  if (recurring.matchName && normalizeName(booking.name) === recurring.matchName) {
    return "strong";
  }
  const wanted = tokens(recurring.name);
  if (!wanted.length) return "none";
  const present = new Set(tokens(`${booking.name} ${booking.purpose}`));
  return wanted.some((word) => present.has(word)) ? "weak" : "none";
}

function signFits(recurring: RecurringItem, booking: MatchCandidate): boolean {
  return recurring.kind === "income" ? booking.amount > 0 : booking.amount < 0;
}

/**
 * A confirmed counterparty may drift (an electricity Abschlag, a final loan
 * installment); an unconfirmed one has to hit the amount exactly, or every
 * "Miete" in a Verwendungszweck would claim the rent.
 */
function amountFits(
  recurring: RecurringItem,
  booking: MatchCandidate,
  identity: Identity
): { fits: boolean; exact: boolean } {
  const diff = Math.abs(Math.abs(booking.amount) - recurring.amount);
  const exact = diff < 0.005;
  if (exact) return { fits: true, exact };
  if (identity === "strong") {
    return { fits: diff <= Math.max(2, recurring.amount * 0.25), exact };
  }
  return { fits: false, exact };
}

/* ------------------------------------------------------------------------- */
/*  Matching                                                                  */
/* ------------------------------------------------------------------------- */

interface Scored extends RecurringMatch {
  score: number;
  date: string;
}

/**
 * Link bookings to the due dates they settle.
 *
 * `settled` holds the due dates already linked in the ledger (see
 * `settledKey`), so a re-import cannot claim them twice. The window defaults
 * to the span of the bookings; the expected list covers exactly that window,
 * which for an import is "what should have appeared in this file".
 */
export function matchRecurring(
  items: RecurringItem[],
  bookings: MatchCandidate[],
  settled: ReadonlySet<string>,
  window?: { from: string; to: string }
): MatchResult {
  const dates = bookings.map((booking) => booking.date).sort();
  const from = window?.from ?? dates[0];
  const to = window?.to ?? dates[dates.length - 1];
  if (!from || !to) return { matches: [], expected: [] };

  const candidates: Scored[] = [];
  for (const recurring of items) {
    if (!recurring.isActive || recurring.amount <= 0) continue;
    const dues = dueDatesBetween(
      recurring,
      shiftDays(from, -DUE_WINDOW_DAYS),
      shiftDays(to, DUE_WINDOW_DAYS)
    );
    if (!dues.length) continue;
    for (const booking of bookings) {
      if (!signFits(recurring, booking)) continue;
      const identity = identityOf(recurring, booking);
      if (identity === "none") continue;
      const amount = amountFits(recurring, booking, identity);
      if (!amount.fits) continue;
      let nearest: string | null = null;
      let distance = Number.POSITIVE_INFINITY;
      for (const due of dues) {
        const gap = Math.abs(dayDiff(due, booking.date));
        if (gap < distance) {
          distance = gap;
          nearest = due;
        }
      }
      if (nearest === null || distance > DUE_WINDOW_DAYS) continue;
      candidates.push({
        key: booking.key,
        recurringId: recurring.id,
        due: nearest,
        confidence: identity === "strong" ? "pattern" : "heuristic",
        score:
          (identity === "strong" ? 20 : 10) +
          (amount.exact ? 5 : 0) +
          (DUE_WINDOW_DAYS - distance),
        date: booking.date,
      });
    }
  }

  // Best evidence first; ties resolve by date so the result is stable.
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      a.recurringId - b.recurringId
  );

  const usedBookings = new Set<string>();
  const usedDues = new Set(settled);
  const matches: RecurringMatch[] = [];
  for (const candidate of candidates) {
    const dueKey = settledKey(candidate.recurringId, candidate.due);
    if (usedBookings.has(candidate.key) || usedDues.has(dueKey)) continue;
    usedBookings.add(candidate.key);
    usedDues.add(dueKey);
    matches.push({
      key: candidate.key,
      recurringId: candidate.recurringId,
      due: candidate.due,
      confidence: candidate.confidence,
    });
  }

  const expected: ExpectedDue[] = [];
  for (const recurring of items) {
    if (!isLiveOn(recurring, to)) continue;
    for (const due of dueDatesBetween(recurring, from, to)) {
      if (usedDues.has(settledKey(recurring.id, due))) continue;
      if (recurring.skippedDues.includes(due)) continue;
      expected.push({ recurringId: recurring.id, due });
    }
  }
  expected.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.recurringId - b.recurringId));

  return { matches, expected };
}

/* ------------------------------------------------------------------------- */
/*  Reading the links back                                                    */
/* ------------------------------------------------------------------------- */

/** One settled due date, as read from the ledger. */
export interface RecurringLink {
  transactionId: number;
  /** Booking day. */
  date: string;
  /** Signed booking amount. */
  amount: number;
  due: string;
}

/** The settled due dates of every item, from the ledger's links. */
export function linksByRecurring(
  transactions: readonly TransactionItem[]
): Map<number, RecurringLink[]> {
  const out = new Map<number, RecurringLink[]>();
  for (const transaction of transactions) {
    if (transaction.recurringId === null || transaction.recurringDue === null) continue;
    const list = out.get(transaction.recurringId) ?? [];
    list.push({
      transactionId: transaction.id,
      date: transaction.date,
      amount: transaction.amount,
      due: transaction.recurringDue,
    });
    out.set(transaction.recurringId, list);
  }
  return out;
}

/** Every settled due date in the ledger, keyed for `matchRecurring`. */
export function settledDues(transactions: readonly TransactionItem[]): Set<string> {
  const out = new Set<string>();
  for (const transaction of transactions) {
    if (transaction.recurringId !== null && transaction.recurringDue !== null) {
      out.add(settledKey(transaction.recurringId, transaction.recurringDue));
    }
  }
  return out;
}

/**
 * Where an item stands on `anchor` (the newest booking): the most recent due
 * date and whether a booking settled it.
 *
 * "open" is the state worth seeing: due, but nothing linked. `daysOpen` lets
 * the UI tone it down for a bank that posts a day late and raise it once a
 * week has passed. `recognizable` says whether a pattern exists at all - an
 * item never confirmed cannot be called missing with confidence.
 */
export type RecurringStatus =
  | { kind: "settled"; due: string; date: string; amount: number; transactionId: number }
  | { kind: "skipped"; due: string }
  | { kind: "open"; due: string; daysOpen: number; recognizable: boolean }
  | { kind: "upcoming"; due: string };

export function recurringStatus(
  recurring: RecurringItem,
  links: readonly RecurringLink[],
  anchor: string
): RecurringStatus | null {
  if (!recurring.isActive || recurring.amount <= 0) return null;
  // Start one interval plus the window before the anchor: the generator
  // seeks close to its argument, so this stays cheap for old schedules.
  const lookback = (recurring.intervalMonths || 1) * 31 + DUE_WINDOW_DAYS;
  let latest: string | null = null;
  let next: string | null = null;
  for (const due of occurrencesAfter(recurring, shiftDays(anchor, -lookback))) {
    if (recurring.endDate && due > recurring.endDate) break;
    if (due <= anchor) {
      latest = due;
    } else {
      next = due;
      break;
    }
  }
  if (latest === null) {
    return next === null ? null : { kind: "upcoming", due: next };
  }
  const link = links.find((candidate) => candidate.due === latest);
  if (link) {
    return {
      kind: "settled",
      due: latest,
      date: link.date,
      amount: link.amount,
      transactionId: link.transactionId,
    };
  }
  if (recurring.skippedDues.includes(latest)) return { kind: "skipped", due: latest };
  return {
    kind: "open",
    due: latest,
    daysOpen: dayDiff(latest, anchor),
    recognizable: recurring.matchName !== null || recurring.matchIban !== null,
  };
}
