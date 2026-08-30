"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

/**
 * Euro amount field with a € suffix; the value is reformatted to the active
 * locale ("3.850,66" in German, "3,850.66" in English) when the field loses
 * focus. The parent keeps the raw string state and parses it on submit -- with
 * the same locale-bound parser, or a German "3.850" reads back as 3.85.
 */
export function CurrencyInput({
  value,
  onChange,
  className,
  containerClassName,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  containerClassName?: string;
}) {
  const { formatAmountInput, parseAmountInput } = useFormatters();
  // "0,00" in German, "0.00" in English: a hint typed in the wrong notation
  // teaches the wrong notation.
  const placeholder = props.placeholder ?? formatAmountInput(0);

  function handleBlur() {
    const parsed = parseAmountInput(value);
    if (parsed !== null) onChange(formatAmountInput(parsed));
  }

  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        {...props}
        placeholder={placeholder}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        className={cn("pr-8 text-right font-mono tabular-nums", className)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        €
      </span>
    </div>
  );
}
