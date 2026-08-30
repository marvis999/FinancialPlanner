"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Database, FlaskConical, Loader2, RotateCcw } from "lucide-react";

import { resetDemoDataAction, switchDataSourceAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { DATA_SOURCE_IDS, type DataSource } from "@/lib/data-source";
import { cn } from "@/lib/utils";

/**
 * Bottom-left switch between the real ledger and the generated demo.
 *
 * Switching changes which SQLite file the server reads, so the page is
 * reloaded rather than patched: every card, chart and tab on it was rendered
 * from the dataset being left behind.
 */
export function SourceSwitcher({ source }: { source: DataSource }) {
  const msg = useTranslations("dataSource");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<DataSource | "reset" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const root = React.useRef<HTMLDivElement>(null);

  const isDemo = source === "demo";
  // Written out rather than looked up by key, so a source added without a
  // translation is a compile error instead of a raw key on screen.
  const label = (id: DataSource) => (id === "demo" ? msg("demoLabel") : msg("realLabel"));
  const description = (id: DataSource) =>
    id === "demo" ? msg("demoDescription") : msg("realDescription");

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function run(key: DataSource | "reset", work: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await work();
      // Full reload, not router.refresh(): the dashboard seeds its React state
      // from the server props once, on mount, so a refresh would leave the old
      // dataset on screen.
      window.location.reload();
    } catch (event) {
      setBusy(null);
      setError(event instanceof Error ? event.message : msg("error"));
    }
  }

  return (
    <div ref={root} className="fixed bottom-4 left-4 z-50 print:hidden">
      {open && (
        <div
          role="menu"
          aria-label={msg("label")}
          className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
            {msg("label")}
          </p>

          {DATA_SOURCE_IDS.map((id) => {
            const selected = id === source;
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={busy !== null}
                onClick={() =>
                  selected
                    ? setOpen(false)
                    : run(id, () => switchDataSourceAction(id))
                }
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "disabled:pointer-events-none disabled:opacity-60",
                  selected && "bg-accent/60"
                )}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {busy === id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : selected ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label(id)}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    {description(id)}
                  </span>
                </span>
              </button>
            );
          })}

          {isDemo && (
            <div className="mt-1 border-t pt-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
                disabled={busy !== null}
                onClick={() => run("reset", () => resetDemoDataAction())}
              >
                {busy === "reset" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                {msg("reset")}
              </Button>
            </div>
          )}

          {error && (
            <p className="px-2 pb-1 pt-1.5 text-xs text-destructive">{error}</p>
          )}
        </div>
      )}

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
        title={msg("current", { source: label(source) })}
        className={cn(
          "flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-3.5 text-xs font-medium shadow-sm backdrop-blur transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          isDemo
            ? "border-amber-500/40 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-200"
            : "bg-card/90 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        {isDemo ? (
          <FlaskConical className="h-3.5 w-3.5" />
        ) : (
          <Database className="h-3.5 w-3.5" />
        )}
        {label(source)}
      </button>
    </div>
  );
}
