"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Pencil, Repeat, Trash2 } from "lucide-react";

import { useIntervalShort } from "@/components/entry-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MerchantIcon } from "@/lib/merchant-icon";
import type { LoanPayoff } from "@/lib/projection";
import type { Kind } from "@/lib/types";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

export interface Row {
  id: number;
  name: string;
  kind: Kind;
  amount: number;
  date?: string;
  intervalMonths?: number;
  isContract?: boolean;
  remainingAmount?: number | null;
  /** Recurring rows: last contract day; nothing books after it. */
  endDate?: string | null;
  /** Recurring rows: paused items are dimmed and excluded from the forecast. */
  isActive?: boolean;
  /** One-off rows: linked debt (Sondertilgung). */
  debtId?: number | null;
  debtLabel?: string | null;
  /** Recurring rows: budget category, null = covered by no budget. */
  category?: string | null;
}

export function ItemTable({
  rows,
  onDelete,
  onEdit,
  onToggleActive,
  disabled,
  empty,
  showDate,
  showInterval,
  totals,
  totalsCell,
  payoffs,
}: {
  rows: Row[];
  onDelete: (row: Row) => void;
  onEdit: (row: Row) => void;
  onToggleActive?: (row: Row, active: boolean) => void;
  disabled: boolean;
  empty: string;
  showDate?: boolean;
  showInterval?: boolean;
  totals?: { income: number; expense: number };
  totalsCell?: React.ReactNode;
  payoffs?: Map<number, LoanPayoff>;
}) {
  const msg = useTranslations("dashboard");
  const msgCommon = useTranslations("common");
  const intervalShort = useIntervalShort();
  const { formatEuro, formatDate, formatMonthLabel } = useFormatters();
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }

  // Name + [date] + [interval] + type, so the total lands under the amount.
  const leadingCols = 2 + (showDate ? 1 : 0) + (showInterval ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4">{msgCommon("name")}</TableHead>
            {showDate && (
              <TableHead className="w-28 px-4">{msgCommon("date")}</TableHead>
            )}
            {showInterval && (
              <TableHead className="w-28 px-4">{msgCommon("interval")}</TableHead>
            )}
            <TableHead className="w-24 px-4">{msgCommon("kind")}</TableHead>
            <TableHead className="w-32 px-4 text-right">
              {msgCommon("amount")}
            </TableHead>
            <TableHead className="w-32 px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(row.isActive === false && "opacity-50")}
            >
              <TableCell className="px-4">
                <div className="flex items-center gap-2.5">
                  <MerchantIcon name={row.name} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.name}</div>
                    {row.isContract && (
                      <Badge
                        variant="secondary"
                        className="mt-0.5 gap-1 font-normal"
                      >
                        <Repeat className="h-3 w-3" />
                        {msgCommon("contract")}
                      </Badge>
                    )}
                    {row.debtLabel && (
                      <Badge
                        variant="outline"
                        className="mt-0.5 gap-1 whitespace-nowrap font-normal"
                      >
                        {msg("repays", { name: row.debtLabel })}
                      </Badge>
                    )}
                    {row.isActive === false && (
                      <Badge variant="secondary" className="mt-0.5 font-normal">
                        {msgCommon("paused")}
                      </Badge>
                    )}
                    {row.remainingAmount != null && row.remainingAmount > 0 && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {msg("remainingDebt")}{" "}
                        <span className="font-mono tabular-nums">
                          {formatEuro(row.remainingAmount)}
                        </span>
                        {payoffs?.get(row.id) && (
                          <>
                            {msg("payoffPrefix")}
                            <span className="font-medium text-foreground">
                              {formatMonthLabel(
                                payoffs.get(row.id)!.payoffDate.slice(0, 7)
                              )}
                            </span>
                            {msg("payoffSuffix")}
                          </>
                        )}
                      </div>
                    )}
                    {row.endDate && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {msg("endsOn")}
                        <span className="font-medium text-foreground">
                          {formatDate(row.endDate)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </TableCell>
              {showDate && (
                <TableCell className="whitespace-nowrap px-4 text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {row.date ? formatDate(row.date) : "—"}
                  </span>
                </TableCell>
              )}
              {showInterval && (
                <TableCell className="px-4">
                  <Badge variant="outline">
                    {intervalShort(row.intervalMonths ?? 1)}
                  </Badge>
                </TableCell>
              )}
              <TableCell className="px-4">
                <Badge
                  variant={row.kind === "income" ? "success" : "destructive"}
                >
                  {row.kind === "income" ? msgCommon("income") : msgCommon("expense")}
                </Badge>
              </TableCell>
              <TableCell
                className={cn(
                  "whitespace-nowrap px-4 text-right font-mono tabular-nums",
                  row.kind === "income" ? "text-success" : "text-destructive"
                )}
              >
                {row.kind === "income" ? "+" : "−"}
                {formatEuro(row.amount)}
              </TableCell>
              <TableCell className="px-4">
                <div className="flex items-center justify-end gap-1">
                  {onToggleActive && (
                    <Switch
                      checked={row.isActive !== false}
                      onCheckedChange={(checked) => onToggleActive(row, checked)}
                      disabled={disabled}
                      className="mr-1"
                      aria-label={
                        row.isActive !== false
                          ? msg("pauseAria", { name: row.name })
                          : msg("activateAria", { name: row.name })
                      }
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => onEdit(row)}
                    disabled={disabled}
                    aria-label={msg("editAria", { name: row.name })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(row)}
                    disabled={disabled}
                    aria-label={msg("deleteAria", { name: row.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {totals && (
          <tfoot className="border-t">
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={leadingCols}
                className="px-4 font-medium text-muted-foreground"
              >
                {msgCommon("perMonth")}
              </TableCell>
              <TableCell className="px-4 text-right font-mono font-semibold tabular-nums">
                {totalsCell ?? formatEuro(totals.income - totals.expense)}
              </TableCell>
              <TableCell className="px-4" />
            </TableRow>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
