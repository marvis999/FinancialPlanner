export type Kind = "expense" | "income";

/** How often a recurring item is due, in months. */
export type Interval = 1 | 3 | 6 | 12;

export interface RecurringItem {
  id: number;
  name: string;
  amount: number; // always positive; sign derived from `kind`
  kind: Kind;
  intervalMonths: number; // 1 = monthly, 3 = quarterly, 6 = half-year, 12 = yearly
  isContract: boolean; // marks a subscription / contract
  date: string; // ISO date: anchors the schedule (first / reference due date)
  /** Remaining amount owed (loans/installments); null = runs indefinitely. */
  remainingAmount: number | null;
  /** Day the remaining amount was entered; payments after it count it down. */
  remainingAsOf: string | null;
  /** Last day the contract runs; no payments after it. Null = open-ended. */
  endDate: string | null;
  /** Paused items stay in the list but are left out of forecast and totals. */
  isActive: boolean;
  /**
   * Spending category this item belongs to (key from lib/categories), so a
   * budget can cap it. Null = not assigned: no budget covers this item.
   */
  category: string | null;
}

/** Monthly spending limit for one category. */
export interface BudgetItem {
  id: number;
  category: string; // category key from lib/categories
  amount: number; // monthly limit, positive
}

export interface OneOffItem {
  id: number;
  name: string;
  amount: number; // always positive; sign derived from `kind`
  kind: Kind;
  date: string; // ISO date: YYYY-MM-DD
  isContract: boolean; // marks a subscription / contract
  /** Recurring item whose Restschuld this expense pays down (Sondertilgung). */
  debtId: number | null;
  /**
   * Paused items stay in the list but are left out of forecast and debt math —
   * for expenses one is not sure about yet, without having to delete them.
   */
  isActive: boolean;
}

export interface Settings {
  startingBalance: number;
  startDate: string; // ISO date: YYYY-MM-DD (first of the month)
  monthsAhead: number;
  /**
   * Day of month (1–28) the budget period begins; 1 = calendar months.
   * 15 makes budgets run salary-to-salary (15th to the 14th).
   */
  budgetStartDay: number;
}

export interface AppState {
  recurring: RecurringItem[];
  oneoff: OneOffItem[];
  budgets: BudgetItem[];
  settings: Settings;
}

/** A real, imported bank transaction (ledger entry). */
export interface TransactionItem {
  id: number;
  date: string; // ISO date: YYYY-MM-DD
  name: string; // counterparty (or booking-text fallback)
  amount: number; // signed: + income, - expense
  type: string; // the bank's "Buchungstext" column, e.g. KARTENZAHLUNG
  purpose: string; // the bank's "Verwendungszweck" column
  counterpartyIban: string;
  balance: number; // running account balance after this transaction
  /** Manually assigned category key; null = derive from keywords. */
  category: string | null;
  /** Free-form user labels, e.g. "Urlaub 2026" or "Hund". */
  tags: string[];
}

/** A category (re-)assignment proposed by Claude for one merchant group. */
export interface CategorySuggestion {
  /** Stable per-run key of the merchant group. */
  key: string;
  /** Display name of the merchant / counterparty. */
  name: string;
  /** Transaction ids the suggestion applies to. */
  ids: number[];
  count: number;
  /** Signed sum of the group's amounts. */
  total: number;
  currentCategory: string;
  suggestedCategory: string;
  /** Short German reasoning from the model. */
  reason: string;
  /** True once the user accepted the suggestion (kept for the review UI). */
  accepted: boolean;
}

/** Serializable snapshot of a server-side analysis job for the UI. */
export interface AnalysisJobInfo {
  status: "idle" | "running" | "done" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  /** Progress lines, oldest first; the last one reflects the current step. */
  log: string[];
  error: string | null;
}

export interface CategoryAnalysisState extends AnalysisJobInfo {
  suggestions: CategorySuggestion[];
}

export interface FreeAnalysisState extends AnalysisJobInfo {
  question: string;
  answer: string;
}

/** Combined state of both analysis jobs, polled by the Analyse tab. */
export interface AnalysisState {
  categories: CategoryAnalysisState;
  free: FreeAnalysisState;
}

/** One new payment the Claude import check flagged, with its suggestions. */
export interface ImportCheckFinding {
  /** Fingerprint of the parsed CSV row — stable across parse runs. */
  fingerprint: string;
  date: string;
  name: string;
  /** Signed: + income, − expense. */
  amount: number;
  purpose: string;
  /** Category the keyword fallback would assign without intervention. */
  currentCategory: string;
  /** Differing category Claude proposes; null = no category finding. */
  suggestedCategory: string | null;
  categoryReason: string;
  /** Planned one-off item this payment appears to realize. */
  oneOff: {
    id: number;
    name: string;
    amount: number; // positive magnitude, sign via kind
    kind: Kind;
    date: string;
  } | null;
  oneOffReason: string;
}

/** Outcome of the Claude pre-import check over one uploaded CSV. */
export interface ImportCheckResult {
  /** Payments in the file that are not in the ledger yet. */
  newCount: number;
  /** How many of those were sent to Claude (newest first, capped). */
  checked: number;
  findings: ImportCheckFinding[];
}

/** Snapshot of the pre-import check job, polled by the upload component. */
export interface ImportCheckState extends AnalysisJobInfo {
  result: ImportCheckResult | null;
}

/** The user's verdict for one flagged payment, sent along with the import. */
export interface ImportReviewDecision {
  fingerprint: string;
  /** Accepted category suggestion, or null when none was accepted. */
  category: string | null;
  /** Accepted one-off match: the planned item is removed once imported. */
  oneOffId: number | null;
}

/** Actual account balance at the end of a given month (from imported data). */
export interface MonthlyBalance {
  date: string; // YYYY-MM-01
  balance: number;
}

/** A parsed transaction ready to be inserted (fingerprint for de-duplication). */
export interface ImportTransaction {
  date: string;
  valuta: string | null;
  name: string;
  amount: number; // signed
  currency: string;
  type: string;
  purpose: string;
  iban: string;
  bic: string;
  fingerprint: string;
}

export interface ImportResult {
  added: number;
  skipped: number;
  /** Booked rows the parser rejected. Counted separately from `skipped`, which
   *  means "already present": reporting a broken row as a duplicate told the
   *  user their booking was safely stored when nothing had been written. */
  invalid?: number;
  total: number;
  newBalance: number;
  minDate: string;
  maxDate: string;
}
