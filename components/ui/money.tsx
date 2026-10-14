"use client";

import { useFormatters } from "@/lib/use-formatters";
import { cn, euroParts } from "@/lib/utils";

/**
 * A EUR amount with a smaller, raised currency sign, for headline figures.
 * Lists and tables keep plain formatEuro text.
 */
export function Money({ value, className }: { value: number; className?: string }) {
  const { locale } = useFormatters();
  const segments = euroParts(value, locale);
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {segments.map((segment, index) =>
        segment.currency ? (
          <span
            key={index}
            className={cn(
              "align-[0.55em] text-[0.55em] font-medium opacity-75",
              index < segments.length - 1 ? "mr-[0.08em]" : "ml-[0.15em]"
            )}
          >
            {segment.text}
          </span>
        ) : (
          segment.text
        )
      )}
    </span>
  );
}
