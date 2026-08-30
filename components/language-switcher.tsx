"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Languages, Loader2 } from "lucide-react";

import { switchLocaleAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/locale";
import { useAppLocale } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

/**
 * Interface language, next to the theme toggle: both change how the page
 * reads rather than what it says, and both take effect immediately.
 *
 * Switching reloads for the same reason the data source does - the messages
 * and every formatted number on screen came from the previous locale.
 */
export function LanguageSwitcher() {
  const msg = useTranslations("language");
  const active = useAppLocale();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<Locale | null>(null);
  const root = React.useRef<HTMLDivElement>(null);

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

  async function choose(next: Locale) {
    if (next === active) {
      setOpen(false);
      return;
    }
    setBusy(next);
    try {
      await switchLocaleAction(next);
      window.location.reload();
    } catch {
      setBusy(null);
    }
  }

  return (
    <div ref={root} className="relative">
      <Button
        variant="outline"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-label={msg("switch")}
        title={msg("label")}
      >
        <Languages className="h-4 w-4" />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label={msg("label")}
          className="absolute right-0 z-50 mt-2 w-44 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          {LOCALES.map((locale) => {
            const selected = locale === active;
            return (
              <button
                key={locale}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={busy !== null}
                onClick={() => choose(locale)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "disabled:pointer-events-none disabled:opacity-60",
                  selected && "bg-accent/60"
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {busy === locale ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : selected ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                </span>
                {LOCALE_LABELS[locale]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
