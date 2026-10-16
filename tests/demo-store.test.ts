import { afterEach, describe, expect, it, vi } from "vitest";

import { freshDataDir } from "./helpers/db-harness";
import de from "@/messages/de.json";
import { todayIso } from "@/lib/utils";

type Actions = typeof import("@/app/actions");

/**
 * The static demo replaces lib/db.ts and app/actions.ts with demo/store.ts
 * and demo/actions.ts. The real pair is the specification: both are seeded
 * with the same day's household, every edit is made through both, and each
 * answer has to come back identical.
 */
async function load() {
  freshDataDir();
  vi.resetModules();
  const db = await import("@/lib/db");
  db.setActiveSource("demo");
  const real: Actions = await import("@/app/actions");
  // Typed as the real module: a missing export or a changed signature in the
  // demo is a type error here, not a runtime surprise in the browser.
  const demo: Actions = await import("@/demo/actions");
  (await import("@/demo/store")).resetDemoStore(todayIso());
  return { db, real, demo };
}

afterEach(() => vi.resetModules());

describe("demo store", () => {
  it("seeds the same household as the SQLite demo", async () => {
    const { db } = await load();
    const store = await import("@/demo/store");
    expect(store.getAppState()).toEqual(db.getAppState());
    expect(store.listTransactions()).toEqual(db.listTransactions());
    expect(store.getMonthlyHistory()).toEqual(db.getMonthlyHistory());
  });

  it("answers every ledger edit exactly like the server actions", async () => {
    const { db, real, demo } = await load();
    async function both<T>(step: (actions: Actions) => Promise<T>): Promise<T> {
      const expected = await step(real);
      expect(await step(demo)).toEqual(expected);
      return expected;
    }

    const today = todayIso();
    const recurring = db.listRecurring();
    const loan = recurring.find((item) => item.name === "Autokredit")!;
    const salary = recurring.find((item) => item.kind === "income")!;
    const transactions = db.listTransactions();
    const someIds = transactions.slice(0, 5).map((transaction) => transaction.id);
    const linked = transactions.find((transaction) => transaction.recurringId !== null)!;

    await both((actions) =>
      actions.addRecurringAction({
        name: "  Segelkurs ",
        amount: -60.456,
        kind: "expense",
        intervalMonths: 5,
        isContract: true,
        date: today,
        remainingAmount: 600,
        category: "no-such-category",
      })
    );
    await both((actions) => actions.toggleRecurringActiveAction(loan.id, false));
    await both((actions) => actions.toggleRecurringActiveAction(loan.id, true));

    // An existing category changes its amount; a new one is added; one goes.
    await both((actions) => actions.addBudgetAction({ category: "lebensmittel", amount: 500 }));
    const budgets = await both((actions) => actions.addBudgetAction({ category: "wohnen", amount: 900 }));
    await both((actions) => actions.updateBudgetAction({ id: budgets.budgets[1].id, amount: 75 }));
    await both((actions) => actions.deleteBudgetAction(budgets.budgets[0].id));

    // A designation against an income is dropped; one against the loan kept.
    await both((actions) =>
      actions.addOneOffAction({ name: "Extra", amount: 100, kind: "expense", date: today, isContract: false, debtId: salary.id })
    );
    const withDebt = await both((actions) =>
      actions.addOneOffAction({ name: "Sondertilgung 2", amount: 500, kind: "expense", date: today, isContract: false, debtId: loan.id })
    );
    const added = withDebt.oneoff.find((item) => item.name === "Sondertilgung 2")!;
    expect(added.debtId).toBe(loan.id);
    await both((actions) =>
      actions.updateOneOffAction({ ...added, amount: 450, debtId: loan.id })
    );
    await both((actions) => actions.toggleOneOffActiveAction(added.id, false));
    await both((actions) => actions.deleteOneOffAction(withDebt.oneoff[0].id));

    // Tags de-duplicate case-insensitively; categories reset with null.
    await both((actions) => actions.addTransactionTagAction(someIds, "  Urlaub   2026 "));
    await both((actions) => actions.addTransactionTagAction(someIds, "urlaub 2026"));
    await both((actions) => actions.addTransactionTagAction(someIds, "Hund"));
    await both((actions) => actions.removeTransactionTagAction(someIds.slice(0, 2), "HUND"));
    await both((actions) => actions.setTransactionCategoryAction(someIds, "shopping"));
    await both((actions) => actions.setTransactionCategoryAction(someIds.slice(0, 1), null));
    await both((actions) =>
      actions.applyCategorySuggestionAction(someIds, "shopping", "freizeit")
    );

    // Links: undo one, let the matcher find it again, then skip a due date.
    await both((actions) => actions.unlinkTransactionAction(linked.id));
    const relinked = await both((actions) => actions.relinkRecurringAction());
    expect(relinked.linked).toBe(1);
    await both((actions) => actions.unlinkTransactionAction(linked.id));
    await both((actions) =>
      actions.linkTransactionAction(linked.id, linked.recurringId!, linked.recurringDue!)
    );
    await both((actions) => actions.setRecurringDueSkippedAction(loan.id, "2099-01-28", true));
    await both((actions) => actions.setRecurringDueSkippedAction(loan.id, "2098-01-28", true));
    await both((actions) => actions.setRecurringDueSkippedAction(loan.id, "2099-01-28", false));

    // A corrected balance re-anchors every running balance.
    const settings = db.getSettings();
    await both((actions) =>
      actions.updateSettingsAction({ ...settings, startingBalance: 1234.567, budgetStartDay: 40 })
    );
    await both((actions) => actions.relinkRecurringAction());

    await both((actions) => actions.deleteRecurringAction(loan.id));
    await both((actions) => actions.relinkRecurringAction());
  });

  it("answers the server-only features with the demo notice", async () => {
    const { demo } = await load();
    const notice = de.server.demoUnavailable;
    expect(await demo.startCsvCheckAction("Buchungstag;Betrag")).toEqual({ ok: false, error: notice });
    expect((await demo.getClaudeAuthAction()).error).toBe(notice);
    expect((await demo.startCategoryAnalysisAction()).categories).toMatchObject({ status: "error", error: notice });
    expect((await demo.startFreeAnalysisAction("Warum?")).free).toMatchObject({
      status: "error",
      error: notice,
      question: "Warum?",
    });
    expect((await demo.getAnalysisStateAction()).free.status).toBe("idle");
  });

  it("throws the demo's edits away on reset", async () => {
    const { demo } = await load();
    const store = await import("@/demo/store");
    const before = store.getAppState();
    await demo.deleteBudgetAction(before.budgets[0].id);
    await demo.resetDemoDataAction();
    expect(store.getAppState()).toEqual(before);
  });
});
