import de from "@/messages/de.json";
import en from "@/messages/en.json";
import {
  toAmount,
  toCategory,
  toEndDate,
  toIds,
  toInterval,
  toIsoDay,
  toKind,
  toRecurringCategory,
  toRemaining,
  toTag,
} from "@/lib/action-input";
import { effectiveCategory } from "@/lib/categories";
import type { DataSource } from "@/lib/data-source";
import { isLocale, type Locale } from "@/lib/locale";
import { clampBudgetStartDay } from "@/lib/period";
import { parseHiddenNames } from "@/lib/pii-mask";
import type {
  AnalysisJobInfo,
  AnalysisState,
  AppState,
  ClaudeActivity,
  ClaudePreview,
  ClaudePreviewKind,
  ClaudePrivacy,
  ImportCheckState,
  ImportReviewDecision,
  ImportSkippedDue,
  Kind,
  Settings,
  TransactionItem,
} from "@/lib/types";
import { todayIso } from "@/lib/utils";

import { readDemoLocale, writeDemoLocale } from "./locale";
import * as db from "./store";

// Type-only, so the bundler never loads the real Server Actions.
import type {
  ClaudeAuthResponse,
  CsvCheckStartResponse,
  CsvImportResponse,
} from "../app/actions";

/**
 * app/actions.ts for the static demo: the demo's tsconfig resolves
 * "@/app/actions" here, so every component keeps its import and calls these
 * instead of Server Actions. Same exports, same signatures, same return types.
 *
 * The ledger actions are the server's bodies over demo/store.ts. Whatever
 * needs a server or a third party (CSV import, the Claude CLI) answers with
 * "not available in the demo" through the error the component already shows.
 */

export type {
  BalancePrompt,
  ClaudeAuthResponse,
  CsvCheckStartResponse,
  CsvImportResponse,
} from "../app/actions";

function unavailable(): string {
  return (readDemoLocale() === "en" ? en : de).server.demoUnavailable;
}

/** As in app/actions.ts: a Restschuld is read against the newest booking. */
function remainingAnchorDate(): string {
  const newest = db.listTransactions()[0];
  return newest ? newest.date : db.getSettings().startDate;
}

// ---------------------------------------------------------------------------
// Recurring items
// ---------------------------------------------------------------------------

export async function addRecurringAction(input: {
  name: string;
  amount: number;
  kind: Kind;
  intervalMonths: number;
  isContract: boolean;
  date: string;
  remainingAmount?: number | null;
  endDate?: string | null;
  category?: string | null;
}): Promise<AppState> {
  const name = input.name.trim();
  const date = input.date || todayIso();
  if (name) {
    const remaining = toRemaining(input.remainingAmount);
    db.addRecurring(
      name,
      toAmount(input.amount),
      toKind(input.kind),
      toInterval(input.intervalMonths),
      !!input.isContract,
      date,
      remaining,
      remaining !== null ? remainingAnchorDate() : null,
      toEndDate(input.endDate),
      toRecurringCategory(input.category)
    );
  }
  return db.getAppState();
}

export async function updateRecurringAction(input: {
  id: number;
  name: string;
  amount: number;
  kind: Kind;
  intervalMonths: number;
  isContract: boolean;
  date: string;
  remainingAmount?: number | null;
  endDate?: string | null;
  category?: string | null;
}): Promise<AppState> {
  const name = input.name.trim();
  if (name) {
    const remaining = toRemaining(input.remainingAmount);
    db.updateRecurring(
      input.id,
      name,
      toAmount(input.amount),
      toKind(input.kind),
      toInterval(input.intervalMonths),
      !!input.isContract,
      input.date || todayIso(),
      remaining,
      remaining !== null ? remainingAnchorDate() : null,
      toEndDate(input.endDate),
      toRecurringCategory(input.category)
    );
  }
  return db.getAppState();
}

export async function deleteRecurringAction(id: number): Promise<AppState> {
  db.deleteRecurring(id);
  return db.getAppState();
}

export async function toggleRecurringActiveAction(
  id: number,
  active: boolean
): Promise<AppState> {
  if (Number.isInteger(id)) db.setRecurringActive(id, !!active);
  return db.getAppState();
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export async function addBudgetAction(input: {
  category: string;
  amount: number;
}): Promise<AppState> {
  const category = toCategory(input.category);
  const amount = toAmount(input.amount);
  if (category && amount > 0) db.addBudget(category, amount);
  return db.getAppState();
}

export async function updateBudgetAction(input: {
  id: number;
  amount: number;
}): Promise<AppState> {
  const amount = toAmount(input.amount);
  if (amount > 0) db.updateBudget(input.id, amount);
  return db.getAppState();
}

export async function deleteBudgetAction(id: number): Promise<AppState> {
  db.deleteBudget(id);
  return db.getAppState();
}

// ---------------------------------------------------------------------------
// Categories and tags on bookings
// ---------------------------------------------------------------------------

export async function setTransactionCategoryAction(
  ids: number[],
  category: string | null
): Promise<{ transactions: TransactionItem[] }> {
  db.setTransactionsCategory(toIds(ids), category === null ? null : toCategory(category));
  return { transactions: db.listTransactions() };
}

export async function applyCategorySuggestionAction(
  ids: number[],
  expectedCategory: string,
  category: string
): Promise<{ transactions: TransactionItem[]; applied: number; skipped: number }> {
  const target = toCategory(category);
  const wanted = new Set(toIds(ids));
  if (!target || !wanted.size) {
    return { transactions: db.listTransactions(), applied: 0, skipped: wanted.size };
  }
  const stillMatching = db
    .listTransactions()
    .filter((transaction) => wanted.has(transaction.id) && effectiveCategory(transaction) === expectedCategory)
    .map((transaction) => transaction.id);
  db.setTransactionsCategory(stillMatching, target);
  return {
    transactions: db.listTransactions(),
    applied: stillMatching.length,
    skipped: wanted.size - stillMatching.length,
  };
}

export async function addTransactionTagAction(
  ids: number[],
  tag: string
): Promise<{ transactions: TransactionItem[] }> {
  const clean = toTag(tag);
  if (clean) db.addTransactionsTag(toIds(ids), clean);
  return { transactions: db.listTransactions() };
}

export async function removeTransactionTagAction(
  ids: number[],
  tag: string
): Promise<{ transactions: TransactionItem[] }> {
  const clean = toTag(tag);
  if (clean) db.removeTransactionsTag(toIds(ids), clean);
  return { transactions: db.listTransactions() };
}

// ---------------------------------------------------------------------------
// One-off items
// ---------------------------------------------------------------------------

/** As in app/actions.ts: only an expense can pay down, or be, a debt. */
function toDebtId(value: unknown, kind: Kind): number | null {
  if (kind !== "expense" || typeof value !== "number" || !Number.isInteger(value))
    return null;
  return db.listRecurring().some((recurring) => recurring.id === value && recurring.kind === "expense")
    ? value
    : null;
}

export async function addOneOffAction(input: {
  name: string;
  amount: number;
  kind: Kind;
  date: string;
  isContract: boolean;
  debtId?: number | null;
}): Promise<AppState> {
  const name = input.name.trim();
  const date = input.date || todayIso();
  if (name) {
    const kind = toKind(input.kind);
    db.addOneOff(name, toAmount(input.amount), kind, date, !!input.isContract, toDebtId(input.debtId, kind));
  }
  return db.getAppState();
}

export async function updateOneOffAction(input: {
  id: number;
  name: string;
  amount: number;
  kind: Kind;
  date: string;
  isContract: boolean;
  debtId?: number | null;
}): Promise<AppState> {
  const name = input.name.trim();
  if (name) {
    const kind = toKind(input.kind);
    db.updateOneOff(
      input.id,
      name,
      toAmount(input.amount),
      kind,
      input.date || todayIso(),
      !!input.isContract,
      toDebtId(input.debtId, kind)
    );
  }
  return db.getAppState();
}

export async function deleteOneOffAction(id: number): Promise<AppState> {
  db.deleteOneOff(id);
  return db.getAppState();
}

export async function toggleOneOffActiveAction(
  id: number,
  active: boolean
): Promise<AppState> {
  if (Number.isInteger(id)) db.setOneOffActive(id, !!active);
  return db.getAppState();
}

// ---------------------------------------------------------------------------
// Links between bookings and recurring due dates
// ---------------------------------------------------------------------------

function snapshot() {
  return {
    state: db.getAppState(),
    history: db.getMonthlyHistory(),
    transactions: db.listTransactions(),
  };
}

export async function linkTransactionAction(
  transactionId: number,
  recurringId: number,
  due: string
): Promise<CsvImportResponse> {
  const day = toIsoDay(due);
  const known = db.listRecurring().some((item) => item.id === recurringId);
  const exists = db.listTransactions().some((transaction) => transaction.id === transactionId);
  if (day && known && exists) {
    db.linkTransactionsToRecurring([{ transactionId, recurringId, due: day }]);
  }
  return { ok: true, ...snapshot() };
}

export async function unlinkTransactionAction(
  transactionId: number
): Promise<CsvImportResponse> {
  db.unlinkTransaction(transactionId);
  return { ok: true, ...snapshot() };
}

export async function setRecurringDueSkippedAction(
  recurringId: number,
  due: string,
  skipped: boolean
): Promise<AppState> {
  const day = toIsoDay(due);
  if (day && db.listRecurring().some((item) => item.id === recurringId)) {
    if (skipped) db.skipRecurringDue(recurringId, day);
    else db.unskipRecurringDue(recurringId, day);
  }
  return db.getAppState();
}

export async function relinkRecurringAction(): Promise<
  CsvImportResponse & { linked: number }
> {
  const linked = db.relinkRecurring();
  return { ok: true, linked, ...snapshot() };
}

// ---------------------------------------------------------------------------
// Settings, data source, language
// ---------------------------------------------------------------------------

export async function updateSettingsAction(settings: Settings): Promise<AppState> {
  db.updateSettings({
    startingBalance: Math.round((Number(settings.startingBalance) || 0) * 100) / 100,
    startDate: settings.startDate || todayIso(),
    monthsAhead: Math.max(1, Math.min(600, Math.round(Number(settings.monthsAhead) || 24))),
    budgetStartDay: clampBudgetStartDay(settings.budgetStartDay),
  });
  return db.getAppState();
}

/** There is only the demo here; the demo page does not render the switcher. */
export async function switchDataSourceAction(_source: DataSource): Promise<DataSource> {
  return "demo";
}

export async function resetDemoDataAction(): Promise<void> {
  db.resetDemoStore();
}

/** Remembered in the browser; LanguageSwitcher reloads right after. */
export async function switchLocaleAction(locale: Locale): Promise<Locale> {
  if (!isLocale(locale)) return readDemoLocale();
  writeDemoLocale(locale);
  return locale;
}

// ---------------------------------------------------------------------------
// Needs a server or the Claude CLI: not available in the demo
// ---------------------------------------------------------------------------

const IDLE_JOB: AnalysisJobInfo = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  log: [],
  error: null,
};

function analysisState(failed?: "categories" | "free", question = ""): AnalysisState {
  const failedJob: AnalysisJobInfo = { ...IDLE_JOB, status: "error", error: unavailable() };
  return {
    categories: { ...(failed === "categories" ? failedJob : IDLE_JOB), suggestions: [] },
    free: { ...(failed === "free" ? failedJob : IDLE_JOB), question, answer: "" },
  };
}

export async function importCsvAction(
  _text: string,
  _closingBalance?: number
): Promise<CsvImportResponse> {
  return { ok: false, error: unavailable(), ...snapshot() };
}

export async function startCsvCheckAction(
  _text: string,
  _closingBalance?: number
): Promise<CsvCheckStartResponse> {
  return { ok: false, error: unavailable() };
}

export async function getCsvCheckStateAction(_withPending = false): Promise<ImportCheckState> {
  return { ...IDLE_JOB, result: null };
}

export async function cancelCsvCheckAction(): Promise<void> {}

export async function skipCsvCheckClaudeAction(): Promise<void> {}

export async function getClaudeActivityAction(): Promise<ClaudeActivity> {
  return { importCheck: false, categories: false, question: false };
}

export async function confirmCsvImportAction(
  _text: string,
  _closingBalance: number | null,
  _decisions: ImportReviewDecision[],
  _skippedDues: ImportSkippedDue[] = []
): Promise<CsvImportResponse> {
  return { ok: false, error: unavailable(), ...snapshot() };
}

export async function getClaudeAuthAction(): Promise<ClaudeAuthResponse> {
  return { status: null, error: unavailable() };
}

export async function startClaudeLoginAction(): Promise<{
  url: string | null;
  error: string | null;
}> {
  return { url: null, error: unavailable() };
}

export async function finishClaudeLoginAction(_code: string): Promise<ClaudeAuthResponse> {
  return { status: null, error: unavailable() };
}

export async function cancelClaudeLoginAction(): Promise<void> {}

let demoHiddenNames: string[] = [];

export async function setClaudeEnabledAction(_enabled: boolean): Promise<ClaudePrivacy> {
  // Claude never runs in the demo, so the switch stays off.
  return { enabled: false, hiddenNames: demoHiddenNames };
}

export async function previewClaudePromptAction(
  _kind: ClaudePreviewKind,
  _question = ""
): Promise<ClaudePreview> {
  return { ok: false, prompt: "", hidden: [], sample: 0, error: unavailable() };
}

export async function setHiddenNamesAction(names: string): Promise<ClaudePrivacy> {
  demoHiddenNames = parseHiddenNames(names);
  return { enabled: false, hiddenNames: demoHiddenNames };
}

export async function getAnalysisStateAction(): Promise<AnalysisState> {
  return analysisState();
}

export async function startCategoryAnalysisAction(): Promise<AnalysisState> {
  return analysisState("categories");
}

export async function resolveCategorySuggestionAction(
  _key: string,
  _accepted: boolean
): Promise<AnalysisState> {
  return analysisState();
}

export async function startFreeAnalysisAction(question: string): Promise<AnalysisState> {
  return analysisState("free", question);
}
