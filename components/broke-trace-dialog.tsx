"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DailyPoint } from "@/lib/projection";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

/**
 * Every booking the forecast makes, day by day, from the anchor to the first
 * negative balance — so the warning can be checked against reality instead of
 * believed. The running balance is accumulated per booking with the same cent
 * rounding the projection uses, so the last row of a day matches the chart.
 */
export function BrokeTraceDialog({
  forecast,
  brokeDate,
  anchorDate,
  startBalance,
  excludedCount,
  onClose,
}: {
  forecast: DailyPoint[];
  brokeDate: string;
  anchorDate: string;
  startBalance: number;
  excludedCount: number;
  onClose: () => void;
}) {
  const msg = useTranslations("dashboard");
  const msgCommon = useTranslations("common");
  const { formatEuro, formatDate } = useFormatters();
  const traceSourceLabel: Record<string, string> = {
    recurring: msg("traceSourceRecurring"),
    oneoff: msg("traceSourceOneOff"),
    budget: msg("traceSourceBudget"),
  };
  const rows: {
    date: string;
    firstOfDay: boolean;
    name: string;
    source: string;
    amount: number;
    running: number;
  }[] = [];
  let running = startBalance;
  for (const p of forecast) {
    if (p.date > brokeDate) break;
    p.events.forEach((event, i) => {
      running = Math.round((running + event.amount) * 100) / 100;
      rows.push({
        date: p.date,
        firstOfDay: i === 0,
        name: event.name,
        source: event.source,
        amount: event.amount,
        running,
      });
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{msg("traceTitle")}</DialogTitle>
          <DialogDescription>
            {msg("traceDescription", {
              anchor: formatDate(anchorDate),
              balance: formatEuro(startBalance),
              broke: formatDate(brokeDate),
            })}
            {excludedCount > 0 && (
              <>{msg("traceExcluded", { count: excludedCount })}</>
            )}
            {msg("traceFootnote")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{msgCommon("date")}</TableHead>
                <TableHead>{msg("traceColBooking")}</TableHead>
                <TableHead className="text-right">{msgCommon("amount")}</TableHead>
                <TableHead className="text-right">{msg("traceColBalanceAfter")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow
                  key={i}
                  className={cn(row.running < 0 && "bg-destructive/10")}
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.firstOfDay ? formatDate(row.date) : ""}
                  </TableCell>
                  <TableCell>
                    <span className="mr-2">{row.name}</span>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                      {traceSourceLabel[row.source] ?? row.source}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      row.amount >= 0 ? "text-success" : undefined
                    )}
                  >
                    {formatEuro(row.amount)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono font-medium tabular-nums",
                      row.running < 0 && "text-destructive"
                    )}
                  >
                    {formatEuro(row.running)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {msgCommon("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
