"use client";

import * as React from "react";
import { NextIntlClientProvider } from "next-intl";

import { Dashboard } from "@/components/dashboard";
import { INTL_FORMATS, type Locale } from "@/lib/locale";
import type { AppState, TransactionItem } from "@/lib/types";
import { todayIso } from "@/lib/utils";
import de from "@/messages/de.json";
import en from "@/messages/en.json";

import { readDemoLocale } from "../locale";
import { getAppState, listTransactions } from "../store";

interface DemoSnapshot {
  locale: Locale;
  timeZone: string;
  today: string;
  state: AppState;
  transactions: TransactionItem[];
}

/**
 * The dashboard, fed from the in-memory store instead of app/page.tsx.
 *
 * Mounted only in the browser: the household is generated from the viewer's
 * "today", and the HTML was prerendered on whatever day the build ran, so
 * rendering it on the server would hand React a ledger from another day to
 * hydrate.
 */
export function DemoApp() {
  const [snapshot, setSnapshot] = React.useState<DemoSnapshot | null>(null);

  React.useEffect(() => {
    const locale = readDemoLocale();
    document.documentElement.lang = locale;
    setSnapshot({
      locale,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      today: todayIso(),
      state: getAppState(),
      transactions: listTransactions(),
    });
  }, []);

  if (!snapshot) return null;

  return (
    <NextIntlClientProvider
      locale={snapshot.locale}
      messages={snapshot.locale === "en" ? en : de}
      formats={INTL_FORMATS}
      timeZone={snapshot.timeZone}
    >
      <Dashboard
        initialState={snapshot.state}
        transactions={snapshot.transactions}
        today={snapshot.today}
      />
    </NextIntlClientProvider>
  );
}
