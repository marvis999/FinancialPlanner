"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CheckboxOption {
  key: string;
  label: string;
  checked: boolean;
  /** Optional color swatch (any CSS color, e.g. "var(--cat-wohnen)"). */
  color?: string;
}

/**
 * Small dropdown with checkboxes (multi-select). Closes on outside click
 * and Escape; selection is applied immediately via onToggle.
 */
export function CheckboxDropdown({
  label,
  options,
  onToggle,
  className,
}: {
  label: React.ReactNode;
  options: CheckboxOption[];
  onToggle: (key: string, checked: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 gap-1.5"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {label}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-72 w-60 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {options.map((o) => (
            <label
              key={o.key}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={o.checked}
                onChange={(event) => onToggle(o.key, event.target.checked)}
              />
              {o.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: o.color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
