import { ALL_CATEGORIES, categorize } from "./categories";
import type {
  ImportCheckFinding,
  ImportTransaction,
  OneOffItem,
} from "./types";

/**
 * Pre-import check: prompt building and answer parsing for the Claude run that
 * reviews freshly uploaded payments (category + one-off match) BEFORE they
 * are written to the ledger. Pure functions, so the whole contract with the
 * model is testable without spawning the CLI.
 */

/**
 * Upper bound of payments sent to the model per upload. A delta import stays
 * far below it; a first import of a year-long export is capped at the newest
 * rows, where a category review matters most (the Analyse tab covers the rest).
 */
export const MAX_CHECK_PAYMENTS = 300;

export interface CheckPayment {
  /** Short id used in the prompt ("t1", "t2", …). */
  tid: string;
  record: ImportTransaction;
}

/** The payments actually sent to Claude: newest first, capped. */
export function toCheckPayments(records: ImportTransaction[]): CheckPayment[] {
  return [...records]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, MAX_CHECK_PAYMENTS)
    .map((record, i) => ({ tid: `t${i + 1}`, record: record }));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Signed planned amount of a one-off, matching the sign of real bookings. */
function signedOneOff(oneOff: OneOffItem): number {
  return oneOff.kind === "income" ? oneOff.amount : -oneOff.amount;
}

export function buildImportCheckPrompt(
  payments: CheckPayment[],
  oneoffs: OneOffItem[],
  answerLanguage: string
): string {
  const catalog = ALL_CATEGORIES.map(
    (category) => `${category.key}: ${category.label}`
  ).join("\n");
  const paymentLines = payments
    .map((payment) =>
      JSON.stringify({
        id: payment.tid,
        date: payment.record.date,
        name: payment.record.name,
        amount: round2(payment.record.amount),
        purpose: payment.record.purpose.slice(0, 140),
        currentCategory: categorize(payment.record),
      })
    )
    .join("\n");
  const oneOffLines = oneoffs
    .map((oneOff) =>
      JSON.stringify({
        id: oneOff.id,
        name: oneOff.name,
        amount: round2(signedOneOff(oneOff)),
        date: oneOff.date,
      })
    )
    .join("\n");

  return `You are an assistant in a personal finance app. A CSV import is bringing new bank bookings into a German private account. The booking text is German; check two things for every new booking:

1. CATEGORY: every booking carries the category a keyword search assigned ("currentCategory"). Suggest a different category ONLY where the current one is clearly wrong and you are confident. Restaurants/fast food, parking, leisure, public offices and the like with no fitting category stay "sonstiges".

Available categories (key: label):
${catalog}

2. ONE-OFF ITEMS: below are planned one-off payments from the app. Check whether a new booking is the actual booking of one of those planned items: same or very similar amount, a date plausibly close to the planned date, name/purpose matching in substance. The sign must agree. Assign each planned item to at most one booking, and only on genuinely plausible matches.

Answer with a JSON array ONLY, with no explanatory text before or after. At most one object per booking; a single object may carry both findings. Leave out bookings with no finding:
[{"id": "t12", "category": "<category-key>", "reason": "<max. 12 words, in ${answerLanguage}>"}, {"id": "t3", "oneOff": <one-off-id>, "oneOffReason": "<max. 12 words, in ${answerLanguage}>"}]

Do not use any tools; answer directly.

Planned one-off items:
${oneOffLines || "(none)"}

New bookings:
${paymentLines}`;
}

/**
 * Turn the model's JSON array into validated findings. Everything the model
 * could get wrong is filtered here: unknown ids, categories outside the
 * catalog or equal to the current one, one-off matches with the wrong sign,
 * the same one-off matched twice, the same payment reported twice.
 */
export function parseImportCheckAnswer(
  parsed: unknown[],
  payments: CheckPayment[],
  oneoffs: OneOffItem[]
): ImportCheckFinding[] {
  const byTid = new Map(payments.map((payment) => [payment.tid, payment]));
  const oneOffById = new Map(oneoffs.map((oneOff) => [oneOff.id, oneOff]));
  const validKeys = new Set(ALL_CATEGORIES.map((category) => category.key));
  const seenPayments = new Set<string>();
  const claimedOneOffs = new Set<number>();
  const findings: ImportCheckFinding[] = [];

  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as {
      id?: unknown;
      category?: unknown;
      reason?: unknown;
      oneOff?: unknown;
      oneOffReason?: unknown;
    };
    const payment = typeof item.id === "string" ? byTid.get(item.id) : undefined;
    if (!payment || seenPayments.has(payment.tid)) continue;

    const current = categorize(payment.record);
    const category =
      typeof item.category === "string" &&
      validKeys.has(item.category) &&
      item.category !== current
        ? item.category
        : null;

    let oneOff: OneOffItem | null = null;
    if (typeof item.oneOff === "number" && Number.isInteger(item.oneOff)) {
      const candidate = oneOffById.get(item.oneOff);
      const signMatches =
        candidate !== undefined &&
        (candidate.kind === "income"
          ? payment.record.amount > 0
          : payment.record.amount < 0);
      if (candidate && signMatches && !claimedOneOffs.has(candidate.id)) {
        oneOff = candidate;
      }
    }

    if (!category && !oneOff) continue;
    seenPayments.add(payment.tid);
    if (oneOff) claimedOneOffs.add(oneOff.id);
    findings.push({
      fingerprint: payment.record.fingerprint,
      date: payment.record.date,
      name: payment.record.name,
      amount: round2(payment.record.amount),
      purpose: payment.record.purpose,
      currentCategory: current,
      suggestedCategory: category,
      categoryReason:
        category && typeof item.reason === "string"
          ? item.reason.slice(0, 200)
          : "",
      oneOff: oneOff
        ? {
            id: oneOff.id,
            name: oneOff.name,
            amount: oneOff.amount,
            kind: oneOff.kind,
            date: oneOff.date,
          }
        : null,
      oneOffReason:
        oneOff && typeof item.oneOffReason === "string"
          ? item.oneOffReason.slice(0, 200)
          : "",
    });
  }
  return findings;
}
