"use server";

import { getTranslations } from "next-intl/server";

import * as db from "@/lib/db";
import {
  deleteJob,
  getJob,
  startJob,
  updateJobResult,
  type Job,
} from "@/lib/analysis-jobs";
import { ALL_CATEGORIES, categoryByKey, effectiveCategory } from "@/lib/categories";
import {
  CLAUDE_MODEL,
  extractJsonArray,
  runClaude,
  type ClaudeError,
} from "@/lib/claude-cli";
import {
  buildImportCheckPrompt,
  parseImportCheckAnswer,
  toCheckPayments,
} from "@/lib/import-check";
import { isDataSource, type DataSource } from "@/lib/data-source";
import { isLocale, type Locale } from "@/lib/locale";
import { activeLocale, setActiveLocale } from "@/lib/locale-store";
import { clampBudgetStartDay } from "@/lib/period";
import { effectiveRemaining } from "@/lib/projection";
import { todayIso } from "@/lib/utils";
import { looksLikeUmsatzCsv, parseCsvTransactions } from "@/lib/csv-import";
import type {
  AnalysisJobInfo,
  AnalysisState,
  AppState,
  CategoryAnalysisState,
  CategorySuggestion,
  FreeAnalysisState,
  ImportCheckResult,
  ImportCheckState,
  ImportResult,
  ImportReviewDecision,
  ImportTransaction,
  Kind,
  MonthlyBalance,
  Settings,
  TransactionItem,
} from "@/lib/types";

function toKind(value: unknown): Kind {
  return value === "income" ? "income" : "expense";
}

function toAmount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  // store a positive magnitude; sign is derived from `kind`
  return Math.abs(Math.round(parsed * 100) / 100);
}

/** Like toAmount but keeps the sign: an account balance can be negative. */
function toSignedAmount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function toInterval(value: unknown): number {
  const parsed = Math.round(Number(value));
  return [1, 3, 6, 12].includes(parsed) ? parsed : 1;
}

function toRemaining(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.abs(Math.round(parsed * 100) / 100);
}

/**
 * The day a Restschuld figure is read against: the newest imported booking,
 * which is exactly the day the dashboard forecasts from and the day the edit
 * dialog pre-filled the value for. Stamping "today" instead attaches the
 * number to a different day than the one it was computed for, so the next
 * import silently shifts the debt by one installment.
 */
function remainingAnchorDate(): string {
  const newest = db.listTransactions()[0];
  return newest ? newest.date : db.getSettings().startDate;
}

/** Budget category of a recurring item; null = covered by no budget. */
function toRecurringCategory(value: unknown): string | null {
  return typeof value === "string" && ALL_CATEGORIES.some((category) => category.key === value)
    ? value
    : null;
}

function toEndDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

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

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

function toCategory(value: unknown): string | null {
  return typeof value === "string" &&
    ALL_CATEGORIES.some((category) => category.key === value)
    ? value
    : null;
}

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
// Transaction categories
// ---------------------------------------------------------------------------

/** Assign a category to bookings; category null resets to automatic. */
export async function setTransactionCategoryAction(
  ids: number[],
  category: string | null
): Promise<{ transactions: TransactionItem[] }> {
  db.setTransactionsCategory(
    toIds(ids),
    category === null ? null : toCategory(category)
  );
  return { transactions: db.listTransactions() };
}

/**
 * Apply an accepted category suggestion, but only to the bookings that are
 * still in the category the suggestion was computed against. A group is built
 * from a snapshot; by the time it is accepted a booking may have been
 * recategorised by hand, and overwriting that is exactly the data loss B14
 * describes. Returns how many were skipped so the UI can say so.
 */
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

// ---------------------------------------------------------------------------
// Transaction tags
// ---------------------------------------------------------------------------

function toIds(ids: number[]): number[] {
  return ids.filter((parsed) => Number.isInteger(parsed)).slice(0, 5000);
}

/** Trimmed, single-spaced, capped at 30 chars; null when nothing remains. */
function toTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().replace(/\s+/g, " ").slice(0, 30);
  return tag || null;
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

export async function deleteRecurringAction(id: number): Promise<AppState> {
  db.deleteRecurring(id);
  return db.getAppState();
}

/** Pause or resume a recurring item without deleting it. */
export async function toggleRecurringActiveAction(
  id: number,
  active: boolean
): Promise<AppState> {
  if (Number.isInteger(id)) db.setRecurringActive(id, !!active);
  return db.getAppState();
}

/**
 * Only an expense can pay down a debt, and only an expense can BE one. Without
 * the second check a one-off could be designated to a recurring income, and the
 * debt machinery -- which is blind to kind -- would then treat the salary as a
 * balance to be paid down and delete it from the forecast.
 */
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
    db.addOneOff(
      name,
      toAmount(input.amount),
      kind,
      date,
      !!input.isContract,
      toDebtId(input.debtId, kind)
    );
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

/** Pause or resume a one-off item without deleting it. */
export async function toggleOneOffActiveAction(
  id: number,
  active: boolean
): Promise<AppState> {
  if (Number.isInteger(id)) db.setOneOffActive(id, !!active);
  return db.getAppState();
}

/** What the first import needs to know before it can anchor the ledger. */
export interface BalancePrompt {
  rows: number;
  minDate: string;
  maxDate: string;
  /** Signed net of the file, so the dialog can show the resulting balance. */
  sum: number;
  /** Balance currently stored, as the dialog's default. */
  suggested: number;
}

export interface CsvImportResponse {
  ok: boolean;
  error?: string;
  result?: ImportResult;
  /**
   * Set instead of `result` when the ledger is empty: nothing was imported
   * yet, because the balance before the oldest booking has to be confirmed
   * first. Re-call with `closingBalance` to go ahead.
   */
  needsBalance?: BalancePrompt;
  /** What the accepted Claude suggestions changed alongside the import. */
  review?: { categoriesApplied: number; oneOffsResolved: number };
  state: AppState;
  history: MonthlyBalance[];
  transactions: TransactionItem[];
}

function snapshot() {
  return {
    state: db.getAppState(),
    history: db.getMonthlyHistory(),
    transactions: db.listTransactions(),
  };
}

type CsvPrep =
  | { kind: "error"; error: string }
  | { kind: "needsBalance"; prompt: BalancePrompt }
  | { kind: "ok"; records: ImportTransaction[]; invalid: number };

type ServerT = Awaited<ReturnType<typeof getTranslations<"server">>>;

/** Shared validation for check and import: same file, same verdict. */
function prepareCsv(
  msg: ServerT,
  text: string,
  closingBalance?: number
): CsvPrep {
  if (!text || !looksLikeUmsatzCsv(text)) {
    return {
      kind: "error",
      error:
        msg("notUmsatzCsv"),
    };
  }

  const { records, invalid } = parseCsvTransactions(text);
  if (!records.length) {
    return {
      kind: "error",
      error:
        invalid > 0
          ? msg("noReadableRows", { invalid })
          : msg("noBookedRows"),
    };
  }

  // An empty ledger carries no reference point: the file says how the balance
  // MOVED, never where it started. Guessing zero would report the net of the
  // file as the account balance - on a year of exports that is a healthy
  // account shown deep in the red. Ask once, then anchor everything to it.
  if (closingBalance === undefined && !db.hasTransactions()) {
    const dates = records.map((record) => record.date).sort();
    return {
      kind: "needsBalance",
      prompt: {
        rows: records.length,
        minDate: dates[0],
        maxDate: dates[dates.length - 1],
        sum:
          Math.round(
            records.reduce((total, recurring) => total + recurring.amount, 0) * 100
          ) / 100,
        suggested: db.getSettings().startingBalance,
      },
    };
  }

  return { kind: "ok", records, invalid };
}

export async function importCsvAction(
  text: string,
  closingBalance?: number
): Promise<CsvImportResponse> {
  // Captured here, not inside the job: the job runs after this action has
  // returned, when there is no request left to resolve a locale from.
  const msg = await getTranslations("server");
  const prep = prepareCsv(msg, text, closingBalance);
  if (prep.kind === "error") {
    return { ok: false, error: prep.error, ...snapshot() };
  }
  if (prep.kind === "needsBalance") {
    return { ok: false, needsBalance: prep.prompt, ...snapshot() };
  }

  const result = db.importTransactions(
    prep.records,
    closingBalance === undefined ? null : toSignedAmount(closingBalance)
  );
  return { ok: true, result: { ...result, invalid: prep.invalid }, ...snapshot() };
}

// ---------------------------------------------------------------------------
// Pre-import check (Claude reviews new payments BEFORE anything is written)
// ---------------------------------------------------------------------------

const IMPORT_CHECK_JOB = "import-check";

export interface CsvCheckStartResponse {
  ok: boolean;
  error?: string;
  /** First import: confirm the balance first, then start the check again. */
  needsBalance?: BalancePrompt;
  /** Every parsed row is already in the ledger — nothing to check. */
  nothingNew?: boolean;
  /** The check job is running; poll getCsvCheckStateAction for progress. */
  started?: boolean;
}

/**
 * Validate the upload and start the Claude review of its NEW payments as a
 * server-side job. Nothing is imported here: the import happens only in
 * confirmCsvImportAction, once the user has seen the findings.
 */
export async function startCsvCheckAction(
  text: string,
  closingBalance?: number
): Promise<CsvCheckStartResponse> {
  // Captured here, not inside the job: the job runs after this action has
  // returned, when there is no request left to resolve a locale from.
  const msg = await getTranslations("server");
  const prep = prepareCsv(msg, text, closingBalance);
  if (prep.kind === "error") return { ok: false, error: prep.error };
  if (prep.kind === "needsBalance") {
    return { ok: false, needsBalance: prep.prompt };
  }

  const existing = db.existingFingerprints(prep.records.map((record) => record.fingerprint));
  const fresh = prep.records.filter((record) => !existing.has(record.fingerprint));
  if (!fresh.length) return { ok: true, nothingNew: true };

  if (getJob(IMPORT_CHECK_JOB)?.status === "running") {
    return { ok: false, error: msg("checkAlreadyRunning") };
  }
  deleteJob(IMPORT_CHECK_JOB);

  const payments = toCheckPayments(fresh);
  const oneoffs = db.listOneOff();
  startJob<ImportCheckResult>(IMPORT_CHECK_JOB, {}, async (progress) => {
    progress(
      msg("newBookings", { count: fresh.length }) +
        (payments.length < fresh.length
          ? msg("newestChecked", { count: payments.length })
          : "") +
        (oneoffs.length
          ? msg("matchedAgainst", { count: oneoffs.length })
          : "")
    );
    const prompt = buildImportCheckPrompt(
      payments,
      oneoffs,
      msg("answerLanguage")
    );
    progress(msg("startingClaude", { model: CLAUDE_MODEL }));
    const run = await runClaude(prompt, {
      onProgress: (phase) => progress(claudePhaseLine(msg, phase), { replaceLast: true }),
    });
    if (!run.ok) throw new Error(claudeErrorMessage(msg, run.error));

    progress(msg("parsingAnswer"));
    const parsed = extractJsonArray(run.text);
    if (!parsed) throw new Error(msg("noJson"));
    const findings = parseImportCheckAnswer(parsed, payments, oneoffs);
    progress(
      findings.length
        ? msg("findingsFound", { count: findings.length })
        : msg("noFindings")
    );
    return { newCount: fresh.length, checked: payments.length, findings };
  });
  return { ok: true, started: true };
}

/** Snapshot of the pre-import check job, polled by the upload component. */
export async function getCsvCheckStateAction(): Promise<ImportCheckState> {
  const job = getJob<ImportCheckResult>(IMPORT_CHECK_JOB);
  return {
    ...jobInfo(job),
    result: job?.status === "done" ? job.result : null,
  };
}

/** Abort: drop the check job so a later upload starts clean. */
export async function cancelCsvCheckAction(): Promise<void> {
  deleteJob(IMPORT_CHECK_JOB);
}

/**
 * The actual import, after the review: write ALL parsed rows (the ledger
 * needs every booking for its running balances), then apply the accepted
 * decisions — categories as manual assignments, matched one-off items
 * removed from the plan because they are now real bookings. A matched
 * extra repayment re-anchors its loan's remaining debt first, otherwise deleting
 * the plan item would silently un-pay the debt.
 */
export async function confirmCsvImportAction(
  text: string,
  closingBalance: number | null,
  decisions: ImportReviewDecision[]
): Promise<CsvImportResponse> {
  // Captured here, not inside the job: the job runs after this action has
  // returned, when there is no request left to resolve a locale from.
  const msg = await getTranslations("server");
  const prep = prepareCsv(msg, text, closingBalance ?? undefined);
  if (prep.kind === "error") {
    return { ok: false, error: prep.error, ...snapshot() };
  }
  if (prep.kind === "needsBalance") {
    return { ok: false, needsBalance: prep.prompt, ...snapshot() };
  }

  const result = db.importTransactions(
    prep.records,
    closingBalance === null ? null : toSignedAmount(closingBalance)
  );

  const byFingerprint = new Map(prep.records.map((record) => [record.fingerprint, record]));
  const valid = decisions
    .filter(
      (decision) =>
        decision && typeof decision.fingerprint === "string" && byFingerprint.has(decision.fingerprint)
    )
    .slice(0, 5000);

  // Accepted categories become manual assignments on the freshly inserted
  // rows, looked up via the same fingerprint the de-duplication uses.
  const ids = db.transactionIdsByFingerprint(valid.map((decision) => decision.fingerprint));
  const idsByCategory = new Map<string, number[]>();
  let categoriesApplied = 0;
  for (const decision of valid) {
    const category = toCategory(decision.category);
    const id = ids.get(decision.fingerprint);
    if (!category || id === undefined) continue;
    const list = idsByCategory.get(category);
    if (list) list.push(id);
    else idsByCategory.set(category, [id]);
    categoriesApplied++;
  }
  for (const [category, txIds] of idsByCategory) {
    db.setTransactionsCategory(txIds, category);
  }

  let oneOffsResolved = 0;
  const claimed = new Set<number>();
  for (const decision of valid) {
    const oneOffId = decision.oneOffId;
    if (
      typeof oneOffId !== "number" ||
      !Number.isInteger(oneOffId) ||
      claimed.has(oneOffId)
    )
      continue;
    claimed.add(oneOffId);
    const oneOff = db.listOneOff().find((candidate) => candidate.id === oneOffId);
    if (!oneOff) continue;
    const record = byFingerprint.get(decision.fingerprint)!;
    if (oneOff.debtId !== null) {
      const debt = db.listRecurring().find((recurring) => recurring.id === oneOff.debtId);
      if (debt) {
        // Restschuld as of the real payment day, without this plan item,
        // minus what was actually paid — then anchored to that day.
        const others = db.listOneOff().filter((candidate) => candidate.id !== oneOffId);
        const remaining = effectiveRemaining(debt, record.date, others);
        if (remaining !== null) {
          db.setRecurringRemaining(
            debt.id,
            Math.max(0, Math.round((remaining - oneOff.amount) * 100) / 100),
            record.date
          );
        }
      }
    }
    db.deleteOneOff(oneOffId);
    oneOffsResolved++;
  }

  deleteJob(IMPORT_CHECK_JOB);
  return {
    ok: true,
    result: { ...result, invalid: prep.invalid },
    review: { categoriesApplied, oneOffsResolved },
    ...snapshot(),
  };
}

// ---------------------------------------------------------------------------
// Claude analyses (via the locally installed Claude Code CLI)
// ---------------------------------------------------------------------------

const MAX_SUGGESTION_GROUPS = 150;

interface MerchantGroup {
  key: string;
  name: string;
  ids: number[];
  count: number;
  total: number;
  category: string;
  samples: string[];
}

function buildMerchantGroups(transactions: TransactionItem[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>();
  for (const transaction of transactions) {
    const name = transaction.name.trim() || "—";
    // Keyed by name AND current category. Grouping on the name alone let one
    // suggestion span bookings that are already categorised differently -- and
    // accepting it rewrote every id in the group, silently discarding the
    // user's manual assignments. Mixed categories under one merchant arise
    // without any manual edit too, because the keyword fallback matches per
    // booking on name + purpose.
    const current = effectiveCategory(transaction);
    const id = `${name.toUpperCase()}\u0000${current}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        key: "",
        name,
        ids: [],
        count: 0,
        total: 0,
        category: current,
        samples: [],
      };
      groups.set(id, g);
    }
    g.ids.push(transaction.id);
    g.count++;
    g.total += transaction.amount;
    if (g.samples.length < 2 && transaction.purpose) {
      g.samples.push(transaction.purpose.slice(0, 90));
    }
  }
  const list = [...groups.values()]
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, MAX_SUGGESTION_GROUPS);
  list.forEach((group, index) => (group.key = `g${index + 1}`));
  return list;
}

const CATEGORY_JOB = "categories";
const FREE_JOB = "free";

/** Progress line for the model's working phases, updated in place. */
function claudePhaseLine(
  msg: ServerT,
  phase: { phase: string; chars: number }
): string {
  if (phase.phase === "start") return msg("claudeReading");
  return phase.phase === "thinking"
    ? msg("claudeThinking", { chars: phase.chars })
    : msg("claudeWriting", { chars: phase.chars });
}

/**
 * The wording for a failed run. lib/claude-cli.ts reports a code because it
 * has no translator; this is where the code becomes a sentence the user can
 * read in their own language.
 */
function claudeErrorMessage(msg: ServerT, error: ClaudeError): string {
  switch (error.code) {
    case "timeout":
      return msg("claudeTimeout", { seconds: error.seconds });
    case "cliNotFound":
      return msg("claudeCliNotFound");
    case "cliStartFailed":
      return msg("claudeCliStartFailed", { detail: error.detail });
    case "unexpectedResponse":
      return error.detail
        ? msg("claudeUnexpectedResponseDetail", { detail: error.detail })
        : msg("claudeUnexpectedResponse");
    case "cliReportedError":
      return msg("claudeCliReportedError", {
        subtype: error.subtype ?? msg("claudeUnknownSubtype"),
      });
  }
}

/**
 * Kick off the category review as a server-side job (no-op when one is
 * already running). The job survives tab switches and page reloads; the
 * client polls `getAnalysisStateAction` for progress and results.
 */
export async function startCategoryAnalysisAction(): Promise<AnalysisState> {
  // Captured here, not inside the job: the job runs after this action has
  // returned, when there is no request left to resolve a locale from.
  const msg = await getTranslations("server");
  const transactions = db.listTransactions();
  if (transactions.length) {
    startJob<CategorySuggestion[]>(CATEGORY_JOB, {}, async (progress) => {
      const groups = buildMerchantGroups(transactions);
      progress(
        msg("groupsPrepared", {
          groups: groups.length,
          bookings: transactions.length,
        })
      );

      const catalog = ALL_CATEGORIES.map(
        (category) => `${category.key}: ${category.label}`
      ).join("\n");
      const groupLines = groups
        .map((group) =>
          JSON.stringify({
            id: group.key,
            name: group.name,
            currentCategory: group.category,
            bookings: group.count,
            total: Math.round(group.total * 100) / 100,
            samples: group.samples,
          })
        )
        .join("\n");

      const answerLanguage = msg("answerLanguage");
      const prompt = `You are an assistant in a personal finance app, reviewing the automatic categorisation of bank bookings on a German private account. The merchant names and booking text are German.

Available categories (key: label):
${catalog}

Below are merchant groups (one JSON object per line) with their currently assigned category. Many sit on "sonstiges" because no keyword matched; some are misfiled through keyword collisions (e.g. pharmacies in "bargeld", money transfers in "kredite").

Suggest a category ONLY where it differs from the current one and you are confident. Leave out groups whose category is right or unclear. Restaurants/fast food, parking, leisure, public offices and the like with no fitting category stay "sonstiges" — unless another one clearly applies.

Answer with a JSON array ONLY, with no explanatory text before or after:
[{"id": "g12", "category": "<category-key>", "reason": "<short reason in ${answerLanguage}, max. 12 words>"}]

Do not use any tools; answer directly.

Merchant groups:
${groupLines}`;

      progress(msg("startingClaude", { model: CLAUDE_MODEL }));
      const run = await runClaude(prompt, {
        onProgress: (phase) => progress(claudePhaseLine(msg, phase), { replaceLast: true }),
      });
      if (!run.ok) throw new Error(claudeErrorMessage(msg, run.error));

      progress(msg("parsingAnswer"));
      const parsed = extractJsonArray(run.text);
      if (!parsed) throw new Error(msg("noJson"));

      const byKey = new Map(groups.map((group) => [group.key, group]));
      const validKeys = new Set(ALL_CATEGORIES.map((category) => category.key));
      const suggestions: CategorySuggestion[] = [];
      for (const raw of parsed) {
        if (typeof raw !== "object" || raw === null) continue;
        const item = raw as {
          id?: unknown;
          category?: unknown;
          reason?: unknown;
        };
        const group = typeof item.id === "string" ? byKey.get(item.id) : undefined;
        const category =
          typeof item.category === "string" && validKeys.has(item.category)
            ? item.category
            : null;
        if (!group || !category || category === group.category) continue;
        suggestions.push({
          key: group.key,
          name: group.name,
          ids: group.ids,
          count: group.count,
          total: Math.round(group.total * 100) / 100,
          currentCategory: group.category,
          suggestedCategory: category,
          reason:
            typeof item.reason === "string" ? item.reason.slice(0, 200) : "",
          accepted: false,
        });
      }
      progress(msg("suggestionsFound", { count: suggestions.length }));
      return suggestions;
    });
  }
  return getAnalysisStateAction();
}

/** Mark a suggestion as accepted, or drop it entirely (rejected). */
export async function resolveCategorySuggestionAction(
  key: string,
  accepted: boolean
): Promise<AnalysisState> {
  updateJobResult<CategorySuggestion[]>(CATEGORY_JOB, (suggestions) =>
    accepted
      ? suggestions.map((suggestion) =>
          suggestion.key === key ? { ...suggestion, accepted: true } : suggestion
        )
      : suggestions.filter((suggestion) => suggestion.key !== key)
  );
  return getAnalysisStateAction();
}

/** Start the free-form question as a server-side job (see above). */
export async function startFreeAnalysisAction(
  question: string
): Promise<AnalysisState> {
  // Captured here, not inside the job: the job runs after this action has
  // returned, when there is no request left to resolve a locale from.
  const msg = await getTranslations("server");
  const asked = (question || "").trim().slice(0, 2000);
  if (!asked) return getAnalysisStateAction();

  const transactions = db.listTransactions();
  const state = db.getAppState();

  // Compact context: per-month category sums for the last 6 months.
  const INCOME_KEY = "income";
  const months = new Map<string, Map<string, number>>();
  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    let categorySums = months.get(month);
    if (!categorySums) months.set(month, (categorySums = new Map()));
    const key =
      transaction.amount >= 0 ? INCOME_KEY : effectiveCategory(transaction);
    categorySums.set(key, (categorySums.get(key) ?? 0) + transaction.amount);
  }
  const recentMonths = [...months.keys()].sort().slice(-6);
  const monthly = recentMonths.map((month) => ({
    month,
    // Category labels come from the catalogue, so they follow the interface
    // language the answer is written in.
    ...Object.fromEntries(
      [...months.get(month)!.entries()].map(([categoryKey, total]) => [
        categoryKey === INCOME_KEY ? INCOME_KEY : categoryByKey(categoryKey).label,
        Math.round(total * 100) / 100,
      ])
    ),
  }));

  const recurringSummary = state.recurring.map((recurring) => ({
    name: recurring.name,
    amount: recurring.kind === "income" ? recurring.amount : -recurring.amount,
    intervalMonths: recurring.intervalMonths,
    isActive: recurring.isActive,
    remainingAmount: recurring.remainingAmount,
    endDate: recurring.endDate,
  }));

  const answerLanguage = msg("answerLanguage");
  const prompt = `You are a finance assistant in a personal finance app (a German private account). Answer the user's question briefly and concretely in ${answerLanguage}, using numbers from the data. Do not use any tools; answer directly as plain text (no JSON, no Markdown tables).

Account data (current balance ${state.settings.startingBalance} EUR):

Monthly totals by category (last 6 months, negative values are expenses):
${JSON.stringify(monthly)}

Recurring items:
${JSON.stringify(recurringSummary)}

The user's question: ${asked}`;

  startJob<string>(FREE_JOB, { question: asked }, async (progress) => {
    progress(msg("contextAssembled"));
    progress(msg("startingClaude", { model: CLAUDE_MODEL }));
    const run = await runClaude(prompt, {
      onProgress: (phase) => progress(claudePhaseLine(msg, phase), { replaceLast: true }),
    });
    if (!run.ok) throw new Error(claudeErrorMessage(msg, run.error));
    return run.text;
  });
  return getAnalysisStateAction();
}

function jobInfo(job: Job<unknown> | undefined): AnalysisJobInfo {
  if (!job) {
    return { status: "idle", startedAt: null, finishedAt: null, log: [], error: null };
  }
  return {
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    log: [...job.log],
    error: job.error,
  };
}

/** Snapshot of both analysis jobs, polled by the Analyse tab. */
export async function getAnalysisStateAction(): Promise<AnalysisState> {
  const catJob = getJob<CategorySuggestion[]>(CATEGORY_JOB);
  const freeJob = getJob<string>(FREE_JOB);
  const categories: CategoryAnalysisState = {
    ...jobInfo(catJob),
    suggestions: catJob?.status === "done" ? (catJob.result ?? []) : [],
  };
  const free: FreeAnalysisState = {
    ...jobInfo(freeJob),
    question: freeJob?.meta.question ?? "",
    answer: freeJob?.status === "done" ? (freeJob.result ?? "") : "",
  };
  return { categories, free };
}

export async function updateSettingsAction(
  settings: Settings
): Promise<AppState> {
  db.updateSettings({
    startingBalance: Math.round((Number(settings.startingBalance) || 0) * 100) / 100,
    startDate: settings.startDate || todayIso(),
    monthsAhead: Math.max(1, Math.min(600, Math.round(Number(settings.monthsAhead) || 24))),
    budgetStartDay: clampBudgetStartDay(settings.budgetStartDay),
  });
  return db.getAppState();
}

// ---------------------------------------------------------------------------
// Data source (real ledger vs. generated demo)
// ---------------------------------------------------------------------------

/**
 * Point the app at another dataset. Everything the server reads afterwards
 * comes from the other SQLite file, so the caller reloads rather than merging
 * the returned state into the page it already rendered.
 */
export async function switchDataSourceAction(
  source: DataSource
): Promise<DataSource> {
  if (!isDataSource(source)) return db.activeSource();
  if (source === db.activeSource()) return source;

  // Analysis and import-check results were computed over the dataset being
  // left behind; their transaction ids mean nothing in the new one.
  deleteJob(IMPORT_CHECK_JOB);
  deleteJob(CATEGORY_JOB);
  deleteJob(FREE_JOB);

  return db.setActiveSource(source);
}

/** Throw the demo away and regenerate it. Never touches the real dataset. */
export async function resetDemoDataAction(): Promise<void> {
  deleteJob(IMPORT_CHECK_JOB);
  deleteJob(CATEGORY_JOB);
  deleteJob(FREE_JOB);
  db.resetDemoData();
}

// ---------------------------------------------------------------------------
// Interface language
// ---------------------------------------------------------------------------

/**
 * Switch the interface language. Like the data source, the caller reloads:
 * the messages for the page it already rendered came from the old catalogue.
 */
export async function switchLocaleAction(locale: Locale): Promise<Locale> {
  if (!isLocale(locale)) return activeLocale();
  return setActiveLocale(locale);
}
