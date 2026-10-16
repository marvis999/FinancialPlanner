/**
 * Hides personal details in text before it goes to Claude, and puts them back
 * into Claude's answer.
 *
 * Each hidden value becomes a numbered placeholder such as "[IBAN-1]". The
 * same value always gets the same placeholder within one masker, so Claude
 * can still see that two bookings share a reference without seeing it. A
 * masker lives for one Claude run: numbering starts fresh every time.
 *
 * Masked automatically: IBANs, SEPA creditor IDs, card numbers, email
 * addresses, phone numbers, street addresses, SEPA reference fields, labelled
 * numbers (customer, contract, invoice, …) and any other code with five or
 * more digits. Dates and amounts are kept. Names are masked only when the user
 * lists them: shop names are what the category review works from, and a name
 * heuristic would hide those too.
 */

export type PlaceholderKind =
  | "NAME"
  | "EMAIL"
  | "IBAN"
  | "CREDITOR"
  | "CARD"
  | "PHONE"
  | "ADDRESS"
  | "REF";

export interface Masker {
  mask(text: string): string;
  /** Replace the placeholders this masker handed out with the original text. */
  unmask(text: string): string;
  /** How many distinct values of each kind it has hidden so far. */
  hidden(): { kind: PlaceholderKind; count: number }[];
}

export const PLACEHOLDER = /\[(NAME|EMAIL|IBAN|CREDITOR|CARD|PHONE|ADDRESS|REF)-(\d+)\]/g;

/** Not part of a word: letters and digits in any script count as word characters. */
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The words of a listed name worth matching on their own ("Mustermann, Max" → both). */
function nameParts(name: string): string[] {
  return name
    .split(/[\s,.;]+/u)
    .filter((part) => [...part].filter((char) => /\p{L}/u.test(char)).length >= 3);
}

const SEPA_TAG = "EREF|MREF|KREF|CRED|PURP|ABWA|ABWE|BREF|RREF";
/** A SEPA code field (end-to-end, mandate, creditor reference): one token. */
const SEPA_CODE = new RegExp(
  `${BEFORE}(EREF|MREF|KREF|CRED|PURP|BREF|RREF)(\\s*[+:]\\s*)((?!\\[)[^\\s,;]+)`,
  "gu"
);
/**
 * An alternative payer or payee (ABWA/ABWE) is a name and may contain spaces,
 * so it runs until the next field tag or the end of the text.
 */
const SEPA_NAME = new RegExp(
  `${BEFORE}(ABWA|ABWE)(\\s*[+:]\\s*)((?!\\[)[^\\s].*?)(?=\\s+(?:${SEPA_TAG}|SVWZ)\\s*[+:]|$)`,
  "gu"
);

const REF_LABEL =
  "Kundennummer|Kunden-?Nr\\.?|Kd\\.?-?Nr\\.?|Vertragsnummer|Vertrags-?Nr\\.?|Vertrag|" +
  "Rechnungsnummer|Rechnungs-?Nr\\.?|Rechnung|Re\\.?-?Nr\\.?|Mandatsreferenz|Mandatsref\\.?|Mandat|" +
  "Referenz|Ref\\.?|Auftragsnummer|Auftrag|Bestellnummer|Bestell-?Nr\\.?|Bestellung|" +
  "Versicherungsscheinnummer|Versicherungsschein|Versicherungsnummer|VS-?Nr\\.?|Policennummer|Police|" +
  "Mitgliedsnummer|Mitglieds-?Nr\\.?|Steuernummer|Steuer-?Nr\\.?|Steuer-?ID|IdNr\\.?|" +
  "Personalnummer|Z[äa]hlernummer|Kontonummer|Kto\\.?-?Nr\\.?|" +
  "Customer|Invoice|Order|Contract|Account";
/**
 * A labelled code: the label stays, the value (anything with a digit in it)
 * goes, including further digit groups after single spaces, as in the tax ID
 * "Steuer-ID 12 345 678 901".
 */
const LABELLED_REF = new RegExp(
  `${BEFORE}(${REF_LABEL})(\\s*(?:[:#]|Nr\\.?)?\\s*)([\\p{L}\\p{N}][\\p{L}\\p{N}\\-/._]*\\p{N}[\\p{L}\\p{N}\\-/._]*(?: \\p{N}+(?![,.]\\p{N}))*)`,
  "giu"
);

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const CREDITOR_ID = /\b[A-Z]{2}\d{2}\s?ZZZ\s?[0-9A-Z]{8,}\b/gi;
/** IBAN length per country (ISO 13616), for the countries a German account sees. */
const IBAN_LENGTH: Record<string, number> = {
  DE: 22, AT: 20, CH: 21, LI: 21, NL: 18, BE: 16, LU: 20, FR: 27, MC: 27, IT: 27,
  SM: 27, ES: 24, PT: 25, GB: 22, IE: 22, PL: 28, CZ: 24, SK: 24, HU: 28, DK: 18,
  FI: 18, SE: 24, NO: 15, IS: 26, SI: 19, HR: 21, RO: 24, BG: 22, GR: 27, EE: 20,
  LV: 21, LT: 20, MT: 31, CY: 28,
};
/** Where an IBAN could start: country code and check digits, at a word start. */
const IBAN_START = /(?<![\p{L}\p{N}])([A-Z]{2})\d{2}/gu;

/**
 * The IBAN starting at `start`, in one piece or in groups ("DE89 3704 …"),
 * cut at its country's length; null when there is none. Scanned by hand: a
 * pattern would swallow a near-miss like "OK51343943" together with the real
 * IBAN right behind it.
 */
function ibanAt(text: string, start: number, country: string): string | null {
  const length = IBAN_LENGTH[country];
  let end = start;
  if (length) {
    let count = 0;
    while (end < text.length && count < length && /[A-Z0-9 ]/.test(text[end])) {
      // One space between groups at most, and never two in a row.
      if (text[end] === " " && (text[end + 1] === " " || count === 0)) break;
      if (text[end] !== " ") count++;
      end++;
    }
    if (count < length) return null;
  } else {
    // Unknown country: only a compact IBAN.
    while (end < text.length && /[A-Z0-9]/.test(text[end])) end++;
    if (end - start < 15 || end - start > 34) return null;
  }
  return /[\p{L}\p{N}]/u.test(text[end] ?? "") ? null : text.slice(start, end);
}
/**
 * Card numbers in other layouts: Amex 4-6-5, 13 to 19 digits in one piece,
 * and the masked forms banks print ("XXXX XXXX XXXX 1234", "4871 04XX XXXX
 * 1234", "************1234"). The masked forms end in exactly four digits,
 * so an amount right after them stays where it is.
 */
const CARD = new RegExp(
  `${BEFORE}(?:\\d{4}[ -]\\d{6}[ -]\\d{5}|\\d{13,19}|(?:\\d{4}[ -]?\\d{2})?(?:[X*•]{2,4}[ -]?){2,4}\\d{4}(?!\\d|[,.]\\d)|[X*•]{6,}\\d{4})${AFTER}`,
  "giu"
);
/**
 * A run of four-digit groups ("1234 5678 9012 3456"). Whether it is a card
 * depends on its neighbours, so mask() decides: see maskCardGroups.
 */
// Not right after "10." or "08/": then the first group is the year of a date.
const DIGIT_GROUPS = /(?<![\p{L}\p{N}]|\d[./-])\d{4}(?:[ -]\d{4})+(?![\p{L}\p{N}])/gu;

/**
 * Phone numbers: country or area code, then the subscriber number, optionally
 * split into groups of two or three ("123 456 78") and a "-12" extension.
 * Four-digit groups are left out on purpose: those are years and branch
 * numbers sitting next to the phone number, not part of it.
 */
// A group followed by "," "." or "/" belongs to an amount or a date ("12,50", "08/26").
const SUBSCRIBER = "\\d{3,}(?!\\d|[,.]\\d)(?: \\d{2,3}(?![\\d%]|[,./]\\d))*(?:-\\d{1,5})?";
const PHONE_INTERNATIONAL = new RegExp(
  `${BEFORE}(?:\\+|00)\\d{1,3}[ \\-/]?(?:\\(0\\)[ \\-/]?)?\\d{2,5}[ \\-/]?${SUBSCRIBER}${AFTER}`,
  "gu"
);
/** National numbers need a separator after the area code; plain digit runs are left to REF. */
// Not right after "814/" or "12.": then the zero is the middle of a code or a date.
const PHONE_NATIONAL = new RegExp(
  `${BEFORE}(?<!\\d[/.])0\\d{2,5}[ \\-/]${SUBSCRIBER}${AFTER}`,
  "gu"
);
const STREET = new RegExp(
  `${BEFORE}[\\p{L}][\\p{L}\\-]*(?:stra(?:ß|ss)e|str\\.|weg|allee|platz|gasse|ring|damm|ufer|chaussee)\\s*\\d+\\s?[a-z]?${AFTER}`,
  "giu"
);
/** Any remaining token; it is masked when it holds five or more digits. */
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}\-/._]*/gu;
const DATE_OR_AMOUNT = [
  /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\.?$/,
  // Month and year, as in "Miete 10/2026" or "Rechnung 2026-10", and quarters.
  /^\d{1,2}\/(?:\d{2}|\d{4})$/,
  /^\d{4}-\d{2}$/,
  /^Q[1-4]\/(?:\d{2}|\d{4})$/i,
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/,
  /^\d+[.,]\d{2}$/,
];

/** One name per line; blank lines and duplicates dropped, at most 200 names. */
export function parseHiddenNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim().slice(0, 100);
    if (name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names.slice(0, 200);
}

export function createMasker(hiddenNames: readonly string[] = []): Masker {
  const numbers = new Map<string, number>();
  const counters = new Map<PlaceholderKind, number>();
  const originals = new Map<string, string>();

  function placeholder(kind: PlaceholderKind, key: string, original: string): string {
    const id = `${kind}\u0000${key}`;
    let n = numbers.get(id);
    if (n === undefined) {
      n = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, n);
      numbers.set(id, n);
    }
    const tag = `[${kind}-${n}]`;
    if (!originals.has(tag)) originals.set(tag, original);
    return tag;
  }

  const normalize = (text: string) => text.replace(/\s+/g, "").toUpperCase();

  // Longest first, so "Max Mustermann" wins over "Max" and keeps one placeholder.
  const names = hiddenNames.map((name) => name.trim()).filter((name) => name.length >= 2);
  const namePatterns = names
    .flatMap((name, index) =>
      [name, ...nameParts(name)].map((variant) => ({ variant, index, name }))
    )
    .sort((a, b) => b.variant.length - a.variant.length)
    .map(({ variant, index, name }) => ({
      pattern: new RegExp(`${BEFORE}${escapeRegExp(variant)}${AFTER}`, "giu"),
      key: String(index),
      name,
    }));

  function mask(text: string): string {
    let out = text;
    for (const { pattern, key, name } of namePatterns) {
      out = out.replace(pattern, () => placeholder("NAME", key, name));
    }
    out = out.replace(EMAIL, (match) => placeholder("EMAIL", match.toLowerCase(), match));
    // SEPA fields first: an alternative payer (ABWA) is a name, everything else a code.
    out = out.replace(
      SEPA_NAME,
      (_match, tag: string, separator: string, value: string) =>
        `${tag}${separator}${placeholder("NAME", normalize(value), value)}`
    );
    out = out.replace(
      SEPA_CODE,
      (_match, tag: string, separator: string, value: string) =>
        `${tag}${separator}${placeholder("REF", normalize(value), value)}`
    );
    out = out.replace(CREDITOR_ID, (match) => placeholder("CREDITOR", normalize(match), match));
    {
      let masked = "";
      let last = 0;
      for (const start of out.matchAll(IBAN_START)) {
        const at = start.index ?? 0;
        if (at < last) continue;
        const iban = ibanAt(out, at, start[1]);
        if (!iban) continue;
        masked += out.slice(last, at) + placeholder("IBAN", normalize(iban), iban);
        last = at + iban.length;
      }
      out = masked + out.slice(last);
    }
    out = out.replace(DIGIT_GROUPS, (run: string, offset: number, whole: string) => {
      // A last group followed by ",56" or ".56" is the integer part of an amount.
      let card = run;
      let tail = "";
      if (/^[,.]\d/.test(whole.slice(offset + run.length))) {
        const cut = run.search(/[ -]\d{4}$/);
        card = run.slice(0, cut);
        tail = run.slice(cut);
      }
      // Four groups or more: a card, possibly with a neighbouring number, which
      // is hidden along with it rather than leaving part of the card behind.
      if (card.replace(/\D/g, "").length < 16) return run;
      return placeholder("CARD", normalize(card), card) + tail;
    });
    out = out.replace(CARD, (match) => placeholder("CARD", normalize(match), match));
    // Labelled codes before phone numbers: "Rechnung #814/0404" is a code, not a phone.
    out = out.replace(
      LABELLED_REF,
      (match, label: string, separator: string, value: string) =>
        DATE_OR_AMOUNT.some((pattern) => pattern.test(value))
          ? match
          : `${label}${separator}${placeholder("REF", normalize(value), value)}`
    );
    out = out.replace(PHONE_INTERNATIONAL, (match) => placeholder("PHONE", normalize(match), match));
    out = out.replace(PHONE_NATIONAL, (match) => placeholder("PHONE", normalize(match), match));
    out = out.replace(STREET, (match) => placeholder("ADDRESS", normalize(match), match));
    out = out.replace(TOKEN, (token) => {
      const digits = token.replace(/\D/g, "").length;
      if (digits < 5 || DATE_OR_AMOUNT.some((pattern) => pattern.test(token))) return token;
      return placeholder("REF", normalize(token), token);
    });
    return out;
  }

  function unmask(text: string): string {
    return text.replace(PLACEHOLDER, (tag) => originals.get(tag) ?? tag);
  }

  function hidden() {
    return [...counters.entries()].map(([kind, count]) => ({ kind, count }));
  }

  return { mask, unmask, hidden };
}
