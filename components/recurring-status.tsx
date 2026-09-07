"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Circle,
  CircleCheck,
  CircleDashed,
  Link2,
  Link2Off,
  MinusCircle,
  TriangleAlert,
} from "lucide-react";

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
  TableRow,
} from "@/components/ui/table";
import { dayDiff, type RecurringStatus } from "@/lib/recurring-match";
import type { RecurringItem, TransactionItem } from "@/lib/types";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

/**
 * Where a recurring item stands right now, under its name in the table:
 * booked on a day, due but nothing linked yet, skipped, or not started. The
 * open state is the one worth a glance - a rent that has not appeared a week
 * after its due date is a fact the forecast cannot tell from a lagging import.
 */

/** Days after the due date before "no booking yet" turns into a warning. */
const GRACE_DAYS = 3;

function isOverdue(status: RecurringStatus): boolean {
  return status.kind === "open" && status.daysOpen > GRACE_DAYS;
}

/**
 * The same state as one glyph, for the table's leading column: a filled check
 * is paid, a hollow circle is waiting, a triangle is late. Purely decorative -
 * `RecurringStatusLine` says the same thing in words in the very same row, so
 * announcing it twice would only make the row longer to listen to.
 */
export function RecurringStatusMarker({
  status,
}: {
  status: RecurringStatus | null;
}) {
  if (!status) return null;
  const icon = {
    settled: <CircleCheck className="h-4 w-4 text-success" />,
    skipped: <MinusCircle className="h-4 w-4 text-muted-foreground/60" />,
    upcoming: <CircleDashed className="h-4 w-4 text-muted-foreground/60" />,
    open: isOverdue(status) ? (
      <TriangleAlert className="h-4 w-4 text-destructive" />
    ) : (
      <Circle className="h-4 w-4 text-muted-foreground" />
    ),
  }[status.kind];
  return <span aria-hidden="true">{icon}</span>;
}

export function RecurringStatusLine({
  status,
  disabled,
  onAssign,
  onUnlink,
  onSkip,
}: {
  status: RecurringStatus | null;
  disabled: boolean;
  /** Open the picker for the due date in question. */
  onAssign: (due: string) => void;
  onUnlink: (transactionId: number) => void;
  onSkip: (due: string, skipped: boolean) => void;
}) {
  const msg = useTranslations("recurringStatus");
  const { formatDate, formatEuro } = useFormatters();
  if (!status) return null;

  const action = (label: string, onClick: () => void, icon?: React.ReactNode) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {label}
    </button>
  );

  switch (status.kind) {
    case "settled":
      return (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CircleCheck className="h-3.5 w-3.5 text-success" />
            {msg("settled", {
              date: formatDate(status.date),
              amount: formatEuro(Math.abs(status.amount)),
            })}
          </span>
          {action(msg("unlink"), () => onUnlink(status.transactionId), <Link2Off className="h-3 w-3" />)}
        </div>
      );
    case "skipped":
      return (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CircleDashed className="h-3.5 w-3.5" />
            {msg("skipped", { date: formatDate(status.due) })}
          </span>
          {action(msg("unskip"), () => onSkip(status.due, false))}
        </div>
      );
    case "open": {
      const overdue = isOverdue(status);
      return (
        <div
          className={cn(
            "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs",
            overdue ? "text-destructive" : "text-muted-foreground"
          )}
        >
          <span className="inline-flex items-center gap-1">
            {overdue ? (
              <TriangleAlert className="h-3.5 w-3.5" />
            ) : (
              <CircleDashed className="h-3.5 w-3.5" />
            )}
            {!status.recognizable
              ? msg("neverLinked", { date: formatDate(status.due) })
              : overdue
                ? msg("overdue", { date: formatDate(status.due), days: status.daysOpen })
                : msg("pending", { date: formatDate(status.due) })}
          </span>
          {action(msg("assign"), () => onAssign(status.due), <Link2 className="h-3 w-3" />)}
          {action(msg("skip"), () => onSkip(status.due, true))}
        </div>
      );
    }
    case "upcoming":
      return (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {msg("upcoming", { date: formatDate(status.due) })}
        </div>
      );
  }
}

/** Days either side of the due date the picker looks for candidates. */
const PICKER_WINDOW_DAYS = 15;

/**
 * Pick the booking that settles one due date: unlinked bookings with the
 * right sign near the date, closest amount first.
 */
export function AssignBookingDialog({
  item,
  due,
  transactions,
  disabled,
  onPick,
  onClose,
}: {
  item: RecurringItem;
  due: string;
  transactions: readonly TransactionItem[];
  disabled: boolean;
  onPick: (transactionId: number) => void;
  onClose: () => void;
}) {
  const msg = useTranslations("recurringStatus");
  const msgCommon = useTranslations("common");
  const { formatDate, formatEuro } = useFormatters();
  const candidates = React.useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            transaction.recurringId === null &&
            (item.kind === "income" ? transaction.amount > 0 : transaction.amount < 0) &&
            Math.abs(dayDiff(due, transaction.date)) <= PICKER_WINDOW_DAYS
        )
        .sort(
          (a, b) =>
            Math.abs(Math.abs(a.amount) - item.amount) -
              Math.abs(Math.abs(b.amount) - item.amount) ||
            Math.abs(dayDiff(due, a.date)) - Math.abs(dayDiff(due, b.date))
        )
        .slice(0, 20),
    [transactions, item, due]
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{msg("assignTitle", { name: item.name })}</DialogTitle>
          <DialogDescription>
            {msg("assignDescription", {
              date: formatDate(due),
              amount: formatEuro(item.amount),
            })}
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{msg("assignEmpty")}</p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <Table>
              <TableBody>
                {candidates.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="px-3 py-2">
                      <div className="max-w-[240px] truncate text-sm font-medium">
                        {transaction.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(transaction.date)}
                        {transaction.purpose && (
                          <span className="ml-1 truncate"> · {transaction.purpose}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm tabular-nums">
                      {formatEuro(transaction.amount)}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => onPick(transaction.id)}
                        disabled={disabled}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {msg("pick")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={disabled}>
            {msgCommon("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
