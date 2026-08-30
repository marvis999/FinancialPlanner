import * as React from "react";
import {
  Banknote,
  Briefcase,
  Clapperboard,
  Cpu,
  CreditCard,
  Dumbbell,
  Fuel,
  Home,
  Landmark,
  type LucideIcon,
  Music,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Train,
  UtensilsCrossed,
  Zap,
} from "lucide-react";
import {
  siAldinord,
  siApple,
  siDeutschebahn,
  siDeutschetelekom,
  siDhl,
  siEbay,
  siGoogle,
  siIkea,
  siLidl,
  siMcdonalds,
  siNetflix,
  siPaypal,
  siShell,
  siSpotify,
  siStarbucks,
  siVodafone,
  siYoutube,
  siZalando,
  type SimpleIcon,
} from "simple-icons";

// --- Real brand logos (Simple Icons), matched by keyword ---------------------

interface BrandRule {
  test: RegExp;
  icon: SimpleIcon;
}

const BRAND_RULES: BrandRule[] = [
  { test: /NETFLIX/, icon: siNetflix },
  { test: /SPOTIFY/, icon: siSpotify },
  { test: /YOUTUBE/, icon: siYoutube },
  { test: /PAYPAL/, icon: siPaypal },
  { test: /\bEBAY\b/, icon: siEbay },
  { test: /ZALANDO/, icon: siZalando },
  { test: /\bIKEA\b/, icon: siIkea },
  { test: /\bDHL\b/, icon: siDhl },
  { test: /LIDL/, icon: siLidl },
  { test: /\bALDI\b/, icon: siAldinord },
  { test: /VODAFONE/, icon: siVodafone },
  { test: /TELEKOM|MAGENTA/, icon: siDeutschetelekom },
  { test: /DEUTSCHE BAHN|\bDB\b|DB VERTRIEB|DB FERNVERKEHR/, icon: siDeutschebahn },
  { test: /MCDONALD/, icon: siMcdonalds },
  { test: /STARBUCKS/, icon: siStarbucks },
  { test: /SHELL/, icon: siShell },
  { test: /\bAPPLE\b|ITUNES/, icon: siApple },
  { test: /\bGOOGLE\b/, icon: siGoogle },
];

function matchBrand(haystack: string): SimpleIcon | null {
  return BRAND_RULES.find((rule) => rule.test.test(haystack))?.icon ?? null;
}

// --- Category fallback (lucide) ----------------------------------------------

interface Rule {
  test: RegExp;
  Icon: LucideIcon;
  color: string;
}

const RULES: Rule[] = [
  { test: /DISNEY|PRIME VIDEO|\bWOW\b|DAZN|\bSKY\b|PARAMOUNT|JOYN|MUBI|TWITCH|KINO/, Icon: Clapperboard, color: "#e11d48" },
  { test: /APPLE MUSIC|DEEZER|SOUNDCLOUD|TIDAL|AUDIBLE/, Icon: Music, color: "#1db954" },
  { test: /ANTHROPIC|CLAUDE|OPENAI|CHATGPT|GITHUB|ADOBE|MICROSOFT|STEAM|PLAYSTATION|XBOX|NINTENDO|NOTION|FIGMA|DROPBOX|JETBRAINS/, Icon: Cpu, color: "#8b5cf6" },
  { test: /\bO2\b|TELEFONICA|CONGSTAR|ALDI ?TALK|1&1|1UND1|MOBILCOM|\bBLAU\b|LEBARA|LYCA|FREENET|SIMYO|\bPYUR\b/, Icon: Smartphone, color: "#d946ef" },
  { test: /\bREWE\b|EDEKA|KAUFLAND|PENNY|NETTO|NORMA|\bDM[- ]|DROGERIE|ROSSMANN|M(UE|Ü)LLER|TEGUT|DENNS|MARKTKAUF|SUPERMARKT|NEUKAUF/, Icon: ShoppingCart, color: "#f59e0b" },
  { test: /BURGER KING|\bKFC\b|SUBWAY|LIEFERANDO|WOLT|UBER EATS|DOMINO|PIZZA|RESTAURANT|IMBISS|B(AE|Ä)CKER|KAMPS|NORDSEE|VAPIANO|D(OE|Ö)NER|\bCAFE\b|COFFEE|SNACK/, Icon: UtensilsCrossed, color: "#ea580c" },
  { test: /\bARAL\b|\bESSO\b|\bTOTAL\b|TANKSTELLE|\bJET\b|\bOMV\b|\bHEM\b|\bAGIP\b|\bTANK\b/, Icon: Fuel, color: "#0891b2" },
  { test: /FLIX|\bBVG\b|\bMVG\b|\bHVV\b|\bRMV\b|\bVRR\b|\bUBER\b|\bBOLT\b|FREENOW|\bTIER\b|\bLIME\b|\bSIXT\b|EUROPCAR|\bBAHN\b|TICKET|NAHVERKEHR|PARKEN|PARKHAUS/, Icon: Train, color: "#3b82f6" },
  { test: /VERSICHERUNG|INSURANCE|ALLIANZ|\bHUK\b|\bAXA\b|\bERGO\b|\bDEVK\b|GENERALI|GOTHAER|SIGNAL IDUNA|BARMENIA|AGILA|\bWGV\b|\bVHV\b|\bLVM\b|\bVERTI\b|KRANKENVERS|KFZ.?VERS/, Icon: ShieldCheck, color: "#10b981" },
  { test: /MIETE|KALTMIETE|WARMMIETE|HAUSVERWALTUNG|VERMIET|\bWOHNUNG\b|NEBENKOSTEN|\bWEG\b|INVEST/, Icon: Home, color: "#b45309" },
  { test: /STROM|STADTWERKE|ENERGIE|\bGAS\b|WASSER|VATTENFALL|E\.?ON|ENBW|\bRWE\b|LEKKER|YELLO|MAINGAU|NATURSTROM|ABWASSER|ENTSORGUNG|\bGEZ\b|RUNDFUNK|BEITRAGSSERVICE/, Icon: Zap, color: "#eab308" },
  { test: /FITNESS|MCFIT|CLEVERFIT|\bGYM\b|\bFITX\b|URBAN SPORTS|APOTHEKE|PHARMACY|\bARZT\b|ZAHNARZT|KLINIK|PHYSIO/, Icon: Dumbbell, color: "#f43f5e" },
  { test: /AMAZON|\bOTTO\b|ALIEXPRESS|SHEIN|ABOUT YOU|MEDIA ?MARKT|SATURN|\bH&M\b|\bC&A\b|DECATHLON|THALIA|TEDI/, Icon: ShoppingBag, color: "#2563eb" },
  { test: /LOHN|GEHALT|BUNDESAGENTUR|FAMILIENKASSE|\bARBEIT\b|KINDERGELD|\bRENTE\b|BAF(OE|Ö)G|ERSTATTUNG|FINANZAMT|STEUER|VERLAG/, Icon: Briefcase, color: "#16a34a" },
  { test: /BARGELD|AUSZAHLUNG|GELDAUTOMAT|\bATM\b|\bCASH\b|EINZAHLUNG|AUTOMATENSTATION/, Icon: Banknote, color: "#64748b" },
  { test: /ENTGELT|ABSCHLUSS|GEB(UE|Ü)HR|KONTOF(UE|Ü)HRUNG|ZINSEN|\bDISPO\b|KREDITKARTE|\bVISA\b|MASTERCARD|KLARNA|\bN26\b|\bDKB\b|\bING\b|SPARKASSE|VOLKSBANK|COMMERZBANK|REVOLUT|TRADE REPUBLIC|SCALABLE|BROKER|DEPOT/, Icon: Landmark, color: "#6b7280" },
];

const DEFAULT: Rule = { test: /.*/, Icon: CreditCard, color: "#64748b" };

function matchCategory(haystack: string): Rule {
  return RULES.find((rule) => rule.test.test(haystack)) ?? DEFAULT;
}

const CHIP_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.75rem",
  height: "1.75rem",
  borderRadius: "0.5rem",
  flexShrink: 0,
};

/** Rounded icon chip: real brand logo when known, otherwise a category icon. */
export function MerchantIcon({
  name,
  type,
  purpose,
  className,
}: {
  name: string;
  type?: string;
  purpose?: string;
  className?: string;
}) {
  // Include the purpose so payments routed through an intermediary (PayPal,
  // Klarna) still match the real merchant named in the reference text.
  const hay = [name, type, purpose].filter(Boolean).join(" ").toUpperCase();
  const brand = matchBrand(hay);

  if (brand) {
    return (
      <span
        className={className}
        style={{
          ...CHIP_STYLE,
          color: "hsl(var(--foreground))",
          backgroundColor: "hsl(var(--muted))",
        }}
        aria-hidden
        title={brand.title}
      >
        <svg role="img" viewBox="0 0 24 24" width={15} height={15} fill="currentColor">
          <path d={brand.path} />
        </svg>
      </span>
    );
  }

  const { Icon, color } = matchCategory(hay);
  return (
    <span
      className={className}
      style={{ ...CHIP_STYLE, color, backgroundColor: `${color}1f` }}
      aria-hidden
    >
      <Icon size={16} />
    </span>
  );
}
