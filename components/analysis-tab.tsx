"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, CircleCheck, Loader2, Sparkles, X } from "lucide-react";

import {
  getAnalysisStateAction,
  resolveCategorySuggestionAction,
  startCategoryAnalysisAction,
  startFreeAnalysisAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryByKey } from "@/lib/categories";
import type { AnalysisJobInfo, AnalysisState, CategorySuggestion } from "@/lib/types";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

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

function useFormatElapsed(): (ms: number) => string {
  const msg = useTranslations("analysis");
  return React.useCallback(
    (ms: number) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return msg("elapsed", {
        minutes: Math.floor(s / 60),
        seconds: String(s % 60).padStart(2, "0"),
      });
    },
    [msg]
  );
}

/**
 * Live progress panel for a running job: every completed step gets a check
 * mark, the current step a spinner, plus an elapsed-time counter.
 */
function JobProgress({ job, now }: { job: AnalysisJobInfo; now: number }) {
  const msg = useTranslations("analysis");
  const formatElapsed = useFormatElapsed();
  return (
    <div className="rounded-lg border border-dashed px-4 py-3">
      <ul className="space-y-1.5">
        {job.log.map((line, i) => {
          const isCurrent = i === job.log.length - 1 && job.status === "running";
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
      {job.status === "running" && job.startedAt !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          {msg("runningSince", { elapsed: formatElapsed(now - job.startedAt) })}
        </p>
      )}
    </div>
  );
}

export function AnalysisTab({
  onApplyCategory,
  disabled,
}: {
  /** Applies a manual category to the given bookings (server + state). */
  onApplyCategory: (
    ids: number[],
    expectedCategory: string,
    category: string
  ) => Promise<{ applied: number; skipped: number }>;
  disabled: boolean;
}) {
  const [state, setState] = React.useState<AnalysisState | null>(null);
  const [question, setQuestion] = React.useState("");
  // Set when an accepted suggestion left some bookings alone (B14).
  const msg = useTranslations("analysis");
  const { formatEuro } = useFormatters();
  const [skipNote, setSkipNote] = React.useState<string | null>(null);
  const [seededQuestion, setSeededQuestion] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  const refresh = React.useCallback(async () => {
    try {
      setState(await getAnalysisStateAction());
    } catch {
      // transient (e.g. dev-server reload) — next poll will recover
    }
  }, []);

  // Initial snapshot on mount: picks up runs started before a tab switch.
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const running =
    state?.categories.status === "running" || state?.free.status === "running";

  // Poll while something is running; tick the elapsed counter every second.
  React.useEffect(() => {
    if (!running) return;
    const poll = setInterval(() => void refresh(), 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [running, refresh]);

  // Show the question of a run that was started before a remount.
  React.useEffect(() => {
    if (!seededQuestion && state && state.free.question && !question) {
      setQuestion(state.free.question);
      setSeededQuestion(true);
    }
  }, [state, seededQuestion, question]);

  const categories = state?.categories;
  const free = state?.free;
  const suggestions = categories?.suggestions ?? [];
  const openCount = suggestions.filter((suggestion) => !suggestion.accepted)
    .length;

  async function startAnalysis() {
    setState(await startCategoryAnalysisAction());
  }

  async function accept(s: CategorySuggestion) {
    const { applied, skipped } = await onApplyCategory(
      s.ids,
      s.currentCategory,
      s.suggestedCategory
    );
    // A booking recategorised by hand since the group was built is left alone;
    // say so rather than reporting the suggestion as fully applied.
    setSkipNote(
      skipped > 0
        ? msg("appliedNote", { name: s.name, applied, skipped })
        : null
    );
    setState(await resolveCategorySuggestionAction(s.key, true));
  }

  async function reject(s: CategorySuggestion) {
    setState(await resolveCategorySuggestionAction(s.key, false));
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setState(await startFreeAnalysisAction(question));
  }

  const catRunning = categories?.status === "running";
  const freeRunning = free?.status === "running";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div>
            <CardTitle>{msg("categoriesTitle")}</CardTitle>
            <CardDescription>
              {msg("categoriesDescription")}
            </CardDescription>
          </div>
          <Button onClick={startAnalysis} disabled={catRunning || disabled}>
            {catRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {catRunning
              ? msg("running")
              : categories?.status === "done"
                ? msg("restart")
                : msg("start")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories && categories.status === "running" && (
            <JobProgress job={categories} now={now} />
          )}
          {categories?.status === "error" && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {categories.error ?? msg("failed")}
            </p>
          )}
          {categories?.status === "done" && suggestions.length === 0 && (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {msg("noSuggestions")}
            </p>
          )}
          {suggestions.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4">{msg("colMerchant")}</TableHead>
                      <TableHead className="px-4">{msg("colCurrent")}</TableHead>
                      <TableHead className="px-4">{msg("colSuggestion")}</TableHead>
                      <TableHead className="hidden px-4 lg:table-cell">
                        {msg("colReason")}
                      </TableHead>
                      <TableHead className="w-24 px-4 text-right">
                        {msg("colAction")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggestions.map((suggestion) => (
                      <TableRow
                        key={suggestion.key}
                        className={cn(suggestion.accepted && "opacity-60")}
                      >
                        <TableCell className="px-4">
                          <div className="max-w-[240px] truncate font-medium">
                            {suggestion.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {msg("bookings", { count: suggestion.count })} ·{" "}
                            <span className="font-mono tabular-nums">
                              {formatEuro(suggestion.total)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <CategoryBadge categoryKey={suggestion.currentCategory} />
                        </TableCell>
                        <TableCell className="px-4">
                          <CategoryBadge categoryKey={suggestion.suggestedCategory} />
                          <div className="mt-0.5 text-xs text-muted-foreground lg:hidden">
                            {suggestion.reason}
                          </div>
                        </TableCell>
                        <TableCell className="hidden max-w-xs px-4 text-xs text-muted-foreground lg:table-cell">
                          {suggestion.reason}
                        </TableCell>
                        <TableCell className="px-4">
                          {suggestion.accepted ? (
                            <span className="flex items-center justify-end gap-1 text-xs font-medium text-success">
                              <Check className="h-3.5 w-3.5" />
                              {msg("accepted")}
                            </span>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-success hover:bg-success/10 hover:text-success"
                                onClick={() => void accept(suggestion)}
                                disabled={disabled}
                                aria-label={msg("acceptAria", { name: suggestion.name })}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => void reject(suggestion)}
                                disabled={disabled}
                                aria-label={msg("rejectAria", { name: suggestion.name })}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {skipNote && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {skipNote}
                </p>
              )}
              {openCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {msg("openCount", { count: openCount })}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{msg("freeTitle")}</CardTitle>
          <CardDescription>
            {msg("freeDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={msg("questionPlaceholder")}
              rows={2}
              className="flex-1 resize-y rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              className="sm:self-end"
              disabled={freeRunning || disabled || !question.trim()}
            >
              {freeRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {msg("ask")}
            </Button>
          </form>
          {free && free.status === "running" && <JobProgress job={free} now={now} />}
          {free?.status === "error" && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {free.error ?? msg("requestFailed")}
            </p>
          )}
          {free?.status === "done" && free.answer && (
            <div className="space-y-1.5">
              {free.question && (
                <p className="text-xs text-muted-foreground">
                  {msg("questionLabel", { question: free.question })}
                </p>
              )}
              <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
                {free.answer}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
