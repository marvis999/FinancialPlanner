import { ALL_CATEGORIES, categorize } from "./categories";
import type {
  ImportCheckFinding,
  ImportExpectedDue,
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

/** Signed due amount of a recurring item, matching the sign of real bookings. */
function signedDue(due: ImportExpectedDue): number {
  return due.kind === "income" ? due.amount : -due.amount;
}

export function buildImportCheckPrompt(
  payments: CheckPayment[],
  oneoffs: OneOffItem[],
  answerLanguage: string,
  /** Due dates the deterministic matcher could not settle from this file. */
  expected: ImportExpectedDue[] = [],
  /** Hides personal details in every free-text field (see lib/pii-mask.ts). */
  mask: (text: string) => string = (text) => text
): string {
  const catalog = ALL_CATEGORIES.map(
    (category) => `${category.key}: ${category.label}`
  ).join("\n");
  const paymentLines = payments
    .map((payment) =>
      JSON.stringify({
        id: payment.tid,
        date: payment.record.date,
        name: mask(payment.record.name),
        amount: round2(payment.record.amount),
        // Masked before cutting, so a cut cannot leave half an IBAN behind.
        purpose: mask(payment.record.purpose).slice(0, 140),
        currentCategory: categorize(payment.record),
      })
    )
    .join("\n");
  const oneOffLines = oneoffs
    .map((oneOff) =>
      JSON.stringify({
        id: oneOff.id,
        name: mask(oneOff.name),
        amount: round2(signedOneOff(oneOff)),
        date: oneOff.date,
      })
    )
    .join("\n");
  const expectedLines = expected
    .map((due) =>
      JSON.stringify({
        id: due.recurringId,
        name: mask(due.name),
        amount: round2(signedDue(due)),
        due: due.due,
      })
    )
    .join("\n");

  return `You are an assistant in a personal finance app. A CSV import is bringing new bank bookings into a German private account. The booking text is German; check two things for every new booking:

1. CATEGORY: every booking carries the category a keyword search assigned ("currentCategory"). Suggest a different category ONLY where the current one is clearly wrong and you are confident. Restaurants/fast food, parking, leisure, public offices and the like with no fitting category stay "sonstiges".

Available categories (key: label):
${catalog}

2. ONE-OFF ITEMS: below are planned one-off payments from the app. Check whether a new booking is the actual booking of one of those planned items: same or very similar amount, a date plausibly close to the planned date, name/purpose matching in substance. The sign must agree. Assign each planned item to at most one booking, and only on genuinely plausible matches.

3. RECURRING ITEMS: below are due dates of recurring items (rent, subscriptions, salary, insurance) that should have a booking in this file but were not recognized automatically. Check whether a new booking is that payment: same or similar amount, a date within about a week of the due date, a counterparty plausible for the item. The sign must agree. Assign each due date to at most one booking, and only on genuinely plausible matches.

Answer with a JSON array ONLY, with no explanatory text before or after. At most one object per booking; a single object may carry several findings. Leave out bookings with no finding:
[{"id": "t12", "category": "<category-key>", "reason": "<max. 12 words, in ${answerLanguage}>"}, {"id": "t3", "oneOff": <one-off-id>, "oneOffReason": "<max. 12 words, in ${answerLanguage}>"}, {"id": "t5", "recurring": <recurring-id>, "due": "<YYYY-MM-DD>", "recurringReason": "<max. 12 words, in ${answerLanguage}>"}]

Do not use any tools; answer directly.

Planned one-off items:
${oneOffLines || "(none)"}

Expected recurring due dates without a booking:
${expectedLines || "(none)"}

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
  oneoffs: OneOffItem[],
  /** Due dates the model was asked about; anything else is dropped. */
  expected: ImportExpectedDue[] = [],
  /** Bookings the deterministic matcher already linked; not up for grabs. */
  taken: ReadonlySet<string> = new Set()
): ImportCheckFinding[] {
  const byTid = new Map(payments.map((payment) => [payment.tid, payment]));
  const oneOffById = new Map(oneoffs.map((oneOff) => [oneOff.id, oneOff]));
  const validKeys = new Set(ALL_CATEGORIES.map((category) => category.key));
  const seenPayments = new Set<string>();
  const claimedOneOffs = new Set<number>();
  const claimedDues = new Set<string>();
  const findings: ImportCheckFinding[] = [];

  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as {
      id?: unknown;
      category?: unknown;
      reason?: unknown;
      oneOff?: unknown;
      oneOffReason?: unknown;
      recurring?: unknown;
      due?: unknown;
      recurringReason?: unknown;
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

    let recurring: ImportExpectedDue | null = null;
    if (
      typeof item.recurring === "number" &&
      Number.isInteger(item.recurring) &&
      !taken.has(payment.record.fingerprint)
    ) {
      const forItem = expected.filter((due) => due.recurringId === item.recurring);
      // The model names the due date it means; with a single candidate the
      // date may be left out, with several it has to be one of them.
      const candidate =
        typeof item.due === "string"
          ? forItem.find((due) => due.due === item.due)
          : forItem.length === 1
            ? forItem[0]
            : undefined;
      const signMatches =
        candidate !== undefined &&
        (candidate.kind === "income"
          ? payment.record.amount > 0
          : payment.record.amount < 0);
      if (candidate && signMatches && !claimedDues.has(`${candidate.recurringId}|${candidate.due}`)) {
        recurring = candidate;
      }
    }

    if (!category && !oneOff && !recurring) continue;
    seenPayments.add(payment.tid);
    if (oneOff) claimedOneOffs.add(oneOff.id);
    if (recurring) claimedDues.add(`${recurring.recurringId}|${recurring.due}`);
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
      recurring: recurring
        ? {
            id: recurring.recurringId,
            name: recurring.name,
            amount: recurring.amount,
            kind: recurring.kind,
            due: recurring.due,
          }
        : null,
      recurringReason:
        recurring && typeof item.recurringReason === "string"
          ? item.recurringReason.slice(0, 200)
          : "",
    });
  }
  return findings;
}
