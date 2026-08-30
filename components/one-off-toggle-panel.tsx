"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import type { OneOffItem } from "@/lib/types";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

/**
 * Collapsible list under the chart: include or exclude individual one-off
 * items from the forecast ("where do I land without the car sale?").
 * View-only state — the items themselves stay untouched.
 */
export function OneOffTogglePanel({
  items,
  excluded,
  onToggle,
}: {
  items: OneOffItem[];
  excluded: ReadonlySet<number>;
  onToggle: (id: number, included: boolean) => void;
}) {
  const msg = useTranslations("dashboard");
  const { formatEuro, formatDate } = useFormatters();
  const [open, setOpen] = React.useState(false);
  if (items.length === 0) return null;

  const includedCount = items.filter((item) => !excluded.has(item.id)).length;

  return (
    <div className="mt-3 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm"
      >
        <span className="font-medium">{msg("oneOffPanelTitle")}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {msg("oneOffPanelCount", {
            included: includedCount,
            total: items.length,
          })}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open && (
        <div className="border-t px-3 pb-2">
          {items.map((item) => {
            const included = !excluded.has(item.id);
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <div
                    className={cn(
                      "truncate text-sm font-medium",
                      !included && "text-muted-foreground line-through"
                    )}
                  >
                    {item.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(item.date)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      !included
                        ? "text-muted-foreground"
                        : item.kind === "income"
                          ? "text-success"
                          : "text-destructive"
                    )}
                  >
                    {item.kind === "income" ? "+" : "−"}
                    {formatEuro(item.amount)}
                  </span>
                  <Switch
                    checked={included}
                    onCheckedChange={(checked) => onToggle(item.id, checked)}
                    aria-label={msg("oneOffIncludeAria", { name: item.name })}
                  />
                </div>
              </div>
            );
          })}
          <p className="pt-2 text-[11px] leading-snug text-muted-foreground">
            {msg("oneOffPanelNote")}
          </p>
        </div>
      )}
    </div>
  );
}
