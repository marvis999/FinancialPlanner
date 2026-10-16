import { afterEach, describe, expect, it, vi } from "vitest";

import { buildImportCheckPrompt, toCheckPayments } from "@/lib/import-check";
import { createMasker } from "@/lib/pii-mask";
import type { ImportTransaction } from "@/lib/types";
import { freshDataDir } from "./helpers/db-harness";

/**
 * Nothing may reach Claude until the user turns it on, and what does reach it
 * has the personal details masked. The switch is enforced in runClaude, so
 * these tests also prove the CLI is never spawned while it is off.
 */

const HEADER =
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";' +
  '"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";' +
  '"Betrag";"Waehrung";"Info"';
const ROW =
  '"DE00";"03.08.26";"03.08.26";"KARTENZAHLUNG";"Einkauf";"REWE";"DE02123456";"TESTDEFF";"-42,10";"EUR";"Umsatz gebucht"';

async function load() {
  freshDataDir();
  vi.resetModules();
  const cli = await import("@/lib/claude-cli");
  const actions = await import("@/app/actions");
  const db = await import("@/lib/db");
  return { cli, actions, db };
}

const PRIVATE_BOOKING: ImportTransaction = {
  date: "2026-08-03",
  valuta: null,
  name: "Max Mustermann",
  amount: -250,
  currency: "EUR",
  type: "UEBERWEISUNG",
  purpose: "Rueckzahlung IBAN DE89 3704 0044 0532 0130 00 Kundennr. 7712345",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  fingerprint: "fp1",
};

afterEach(() => vi.resetModules());

describe("the Claude switch", () => {
  it("is off until the user turns it on, and then blocks every run", async () => {
    const { cli, actions } = await load();
    // "disabled" comes only from the guard that runs before the CLI is spawned.
    expect(await cli.runClaude("hello")).toEqual({ ok: false, error: { code: "disabled" } });

    expect(await actions.setClaudeEnabledAction(true)).toMatchObject({ enabled: true });
    expect(await actions.setClaudeEnabledAction(false)).toMatchObject({ enabled: false });
    expect(await cli.runClaude("hello")).toEqual({ ok: false, error: { code: "disabled" } });
  });

  it("still opens the import review while off, without findings and without sending", async () => {
    const { actions } = await load();
    const res = await actions.startCsvCheckAction([HEADER, ROW].join("\n"), 1000);
    expect(res).toMatchObject({ ok: true, started: true });
    let state = await actions.getCsvCheckStateAction();
    for (let i = 0; i < 20 && state.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = await actions.getCsvCheckStateAction();
    }
    expect(state.status).toBe("done");
    expect(state.result).toEqual({ newCount: 1, checked: 0, findings: [], claudeOff: true });
  });

  it("does not start an analysis while off", async () => {
    const { actions } = await load();
    const free = await actions.startFreeAnalysisAction("Where can I save?");
    expect(free.free.status).toBe("idle");
    const categories = await actions.startCategoryAnalysisAction();
    expect(categories.categories.status).toBe("idle");
  });

  it("stores the hidden names one per line, without blanks or duplicates", async () => {
    const { actions } = await load();
    const saved = await actions.setHiddenNamesAction("Max Mustermann\n\n  Erika  \nmax mustermann\nX");
    expect(saved.hiddenNames).toEqual(["Max Mustermann", "Erika"]);
  });
});

describe("the preview of what Claude receives", () => {
  it("builds every prompt while Claude is off, with the private details masked", async () => {
    const { actions, db } = await load();
    db.importTransactions([PRIVATE_BOOKING], 0);
    await actions.setHiddenNamesAction("Max Mustermann");

    const preview = await actions.previewClaudePromptAction("import");
    expect(preview).toMatchObject({ ok: true, sample: 1, error: null });
    expect(preview.prompt).not.toMatch(/Mustermann|DE89|0532 0130|7712345/);
    expect(preview.prompt).toContain("[IBAN-1]");
    expect(preview.hidden).toEqual(
      expect.arrayContaining([
        { kind: "NAME", count: 1 },
        { kind: "IBAN", count: 1 },
        { kind: "REF", count: 1 },
      ])
    );

    const categories = await actions.previewClaudePromptAction("categories");
    expect(categories.ok).toBe(true);
    expect(categories.prompt).toContain("Merchant groups:");
    expect(categories.prompt).not.toMatch(/Mustermann|DE89|7712345/);

    const question = await actions.previewClaudePromptAction("question", "Was schulde ich Max Mustermann?");
    expect(question.prompt).toContain("The user's question: Was schulde ich [NAME-1]?");
  });

  it("explains that there is nothing to preview without bookings", async () => {
    const { actions } = await load();
    const preview = await actions.previewClaudePromptAction("import");
    expect(preview.ok).toBe(false);
    expect(preview.error).toBeTruthy();
  });
});

describe("the import prompt", () => {
  it("contains no IBAN, reference or listed name from the booking", () => {
    const record = PRIVATE_BOOKING;
    const masker = createMasker(["Max Mustermann"]);
    const prompt = buildImportCheckPrompt(toCheckPayments([record]), [], "English", [], masker.mask);
    expect(prompt).not.toMatch(/Mustermann|DE89|0532 0130|7712345/);
    expect(prompt).toContain("[NAME-1]");
    expect(prompt).toContain("[IBAN-1]");
    expect(prompt).toContain("Kundennr. [REF-1]");
  });
});
