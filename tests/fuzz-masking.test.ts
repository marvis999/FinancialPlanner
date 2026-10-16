import { describe, expect, it } from "vitest";

import { createMasker, PLACEHOLDER } from "@/lib/pii-mask";
import { forAll, type Rng } from "./helpers/fuzz";

/**
 * Fuzz the masking with generated booking texts: random mixes of personal
 * details (that must disappear) and ordinary booking text, dates and amounts
 * (that must come through untouched).
 */

const FIRST = ["Max", "Erika", "Jürgen", "Ayşe", "Lena", "Mehmet", "Sophie", "Lukas", "Anna-Lena", "Björn"];
const LAST = ["Mustermann", "Musterfrau", "Schäfer", "Yılmaz", "Oberhuber", "Nguyen", "Weiß", "Kowalski", "Brandt"];
const STREET_ROOTS = ["Muster", "Haupt", "Linden", "Garten", "Bahnhof", "Schiller", "Kirch"];
const STREET_ENDS = ["straße", "strasse", "str.", "weg", "allee", "platz", "gasse", "ring", "damm"];
const LABELS = [
  "Kundennr.", "Kundennummer", "Kd-Nr.", "Vertragsnummer", "Vertrag", "Rechnung", "Rechnungsnr.",
  "Mandatsreferenz", "Referenz", "Bestellnummer", "Versicherungsnummer", "Mitgliedsnummer", "Zählernummer",
];
const SAFE_WORDS = [
  "Miete", "Lastschrift", "Einkauf", "REWE", "Gehalt", "Abo", "Danke", "Oktober", "Strom",
  "Abschlag", "Zahlung", "Kartenzahlung", "Netflix", "Tankstelle", "Edeka", "Apotheke", "Beitrag",
];

const digits = (random: Rng, count: number) =>
  Array.from({ length: count }, () => random.int(0, 9)).join("");
const letters = (random: Rng, count: number) =>
  Array.from({ length: count }, () => String.fromCharCode(65 + random.int(0, 25))).join("");
const groupsOf4 = (text: string) => text.replace(/(.{4})(?=.)/g, "$1 ");

/** A personal detail, and the part of it that must not survive masking. */
interface Sensitive {
  kind: string;
  text: string;
  /** Must not appear in the output once spaces and punctuation are ignored. */
  core: string;
}

function iban(random: Rng): Sensitive {
  const country = random.pick(["DE", "AT", "NL", "FR"]);
  const body =
    country === "DE" ? digits(random, 18)
    : country === "AT" ? digits(random, 16)
    : country === "NL" ? letters(random, 4) + digits(random, 10)
    : digits(random, 10) + letters(random, 3) + digits(random, 10);
  const compact = `${country}${digits(random, 2)}${body}`;
  const text = random.chance(0.5) ? groupsOf4(compact) : compact;
  return { kind: "iban", text, core: compact };
}

function card(random: Rng): Sensitive {
  const number = digits(random, 16);
  const last4 = number.slice(-4);
  const text = random.pick([
    groupsOf4(number),
    number.replace(/(.{4})(?=.)/g, "$1-"),
    number,
    `XXXX XXXX XXXX ${last4}`,
    `************${last4}`,
  ]);
  return { kind: "card", text, core: text.includes("X") || text.includes("*") ? text : number };
}

function phone(random: Rng): Sensitive {
  const area = random.pick(["30", "211", "89", "170", "151"]);
  const subscriber = digits(random, random.int(6, 8));
  const text = random.pick([
    `+49 ${area} ${subscriber}`,
    `0049 ${area} ${subscriber}`,
    `0${area} ${subscriber}`,
    `0${area}/${subscriber}`,
    `0${area}-${subscriber}`,
  ]);
  return { kind: "phone", text, core: `${area}${subscriber}` };
}

function email(random: Rng): Sensitive {
  const text = `${random.pick(FIRST).toLowerCase().replace(/[^a-z]/g, "")}.${digits(random, 2)}@${random.pick(["web.de", "gmx.net", "beispiel.org", "mail.example.com"])}`;
  return { kind: "email", text, core: text };
}

function street(random: Rng): Sensitive {
  const name = random.pick(STREET_ROOTS) + random.pick(STREET_ENDS);
  const text = `${name} ${random.int(1, 199)}${random.chance(0.2) ? "a" : ""}`;
  return { kind: "street", text, core: text };
}

function labelled(random: Rng): Sensitive {
  const value = random.pick([
    // Grouped, as tax IDs are written: "12 345 678 901".
    `${digits(random, 2)} ${digits(random, 3)} ${digits(random, 3)} ${digits(random, 3)}`,
    digits(random, random.int(5, 10)),
    `${letters(random, 2)}-${digits(random, 4)}-${digits(random, 4)}`,
    `${digits(random, 3)}/${digits(random, 4)}`,
  ]);
  const text = `${random.pick(LABELS)}${random.pick([" ", ": ", " Nr. ", " #"])}${value}`;
  return { kind: "labelled", text, core: value };
}

function sepa(random: Rng): Sensitive {
  const tag = random.pick(["EREF", "MREF", "KREF"]);
  const value = `${letters(random, 3)}${digits(random, random.int(4, 12))}`;
  return { kind: "sepa", text: `${tag}+${value}`, core: value };
}

function creditor(random: Rng): Sensitive {
  const value = `DE${digits(random, 2)}ZZZ${digits(random, 11)}`;
  return { kind: "creditor", text: `CRED+${value}`, core: value };
}

function longCode(random: Rng): Sensitive {
  const value = random.chance(0.5) ? digits(random, random.int(6, 12)) : `${letters(random, 2)}${digits(random, random.int(5, 9))}`;
  return { kind: "code", text: value, core: value };
}

const SENSITIVE = [iban, card, phone, email, street, labelled, sepa, creditor, longCode];

const SAFE = [
  () => "15.10.2026",
  () => "2026-10-15",
  () => "01.08.26",
  () => "1.234,56",
  () => "12,50",
  () => "1234,56",
  () => "-89,90",
  () => "1234.56",
  () => "4711",
  () => "KW 42",
  () => "19%",
  () => "10/2026",
  () => "08/26",
  () => "Okt 2026",
  (random: Rng) => random.pick(SAFE_WORDS),
];

/**
 * Matches `core` in the output as a whole value, tolerating spaces, dashes or
 * slashes between its characters (the bank may group it differently).
 */
function leakPattern(core: string): RegExp {
  const chars = [...core.replace(/[\s\-/]/g, "")].map((char) =>
    char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(`(?<![\\p{L}\\p{N}])${chars.join("[ \\-/]?")}(?![\\p{L}\\p{N}])`, "iu");
}

interface Case {
  text: string;
  sensitive: Sensitive[];
  safe: string[];
  names: string[];
  /** Name variants as they appear in the text. */
  nameVariants: string[];
}

function generate(random: Rng, withNames: boolean): Case {
  const sensitive = Array.from({ length: random.int(1, 4) }, () => random.pick(SENSITIVE)(random));
  const safe = Array.from({ length: random.int(1, 5) }, () => random.pick(SAFE)(random));
  const names: string[] = [];
  const nameVariants: string[] = [];
  if (withNames) {
    const first = random.pick(FIRST);
    const last = random.pick(LAST);
    names.push(`${first} ${last}`);
    nameVariants.push(
      random.pick([`${first} ${last}`, `${last}, ${first}`, `${last.toUpperCase()} ${first.toUpperCase()}`, last, first.toLowerCase()])
    );
  }
  const pieces = [...sensitive.map((item) => item.text), ...safe, ...nameVariants];
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = random.int(0, i);
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  // Two unrelated numbers glued with one space are ambiguous ("4711 8746 5700
  // 9584 9894" reads as one long card number, and is hidden as one), so the
  // generator separates them the way booking texts usually do.
  const separator = random.pick([" ", " ", ", ", " / "]);
  const text = pieces.reduce((joined, piece, index) => {
    if (index === 0) return piece;
    const glued = /\d$/.test(joined) && /^\d/.test(piece) && separator === " ";
    return joined + (glued ? " / " : separator) + piece;
  }, "");
  return { text, sensitive, safe, names, nameVariants };
}

function checkMasked(input: Case) {
  const masker = createMasker(input.names);
  const out = masker.mask(input.text);

  for (const item of input.sensitive) {
    expect(out, `${item.kind} "${item.text}" leaked in: ${out}`).not.toMatch(leakPattern(item.core));
  }
  for (const name of input.names) {
    for (const part of name.split(" ")) {
      expect(out.toLowerCase(), `name "${part}" leaked in: ${out}`).not.toMatch(
        new RegExp(`(?<![\\p{L}])${part.toLowerCase()}(?![\\p{L}])`, "u")
      );
    }
  }
  for (const piece of input.safe) {
    expect(out, `safe "${piece}" was changed in: ${out}`).toContain(piece);
  }
  // Masking what is already masked changes nothing.
  expect(masker.mask(out)).toBe(out);
  // The summary counts exactly the placeholders in the text.
  const distinct = new Set([...out.matchAll(PLACEHOLDER)].map((match) => match[0]));
  expect(masker.hidden().reduce((sum, entry) => sum + entry.count, 0)).toBe(distinct.size);
  return { masker, out };
}

describe("masking fuzz", () => {
  // Generous timeouts: FUZZ_SCALE multiplies the runs.
  it("hides every generated personal detail and keeps dates, amounts and words", { timeout: 600_000 }, () => {
    forAll(20261017, 3000, (random) => generate(random, false), (input) => {
      const { masker, out } = checkMasked(input);
      // Without names every placeholder maps back to exactly what it replaced.
      expect(masker.unmask(out)).toBe(input.text);
    });
  });

  it("hides listed names in every spelling the bank uses", { timeout: 600_000 }, () => {
    forAll(4711, 2000, (random) => generate(random, true), (input) => {
      checkMasked(input);
    });
  });
});
