"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, CircleCheck, Loader2, Sparkles, Upload, X } from "lucide-react";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryByKey } from "@/lib/categories";
import type {
  ImportCheckFinding,
  ImportCheckResult,
  ImportCheckState,
  ImportReviewDecision,
} from "@/lib/types";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

/**
 * Upload flow: decode → (first import: confirm balance) → Claude checks the
 * NEW payments (category + one-off match) → review dialog → import. Nothing
 * is written before the review is confirmed; "reject all" aborts the whole
 * upload. The check runs as a server-side job and is polled, so a tab switch
 * does not kill it.
 */

/** Everything the flow needs to finish the upload later. */
interface PendingFile {
  text: string;
  closingBalance: number | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "balance"; preview: BalancePrompt; text: string }
  | { kind: "checking"; file: PendingFile }
  | { kind: "failed"; file: PendingFile; error: string }
  | { kind: "review"; file: PendingFile; result: ImportCheckResult };

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
  const { formatDate, formatEuro, formatAmountInput, parseAmountInput } =
    useFormatters();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [job, setJob] = React.useState<ImportCheckState | null>(null);
  const [openingValue, setOpeningValue] = React.useState("");
  // Findings the user rejected in the review dialog, by fingerprint.
  const [rejected, setRejected] = React.useState<Set<string>>(() => new Set());

  function report(res: CsvImportResponse) {
    if (res.ok && res.result) {
      const result = res.result;
      const review = res.review;
      setNotice({
        ok: true,
        text:
          msg("imported", {
            added: result.added,
            skipped: result.skipped,
            total: result.total,
            from: formatDate(result.minDate),
            to: formatDate(result.maxDate),
            balance: formatEuro(result.newBalance),
          }) +
          (result.invalid
            ? msg("invalidRows", { count: result.invalid })
            : "") +
          (review && (review.categoriesApplied || review.oneOffsResolved)
            ? msg("reviewApplied", {
                categories: review.categoriesApplied,
                oneOffs: review.oneOffsResolved,
              })
            : ""),
      });
    } else {
      setNotice({ ok: false, text: res.error || msg("importFailed") });
    }
  }

  const doImport = React.useCallback(
    async (file: PendingFile, decisions: ImportReviewDecision[]) => {
      setBusy(true);
      try {
        const res = await confirmCsvImportAction(
          file.text,
          file.closingBalance,
          decisions
        );
        onImported(res);
        report(res);
        setPhase({ kind: "idle" });
        setRejected(new Set());
      } catch {
        setNotice({ ok: false, text: msg("importFailedGeneric") });
      } finally {
        setBusy(false);
      }
    },
    // report only touches state setters, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onImported]
  );

  /** Kick off (or re-kick after the balance dialog) the Claude check. */
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
        if (!res.ok) {
          setPhase({ kind: "idle" });
          setNotice({ ok: false, text: res.error || msg("checkFailed") });
          return;
        }
        const file: PendingFile = { text, closingBalance };
        if (res.nothingNew) {
          // Nothing to review; the import itself reports "0 neue, N Duplikate".
          await doImport(file, []);
          return;
        }
        setJob(null);
        setPhase({ kind: "checking", file });
      } catch {
        setPhase({ kind: "idle" });
        setNotice({ ok: false, text: msg("checkNotStarted") });
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
      setNotice({ ok: false, text: msg("fileUnreadable") });
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** Abort the upload: nothing was imported, drop the server-side job. */
  const abort = React.useCallback(() => {
    void cancelCsvCheckAction();
    setPhase({ kind: "idle" });
    setJob(null);
    setRejected(new Set());
    setNotice({
      ok: false,
      text: msg("aborted"),
    });
  // msg and the formatters are re-created every render, but the language
  // switcher reloads the page, so a captured one can never be stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the check job while it runs; hand over to review/import when done.
  const checking = phase.kind === "checking";
  React.useEffect(() => {
    if (!checking || phase.kind !== "checking") return;
    let stopped = false;
    const file = phase.file;
    const poll = async () => {
      try {
        const st = await getCsvCheckStateAction();
        if (stopped) return;
        setJob(st);
        if (st.status === "done" || st.status === "error") {
          // Overlapping polls must not handle the terminal state twice
          // (a second "done" would import the file a second time).
          stopped = true;
        }
        if (st.status === "done") {
          const result = st.result;
          if (result && result.findings.length > 0) {
            setRejected(new Set());
            setPhase({ kind: "review", file, result });
          } else {
            // Nothing flagged — import straight away.
            setPhase({ kind: "idle" });
            await doImport(file, []);
            setNotice((previous) =>
              previous && previous.ok
                ? { ok: true, text: msg("noFindings", { text: previous.text }) }
                : previous
            );
          }
        } else if (st.status === "error") {
          setPhase({
            kind: "failed",
            file,
            error: st.error ?? msg("checkFailed"),
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
  // msg and the formatters are re-created every render, but the language
  // switcher reloads the page, so a captured one can never be stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, phase, doImport]);

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
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            notice.ok
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {notice.text}
        </p>
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
                Abbrechen
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

      {/* --------------------- Check failed: fall back ---------------------- */}
      {phase.kind === "failed" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) abort();
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{msg("checkFailedTitle")}</DialogTitle>
              <DialogDescription>
                {msg("checkFailedDescription", { error: phase.error })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={abort} disabled={busy}>
                {msg("abortUpload")}
              </Button>
              <Button
                onClick={() => void doImport(phase.file, [])}
                disabled={busy}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {msg("importAnyway")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* -------------------------- Review dialog --------------------------- */}
      {phase.kind === "review" && (
        <ReviewDialog
          result={phase.result}
          rejected={rejected}
          busy={busy}
          onSetRejected={setRejected}
          onImport={(decisions) => void doImport(phase.file, decisions)}
          onAbort={abort}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Review dialog                                                             */
/* -------------------------------------------------------------------------- */

function decisionsOf(
  findings: ImportCheckFinding[],
  rejected: ReadonlySet<string>
): ImportReviewDecision[] {
  return findings
    .filter((finding) => !rejected.has(finding.fingerprint))
    .map((finding) => ({
      fingerprint: finding.fingerprint,
      category: finding.suggestedCategory,
      oneOffId: finding.oneOff?.id ?? null,
    }));
}

function ReviewDialog({
  result,
  rejected,
  busy,
  onSetRejected,
  onImport,
  onAbort,
}: {
  result: ImportCheckResult;
  rejected: Set<string>;
  busy: boolean;
  onSetRejected: (next: Set<string>) => void;
  onImport: (decisions: ImportReviewDecision[]) => void;
  onAbort: () => void;
}) {
  const msg = useTranslations("csvUpload");
  const { formatDate, formatEuro } = useFormatters();
  const findings = result.findings;
  const acceptedCount = findings.length - rejected.size;
  const plainCount = result.newCount - findings.length;
  const hasOneOffMatches = findings.some((finding) => finding.oneOff !== null);

  const setRow = (fingerprint: string, accepted: boolean) => {
    const next = new Set(rejected);
    if (accepted) next.delete(fingerprint);
    else next.add(fingerprint);
    onSetRejected(next);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onAbort();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{msg("reviewTitle")}</DialogTitle>
          <DialogDescription>
            {msg("reviewDescription", {
              newCount: result.newCount,
              findings: findings.length,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => onImport(decisionsOf(findings, new Set()))}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {msg("acceptAllImport")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onAbort}
            disabled={busy}
          >
            <X className="h-4 w-4" />
            {msg("rejectAllAbort")}
          </Button>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{msg("colBooking")}</TableHead>
                <TableHead className="px-4">{msg("colCategory")}</TableHead>
                <TableHead className="px-4">{msg("colOneOff")}</TableHead>
                <TableHead className="w-24 px-4 text-right">{msg("colAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((finding) => {
                const accepted = !rejected.has(finding.fingerprint);
                return (
                  <TableRow key={finding.fingerprint}>
                    <TableCell className="px-4 align-top">
                      <div className="max-w-[220px] truncate font-medium">
                        {finding.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(finding.date)} ·{" "}
                        <span
                          className={cn(
                            "font-mono tabular-nums",
                            finding.amount >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {formatEuro(finding.amount)}
                        </span>
                      </div>
                      {finding.purpose && (
                        <div className="max-w-[220px] truncate text-xs text-muted-foreground">
                          {finding.purpose}
                        </div>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn("px-4 align-top", !accepted && "opacity-50")}
                    >
                      {finding.suggestedCategory ? (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <CategoryBadge categoryKey={finding.currentCategory} />
                            <span className="text-xs text-muted-foreground">
                              →
                            </span>
                            <CategoryBadge categoryKey={finding.suggestedCategory} />
                          </div>
                          {finding.categoryReason && (
                            <div className="max-w-[240px] text-xs text-muted-foreground">
                              {finding.categoryReason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn("px-4 align-top", !accepted && "opacity-50")}
                    >
                      {finding.oneOff ? (
                        <div className="space-y-0.5">
                          <div className="max-w-[200px] truncate text-sm font-medium">
                            {finding.oneOff.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Geplant {formatDate(finding.oneOff.date)} ·{" "}
                            <span className="font-mono tabular-nums">
                              {finding.oneOff.kind === "income" ? "+" : "−"}
                              {formatEuro(finding.oneOff.amount)}
                            </span>
                          </div>
                          {finding.oneOffReason && (
                            <div className="max-w-[220px] text-xs text-muted-foreground">
                              {finding.oneOffReason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 align-top">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-8 w-8",
                            accepted
                              ? "bg-success/15 text-success hover:bg-success/20 hover:text-success"
                              : "text-muted-foreground hover:text-success"
                          )}
                          onClick={() => setRow(finding.fingerprint, true)}
                          disabled={busy}
                          aria-label={msg("acceptAria", { name: finding.name })}
                          aria-pressed={accepted}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-8 w-8",
                            !accepted
                              ? "bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive"
                              : "text-muted-foreground hover:text-destructive"
                          )}
                          onClick={() => setRow(finding.fingerprint, false)}
                          disabled={busy}
                          aria-label={msg("rejectAria", { name: finding.name })}
                          aria-pressed={!accepted}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {plainCount > 0 && (
            <p>
              {msg("plainCount", { count: plainCount })}
            </p>
          )}
          {result.checked < result.newCount && (
            <p>
              {msg("checkedSubset", {
                checked: result.checked,
                total: result.newCount,
              })}
            </p>
          )}
          {hasOneOffMatches && (
            <p>
              {msg("oneOffNote")}
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="self-center text-xs text-muted-foreground">
            {msg("acceptedSummary", {
              accepted: acceptedCount,
              total: findings.length,
            })}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onAbort} disabled={busy}>
              Abbrechen
            </Button>
            <Button
              onClick={() => onImport(decisionsOf(findings, rejected))}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {msg("import")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
