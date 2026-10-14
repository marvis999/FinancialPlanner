"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SlidersHorizontal, Upload } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const VIEWS = [
  "now",
  "plan-recurring",
  "plan-oneoff",
  "bookings",
  "ask",
  "settings",
] as const;
export type View = (typeof VIEWS)[number];

function isView(value: string | null): value is View {
  return (VIEWS as readonly (string | null)[]).includes(value);
}

/**
 * The open view, kept in `?view=` so a reload or the back button returns to
 * it. pushState instead of router.push: Next syncs useSearchParams with it,
 * and the page is not fetched from the server again, which would re-read the
 * database for a tab switch.
 */
export function useView(): [View, (next: View) => void] {
  const raw = useSearchParams().get("view");
  const view: View = isView(raw) ? raw : "now";
  const navigate = React.useCallback((next: View) => {
    window.history.pushState(null, "", next === "now" ? "?" : `?view=${next}`);
    window.scrollTo({ top: 0 });
  }, []);
  return [view, navigate];
}

/**
 * A link that switches views in place but still opens in a new tab on
 * middle-click. Forwards its ref and composes onClick so it can sit inside a
 * Radix `asChild` trigger.
 */
const ViewLink = React.forwardRef<
  HTMLAnchorElement,
  { to: View; onNavigate: (next: View) => void } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    "href"
  >
>(({ to, onNavigate, onClick, ...props }, ref) => (
  <a
    ref={ref}
    href={to === "now" ? "?" : `?view=${to}`}
    onClick={(event) => {
      onClick?.(event);
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      onNavigate(to);
    }}
    {...props}
  />
));
ViewLink.displayName = "ViewLink";

export function AppHeader({
  view,
  onNavigate,
  bookingsCount,
}: {
  view: View;
  onNavigate: (next: View) => void;
  bookingsCount: number;
}) {
  const msg = useTranslations("dashboard");
  const msgMeta = useTranslations("meta");

  const sections: { to: View; label: string; active: boolean; count?: number }[] = [
    { to: "now", label: msg("navNow"), active: view === "now" },
    { to: "plan-recurring", label: msg("navPlan"), active: view.startsWith("plan-") },
    {
      to: "bookings",
      label: msg("tabTransactions"),
      active: view === "bookings",
      count: bookingsCount,
    },
    { to: "ask", label: msg("navAsk"), active: view === "ask" },
  ];

  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 sm:px-6">
        <ViewLink
          to="now"
          onNavigate={onNavigate}
          className="font-display text-xl font-extrabold tracking-tight"
        >
          {msgMeta("title")}
        </ViewLink>
        <nav aria-label={msg("navLabel")} className="flex flex-wrap gap-6 self-stretch">
          {sections.map((section) => (
            <ViewLink
              key={section.to}
              to={section.to}
              onNavigate={onNavigate}
              aria-current={section.active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 border-b-[3px] border-transparent text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                section.active && "border-primary font-semibold text-foreground"
              )}
            >
              {section.label}
              {section.count ? (
                <span className="hidden rounded bg-muted-foreground/15 px-1.5 text-xs sm:inline">
                  {section.count}
                </span>
              ) : null}
            </ViewLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <ViewLink
                to="settings"
                onNavigate={onNavigate}
                aria-label={msg("navSettings")}
                aria-current={view === "settings" ? "page" : undefined}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  view === "settings" && "bg-accent text-primary"
                )}
              >
                <SlidersHorizontal className="h-5 w-5" />
              </ViewLink>
            </TooltipTrigger>
            <TooltipContent>{msg("navSettings")}</TooltipContent>
          </Tooltip>
          {/* The upload lives with the bookings until the import gets its own flow. */}
          <ViewLink
            to="bookings"
            onNavigate={onNavigate}
            className="flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors hover:bg-accent"
          >
            <Upload className="h-4 w-4" />
            {msg("navImport")}
          </ViewLink>
        </div>
      </div>
    </header>
  );
}

/** Second-level tabs inside Plan. */
export function PlanNav({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (next: View) => void;
}) {
  const msg = useTranslations("dashboard");
  const tabs: { to: View; label: string }[] = [
    { to: "plan-recurring", label: msg("tabRecurring") },
    { to: "plan-oneoff", label: msg("tabOneOff") },
  ];
  return (
    <nav
      aria-label={msg("navPlan")}
      className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1"
    >
      {tabs.map((tab) => (
        <ViewLink
          key={tab.to}
          to={tab.to}
          onNavigate={onNavigate}
          aria-current={view === tab.to ? "page" : undefined}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            view === tab.to && "bg-background font-semibold text-foreground shadow-sm dark:bg-accent"
          )}
        >
          {tab.label}
        </ViewLink>
      ))}
    </nav>
  );
}
