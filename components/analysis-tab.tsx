"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";

import {
  getAnalysisStateAction,
  startFreeAnalysisAction,
} from "@/app/actions";
import { JobProgress } from "@/components/analysis-job";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import type { AnalysisState } from "@/lib/types";

/**
 * The free analysis: ask Claude a question about the finances and read the
 * answer. Category suggestions used to live here too; they moved to the
 * bookings tab, next to the table they recategorise (see
 * components/category-suggestions.tsx). Both still run as the same kind of
 * server-side job, which is why both poll `getAnalysisStateAction`.
 */
export function AnalysisTab({ disabled }: { disabled: boolean }) {
  const msg = useTranslations("analysis");
  const [state, setState] = React.useState<AnalysisState | null>(null);
  const [question, setQuestion] = React.useState("");
  const [seededQuestion, setSeededQuestion] = React.useState(false);
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

  const free = state?.free;
  const freeRunning = free?.status === "running";

  // Poll while the run is going; tick the elapsed counter every second.
  React.useEffect(() => {
    if (!freeRunning) return;
    const poll = setInterval(() => void refresh(), 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [freeRunning, refresh]);

  // Show the question of a run that was started before a remount.
  React.useEffect(() => {
    if (!seededQuestion && state && state.free.question && !question) {
      setQuestion(state.free.question);
      setSeededQuestion(true);
    }
  }, [state, seededQuestion, question]);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setState(await startFreeAnalysisAction(question));
  }

  return (
    <section>
      <SectionHeading
        title={msg("freeTitle")}
        description={msg("freeDescription")}
      />
      <Card>
        <CardContent className="pt-6 space-y-3">
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
          {free && free.status === "running" && (
            <JobProgress job={free} now={now} />
          )}
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
    </section>
  );
}
