"use client";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/providers/locale-provider";
import { useFormat } from "@/lib/format/index";
// Side-effect import: registers the shared 'table' i18n namespace.
import "@/lib/i18n/table-messages";
import { cn } from "@/lib/utils";

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

function getPageNumbers(
  currentPage: number,
  totalPages: number
): (number | "...")[] {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, i) => i + 1);

  if (currentPage <= 4) return [1, 2, 3, 4, 5, "...", totalPages];
  if (currentPage >= totalPages - 3)
    return [
      1,
      "...",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  return [
    1,
    "...",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "...",
    totalPages,
  ];
}

export function DataTablePagination({
  page,
  pageSize,
  totalRows,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className,
}: DataTablePaginationProps) {
  const t = useT("table");
  const { formatNumber } = useFormat();

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const start = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalRows);

  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-2 py-3",
        className
      )}
      aria-label={t("pagination.label")}
    >
      <p className="text-sm text-muted-foreground shrink-0">
        {totalRows === 0
          ? t("pagination.noResults")
          : t("pagination.showing", {
              start: formatNumber(start),
              end: formatNumber(end),
              total: formatNumber(totalRows),
            })}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground shrink-0">
            {t("pagination.rowsPerPage")}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(val) => onPageSizeChange(Number(val))}
          >
            <SelectTrigger className="h-8 w-16" aria-label={t("pagination.rowsPerPage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {formatNumber(size)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <nav className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(1)}
            disabled={page === 1}
            aria-label={t("pagination.firstPage")}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label={t("pagination.previousPage")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="hidden sm:flex items-center gap-1">
            {pageNumbers.map((num, i) =>
              num === "..." ? (
                <span
                  key={`ellipsis-${i}`}
                  className="px-2 text-sm text-muted-foreground"
                >
                  &hellip;
                </span>
              ) : (
                <Button
                  key={num}
                  variant={num === page ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onPageChange(num as number)}
                  aria-label={t("pagination.goToPage", { page: formatNumber(num) })}
                  aria-current={num === page ? "page" : undefined}
                >
                  {formatNumber(num)}
                </Button>
              )
            )}
          </div>
          <span className="sm:hidden text-sm text-muted-foreground">
            {t("pagination.pageOf", {
              page: formatNumber(page),
              total: formatNumber(totalPages),
            })}
          </span>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            aria-label={t("pagination.nextPage")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(totalPages)}
            disabled={page === totalPages}
            aria-label={t("pagination.lastPage")}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </nav>
      </div>
    </div>
  );
}
