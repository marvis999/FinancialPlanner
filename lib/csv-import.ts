import crypto from "node:crypto";

import type { ImportTransaction } from "./types";

// NOTE: the fingerprint formula here is frozen. Every already-imported row
// carries a fingerprint built from it, so changing the formula would make
// re-imported history insert as duplicates rather than de-duplicate.

/** Quote-aware CSV parser (";" delimiter, double quotes, embedded newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is one literal quote.
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else inQuotes = false;
      } else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ";") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // A single-column row is a stray blank line, not a booking.
  return rows.filter((columns) => columns.length > 1);
}

/**
 * German amount, e.g. "-1.234,56". A dot only groups thousands when it groups
 * exactly three digits; stripping every dot unconditionally turned an
 * anglicised "-1234.56" into -123456. Returns NaN when it is not a number.
 */
function parseAmount(raw: string): number {
  const text = String(raw).trim();
  if (!text) return NaN;
  if (text.includes(","))
    return Number(text.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ""));
  return Number(text);
}

/**
 * "DD.MM.YY" or "DD.MM.YYYY" to ISO. Returns "" for anything else, including a
 * date that does not exist. The old version prefixed "20" unconditionally, so a
 * four-digit year became the year 202026: lexically the smallest date in the
 * table, which reordered every running balance, wrote a start_date that threw
 * during render, and produced a NaN chart axis that dropped every month label.
 */
function parseDate(raw: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(String(raw).trim());
  if (!match) return "";
  const [, day, month, yearDigits] = match;
  const year = yearDigits.length === 2 ? `20${yearDigits}` : yearDigits;
  const iso = `${year}-${month}-${day}`;
  // Round-trip so 31.02. and month 13 are rejected rather than normalised.
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
    ? ""
    : iso;
}

/**
 * True if the decoded text looks like a Sparkassen "umsatz" CSV export.
 *
 * The German words here are data, not interface text: they are the column
 * headings the bank itself writes into the file.
 */
export function looksLikeUmsatzCsv(text: string): boolean {
  const head = text.slice(0, 2000);
  return head.includes("Buchungstag") && head.includes("Betrag");
}

/** A row mid-parse: the transaction plus the bookkeeping used to order it. */
interface ParsedRecord extends ImportTransaction {
  /** Position in the file, used to break ties within the same day. */
  sourceIndex: number;
  /** How many identical bookings preceded this one on the same day. */
  occurrence: number;
  /** The raw "Info" column, e.g. "Umsatz gebucht". */
  status: string;
}

export interface ParsedCsv {
  records: ImportTransaction[];
  /** Booked rows that could not be parsed; surfaced instead of swallowed. */
  invalid: number;
}

/** Parse a Sparkassen "umsatz" CSV into fingerprinted, booked transactions. */
export function parseCsvTransactions(text: string): ParsedCsv {
  const rows = parseCsv(text);
  if (!rows.length) return { records: [], invalid: 0 };
  const header = rows[0];
  const columnIndex = (name: string) => header.indexOf(name);
  // The keys are ours; the strings are the German headings the bank writes.
  const column = {
    bookingDate: columnIndex("Buchungstag"),
    valueDate: columnIndex("Valutadatum"),
    bookingType: columnIndex("Buchungstext"),
    purpose: columnIndex("Verwendungszweck"),
    counterparty: columnIndex("Beguenstigter/Zahlungspflichtiger"),
    iban: columnIndex("Kontonummer/IBAN"),
    bic: columnIndex("BIC (SWIFT-Code)"),
    amount: columnIndex("Betrag"),
    currency: columnIndex("Waehrung"),
    status: columnIndex("Info"),
  };
  if (column.bookingDate < 0 || column.amount < 0)
    return { records: [], invalid: 0 };

  let records: ParsedRecord[] = rows.slice(1).map((columns, sourceIndex) => {
    const counterparty = (columns[column.counterparty] || "").trim();
    const bookingType = (columns[column.bookingType] || "").trim();
    return {
      sourceIndex,
      occurrence: 0,
      status: (columns[column.status] || "").trim(),
      date: parseDate(columns[column.bookingDate]),
      valuta: columns[column.valueDate]
        ? parseDate(columns[column.valueDate]) || null
        : null,
      name: counterparty || bookingType || "—",
      amount: parseAmount(columns[column.amount]),
      currency: columns[column.currency] || "EUR",
      type: bookingType,
      purpose: (columns[column.purpose] || "").replace(/\s+/g, " ").trim(),
      iban: (columns[column.iban] || "").trim(),
      bic: (columns[column.bic] || "").trim(),
      fingerprint: "",
    };
  });

  // Without an Info column every row read "" and the filter dropped the whole
  // file, reporting "no booked transactions" for a file that was entirely booked.
  if (column.status >= 0)
    records = records.filter((record) => /gebucht/i.test(record.status));

  // Drop unparsable rows BEFORE the occurrence counter, so the fingerprints of
  // the surviving rows stay identical to the CLI importer's.
  const bookedCount = records.length;
  records = records.filter(
    (record) => record.date !== "" && Number.isFinite(record.amount)
  );
  const invalid = bookedCount - records.length;

  records.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : b.sourceIndex - a.sourceIndex
  );

  const occurrencesSoFar = new Map<string, number>();
  for (const record of records) {
    const identity = [
      record.date,
      record.amount.toFixed(2),
      record.iban,
      record.name,
      record.purpose,
    ].join("|");
    const seenBefore = occurrencesSoFar.get(identity) ?? 0;
    record.occurrence = seenBefore;
    occurrencesSoFar.set(identity, seenBefore + 1);
    record.fingerprint = crypto
      .createHash("sha256")
      .update([identity, record.occurrence].join("|"))
      .digest("hex");
  }

  return {
    records: records.map(
      ({
        sourceIndex: _sourceIndex,
        occurrence: _occurrence,
        status: _status,
        ...rest
      }) => rest
    ),
    invalid,
  };
}
