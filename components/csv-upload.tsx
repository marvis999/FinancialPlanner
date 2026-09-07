"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import {
  cancelCsvCheckAction,
  confirmCsvImportAction,
  getCsvCheckStateAction,
  startCsvCheckAction,
  type CsvImportResponse,
  type BalancePrompt,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryByKey } from "@/lib/categories";
import { dayDiff, settledKey } from "@/lib/recurring-match";
import type {
  ImportBooking,
  ImportCheckFinding,
  ImportCheckState,
  ImportExpectedDue,
  ImportResult,
  ImportReviewDecision,
  ImportSkippedDue,
  ImportSummary,
} from "@/lib/types";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

/**
 * Upload flow: decode → (first import: confirm balance) → the file is
 * validated and every new booking is matched against the recurring items
 * WITHOUT the model → Claude checks the new payments (categories, one-off
 * matches, the recurring due dates still open) → review → import → result.
 *
 * The review is never skipped: it lists every new booking, what each one
 * was matched to, and every recurring charge that was due in the file's span
 * but did not appear. That part comes from the deterministic pass, so it is
 * there even when the Claude check fails. Nothing is written before the
 * review is confirmed; abort leaves the ledger untouched. The check runs as
 * a server-side job and is polled, so a tab switch does not kill it.
 */

/** Everything the flow needs to finish the upload later. */
interface PendingFile {
  text: string;
  closingBalance: number | null;
}

/** What the import changed, kept on screen until dismissed. */
interface ImportOutcome {
  result: ImportResult;
  review: NonNullable<CsvImportResponse["review"]> | null;
  /** Due dates still without a booking after the review. */
  missing: ImportExpectedDue[];
}

type Phase =
  | { kind: "idle" }
  | { kind: "balance"; preview: BalancePrompt; text: string }
  | { kind: "checking"; file: PendingFile; summary: ImportSummary }
  | {
      kind: "review";
      file: PendingFile;
      summary: ImportSummary;
      findings: ImportCheckFinding[];
      checked: number;
      /** The Claude check failed; the deterministic part still stands. */
      claudeError: string | null;
    }
  | { kind: "done"; outcome: ImportOutcome };

function CategoryBadge({ categoryKey }: { categoryKey: string }) {
  const cat = categoryByKey(categoryKey);
  const categoryLabel = useCategoryLabel();
  return (
    <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-normal">
      <span
        className="h-2 w-2 rounded-[3px]"
        style={{ backgroundColor: `var(${cat.cssVar})` }}
      />
      {categoryLabel(categoryKey)}
    </Badge>
  );
}

export function CsvUpload({
  onImported,
  disabled,
  label,
}: {
  onImported: (res: CsvImportResponse) => void;
  disabled?: boolean;
  /** Defaults to the translated "CSV importieren". */
  label?: string;
}) {
  const msg = useTranslations("csvUpload");
  const msgCommon = useTranslations("common");
  const { formatDate, formatEuro, formatAmountInput, parseAmountInput } =
    useFormatters();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [job, setJob] = React.useState<ImportCheckState | null>(null);
  const [openingValue, setOpeningValue] = React.useState("");

  const doImport = React.useCallback(
    async (
      file: PendingFile,
      decisions: ImportReviewDecision[],
      skipped: ImportSkippedDue[],
      missing: ImportExpectedDue[]
    ) => {
      setBusy(true);
      try {
        const res = await confirmCsvImportAction(
          file.text,
          file.closingBalance,
          decisions,
          skipped
        );
        onImported(res);
        if (res.ok && res.result) {
          setNotice(null);
          setPhase({
            kind: "done",
            outcome: { result: res.result, review: res.review ?? null, missing },
          });
        } else {
          setPhase({ kind: "idle" });
          setNotice(res.error || msg("importFailed"));
        }
      } catch {
        setPhase({ kind: "idle" });
        setNotice(msg("importFailedGeneric"));
      } finally {
        setBusy(false);
      }
    },
    // msg is re-created every render, but the language switcher reloads the
    // page, so a captured one can never be stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onImported]
  );

  /** Kick off (or re-kick after the balance dialog) the check. */
  const startCheck = React.useCallback(
    async (text: string, closingBalance: number | null) => {
      setBusy(true);
      setNotice(null);
      try {
        const res = await startCsvCheckAction(
          text,
          closingBalance === null ? undefined : closingBalance
        );
        if (res.needsBalance) {
          setPhase({ kind: "balance", preview: res.needsBalance, text });
          setOpeningValue(formatAmountInput(res.needsBalance.suggested));
          return;
        }
        if (!res.ok || !res.summary) {
          setPhase({ kind: "idle" });
          setNotice(res.error || msg("checkFailed"));
          return;
        }
        const file: PendingFile = { text, closingBalance };
        if (res.nothingNew) {
          // Nothing to review; the import reports "0 neue, N Duplikate".
          await doImport(file, [], [], []);
          return;
        }
        setJob(null);
        setPhase({ kind: "checking", file, summary: res.summary });
      } catch {
        setPhase({ kind: "idle" });
        setNotice(msg("checkNotStarted"));
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    // msg and the formatters are re-created every render, but the language
    // switcher reloads the page, so a captured one can never be stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doImport]
  );

  async function handleFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      // Sparkasse exports are Windows-1252 encoded.
      const text = new TextDecoder("windows-1252").decode(buf);
      await startCheck(text, null);
    } catch {
      setNotice(msg("fileUnreadable"));
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** Abort the upload: nothing was imported, drop the server-side job. */
  const abort = React.useCallback(() => {
    void cancelCsvCheckAction();
    setPhase({ kind: "idle" });
    setJob(null);
    setNotice(msg("aborted"));
  // msg is re-created every render, but the language switcher reloads the
  // page, so a captured one can never be stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the check job while it runs; hand over to the review when done. A
  // failed check hands over too: the review then carries the error and the
  // deterministic findings, instead of asking to "import anyway" blind.
  const checking = phase.kind === "checking";
  React.useEffect(() => {
    if (!checking || phase.kind !== "checking") return;
    let stopped = false;
    const { file, summary } = phase;
    const poll = async () => {
      try {
        const st = await getCsvCheckStateAction();
        if (stopped) return;
        setJob(st);
        if (st.status === "done" || st.status === "error") {
          // Overlapping polls must not handle the terminal state twice.
          stopped = true;
        }
        if (st.status === "done") {
          setPhase({
            kind: "review",
            file,
            summary,
            findings: st.result?.findings ?? [],
            checked: st.result?.checked ?? 0,
            claudeError: null,
          });
        } else if (st.status === "error") {
          setPhase({
            kind: "review",
            file,
            summary,
            findings: [],
            checked: 0,
            claudeError: st.error ?? msg("checkFailed"),
          });
        }
      } catch {
        // transient (e.g. dev-server reload) — next poll will recover
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  // msg is re-created every render, but the language switcher reloads the
  // page, so a captured one can never be stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, phase]);

  function confirmOpening() {
    if (phase.kind !== "balance") return;
    const parsed = parseAmountInput(openingValue);
    if (parsed === null) return;
    void startCheck(phase.text, parsed);
  }

  const parsedOpening = parseAmountInput(openingValue);
  // The user types the CURRENT balance; the opening balance is what follows
  // from it, shown so the figure can be sanity-checked against a statement.
  const derivedOpening =
    phase.kind === "balance" && parsedOpening !== null
      ? Math.round((parsedOpening - phase.preview.sum) * 100) / 100
      : null;

  const uploadDisabled = busy || disabled || phase.kind !== "idle";

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const finding = event.target.files?.[0];
          if (finding) handleFile(finding);
        }}
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={uploadDisabled}
        className="shrink-0"
      >
        {busy || phase.kind === "checking" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {label ?? msg("importCsv")}
      </Button>

      {phase.kind === "checking" && (
        <div className="rounded-lg border border-dashed px-4 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            {msg("checking")}
          </p>
          <ul className="space-y-1.5">
            {(job?.log ?? [msg("checkStarting")]).map((line, i, all) => {
              const isCurrent = i === all.length - 1;
              return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {isCurrent ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  )}
                  <span className={cn(!isCurrent && "text-muted-foreground")}>
                    {line}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={abort} disabled={busy}>
              {msgCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notice}
        </p>
      )}

      {phase.kind === "done" && (
        <ImportResultPanel
          outcome={phase.outcome}
          onClose={() => setPhase({ kind: "idle" })}
        />
      )}

      {/* Dialogs are mounted only while needed. Leaving a Radix dialog mounted
          and toggling `open` relies on the portal unmounting when its exit
          animation ends; if that event does not arrive the overlay stays
          behind and covers the page, which is unrecoverable without a reload. */}

      {/* ------------------- First import: confirm balance ------------------ */}
      {phase.kind === "balance" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setPhase({ kind: "idle" });
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{msg("balanceTitle")}</DialogTitle>
              <DialogDescription>
                {msg("balanceDescription", {
                  rows: phase.preview.rows,
                  from: formatDate(phase.preview.minDate),
                  to: formatDate(phase.preview.maxDate),
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="opening-balance">
                {msg("balanceLabel", { date: formatDate(phase.preview.maxDate) })}
              </Label>
              <CurrencyInput
                id="opening-balance"
                value={openingValue}
                onChange={setOpeningValue}
                autoFocus
              />
              <p className="text-xs leading-snug text-muted-foreground">
                {msg("balanceHint")}
              </p>
              <p className="text-sm text-muted-foreground">
                {msg("sumOfBookings", { sum: formatEuro(phase.preview.sum) })}
                {derivedOpening === null ? (
                  msg("enterAmount")
                ) : (
                  <>
                    {msg("openingBefore", {
                      date: formatDate(phase.preview.minDate),
                    })}
                    <span className="font-medium text-foreground">
                      {formatEuro(derivedOpening)}
                    </span>
                  </>
                )}
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setPhase({ kind: "idle" })}
                disabled={busy}
              >
                {msgCommon("cancel")}
              </Button>
              <Button
                onClick={confirmOpening}
                disabled={busy || parsedOpening === null}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {msg("continueToCheck")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* -------------------------- Review dialog --------------------------- */}
      {phase.kind === "review" && (
        <ReviewDialog
          summary={phase.summary}
          findings={phase.findings}
          checked={phase.checked}
          claudeError={phase.claudeError}
          busy={busy}
          onImport={(decisions, skipped, missing) =>
            void doImport(phase.file, decisions, skipped, missing)
          }
          onAbort={abort}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Result panel                                                              */
/* -------------------------------------------------------------------------- */

function ImportResultPanel({
  outcome,
  onClose,
}: {
  outcome: ImportOutcome;
  onClose: () => void;
}) {
  const msg = useTranslations("csvUpload");
  const msgCommon = useTranslations("common");
  const { formatDate, formatEuro } = useFormatters();
  const { result, review, missing } = outcome;
  const nothingNew = result.added === 0 && result.skipped > 0;
  return (
    <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 px-4 py-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <CircleCheck className="h-4 w-4 text-success" />
        {nothingNew ? msg("doneNothingNew", { count: result.skipped }) : msg("doneTitle")}
      </p>
      {!nothingNew && (
        <p>
          {msg("imported", {
            added: result.added,
            skipped: result.skipped,
            total: result.total,
            from: formatDate(result.minDate),
            to: formatDate(result.maxDate),
            balance: formatEuro(result.newBalance),
          })}
          {result.invalid ? msg("invalidRows", { count: result.invalid }) : ""}
        </p>
      )}
      {review &&
        (review.recurringLinked ||
          review.oneOffsResolved ||
          review.categoriesApplied ||
          review.duesSkipped) > 0 && (
          <p className="text-muted-foreground">
            {msg("doneReview", {
              recurring: review.recurringLinked,
              oneOffs: review.oneOffsResolved,
              categories: review.categoriesApplied,
              skipped: review.duesSkipped,
            })}
          </p>
        )}
      {missing.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {msg("doneMissingTitle")}
          </p>
          <ul className="mt-1 space-y-0.5">
            {missing.map((due) => (
              <li key={settledKey(due.recurringId, due.due)}>
                {due.name} · {msg("dueOn", { date: formatDate(due.due) })} ·{" "}
                <span className="font-mono tabular-nums">
                  {due.kind === "income" ? "+" : "−"}
                  {formatEuro(due.amount)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">{msg("doneMissingHint")}</p>
        </div>
      )}
      <div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {msgCommon("close")}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Review dialog                                                             */
/* -------------------------------------------------------------------------- */

type RecurringSource = "manual" | "pattern" | "heuristic" | "claude";

interface RowMatch extends ImportExpectedDue {
  source: RecurringSource;
  reason: string;
}

/** One new booking with everything the review decided about it. */
interface ReviewRow {
  booking: ImportBooking;
  /** Accepted category suggestion. */
  category: string | null;
  categoryReason: string;
  /** Accepted one-off match. */
  oneOff: ImportCheckFinding["oneOff"];
  oneOffReason: string;
  recurring: RowMatch | null;
  /** The row carries a suggestion (Claude or matcher) that can be rejected. */
  hasSuggestion: boolean;
  rejected: boolean;
}

function dueKey(due: ImportExpectedDue): string {
  return settledKey(due.recurringId, due.due);
}

function buildRows(
  summary: ImportSummary,
  findings: ImportCheckFinding[],
  rejected: ReadonlySet<string>,
  assigned: ReadonlyMap<string, ImportExpectedDue>
): ReviewRow[] {
  const findingByFp = new Map(findings.map((finding) => [finding.fingerprint, finding]));
  const matchByFp = new Map(summary.recurringMatches.map((match) => [match.fingerprint, match]));
  return summary.bookings.map((booking) => {
    const finding = findingByFp.get(booking.fingerprint) ?? null;
    const match = matchByFp.get(booking.fingerprint) ?? null;
    const manual = assigned.get(booking.fingerprint) ?? null;
    const isRejected = rejected.has(booking.fingerprint);
    // A manual assignment beats every suggestion; the matcher's own beats
    // the model's, because the matcher had the exact amount or a confirmed
    // counterparty and the model only a plausible story.
    let recurring: RowMatch | null = null;
    if (manual) {
      recurring = { ...manual, source: "manual", reason: "" };
    } else if (match && !isRejected) {
      recurring = {
        recurringId: match.recurringId,
        name: match.name,
        amount: match.amount,
        kind: match.kind,
        due: match.due,
        source: match.confidence,
        reason: "",
      };
    } else if (finding?.recurring && !isRejected) {
      recurring = {
        recurringId: finding.recurring.id,
        name: finding.recurring.name,
        amount: finding.recurring.amount,
        kind: finding.recurring.kind,
        due: finding.recurring.due,
        source: "claude",
        reason: finding.recurringReason,
      };
    }
    return {
      booking,
      category: !isRejected && finding?.suggestedCategory ? finding.suggestedCategory : null,
      categoryReason: finding?.categoryReason ?? "",
      oneOff: !isRejected && finding?.oneOff ? finding.oneOff : null,
      oneOffReason: finding?.oneOffReason ?? "",
      recurring,
      hasSuggestion: match !== null || finding !== null,
      rejected: isRejected,
    };
  });
}

function ReviewDialog({
  summary,
  findings,
  checked,
  claudeError,
  busy,
  onImport,
  onAbort,
}: {
  summary: ImportSummary;
  findings: ImportCheckFinding[];
  checked: number;
  claudeError: string | null;
  busy: boolean;
  onImport: (
    decisions: ImportReviewDecision[],
    skipped: ImportSkippedDue[],
    missing: ImportExpectedDue[]
  ) => void;
  onAbort: () => void;
}) {
  const msg = useTranslations("csvUpload");
  const { formatDate, formatEuro } = useFormatters();
  // Bookings whose suggestions the user rejected, by fingerprint.
  const [rejected, setRejected] = React.useState<Set<string>>(() => new Set());
  // Bookings the user assigned to a due date by hand.
  const [assigned, setAssigned] = React.useState<Map<string, ImportExpectedDue>>(
    () => new Map()
  );
  // Due dates the user marked as settled without a booking.
  const [skipped, setSkipped] = React.useState<Map<string, ImportExpectedDue>>(
    () => new Map()
  );
  const [showPlain, setShowPlain] = React.useState(false);

  const rows = React.useMemo(
    () => buildRows(summary, findings, rejected, assigned),
    [summary, findings, rejected, assigned]
  );

  // Every due date the file's span asked for: the ones still open plus the
  // ones the matcher settled, because a rejected match reopens its due date.
  const allDues = React.useMemo(() => {
    const byKey = new Map<string, ImportExpectedDue>();
    for (const due of summary.expected) byKey.set(dueKey(due), due);
    for (const match of summary.recurringMatches) {
      const due: ImportExpectedDue = {
        recurringId: match.recurringId,
        name: match.name,
        amount: match.amount,
        kind: match.kind,
        due: match.due,
      };
      byKey.set(dueKey(due), due);
    }
    return [...byKey.values()].sort(
      (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.name.localeCompare(b.name))
    );
  }, [summary]);

  const settledNow = React.useMemo(() => {
    const out = new Set<string>();
    for (const row of rows) if (row.recurring) out.add(dueKey(row.recurring));
    return out;
  }, [rows]);

  const openDues = allDues.filter((due) => !settledNow.has(dueKey(due)));
  const missing = openDues.filter((due) => !skipped.has(dueKey(due)));

  const flagged = rows.filter(
    (row) => row.hasSuggestion || row.recurring !== null
  );
  const plain = rows.filter((row) => !row.hasSuggestion && row.recurring === null);
  const visibleRows = showPlain ? [...flagged, ...plain] : flagged;

  const counts = {
    bookings: rows.length,
    recurring: rows.filter((row) => row.recurring !== null).length,
    oneOffs: rows.filter((row) => row.oneOff !== null).length,
    categories: rows.filter((row) => row.category !== null).length,
    missing: missing.length,
  };

  const setRow = (fingerprint: string, accepted: boolean) => {
    setRejected((previous) => {
      const next = new Set(previous);
      if (accepted) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  };

  const assign = (due: ImportExpectedDue, fingerprint: string | null) => {
    setAssigned((previous) => {
      const next = new Map(previous);
      for (const [key, value] of next) {
        if (dueKey(value) === dueKey(due)) next.delete(key);
      }
      if (fingerprint) next.set(fingerprint, due);
      return next;
    });
  };

  const toggleSkip = (due: ImportExpectedDue) => {
    setSkipped((previous) => {
      const next = new Map(previous);
      const key = dueKey(due);
      if (next.has(key)) next.delete(key);
      else next.set(key, due);
      return next;
    });
  };

  /** Bookings a due date could be assigned to, most plausible first. */
  const candidatesFor = (due: ImportExpectedDue): ReviewRow[] =>
    rows
      .filter(
        (row) =>
          (due.kind === "income" ? row.booking.amount > 0 : row.booking.amount < 0) &&
          (row.recurring === null || dueKey(row.recurring) === dueKey(due))
      )
      .sort(
        (a, b) =>
          Math.abs(Math.abs(a.booking.amount) - due.amount) -
            Math.abs(Math.abs(b.booking.amount) - due.amount) ||
          Math.abs(dayDiff(due.due, a.booking.date)) -
            Math.abs(dayDiff(due.due, b.booking.date))
      )
      .slice(0, 15);

  const submit = () => {
    const decisions: ImportReviewDecision[] = [];
    for (const row of rows) {
      const oneOffId = row.oneOff?.id ?? null;
      if (!row.category && oneOffId === null && !row.recurring) continue;
      decisions.push({
        fingerprint: row.booking.fingerprint,
        category: row.category,
        oneOffId,
        recurringId: row.recurring?.recurringId ?? null,
        recurringDue: row.recurring?.due ?? null,
      });
    }
    onImport(
      decisions,
      [...skipped.values()].map((due) => ({ recurringId: due.recurringId, due: due.due })),
      missing
    );
  };

  const sourceLabel: Record<RecurringSource, string> = {
    pattern: msg("matchPattern"),
    heuristic: msg("matchHeuristic"),
    claude: msg("matchClaude"),
    manual: msg("matchManual"),
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onAbort();
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{msg("reviewTitle")}</DialogTitle>
          <DialogDescription>
            {msg("reviewSummary", {
              newCount: summary.bookings.length,
              from: formatDate(summary.minDate),
              to: formatDate(summary.maxDate),
              duplicates: summary.duplicates,
            })}
            {summary.invalid ? msg("invalidRows", { count: summary.invalid }) : ""}
          </DialogDescription>
        </DialogHeader>

        <p
          className={cn(
            "flex items-start gap-1.5 text-xs",
            claudeError ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {claudeError ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {claudeError
              ? msg("claudeFailedNote", { error: claudeError })
              : msg("claudeChecked", { checked, total: summary.bookings.length })}
          </span>
        </p>

        <div className="max-h-[60vh] space-y-4 overflow-auto pr-1">
          {/* ---------------- Expected, but not in the file ---------------- */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              {openDues.length > 0 && (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              )}
              {msg("expectedTitle")}
            </h3>
            {openDues.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {allDues.length === 0 ? msg("expectedNoneDue") : msg("expectedNone")}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{msg("expectedDescription")}</p>
                <div className="rounded-lg border">
                  <Table>
                    <TableBody>
                      {openDues.map((due) => {
                        const key = dueKey(due);
                        const isSkipped = skipped.has(key);
                        return (
                          <TableRow key={key} className={cn(isSkipped && "opacity-60")}>
                            <TableCell className="px-4 align-top">
                              <div className="font-medium">{due.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {msg("dueOn", { date: formatDate(due.due) })} ·{" "}
                                <span className="font-mono tabular-nums">
                                  {due.kind === "income" ? "+" : "−"}
                                  {formatEuro(due.amount)}
                                </span>
                                {isSkipped && (
                                  <Badge variant="secondary" className="ml-2 font-normal">
                                    {msg("skippedLabel")}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="w-[22rem] px-4 align-top">
                              {!isSkipped && (
                                <Select
                                  value=""
                                  onValueChange={(value) => assign(due, value || null)}
                                  disabled={busy}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder={msg("assignPlaceholder")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {candidatesFor(due).map((row) => (
                                      <SelectItem
                                        key={row.booking.fingerprint}
                                        value={row.booking.fingerprint}
                                        className="text-xs"
                                      >
                                        {formatDate(row.booking.date)} · {row.booking.name} ·{" "}
                                        {formatEuro(row.booking.amount)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </TableCell>
                            <TableCell className="w-44 px-4 text-right align-top">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => toggleSkip(due)}
                                disabled={busy}
                              >
                                {isSkipped ? msg("unskipDue") : msg("skipDue")}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </section>

          {/* -------------------------- New bookings ------------------------ */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">
              {msg("bookingsTitle", { count: rows.length })}
            </h3>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">{msg("colBooking")}</TableHead>
                    <TableHead className="px-4">{msg("colCategory")}</TableHead>
                    <TableHead className="px-4">{msg("colMatch")}</TableHead>
                    <TableHead className="w-24 px-4 text-right">{msg("colAction")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => {
                    const { booking } = row;
                    const dimmed = row.rejected;
                    return (
                      <TableRow key={booking.fingerprint}>
                        <TableCell className="px-4 align-top">
                          <div className="max-w-[220px] truncate font-medium">{booking.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(booking.date)} ·{" "}
                            <span
                              className={cn(
                                "font-mono tabular-nums",
                                booking.amount >= 0 ? "text-success" : "text-destructive"
                              )}
                            >
                              {formatEuro(booking.amount)}
                            </span>
                          </div>
                          {booking.purpose && (
                            <div className="max-w-[220px] truncate text-xs text-muted-foreground">
                              {booking.purpose}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={cn("px-4 align-top", dimmed && "opacity-50")}>
                          {row.category ? (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <CategoryBadge categoryKey={booking.category} />
                                <span className="text-xs text-muted-foreground">→</span>
                                <CategoryBadge categoryKey={row.category} />
                              </div>
                              {row.categoryReason && (
                                <div className="max-w-[240px] text-xs text-muted-foreground">
                                  {row.categoryReason}
                                </div>
                              )}
                            </div>
                          ) : (
                            <CategoryBadge categoryKey={booking.category} />
                          )}
                        </TableCell>
                        <TableCell className={cn("px-4 align-top", dimmed && "opacity-50")}>
                          {row.recurring ? (
                            <div className="space-y-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="max-w-[200px] truncate text-sm font-medium">
                                  {row.recurring.name}
                                </span>
                                <Badge
                                  variant={
                                    row.recurring.source === "pattern" ||
                                    row.recurring.source === "manual"
                                      ? "success"
                                      : "secondary"
                                  }
                                  className="font-normal"
                                >
                                  {sourceLabel[row.recurring.source]}
                                </Badge>
                                {row.recurring.source === "manual" && (
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => assign(row.recurring!, null)}
                                    aria-label={msg("clearAssignAria", { name: row.recurring.name })}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {msg("dueOn", { date: formatDate(row.recurring.due) })} ·{" "}
                                <span className="font-mono tabular-nums">
                                  {row.recurring.kind === "income" ? "+" : "−"}
                                  {formatEuro(row.recurring.amount)}
                                </span>
                              </div>
                              {row.recurring.reason && (
                                <div className="max-w-[220px] text-xs text-muted-foreground">
                                  {row.recurring.reason}
                                </div>
                              )}
                            </div>
                          ) : row.oneOff ? (
                            <div className="space-y-0.5">
                              <div className="max-w-[200px] truncate text-sm font-medium">
                                {row.oneOff.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {msg("plannedOn", { date: formatDate(row.oneOff.date) })} ·{" "}
                                <span className="font-mono tabular-nums">
                                  {row.oneOff.kind === "income" ? "+" : "−"}
                                  {formatEuro(row.oneOff.amount)}
                                </span>
                              </div>
                              {row.oneOffReason && (
                                <div className="max-w-[220px] text-xs text-muted-foreground">
                                  {row.oneOffReason}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 align-top">
                          {row.hasSuggestion && (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "h-8 w-8",
                                  !row.rejected
                                    ? "bg-success/15 text-success hover:bg-success/20 hover:text-success"
                                    : "text-muted-foreground hover:text-success"
                                )}
                                onClick={() => setRow(booking.fingerprint, true)}
                                disabled={busy}
                                aria-label={msg("acceptAria", { name: booking.name })}
                                aria-pressed={!row.rejected}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "h-8 w-8",
                                  row.rejected
                                    ? "bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive"
                                    : "text-muted-foreground hover:text-destructive"
                                )}
                                onClick={() => setRow(booking.fingerprint, false)}
                                disabled={busy}
                                aria-label={msg("rejectAria", { name: booking.name })}
                                aria-pressed={row.rejected}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">
                        {msg("noFlaggedRows")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {plain.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowPlain((previous) => !previous)}
              >
                {showPlain ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {showPlain ? msg("hidePlain") : msg("showPlain", { count: plain.length })}
              </Button>
            )}
          </section>
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="self-center text-xs text-muted-foreground">
            {msg("footerCounts", counts)}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onAbort} disabled={busy}>
              {msg("abortUpload")}
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {msg("import")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
