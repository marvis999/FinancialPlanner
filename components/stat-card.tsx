"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon,
  accent,
  note,
  noteTone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "income" | "expense";
  /** Small line under the value: as-of date, warning, unit. */
  note?: React.ReactNode;
  noteTone?: "muted" | "warning";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium">{label}</span>
          <span
            className={cn(
              accent === "income" && "text-success",
              accent === "expense" && "text-destructive"
            )}
          >
            {icon}
          </span>
        </div>
        <div
          className={cn(
            "text-xl font-semibold tabular-nums",
            accent === "income" && "text-success",
            accent === "expense" && "text-destructive"
          )}
        >
          {value}
        </div>
        {note && (
          <div
            className={cn(
              "text-[11px] leading-snug",
              noteTone === "warning"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            )}
          >
            {note}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
