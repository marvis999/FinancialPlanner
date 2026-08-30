import { Dashboard } from "@/components/dashboard";
import { SourceSwitcher } from "@/components/source-switcher";
import { activeSource, getAppState, listTransactions } from "@/lib/db";
import { todayIso } from "@/lib/utils";

// The dashboard reads from SQLite on every request.
export const dynamic = "force-dynamic";

export default function Home() {
  // Resolved first: it decides which database the two reads below open.
  const source = activeSource();
  const state = getAppState();
  const transactions = listTransactions();
  // Server-side, so the initial HTML and the first client render agree even
  // when the browser sits in a different timezone than the server.
  return (
    <>
      <Dashboard
        initialState={state}
        transactions={transactions}
        today={todayIso()}
      />
      <SourceSwitcher source={source} />
    </>
  );
}
