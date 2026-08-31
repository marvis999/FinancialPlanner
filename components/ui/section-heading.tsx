"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

/**
 * The heading for a section, rendered ABOVE its card rather than inside it.
 * The card holds the content; the heading names it and sits on the page
 * background, flush left with the card's edge.
 *
 * A real `<h2>`, unlike the `<div>` CardTitle renders: these are the page's
 * section headings, so a screen reader should be able to navigate by them.
 *
 * The description lives behind the (i) rather than under the title: it is
 * reference text - which period a budget covers, what the chart is plotting -
 * that is worth having once and in the way every time after. The hover card
 * opens on focus as well as hover, so it is reachable from the keyboard.
 *
 * `aside` takes the one piece of summary that belongs on the heading line -
 * an ending balance, a search box. It sits right of the title on wide screens
 * and wraps underneath on narrow ones.
 */
export function SectionHeading({
  title,
  description,
  aside,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  const msg = useTranslations("common");
  return (
    <div
      className={cn(
        // sm:min-h-9 matches the default button height: an `aside` holding a
        // button would otherwise make the row taller than one without, and the
        // gap between heading and card would differ from section to section.
        "mb-3 flex flex-col gap-2 sm:min-h-9 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold leading-none tracking-tight">
          {title}
        </h2>
        {description === undefined ? null : (
          <HoverCard openDelay={80}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                aria-label={msg("moreInfo")}
                className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Info className="h-4 w-4" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              align="start"
              className="text-sm font-normal text-muted-foreground"
            >
              {description}
            </HoverCardContent>
          </HoverCard>
        )}
      </div>
      {aside}
    </div>
  );
}
