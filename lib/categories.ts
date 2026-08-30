/**
 * Keyword-based spending categories for imported transactions.
 *
 * Colors are theme-aware CSS custom properties defined in globals.css
 * (light and dark steps of the same validated categorical palette).
 * Match order is specificity-first: earlier entries win, so e.g. the
 * PayPal purpose "AldiTalk" lands in Telefon & Abos, not Shopping.
 *
 * These lists hold PUBLIC keywords only: German generic terms and widely
 * used providers. Nothing that identifies one household belongs here - no
 * landlord, no contract or customer number, no branch or cash-machine
 * location. Those match exactly one person, they are useless to everyone
 * else, and this file is read by anyone with the repository.
 *
 * A booking that only your own account sees is categorised in the app
 * instead: assign it by hand in the transactions tab and the choice is stored in
 * `transactions.category`, in your database, where it belongs.
 */

export interface Category {
  key: string;
  label: string;
  /** Lowercase substrings matched against name + purpose. */
  patterns: string[];
  /** CSS custom property with the theme-aware category color. */
  cssVar: string;
}

export const CATEGORIES: Category[] = [
  {
    key: "versicherungen",
    label: "Versicherungen",
    /*
     * Ahead of Kredite deliberately. Banks collect insurance premiums by
     * direct debit, so those bookings carry the bank's name AND the word
     * Versicherungsbeitrag; with Kredite first, the lender keyword won and
     * every premium was filed as a loan instalment. What the money paid for
     * is more specific than who moved it.
     *
     * "ergo " keeps its trailing space so it cannot swallow Ergotherapie.
     */
    patterns: [
      "versicherung", "assekuranz", "haftpflicht", "krankenkasse", "krankenvers",
      "kfz-vers", "rechtsschutz",
      "allianz", "axa", "ergo ", "devk", "generali", "gothaer", "signal iduna",
      "barmenia", "debeka", "provinzial", "huk", "agila", "andsafe", "wgv",
      "vhv", "lvm", "verti", "zurich", "r+v",
      "aok", "barmer", "dak ", "techniker kranken",
    ],
    cssVar: "--cat-versicherungen",
  },
  {
    key: "kredite",
    label: "Kredite & Raten",
    // Not bare "kredit": that swallows every Kreditkartenabrechnung, which is
    // aggregated spending rather than a loan.
    patterns: [
      "ratenkredit", "kreditrate", "darlehen", "ratenzahlung", "ratenkauf",
      "finanzierung", "baufinanzierung", "hypothek", "umschuldung",
      "sofortkredit", "verbraucherkredit", "teilzahlung", "abzahlung",
      "kreditvertrag", "darlehensvertrag", "tilgung", "sondertilgung",
      "annuitaet",
      "klarna", "riverty", "afterpay", "clearpay", "scalapay", "billie",
      "easycredit", "auxmoney", "smava", "younited", "cofidis", "affirm",
      "paypal ratenzahlung",
      "santander", "targobank", "consors finanz", "creditplus", "norisbank",
      "bank11", "tf bank", "swk bank", "ing-diba", "baur",
    ],
    cssVar: "--cat-kredite",
  },
  {
    key: "wohnen",
    label: "Wohnen & Energie",
    patterns: [
      "miete", "kaltmiete", "warmmiete", "hausverwaltung", "vermieter",
      "immobilien", "wohnungsbau", "hausgeld", "nebenkosten", "betriebskosten",
      "grundsteuer",
      // Not bare "strom": it matches the town Stromberg in a card booking.
      "stadtwerke", "energie", "stromabschlag", "stromkosten", "stromrechnung",
      "stromliefer", "gasversorg", "wasserwerk", "abschlag",
      "vattenfall", "e.on", "eon ", "rwe", "enbw", "yello", "lichtblick", "eprimo",
    ],
    cssVar: "--cat-wohnen",
  },
  {
    key: "telefon",
    label: "Telefon & Abos",
    // Before Shopping, so "Amazon Prime" is an subscription and not a parcel.
    patterns: [
      "telefonica", "vodafone", "telekom", "alditalk", "aldi talk", "o2 ",
      "1&1", "congstar", "mobilcom", "freenet",
      "anthropic", "claude", "netflix", "spotify", "disney", "dazn",
      "amazon prime", "youtube premium", "apple.com/bill",
      "rundfunk", "ard zdf",
    ],
    cssVar: "--cat-telefon",
  },
  {
    key: "tanken",
    label: "Tanken & Verkehr",
    patterns: [
      "tankstelle", "autohof", "raststaette", "tankkarte",
      "aral", "shell", "esso", "bft", "jet ", "avia", "agip", "totalenergies",
      "orlen", "supol", "westfalen tank", "classic tankstelle", "sprint tank",
      "q1 tankstelle", "star tankstelle", "circle k", "bp ",
      // Charging counts as fuelling: same purpose, different pump.
      "ladesaeule", "ladestrom", "ionity", "allego", "ewe go",
      "deutsche bahn", "db vertrieb", "db fernverkehr", "db regio",
      "flixbus", "flixtrain", "freenow", "taxi",
      "parkhaus", "parkraum", "parkplatz", "parkgebuehr", "apcoa", "contipark",
      "easypark",
    ],
    cssVar: "--cat-tanken",
  },
  {
    key: "lebensmittel",
    label: "Lebensmittel & Drogerie",
    patterns: [
      "aldi sagt", "aldi nord", "aldi sued", "lidl", "netto", "neukauf",
      "kaufland", "rewe", "edeka", "penny", "norma", "famila", "combi",
      "globus", "nahkauf", "tegut", "denns", "alnatura", "akzenta",
      "dm drogerie", "rossmann", "budni", "muller handels",
    ],
    cssVar: "--cat-lebensmittel",
  },
  {
    key: "bargeld",
    label: "Bargeld",
    patterns: [
      "bargeld", "geldautomat", "auszahlung", "cash group",
      "sparkasse", "volksbank", "raiffeisenbank", "commerzbank", "postbank",
    ],
    cssVar: "--cat-bargeld",
  },
  {
    key: "shopping",
    label: "Online & Shopping",
    patterns: [
      "amazon", "ebay", "paypal", "zalando", "tkmaxx", "ikea", "tedi",
      "payone", "otto ", "temu", "shein", "flaconi", "etsy", "aliexpress",
      "mediamarkt", "saturn", "conrad", "obi", "bauhaus", "hornbach",
      "douglas", "h&m", "c&a", "deichmann", "decathlon", "thalia",
    ],
    cssVar: "--cat-shopping",
  },
];

/**
 * Incoming money. Deliberately NOT part of ALL_CATEGORIES: it must never be
 * offered as a budget, and it exists so salary stops falling through to
 * Sonstiges - which is budgetable, and would then read as negative spending.
 */
export const INCOME_CATEGORY: Category = {
  key: "einkommen",
  label: "Einnahmen",
  patterns: [
    "gehalt", "lohn", "arbeitsentgelt", "weihnachtsgeld", "urlaubsgeld", "bonus",
    "honorar", "kindergeld", "familienkasse", "rente", "elterngeld", "bafoeg",
    "erstattung", "steuererstattung", "finanzamt", "gutschrift", "dividende",
  ],
  cssVar: "--cat-einkommen",
};

export const OTHER_CATEGORY: Category = {
  key: "sonstiges",
  label: "Sonstiges",
  patterns: [],
  cssVar: "--cat-sonstiges",
};

export const ALL_CATEGORIES: Category[] = [...CATEGORIES, OTHER_CATEGORY];

/** Every key that can be resolved, budgetable or not. */
const RESOLVABLE: Category[] = [...ALL_CATEGORIES, INCOME_CATEGORY];

const byKey = new Map(RESOLVABLE.map((category) => [category.key, category]));

export function categoryByKey(key: string): Category {
  return byKey.get(key) ?? OTHER_CATEGORY;
}

/** Manual assignment wins; otherwise derive from keywords. */
export function effectiveCategory(booking: {
  name: string;
  purpose: string;
  amount?: number;
  category?: string | null;
}): string {
  if (booking.category && byKey.has(booking.category)) return booking.category;
  return categorize(booking);
}

/**
 * A pattern must start at a word boundary, so "esso" no longer matches
 * ESPRESSO and "miete" no longer matches Automiete. Only the LEFT edge is
 * anchored: German compounds have to keep working, so "nebenkosten" must still
 * match Nebenkostenabrechnung.
 */
function toMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(/^\w/.test(pattern) ? `\\b${escaped}` : escaped);
}

const MATCHERS: { key: string; res: RegExp[] }[] = CATEGORIES.map((category) => ({
  key: category.key,
  res: category.patterns.map(toMatcher),
}));

const INCOME_MATCHERS = INCOME_CATEGORY.patterns.map(toMatcher);

/**
 * Category key for a transaction (first matching pattern wins). A positive
 * amount is checked against the income patterns first, so a salary is income
 * rather than whatever its counterparty name happens to look like.
 */
export function categorize(booking: {
  name: string;
  purpose: string;
  amount?: number;
}): string {
  const haystack = (booking.name + " " + booking.purpose).toLowerCase();
  if (typeof booking.amount === "number" && booking.amount > 0) {
    for (const re of INCOME_MATCHERS) if (re.test(haystack)) return INCOME_CATEGORY.key;
  }
  for (const category of MATCHERS) {
    for (const re of category.res) {
      if (re.test(haystack)) return category.key;
    }
  }
  return OTHER_CATEGORY.key;
}
