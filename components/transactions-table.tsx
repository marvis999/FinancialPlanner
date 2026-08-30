"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Tag as TagIcon,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxDropdown } from "@/components/ui/checkbox-dropdown";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ALL_CATEGORIES, categoryByKey, effectiveCategory } from "@/lib/categories";
import { MerchantIcon } from "@/lib/merchant-icon";
import type { TransactionItem } from "@/lib/types";
import { useCategoryLabel } from "@/lib/use-category-label";
import { useFormatters } from "@/lib/use-formatters";
import { cn } from "@/lib/utils";

// Progressive disclosure: drop lower-priority columns on narrow screens so the
// amount stays visible (purpose first, then the running balance on phones).
function colVisibility(id: string): string {
  if (id === "purpose") return "hidden xl:table-cell";
  if (id === "category") return "hidden lg:table-cell";
  if (id === "tags") return "hidden md:table-cell";
  if (id === "balance") return "hidden sm:table-cell";
  return "";
}

/** Columns the user can show/hide via the dropdown; names are translated. */
const TOGGLEABLE_COLUMNS = ["date", "purpose", "category", "tags", "balance"] as const;

/**
 * Amount filter on the absolute value. Accepts "44,98" (exact),
 * ">100", "<50", ">=…", "<=…" and ranges like "50-200".
 */
function matchesAmountQuery(
  query: string,
  amount: number,
  parseAmountInput: (raw: string) => number | null
): boolean {
  const needle = query.trim();
  if (!needle) return true;
  const abs = Math.abs(amount);
  const range = needle.match(/^([\d.,]+)\s*-\s*([\d.,]+)$/);
  if (range) {
    const a = parseAmountInput(range[1]);
    const b = parseAmountInput(range[2]);
    if (a === null || b === null) return true;
    return abs >= Math.min(a, b) && abs <= Math.max(a, b);
  }
  const op = needle.match(/^(>=|<=|>|<|=)?\s*([\d.,]+)$/);
  if (!op) return true; // unparseable input filters nothing
  const threshold = parseAmountInput(op[2]);
  if (threshold === null) return true;
  switch (op[1]) {
    case ">": return abs > threshold;
    case "<": return abs < threshold;
    case ">=": return abs >= threshold;
    case "<=": return abs <= threshold;
    default: return Math.abs(abs - threshold) < 0.005;
  }
}

function SortHeader({
  label,
  onClick,
  align = "left",
}: {
  label: string;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
        align === "right" && "flex-row-reverse"
      )}
    >
      {label}
      <ArrowUpDown className="h-3.5 w-3.5" />
    </button>
  );
}

type TxRow = Omit<TransactionItem, "category"> & { category: string };

export function TransactionsTable({
  transactions,
  onAssignCategory,
  onAddTag,
  onRemoveTag,
}: {
  transactions: TransactionItem[];
  onAssignCategory?: (ids: number[], category: string | null) => void;
  onAddTag?: (ids: number[], tag: string) => void;
  onRemoveTag?: (ids: number[], tag: string) => void;
}) {
  const msg = useTranslations("transactions");
  const categoryLabel = useCategoryLabel();
  const { formatDate, formatEuro, parseAmountInput } = useFormatters();
  const columnLabel: Record<string, string> = {
    date: msg("colDate"),
    purpose: msg("colPurpose"),
    category: msg("colCategory"),
    tags: msg("colTags"),
    balance: msg("colBalance"),
  };
  const [query, setQuery] = React.useState("");
  const [amountQuery, setAmountQuery] = React.useState("");
  const [kindFilter, setKindFilter] = React.useState<"all" | "in" | "out">(
    "all"
  );
  const [tagFilter, setTagFilter] = React.useState<Set<string>>(
    () => new Set()
  );
  const [tagInput, setTagInput] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "date", desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());

  // Manual assignment wins over keyword matching.
  const categorized = React.useMemo(
    () => transactions.map((transaction) => ({
        ...transaction,
        category: effectiveCategory(transaction),
      })),
    [transactions]
  );

  // Every tag currently in use, for the filter dropdown and suggestions.
  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const transaction of transactions) for (const tag of transaction.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [transactions]);

  // Drop filter entries whose tag no longer exists on any booking.
  React.useEffect(() => {
    setTagFilter((prev) => {
      const next = new Set([...prev].filter((tag) => allTags.includes(tag)));
      return next.size === prev.size ? prev : next;
    });
  }, [allTags]);

  // A changed filter changes what "select all" means; start selections fresh.
  React.useEffect(() => {
    setSelected(new Set());
  }, [query, amountQuery, kindFilter, tagFilter]);

  const toggleRows = React.useCallback((ids: number[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return categorized.filter((transaction) => {
      if (kindFilter === "in" && transaction.amount < 0) return false;
      if (kindFilter === "out" && transaction.amount >= 0) return false;
      if (!matchesAmountQuery(amountQuery, transaction.amount, parseAmountInput)) return false;
      if (tagFilter.size > 0 && !transaction.tags.some((tag) => tagFilter.has(tag)))
        return false;
      if (!needle) return true;
      return (
        transaction.name.toLowerCase().includes(needle) ||
        transaction.purpose.toLowerCase().includes(needle) ||
        transaction.type.toLowerCase().includes(needle) ||
        transaction.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
        categoryLabel(effectiveCategory(transaction)).toLowerCase().includes(needle)
      );
    });
  }, [categorized, query, amountQuery, kindFilter, tagFilter, parseAmountInput, categoryLabel]);

  // Union of tags on the selected rows, offered for bulk removal.
  const selectedTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const transaction of categorized) {
      if (selected.has(transaction.id)) for (const tag of transaction.tags) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [categorized, selected]);

  const columns = React.useMemo<ColumnDef<TxRow>[]>(
    () => [
      ...(onAssignCategory
        ? ([
            {
              id: "select",
              header: ({ table }) => {
                const pageIds = table
                  .getRowModel()
                  .rows.map((row) => row.original.id);
                const allChecked =
                  pageIds.length > 0 && pageIds.every((id) => selected.has(id));
                return (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={allChecked}
                    onChange={(event) => toggleRows(pageIds, event.target.checked)}
                    aria-label={msg("selectAllAria")}
                  />
                );
              },
              cell: ({ row }) => (
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={selected.has(row.original.id)}
                  onChange={(event) =>
                    toggleRows([row.original.id], event.target.checked)
                  }
                  aria-label={msg("selectRowAria")}
                />
              ),
            },
          ] satisfies ColumnDef<TxRow>[])
        : []),
      {
        accessorKey: "date",
        header: ({ column }) => (
          <SortHeader
            label={msg("colDate")}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatDate(row.original.date)}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: () => <span className="text-xs">{msg("colCounterparty")}</span>,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <MerchantIcon
              name={row.original.name}
              type={row.original.type}
              purpose={row.original.purpose}
            />
            {/* The cap keeps a long counterparty string from stretching the
                column until the category and amount fall out of the viewport. */}
            <div className="min-w-0 max-w-[220px]">
              <div className="truncate font-medium" title={row.original.name}>
                {row.original.name}
              </div>
              <Badge variant="secondary" className="mt-0.5 font-normal">
                {row.original.type}
              </Badge>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "purpose",
        header: () => <span className="text-xs">{msg("colPurpose")}</span>,
        cell: ({ row }) => (
          <span
            className="line-clamp-2 max-w-[220px] text-muted-foreground"
            title={row.original.purpose}
          >
            {row.original.purpose}
          </span>
        ),
      },
      {
        accessorKey: "category",
        header: () => <span className="text-xs">{msg("colCategory")}</span>,
        cell: ({ row }) => {
          const cat = categoryByKey(row.original.category);
          return (
            <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-normal">
              <span
                className="h-2 w-2 rounded-[3px]"
                style={{ backgroundColor: `var(${cat.cssVar})` }}
              />
              {categoryLabel(row.original.category)}
            </Badge>
          );
        },
      },
      {
        accessorKey: "tags",
        enableSorting: false,
        header: () => <span className="text-xs">{msg("colTags")}</span>,
        cell: ({ row }) =>
          row.original.tags.length > 0 ? (
            <div className="flex max-w-[180px] flex-wrap gap-1">
              {row.original.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="gap-1 whitespace-nowrap font-normal"
                >
                  <TagIcon className="h-3 w-3 text-muted-foreground" />
                  {tag}
                  {onRemoveTag && (
                    <button
                      type="button"
                      onClick={() => onRemoveTag([row.original.id], tag)}
                      className="-mr-0.5 rounded-sm text-muted-foreground transition-colors hover:text-destructive"
                      aria-label={msg("removeTagAria", { tag })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          ) : null,
      },
      {
        accessorKey: "amount",
        header: ({ column }) => (
          <div className="text-right">
            <SortHeader
              label={msg("colAmount")}
              align="right"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
          </div>
        ),
        cell: ({ row }) => (
          <div
            className={cn(
              "whitespace-nowrap text-right font-mono tabular-nums",
              row.original.amount >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {row.original.amount >= 0 ? "+" : "−"}
            {formatEuro(Math.abs(row.original.amount))}
          </div>
        ),
      },
      {
        accessorKey: "balance",
        header: ({ column }) => (
          <div className="text-right">
            <SortHeader
              label={msg("colBalance")}
              align="right"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            />
          </div>
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-right font-mono tabular-nums text-muted-foreground">
            {formatEuro(row.original.balance)}
          </span>
        ),
      },
    ],
    [onAssignCategory, onRemoveTag, selected, toggleRows, msg, categoryLabel, formatDate, formatEuro]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={msg("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8"
            />
          </div>
          <Input
            placeholder={msg("amountPlaceholder")}
            value={amountQuery}
            onChange={(event) => setAmountQuery(event.target.value)}
            className="h-9 w-full font-mono text-xs sm:w-44"
            inputMode="decimal"
          />
          <Select
            value={kindFilter}
            onValueChange={(threshold) => setKindFilter(threshold as "all" | "in" | "out")}
          >
            <SelectTrigger className="h-9 w-full sm:w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{msg("all")}</SelectItem>
              <SelectItem value="in">{msg("incoming")}</SelectItem>
              <SelectItem value="out">{msg("outgoing")}</SelectItem>
            </SelectContent>
          </Select>
          {allTags.length > 0 && (
            <CheckboxDropdown
              label={
                <span className="flex items-center gap-1.5">
                  <TagIcon className="h-3.5 w-3.5" />
                  {tagFilter.size > 0
                    ? msg("tagsWithCount", { count: tagFilter.size })
                    : msg("tags")}
                </span>
              }
              options={allTags.map((tag) => ({
                key: tag,
                label: tag,
                checked: tagFilter.has(tag),
              }))}
              onToggle={(key, checked) =>
                setTagFilter((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <CheckboxDropdown
            label={msg("columns")}
            options={TOGGLEABLE_COLUMNS.map((key) => ({
              key,
              label: columnLabel[key],
              checked: table.getColumn(key)?.getIsVisible() ?? true,
            }))}
            onToggle={(key, checked) =>
              table.getColumn(key)?.toggleVisibility(checked)
            }
          />
          <p className="whitespace-nowrap text-sm text-muted-foreground">
            {msg("count", { count: filtered.length })}
          </p>
        </div>
      </div>

      {(onAssignCategory || onAddTag) && selected.size > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center">
          <span className="text-sm font-medium">
            {msg("selectedCount", { count: selected.size })}
          </span>
          {onAssignCategory && (
            <Select
              value=""
              onValueChange={(threshold) => {
                onAssignCategory(
                  [...selected],
                  threshold === "__auto" ? null : threshold
                );
                setSelected(new Set());
              }}
            >
              <SelectTrigger className="h-8 sm:w-56">
                <SelectValue placeholder={msg("assignCategory")} />
              </SelectTrigger>
              <SelectContent>
                {ALL_CATEGORIES.map((category) => (
                  <SelectItem key={category.key} value={category.key}>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-[3px]"
                        style={{ backgroundColor: `var(${category.cssVar})` }}
                      />
                      {categoryLabel(category.key)}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value="__auto">{msg("autoDetect")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          {onAddTag && (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const tag = tagInput.trim();
                if (!tag) return;
                onAddTag([...selected], tag);
                setTagInput("");
              }}
            >
              <Input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                placeholder={msg("tagPlaceholder")}
                maxLength={30}
                list="tag-suggestions"
                className="h-8 w-full sm:w-40"
              />
              <datalist id="tag-suggestions">
                {allTags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0"
                disabled={!tagInput.trim()}
              >
                <TagIcon className="h-3.5 w-3.5" />
                {msg("tagSubmit")}
              </Button>
            </form>
          )}
          {onRemoveTag && selectedTags.length > 0 && (
            <Select
              value=""
              onValueChange={(threshold) => onRemoveTag([...selected], threshold)}
            >
              <SelectTrigger className="h-8 sm:w-48">
                <SelectValue placeholder={msg("removeTag")} />
              </SelectTrigger>
              <SelectContent>
                {selectedTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setSelected(new Set())}
          >
            {msg("clearSelection")}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn("h-11 px-3", colVisibility(header.column.id))}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn("px-3 py-2.5", colVisibility(cell.column.id))}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {msg("noResults")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{msg("perPage")}</span>
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(threshold) => table.setPageSize(Number(threshold))}
          >
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((pageSize) => (
                <SelectItem key={pageSize} value={String(pageSize)}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {msg("pageOf", {
              page: pageCount === 0 ? 0 : pageIndex + 1,
              total: pageCount,
            })}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label={msg("prevPage")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label={msg("nextPage")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
