import de from "@/messages/de.json";
import { DEFAULT_LOCALE } from "@/lib/locale";

type Messages = typeof de;

/**
 * Stand-in for `next-intl/server` under vitest.
 *
 * The real one needs a React Server Components request scope, which the test
 * runner has no equivalent of; without this every server action that reads a
 * message throws "not supported in Client Components". Resolving against the
 * German catalogue keeps the tests asserting the strings a German user sees,
 * which is what they were written against.
 */

/** `{name}` placeholders, and enough ICU plural to cover the catalogue. */
function format(template: string, values: Record<string, unknown> = {}): string {
  const plural = /\{(\w+),\s*plural,\s*one\s*\{([^{}]*)\}\s*other\s*\{([^{}]*)\}\s*\}/g;
  const withPlurals = template.replace(plural, (_m, key, one, other) => {
    const n = Number(values[key]);
    return (n === 1 ? one : other).replace(/#/g, String(n));
  });
  return withPlurals.replace(/\{(\w+)\}/g, (m, key) =>
    key in values ? String(values[key]) : m
  );
}

export async function getTranslations<N extends keyof Messages>(namespace: N) {
  const table = de[namespace] as Record<string, string>;
  const t = (key: string, values?: Record<string, unknown>) =>
    format(table[key] ?? String(key), values);
  return t as unknown as (
    key: string,
    values?: Record<string, unknown>
  ) => string;
}

export async function getLocale(): Promise<string> {
  return DEFAULT_LOCALE;
}

export async function getMessages(): Promise<Messages> {
  return de;
}
