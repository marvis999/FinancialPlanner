"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, Loader2 } from "lucide-react";

import type { AnalysisJobInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Shared by both Claude-backed analyses: the category suggestions on the
 * bookings tab and the free analysis on its own tab. They run as the same kind
 * of server-side job, so they report progress the same way.
 */

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
export function JobProgress({
  job,
  now,
}: {
  job: AnalysisJobInfo;
  now: number;
}) {
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
