import "server-only";

import Database from "better-sqlite3";
import path from "path";
import { todayIso } from "./utils";
import { categorize, OTHER_CATEGORY } from "./categories";
import { dataDir, readPreference, writePreference } from "./data-dir";
import {
  DATA_SOURCES,
  DEFAULT_DATA_SOURCE,
  isDataSource,
  type DataSource,
} from "./data-source";
import { buildDemoDataset } from "./demo-data";
import type {
  AppState,
  BudgetItem,
  ImportResult,
  ImportTransaction,
  Kind,
  MonthlyBalance,
  OneOffItem,
  RecurringItem,
  Settings,
  TransactionItem,
} from "./types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One open handle per data source. Each source is its own SQLite file, so
 * switching to the demo never reads, writes or locks the real one.
 */
const handles = new Map<DataSource, Database.Database>();

function firstOfCurrentMonth(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

/**
 * The selected source, persisted next to the databases. A cookie would be
 * per-browser, but the CLI importer and the Claude jobs run server-side with
 * no request to read one from - and this app serves a single household, so
 * "which dataset is open" is genuinely server state.
 */
const SOURCE_FILE = "active-source";

/**
 * Read on every call rather than memoised: a server action and a server
 * component render in different bundler layers, so they get their own copy of
 * this module. Caching the choice in memory made the action write "demo" while
 * the very next render still served the real database from its own stale copy.
 * The file is four bytes and sits in the page cache; the read does not show up.
 */
export function activeSource(): DataSource {
  const raw = readPreference(SOURCE_FILE);
  return isDataSource(raw) ? raw : DEFAULT_DATA_SOURCE;
}

/** Switch the dataset every later read and write goes to. */
export function setActiveSource(source: DataSource): DataSource {
  writePreference(SOURCE_FILE, source);
  // Opened eagerly so a first switch to the demo seeds it here, where an
  // error still reaches the caller, rather than during the next render.
  dbFor(source);
  return source;
}

function getDb(): Database.Database {
  return dbFor(activeSource());
}

function dbFor(source: DataSource): Database.Database {
  const open = handles.get(source);
  if (open) return open;

  const database = openDatabase(path.join(dataDir(), DATA_SOURCES[source].file));
  // Cached before seeding, so nothing the seeder calls can re-enter and open
  // a second handle on the same file.
  handles.set(source, database);
  if (source === "demo" && isEmpty(database)) seedDemo(database);
  return database;
}

function openDatabase(file: string): Database.Database {
  const database = new Database(file);
  database.pragma("journal_mode = WAL");

  database.exec(`
    CREATE TABLE IF NOT EXISTS recurring (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      amount     REAL    NOT NULL,
      kind       TEXT    NOT NULL DEFAULT 'expense',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oneoff (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      amount     REAL    NOT NULL,
      kind       TEXT    NOT NULL DEFAULT 'expense',
      date       TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      starting_balance REAL    NOT NULL DEFAULT 0,
      start_date       TEXT    NOT NULL,
      months_ahead     INTEGER NOT NULL DEFAULT 24
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      date              TEXT    NOT NULL,
      valuta_date       TEXT,
      name              TEXT    NOT NULL,
      amount            REAL    NOT NULL,
      currency          TEXT    NOT NULL DEFAULT 'EUR',
      type              TEXT,
      purpose           TEXT,
      counterparty_iban TEXT,
      counterparty_bic  TEXT,
      balance           REAL,
      status            TEXT,
      fingerprint       TEXT    UNIQUE,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

    CREATE TABLE IF NOT EXISTS budgets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      category   TEXT    NOT NULL UNIQUE,
      amount     REAL    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Lightweight migrations: add columns to existing tables when missing.
  ensureColumn(database, "recurring", "interval_months", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "recurring", "is_contract", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "recurring", "date", "TEXT");
  ensureColumn(database, "recurring", "remaining_amount", "REAL");
  ensureColumn(database, "recurring", "remaining_as_of", "TEXT");
  ensureColumn(database, "recurring", "is_active", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "recurring", "end_date", "TEXT");
  if (ensureColumn(database, "recurring", "category", "TEXT")) {
    backfillRecurringCategories(database);
  }
  ensureColumn(database, "oneoff", "is_contract", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "oneoff", "debt_id", "INTEGER");
  ensureColumn(database, "oneoff", "is_active", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "settings", "budget_start_day", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "transactions", "category", "TEXT");
  ensureColumn(database, "transactions", "tags", "TEXT");

  const hasSettings = database
    .prepare("SELECT COUNT(*) AS c FROM settings WHERE id = 1")
    .get() as { c: number };

  if (hasSettings.c === 0) {
    database
      .prepare(
        "INSERT INTO settings (id, starting_balance, start_date, months_ahead) VALUES (1, 0, ?, 24)"
      )
      .run(firstOfCurrentMonth());
  }

  return database;
}

function normalizeKind(value: unknown): Kind {
  return value === "income" ? "income" : "expense";
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  ddl: string
): boolean {
  const existingColumns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (existingColumns.some((existing) => existing.name === column)) return false;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

/**
 * One-shot guess for items that predate the category column: match the item
 * name against the same keyword list that buckets imported bookings. Only a
 * real hit is stored - an unrecognised name stays NULL, i.e. covered by no
 * budget, and the user picks a category in the form. Runs exactly once, when
 * the column is created, so a category cleared by hand is never re-guessed.
 */
function backfillRecurringCategories(database: Database.Database): void {
  const rows = database
    .prepare("SELECT id, name FROM recurring")
    .all() as Array<{ id: number; name: string }>;
  const upd = database.prepare("UPDATE recurring SET category = ? WHERE id = ?");
  database.transaction(() => {
    for (const row of rows) {
      const key = categorize({ name: row.name, purpose: "" });
      if (key !== OTHER_CATEGORY.key) upd.run(key, row.id);
    }
  })();
}

// ---------------------------------------------------------------------------
// Recurring (monthly) items
// ---------------------------------------------------------------------------

export function listRecurring(): RecurringItem[] {
  const rows = getDb()
    .prepare(
      "SELECT id, name, amount, kind, interval_months, is_contract, date, remaining_amount, remaining_as_of, end_date, is_active, category FROM recurring ORDER BY id DESC"
    )
    .all() as Array<{
    id: number;
    name: string;
    amount: number;
    kind: string;
    interval_months: number;
    is_contract: number;
    date: string | null;
    remaining_amount: number | null;
    remaining_as_of: string | null;
    end_date: string | null;
    is_active: number;
    category: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: row.amount,
    kind: normalizeKind(row.kind),
    intervalMonths: row.interval_months || 1,
    isContract: !!row.is_contract,
    date: row.date ?? "",
    remainingAmount: row.remaining_amount,
    remainingAsOf: row.remaining_as_of,
    endDate: row.end_date,
    isActive: !!row.is_active,
    category: row.category,
  }));
}

/** Pause or resume a recurring item (paused = kept, but not forecast). */
export function setRecurringActive(id: number, active: boolean): void {
  getDb()
    .prepare("UPDATE recurring SET is_active = ? WHERE id = ?")
    .run(active ? 1 : 0, id);
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
  getDb()
    .prepare(
      "INSERT INTO recurring (name, amount, kind, interval_months, is_contract, date, remaining_amount, remaining_as_of, end_date, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(name, amount, kind, intervalMonths, isContract ? 1 : 0, date, remainingAmount, remainingAsOf, endDate, category);
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
  getDb()
    .prepare(
      "UPDATE recurring SET name = ?, amount = ?, kind = ?, interval_months = ?, is_contract = ?, date = ?, remaining_amount = ?, remaining_as_of = ?, end_date = ?, category = ? WHERE id = ?"
    )
    .run(name, amount, kind, intervalMonths, isContract ? 1 : 0, date, remainingAmount, remainingAsOf, endDate, category, id);
}

// ---------------------------------------------------------------------------
// Budgets (monthly limit per spending category)
// ---------------------------------------------------------------------------

export function listBudgets(): BudgetItem[] {
  return getDb()
    .prepare("SELECT id, category, amount FROM budgets ORDER BY amount DESC, id ASC")
    .all() as BudgetItem[];
}

export function addBudget(category: string, amount: number): void {
  getDb()
    .prepare(
      "INSERT INTO budgets (category, amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount"
    )
    .run(category, amount);
}

export function updateBudget(id: number, amount: number): void {
  getDb().prepare("UPDATE budgets SET amount = ? WHERE id = ?").run(amount, id);
}

export function deleteBudget(id: number): void {
  getDb().prepare("DELETE FROM budgets WHERE id = ?").run(id);
}

/** Manually assign (or reset, with null) the category of the given bookings. */
export function setTransactionsCategory(
  ids: number[],
  category: string | null
): void {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(", ");
  getDb()
    .prepare(`UPDATE transactions SET category = ? WHERE id IN (${placeholders})`)
    .run(category, ...ids);
}

// Tags are stored as a JSON string array in transactions.tags (NULL = none).
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

const MAX_TAGS_PER_TRANSACTION = 10;

/** Add a tag to the given bookings (case-insensitive de-duplication). */
export function addTransactionsTag(ids: number[], tag: string): void {
  const wanted = tag.toLowerCase();
  updateTags(ids, (tags) => {
    if (tags.some((existing) => existing.toLowerCase() === wanted)) return tags;
    if (tags.length >= MAX_TAGS_PER_TRANSACTION) return tags;
    return [...tags, tag];
  });
}

/** Remove a tag from the given bookings. */
export function removeTransactionsTag(ids: number[], tag: string): void {
  const unwanted = tag.toLowerCase();
  updateTags(ids, (tags) =>
    tags.filter((existing) => existing.toLowerCase() !== unwanted)
  );
}

function updateTags(ids: number[], change: (tags: string[]) => string[]): void {
  if (!ids.length) return;
  const database = getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = database
    .prepare(`SELECT id, tags FROM transactions WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: number; tags: string | null }>;
  const upd = database.prepare("UPDATE transactions SET tags = ? WHERE id = ?");
  const apply = database.transaction(() => {
    for (const row of rows) {
      const next = change(parseTags(row.tags));
      upd.run(next.length ? JSON.stringify(next) : null, row.id);
    }
  });
  apply();
}

export function deleteRecurring(id: number): void {
  getDb().prepare("DELETE FROM recurring WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// One-off (irregular) items
// ---------------------------------------------------------------------------

export function listOneOff(): OneOffItem[] {
  const rows = getDb()
    .prepare(
      "SELECT id, name, amount, kind, date, is_contract, debt_id, is_active FROM oneoff ORDER BY date ASC, id ASC"
    )
    .all() as Array<{
    id: number;
    name: string;
    amount: number;
    kind: string;
    date: string;
    is_contract: number;
    debt_id: number | null;
    is_active: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: row.amount,
    kind: normalizeKind(row.kind),
    date: row.date,
    isContract: !!row.is_contract,
    debtId: row.debt_id,
    isActive: !!row.is_active,
  }));
}

/** Pause or resume a one-off item (paused = kept, but not forecast). */
export function setOneOffActive(id: number, active: boolean): void {
  getDb()
    .prepare("UPDATE oneoff SET is_active = ? WHERE id = ?")
    .run(active ? 1 : 0, id);
}

export function addOneOff(
  name: string,
  amount: number,
  kind: Kind,
  date: string,
  isContract: boolean,
  debtId: number | null
): void {
  getDb()
    .prepare(
      "INSERT INTO oneoff (name, amount, kind, date, is_contract, debt_id) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(name, amount, kind, date, isContract ? 1 : 0, debtId);
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
  getDb()
    .prepare(
      "UPDATE oneoff SET name = ?, amount = ?, kind = ?, date = ?, is_contract = ?, debt_id = ? WHERE id = ?"
    )
    .run(name, amount, kind, date, isContract ? 1 : 0, debtId, id);
}

export function deleteOneOff(id: number): void {
  getDb().prepare("DELETE FROM oneoff WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSettings(): Settings {
  const row = getDb()
    .prepare(
      "SELECT starting_balance, start_date, months_ahead, budget_start_day FROM settings WHERE id = 1"
    )
    .get() as {
    starting_balance: number;
    start_date: string;
    months_ahead: number;
    budget_start_day: number;
  };
  return {
    startingBalance: row.starting_balance,
    startDate: row.start_date,
    monthsAhead: row.months_ahead,
    budgetStartDay: row.budget_start_day || 1,
  };
}

/**
 * Rewrite every running balance so the newest row ends at `anchor`: the
 * opening balance is derived backwards from it. The single place the ledger
 * is anchored, used by the importer and by a manual balance correction alike
 * - otherwise settings and ledger drift apart and the chart splits in two.
 */
function rebalanceTo(database: Database.Database, anchor: number): void {
  const rows = database
    .prepare("SELECT id, amount FROM transactions ORDER BY date ASC, id ASC")
    .all() as Array<{ id: number; amount: number }>;
  if (!rows.length) return;
  const total = rows.reduce((sum, row) => round2(sum + row.amount), 0);
  const upd = database.prepare("UPDATE transactions SET balance = ? WHERE id = ?");
  database.transaction(() => {
    let bal = round2(anchor - total);
    for (const row of rows) {
      bal = round2(bal + row.amount);
      upd.run(bal, row.id);
    }
  })();
}

export function updateSettings(settings: Settings): void {
  const database = getDb();
  const balance = round2(settings.startingBalance);
  database
    .prepare(
      "UPDATE settings SET starting_balance = ?, start_date = ?, months_ahead = ?, budget_start_day = ? WHERE id = 1"
    )
    .run(balance, settings.startDate, settings.monthsAhead, settings.budgetStartDay);
  // A corrected balance re-anchors the imported history too (C6), so the Ist
  // line and the forecast keep starting from the same number.
  rebalanceTo(database, balance);
}

// ---------------------------------------------------------------------------
// Transactions (imported bank data)
// ---------------------------------------------------------------------------

export function listTransactions(): TransactionItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, date, name, amount, type, purpose, counterparty_iban, balance, category, tags
       FROM transactions
       ORDER BY date DESC, id DESC`
    )
    .all() as Array<{
    id: number;
    date: string;
    name: string;
    amount: number;
    type: string | null;
    purpose: string | null;
    counterparty_iban: string | null;
    balance: number | null;
    category: string | null;
    tags: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    name: row.name,
    amount: row.amount,
    type: row.type ?? "",
    purpose: row.purpose ?? "",
    counterpartyIban: row.counterparty_iban ?? "",
    balance: row.balance ?? 0,
    category: row.category,
    tags: parseTags(row.tags),
  }));
}

/** Is there any imported history at all? Decides whether an import needs an
 *  opening balance to anchor against. */
export function hasTransactions(): boolean {
  const row = getDb()
    .prepare("SELECT EXISTS(SELECT 1 FROM transactions) AS e")
    .get() as { e: number };
  return !!row.e;
}

// IN-clauses are chunked well below SQLite's bound-variable limit.
const FP_CHUNK = 500;

/** Which of the given fingerprints are already stored. */
export function existingFingerprints(fingerprints: string[]): Set<string> {
  const database = getDb();
  const out = new Set<string>();
  for (let i = 0; i < fingerprints.length; i += FP_CHUNK) {
    const chunk = fingerprints.slice(i, i + FP_CHUNK);
    const rows = database
      .prepare(
        `SELECT fingerprint FROM transactions WHERE fingerprint IN (${chunk.map(() => "?").join(", ")})`
      )
      .all(...chunk) as Array<{ fingerprint: string }>;
    for (const row of rows) out.add(row.fingerprint);
  }
  return out;
}

/** Transaction ids for the given fingerprints (missing ones are absent). */
export function transactionIdsByFingerprint(
  fingerprints: string[]
): Map<string, number> {
  const database = getDb();
  const out = new Map<string, number>();
  for (let i = 0; i < fingerprints.length; i += FP_CHUNK) {
    const chunk = fingerprints.slice(i, i + FP_CHUNK);
    const rows = database
      .prepare(
        `SELECT id, fingerprint FROM transactions WHERE fingerprint IN (${chunk.map(() => "?").join(", ")})`
      )
      .all(...chunk) as Array<{ id: number; fingerprint: string }>;
    for (const row of rows) out.set(row.fingerprint, row.id);
  }
  return out;
}

/**
 * Re-anchor a loan's remaining balance to a new day (e.g. after a planned
 * Sondertilgung was matched to a real booking and removed from the plan).
 */
export function setRecurringRemaining(
  id: number,
  remaining: number,
  asOf: string
): void {
  getDb()
    .prepare(
      "UPDATE recurring SET remaining_amount = ?, remaining_as_of = ? WHERE id = ?"
    )
    .run(remaining, asOf, id);
}

/** Actual month-end account balance for every month that has transactions. */
export function getMonthlyHistory(): MonthlyBalance[] {
  const rows = getDb()
    .prepare(
      `SELECT date, balance FROM transactions
       WHERE balance IS NOT NULL
       ORDER BY date ASC, id ASC`
    )
    .all() as Array<{ date: string; balance: number }>;

  // rows are ascending, so the last row of each month wins (= month-end balance)
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    byMonth.set(row.date.slice(0, 7) + "-01", row.balance);
  }
  return [...byMonth.entries()]
    .map(([date, balance]) => ({ date, balance }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Insert parsed transactions (de-duplicated by fingerprint) and recompute all
 * running balances. The balance is anchored so the newest transaction equals
 * the current balance: back-filling older data leaves the current balance
 * unchanged, while newer data moves it by the net of the added rows.
 */
export function importTransactions(
  records: ImportTransaction[],
  /**
   * Balance AFTER the newest booking in `records` -- what the banking app
   * shows as the current balance when the export runs to today. Only consulted
   * on a first import, where there is no stored anchor to move.
   */
  closingBalance?: number | null
): ImportResult {
  const database = getDb();

  const before = database
    .prepare("SELECT MAX(date) AS mx FROM transactions")
    .get() as { mx: string | null };
  const oldMax = before.mx;
  const oldAnchor = getSettings().startingBalance;

  // Only a fingerprint conflict may be swallowed; a row violating any other
  // constraint is a bug and must not be reported to the user as a duplicate.
  const insert = database.prepare(`
    INSERT INTO transactions
      (date, valuta_date, name, amount, currency, type, purpose,
       counterparty_iban, counterparty_bic, status, fingerprint)
    VALUES
      (@date, @valuta, @name, @amount, @currency, @type, @purpose,
       @iban, @bic, 'booked', @fingerprint)
    ON CONFLICT(fingerprint) DO NOTHING
  `);
  const insertAll = database.transaction((items: ImportTransaction[]) => {
    let value = 0;
    let delta = 0;
    for (const it of items) {
      if (insert.run(it).changes !== 1) continue;
      value += 1;
      // The stored balance is the balance at the END of the oldMax day, so a
      // booking that posts later on that same day still moves it.
      if (oldMax !== null && it.date >= oldMax) delta = round2(delta + it.amount);
    }
    return { value, delta };
  });
  const { value: added, delta: addedFromAnchorOn } = insertAll(records);

  const totals = database
    .prepare(
      "SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s, MIN(date) AS mn, MAX(date) AS mx FROM transactions"
    )
    .get() as { c: number; s: number; mn: string | null; mx: string | null };

  if (totals.c === 0 || totals.mx === null) {
    return { added, skipped: records.length - added, total: 0, newBalance: oldAnchor, minDate: "", maxDate: "" };
  }

  // First import: the user confirms the balance AFTER the newest booking, so
  // that figure IS the anchor and rebalanceTo derives the opening backwards
  // from it. Asking for the opening balance instead is unanswerable - no bank
  // shows what an account held the day before the oldest row of a year-old
  // export. Later imports keep the stored balance and move it only by the rows
  // that actually inserted, from the previous newest day on.
  const newAnchor =
    oldMax === null && closingBalance !== null && closingBalance !== undefined
      ? round2(closingBalance)
      : round2(oldAnchor + addedFromAnchorOn);

  rebalanceTo(database, newAnchor);

  database
    .prepare("UPDATE settings SET starting_balance = ?, start_date = ? WHERE id = 1")
    .run(newAnchor, totals.mx.slice(0, 7) + "-01");

  return {
    added,
    skipped: records.length - added,
    total: totals.c,
    newBalance: newAnchor,
    minDate: totals.mn ?? "",
    maxDate: totals.mx,
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export function getAppState(): AppState {
  return {
    recurring: listRecurring(),
    oneoff: listOneOff(),
    budgets: listBudgets(),
    settings: getSettings(),
  };
}

// ---------------------------------------------------------------------------
// Demo dataset
// ---------------------------------------------------------------------------

/** No user content at all - a freshly created file, not one emptied by hand. */
function isEmpty(database: Database.Database): boolean {
  const row = database
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM transactions)
            + EXISTS(SELECT 1 FROM recurring)
            + EXISTS(SELECT 1 FROM oneoff) AS n`
    )
    .get() as { n: number };
  return row.n === 0;
}

/**
 * Fill a demo database with the generated household. Writes only through the
 * handle it is given, so it can never reach the real dataset: `resetDemoData`
 * passes the demo handle explicitly, and `dbFor` only calls this for "demo".
 */
function seedDemo(database: Database.Database): void {
  const data = buildDemoDataset(todayIso());

  const insertRecurring = database.prepare(
    `INSERT INTO recurring
       (name, amount, kind, interval_months, is_contract, date,
        remaining_amount, remaining_as_of, end_date, category)
     VALUES (@name, @amount, @kind, @intervalMonths, @isContract, @date,
             @remainingAmount, @remainingAsOf, @endDate, @category)`
  );
  const insertOneOff = database.prepare(
    `INSERT INTO oneoff (name, amount, kind, date, is_contract, debt_id, is_active)
     VALUES (@name, @amount, @kind, @date, @isContract, @debtId, @isActive)`
  );
  const insertBudget = database.prepare(
    "INSERT INTO budgets (category, amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount"
  );
  const insertTransaction = database.prepare(
    `INSERT INTO transactions
       (date, valuta_date, name, amount, currency, type, purpose,
        counterparty_iban, counterparty_bic, status, fingerprint, category)
     VALUES (@date, @valuta, @name, @amount, @currency, @type, @purpose,
             @iban, @bic, 'booked', @fingerprint, @category)
     ON CONFLICT(fingerprint) DO NOTHING`
  );

  database.transaction(() => {
    const debtIds = new Map<string, number>();
    for (const recurring of data.recurring) {
      const info = insertRecurring.run({
        ...recurring,
        isContract: recurring.isContract ? 1 : 0,
      });
      debtIds.set(recurring.name, Number(info.lastInsertRowid));
    }
    for (const oneOff of data.oneoff) {
      insertOneOff.run({
        name: oneOff.name,
        amount: oneOff.amount,
        kind: oneOff.kind,
        date: oneOff.date,
        isContract: oneOff.isContract ? 1 : 0,
        debtId: oneOff.debtName ? (debtIds.get(oneOff.debtName) ?? null) : null,
        isActive: oneOff.isActive ? 1 : 0,
      });
    }
    for (const b of data.budgets) insertBudget.run(b.category, b.amount);
    for (const tag of data.transactions) insertTransaction.run(tag);

    database
      .prepare(
        "UPDATE settings SET starting_balance = ?, start_date = ?, months_ahead = ?, budget_start_day = ? WHERE id = 1"
      )
      .run(
        data.settings.startingBalance,
        data.settings.startDate,
        data.settings.monthsAhead,
        data.settings.budgetStartDay
      );
  })();

  // Derives every running balance backwards from the newest booking, exactly
  // as a real import does, so the ledger and the settings agree.
  rebalanceTo(database, data.currentBalance);
}

/**
 * Throw the demo away and regenerate it. Guarded twice - by source and by
 * file name - because this is the one destructive operation in the app, and
 * pointing it at the real database would delete a year of bank history.
 */
export function resetDemoData(): void {
  const database = dbFor("demo");
  const file = database.name;
  if (path.basename(file) !== DATA_SOURCES.demo.file) {
    throw new Error(`refusing to reset ${file}: not the demo database`);
  }
  database.exec(
    "DELETE FROM transactions; DELETE FROM recurring; DELETE FROM oneoff; DELETE FROM budgets;"
  );
  seedDemo(database);
}
