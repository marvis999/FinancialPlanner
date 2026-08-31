"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Sparkles, X } from "lucide-react";

import {
  getAnalysisStateAction,
  resolveCategorySuggestionAction,
  startCategoryAnalysisAction,
} from "@/app/actions";
import { JobProgress } from "@/components/analysis-job";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryByKey } from "@/lib/categories";
import type { AnalysisState, CategorySuggestion } from "@/lib/types";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

function CategoryBadge({ categoryKey }: { categoryKey: string }) {
  const category = categoryByKey(categoryKey);
  const categoryLabel = useCategoryLabel();
  return (
    <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-normal">
      <span
        className="h-2 w-2 rounded-[3px]"
        style={{ backgroundColor: `var(${category.cssVar})` }}
      />
      {categoryLabel(categoryKey)}
    </Badge>
  );
}

/**
 * Claude's category suggestions, on the bookings tab: it is the bookings these
 * recategorise, and the table they land in is right below.
 *
 * Returns the pieces rather than one block, because they belong in two places:
 * `trigger` goes in the table toolbar beside the filters, and `panel` above the
 * table - but only once a run has something to show. Rendering the panel
 * unconditionally left an empty box under the heading.
 *
 * Polls the same server-side job registry the free analysis uses, so a run
 * survives a tab switch or a reload and is picked up again on mount.
 */
export function useCategorySuggestions({
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
}): { trigger: React.ReactNode; panel: React.ReactNode } {
  const msg = useTranslations("analysis");
  const { formatEuro } = useFormatters();
  const [state, setState] = React.useState<AnalysisState | null>(null);
  // Set when an accepted suggestion left some bookings alone (B14).
  const [skipNote, setSkipNote] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  const refresh = React.useCallback(async () => {
    try {
      setState(await getAnalysisStateAction());
    } catch {
      // transient (e.g. dev-server reload), the next poll will recover
    }
  }, []);

  // Initial snapshot on mount: picks up runs started before a tab switch.
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = state?.categories;
  const running = categories?.status === "running";

  // Poll while the run is going; tick the elapsed counter every second.
  React.useEffect(() => {
    if (!running) return;
    const poll = setInterval(() => void refresh(), 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [running, refresh]);

  const suggestions = categories?.suggestions ?? [];
  const openCount = suggestions.filter((suggestion) => !suggestion.accepted).length;

  async function startAnalysis() {
    setState(await startCategoryAnalysisAction());
  }

  async function accept(suggestion: CategorySuggestion) {
    const { applied, skipped } = await onApplyCategory(
      suggestion.ids,
      suggestion.currentCategory,
      suggestion.suggestedCategory
    );
    // A booking recategorised by hand since the group was built is left alone;
    // say so rather than reporting the suggestion as fully applied.
    setSkipNote(
      skipped > 0
        ? msg("appliedNote", { name: suggestion.name, applied, skipped })
        : null
    );
    setState(await resolveCategorySuggestionAction(suggestion.key, true));
  }

  async function reject(suggestion: CategorySuggestion) {
    setState(await resolveCategorySuggestionAction(suggestion.key, false));
  }

  const trigger = (
    <Button
      onClick={startAnalysis}
      disabled={running || disabled}
      title={msg("categoriesDescription")}
    >
      {running ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      {running
        ? msg("running")
        : categories?.status === "done"
          ? msg("restart")
          : msg("start")}
    </Button>
  );

  const panel =
    categories === undefined || categories.status === "idle" ? null : (
      <div className="space-y-3">
        {categories.status === "running" && (
          <JobProgress job={categories} now={now} />
        )}
        {categories.status === "error" && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {categories.error ?? msg("failed")}
          </p>
        )}
        {categories.status === "done" && suggestions.length === 0 && (
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
      </div>
    );

  return { trigger, panel };
}
