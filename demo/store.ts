import { buildDemoDataset } from "@/lib/demo-data";
import {
  matchRecurring,
  normalizeIban,
  normalizeName,
  settledDues,
} from "@/lib/recurring-match";
import type {
  AppState,
  BudgetItem,
  Kind,
  MonthlyBalance,
  OneOffItem,
  RecurringItem,
  Settings,
  TransactionItem,
} from "@/lib/types";
import { todayIso } from "@/lib/utils";

/**
 * lib/db.ts for the static demo: the same functions over plain arrays in the
 * browser instead of SQLite on a server. Names, arguments, ordering and the
 * seeding steps follow lib/db.ts one to one, so the two can be read side by
 * side; anything not listed here has no use without a server.
 *
 * Nothing is persisted. A reload regenerates the household for that day.
 */

interface Ledger {
  recurring: RecurringItem[];
  oneoff: OneOffItem[];
  budgets: BudgetItem[];
  settings: Settings;
  transactions: TransactionItem[];
  /** Per table and never reused, like SQLite's AUTOINCREMENT. */
  lastIds: { recurring: number; oneoff: number; budgets: number };
}

let ledger: Ledger | null = null;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Seeded on first use, in the browser, so the household always ends today.
function current(): Ledger {
  ledger ??= seed(todayIso());
  return ledger;
}

/** Throw every edit away and generate the household for `today` again. */
export function resetDemoStore(today: string = todayIso()): void {
  ledger = seed(today);
}

// Every list hands out copies: React keeps the previous state, and an
// in-place edit here would change it behind its back.
function copy<T>(value: T): T {
  return structuredClone(value);
}

function seed(today: string): Ledger {
  const data = buildDemoDataset(today);

  const recurring: RecurringItem[] = data.recurring.map((item, index) => ({
    ...item,
    id: index + 1,
    isActive: true,
    matchName: null,
    matchIban: null,
    skippedDues: [],
  }));
  const debtIds = new Map(recurring.map((item) => [item.name, item.id]));
  const oneoff: OneOffItem[] = data.oneoff.map(({ debtName, ...item }, index) => ({
    ...item,
    id: index + 1,
    debtId: debtName ? (debtIds.get(debtName) ?? null) : null,
  }));
  const budgets: BudgetItem[] = data.budgets.map((budget, index) => ({
    ...budget,
    id: index + 1,
  }));
  const transactions: TransactionItem[] = data.transactions.map((row, index) => ({
    id: index + 1,
    date: row.date,
    name: row.name,
    amount: row.amount,
    type: row.type,
    purpose: row.purpose,
    counterpartyIban: row.iban,
    balance: 0,
    category: row.category,
    tags: [],
    recurringId: null,
    recurringDue: null,
  }));

  const seeded: Ledger = {
    recurring,
    oneoff,
    budgets,
    settings: { ...data.settings },
    transactions,
    lastIds: { recurring: recurring.length, oneoff: oneoff.length, budgets: budgets.length },
  };
  rebalanceTo(seeded, data.currentBalance);
  backfillRecurringLinks(seeded);
  return seeded;
}

/** Same as lib/db.ts: derive every running balance backwards from `anchor`. */
function rebalanceTo(target: Ledger, anchor: number): void {
  const ascending = [...target.transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id - b.id
  );
  if (!ascending.length) return;
  const total = ascending.reduce((sum, transaction) => round2(sum + transaction.amount), 0);
  let balance = round2(anchor - total);
  for (const transaction of ascending) {
    balance = round2(balance + transaction.amount);
    transaction.balance = balance;
  }
}

function backfillRecurringLinks(target: Ledger): void {
  const items = sortedRecurring(target).filter((recurring) => recurring.isActive);
  if (!items.length) return;
  const unlinked = target.transactions.filter((transaction) => transaction.recurringId === null);
  if (!unlinked.length) return;
  const { matches } = matchRecurring(
    items,
    unlinked.map((transaction) => ({
      key: String(transaction.id),
      date: transaction.date,
      name: transaction.name,
      purpose: transaction.purpose,
      amount: transaction.amount,
      iban: transaction.counterpartyIban,
    })),
    settledDues(target.transactions)
  );
  applyLinks(
    target,
    matches.map((match) => ({
      transactionId: Number(match.key),
      recurringId: match.recurringId,
      due: match.due,
    }))
  );
}

/** An item without a learned counterparty takes it from its first link. */
function applyLinks(
  target: Ledger,
  links: Array<{ transactionId: number; recurringId: number; due: string }>
): void {
  for (const entry of links) {
    const transaction = target.transactions.find((candidate) => candidate.id === entry.transactionId);
    if (!transaction) continue;
    transaction.recurringId = entry.recurringId;
    transaction.recurringDue = entry.due;
    const item = target.recurring.find((candidate) => candidate.id === entry.recurringId);
    if (item && item.matchName === null && item.matchIban === null) {
      item.matchName = normalizeName(transaction.name) || null;
      item.matchIban = normalizeIban(transaction.counterpartyIban) || null;
    }
  }
}

// ---------------------------------------------------------------------------
// Recurring items
// ---------------------------------------------------------------------------

function sortedRecurring(target: Ledger): RecurringItem[] {
  return [...target.recurring].sort((a, b) => b.id - a.id);
}

export function listRecurring(): RecurringItem[] {
  return copy(sortedRecurring(current()));
}

export function linkTransactionsToRecurring(
  links: Array<{ transactionId: number; recurringId: number; due: string }>
): void {
  applyLinks(current(), links);
}

export function unlinkTransaction(transactionId: number): void {
  unlinkWhere(current(), (transaction) => transaction.id === transactionId);
}

export function skipRecurringDue(recurringId: number, due: string): void {
  const item = current().recurring.find((candidate) => candidate.id === recurringId);
  if (!item || item.skippedDues.includes(due)) return;
  item.skippedDues = [...item.skippedDues, due].sort();
}

export function unskipRecurringDue(recurringId: number, due: string): void {
  const item = current().recurring.find((candidate) => candidate.id === recurringId);
  if (item) item.skippedDues = item.skippedDues.filter((skipped) => skipped !== due);
}

/** Returns how many due dates the run newly settled. */
export function relinkRecurring(): number {
  const target = current();
  const before = settledDues(target.transactions).size;
  backfillRecurringLinks(target);
  return settledDues(target.transactions).size - before;
}

export function setRecurringActive(id: number, active: boolean): void {
  const item = current().recurring.find((candidate) => candidate.id === id);
  if (item) item.isActive = active;
}

export function addRecurring(
  name: string,
  amount: number,
  kind: Kind,
  intervalMonths: number,
  isContract: boolean,
  date: string,
  remainingAmount: number | null,
  remainingAsOf: string | null,
  endDate: string | null,
  category: string | null
): void {
  const target = current();
  target.recurring.push({
    id: ++target.lastIds.recurring,
    name,
    amount,
    kind,
    intervalMonths,
    isContract,
    date,
    remainingAmount,
    remainingAsOf,
    endDate,
    isActive: true,
    category,
    matchName: null,
    matchIban: null,
    skippedDues: [],
  });
}

export function updateRecurring(
  id: number,
  name: string,
  amount: number,
  kind: Kind,
  intervalMonths: number,
  isContract: boolean,
  date: string,
  remainingAmount: number | null,
  remainingAsOf: string | null,
  endDate: string | null,
  category: string | null
): void {
  const item = current().recurring.find((candidate) => candidate.id === id);
  if (!item) return;
  Object.assign(item, {
    name,
    amount,
    kind,
    intervalMonths,
    isContract,
    date,
    remainingAmount,
    remainingAsOf,
    endDate,
    category,
  });
}

/** Its bookings stay, unlinked; its skipped dues go with it. */
export function deleteRecurring(id: number): void {
  const target = current();
  unlinkWhere(target, (transaction) => transaction.recurringId === id);
  target.recurring = target.recurring.filter((item) => item.id !== id);
}

function unlinkWhere(target: Ledger, predicate: (transaction: TransactionItem) => boolean): void {
  for (const transaction of target.transactions) {
    if (!predicate(transaction)) continue;
    transaction.recurringId = null;
    transaction.recurringDue = null;
  }
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export function listBudgets(): BudgetItem[] {
  return copy([...current().budgets].sort((a, b) => b.amount - a.amount || a.id - b.id));
}

/** One budget per category: adding an existing one changes its amount. */
export function addBudget(category: string, amount: number): void {
  const target = current();
  // Spent even when it only updates, as SQLite's upsert does.
  const id = ++target.lastIds.budgets;
  const existing = target.budgets.find((budget) => budget.category === category);
  if (existing) existing.amount = amount;
  else target.budgets.push({ id, category, amount });
}

export function updateBudget(id: number, amount: number): void {
  const budget = current().budgets.find((candidate) => candidate.id === id);
  if (budget) budget.amount = amount;
}

export function deleteBudget(id: number): void {
  const target = current();
  target.budgets = target.budgets.filter((budget) => budget.id !== id);
}

// ---------------------------------------------------------------------------
// Categories and tags on bookings
// ---------------------------------------------------------------------------

export function setTransactionsCategory(ids: number[], category: string | null): void {
  const wanted = new Set(ids);
  for (const transaction of current().transactions) {
    if (wanted.has(transaction.id)) transaction.category = category;
  }
}

const MAX_TAGS_PER_TRANSACTION = 10;

/** Case-insensitive de-duplication and the same cap as lib/db.ts. */
export function addTransactionsTag(ids: number[], tag: string): void {
  const wanted = tag.toLowerCase();
  updateTags(ids, (tags) => {
    if (tags.some((existing) => existing.toLowerCase() === wanted)) return tags;
    if (tags.length >= MAX_TAGS_PER_TRANSACTION) return tags;
    return [...tags, tag];
  });
}

export function removeTransactionsTag(ids: number[], tag: string): void {
  const unwanted = tag.toLowerCase();
  updateTags(ids, (tags) => tags.filter((existing) => existing.toLowerCase() !== unwanted));
}

function updateTags(ids: number[], change: (tags: string[]) => string[]): void {
  const wanted = new Set(ids);
  for (const transaction of current().transactions) {
    if (wanted.has(transaction.id)) transaction.tags = change(transaction.tags);
  }
}

// ---------------------------------------------------------------------------
// One-off items
// ---------------------------------------------------------------------------

export function listOneOff(): OneOffItem[] {
  return copy(
    [...current().oneoff].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  );
}

export function setOneOffActive(id: number, active: boolean): void {
  const item = current().oneoff.find((candidate) => candidate.id === id);
  if (item) item.isActive = active;
}

export function addOneOff(
  name: string,
  amount: number,
  kind: Kind,
  date: string,
  isContract: boolean,
  debtId: number | null
): void {
  const target = current();
  target.oneoff.push({ id: ++target.lastIds.oneoff, name, amount, kind, date, isContract, debtId, isActive: true });
}

export function updateOneOff(
  id: number,
  name: string,
  amount: number,
  kind: Kind,
  date: string,
  isContract: boolean,
  debtId: number | null
): void {
  const item = current().oneoff.find((candidate) => candidate.id === id);
  if (item) Object.assign(item, { name, amount, kind, date, isContract, debtId });
}

export function deleteOneOff(id: number): void {
  const target = current();
  target.oneoff = target.oneoff.filter((item) => item.id !== id);
}

// ---------------------------------------------------------------------------
// Settings, ledger, aggregate
// ---------------------------------------------------------------------------

export function getSettings(): Settings {
  return copy(current().settings);
}

/** A corrected balance re-anchors the history too, as in lib/db.ts. */
export function updateSettings(settings: Settings): void {
  const target = current();
  const balance = round2(settings.startingBalance);
  target.settings = { ...settings, startingBalance: balance };
  rebalanceTo(target, balance);
}

export function listTransactions(): TransactionItem[] {
  return copy(
    [...current().transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  );
}

/** Month-end balance for every month that has bookings. */
export function getMonthlyHistory(): MonthlyBalance[] {
  const byMonth = new Map<string, number>();
  for (const transaction of listTransactions().reverse()) {
    byMonth.set(transaction.date.slice(0, 7) + "-01", transaction.balance);
  }
  return [...byMonth.entries()].map(([date, balance]) => ({ date, balance }));
}

export function getAppState(): AppState {
  return {
    recurring: listRecurring(),
    oneoff: listOneOff(),
    budgets: listBudgets(),
    settings: getSettings(),
  };
}
