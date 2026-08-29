"use client";

/**
 * "Select all N matching" banner for the shared DataTable (item #8).
 *
 * Shown between the toolbar and the table when the select-all-matching
 * affordance is enabled:
 *
 *   - page mode + every row on the current page checked + more rows matching
 *     the filters than are selected → offers extending the selection to ALL
 *     matching rows (N = the server total).
 *   - all-matching mode → announces the extended selection (minus any rows the
 *     user unchecked afterwards) and offers clearing it.
 *
 * Labels are bilingual (en/ar) by default, resolved via the locale provider
 * like SavedViewsBar; callers can override any of them. Counts are formatted
 * through the shared formatter (Arabic-Indic digits under `ar`).
 */

import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { useFormat } from "@/lib/format/index";
import { cn } from "@/lib/utils";
import { countScopeSelected, type SelectionScope } from "./selection-scope";

export interface SelectAllMatchingLabels {
  /** Page fully selected — `count` is the number of rows on this page. */
  pageSelected?: (count: string) => string;
  /** Button extending the selection — `total` is the server total. */
  selectAllMatching?: (total: string) => string;
  /** All-matching scope with no exclusions. */
  allMatchingSelected?: (total: string) => string;
  /** All-matching scope minus unchecked rows. */
  partialMatchingSelected?: (selected: string, total: string) => string;
  clearSelection?: string;
}

const LABELS: Record<"en" | "ar", Required<SelectAllMatchingLabels>> = {
  en: {
    pageSelected: (count) => `All ${count} rows on this page are selected.`,
    selectAllMatching: (total) => `Select all ${total} matching`,
    allMatchingSelected: (total) => `All ${total} matching rows are selected.`,
    partialMatchingSelected: (selected, total) =>
      `${selected} of ${total} matching rows are selected.`,
    clearSelection: "Clear selection",
  },
  ar: {
    pageSelected: (count) => `تم تحديد جميع صفوف هذه الصفحة (${count}).`,
    selectAllMatching: (total) => `تحديد كل النتائج المطابقة (${total})`,
    allMatchingSelected: (total) =>
      `تم تحديد جميع الصفوف المطابقة (${total}).`,
    partialMatchingSelected: (selected, total) =>
      `تم تحديد ${selected} من أصل ${total} من الصفوف المطابقة.`,
    clearSelection: "مسح التحديد",
  },
};

export interface DataTableSelectAllBannerProps {
  scope: SelectionScope;
  /** Server-side total of rows matching the current filters. */
  totalRows: number;
  /** Number of rows rendered on the current page. */
  pageRowCount: number;
  /** Whether every row on the current page is checked. */
  allPageRowsSelected: boolean;
  /** Number of currently checked row ids (page mode). */
  selectedCount: number;
  onSelectAllMatching: () => void;
  onClearSelection: () => void;
  labels?: SelectAllMatchingLabels;
  className?: string;
}

export function DataTableSelectAllBanner({
  scope,
  totalRows,
  pageRowCount,
  allPageRowsSelected,
  selectedCount,
  onSelectAllMatching,
  onClearSelection,
  labels,
  className,
}: DataTableSelectAllBannerProps) {
  const { locale } = useLocaleOrDefault();
  const { formatNumber } = useFormat();

  const base = locale === "ar" ? LABELS.ar : LABELS.en;
  const resolved: Required<SelectAllMatchingLabels> = { ...base };
  if (labels) {
    for (const [key, value] of Object.entries(labels)) {
      if (value !== undefined) {
        (resolved as Record<string, unknown>)[key] = value;
      }
    }
  }

  const isAllMatching = scope.mode === "all-matching";
  const showPagePrompt =
    !isAllMatching &&
    allPageRowsSelected &&
    pageRowCount > 0 &&
    totalRows > selectedCount;

  if (!isAllMatching && !showPagePrompt) return null;

  const scopeCount = countScopeSelected(scope, totalRows);
  const message = isAllMatching
    ? scope.excludedIds.length === 0
      ? resolved.allMatchingSelected(formatNumber(totalRows))
      : resolved.partialMatchingSelected(
          formatNumber(scopeCount),
          formatNumber(totalRows),
        )
    : resolved.pageSelected(formatNumber(pageRowCount));

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-soft border border-primary/15 bg-primary/5 px-3 py-2 text-sm",
        className,
      )}
    >
      <ListChecks className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="text-foreground/90">{message}</span>
      {isAllMatching ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto h-7 px-2 text-muted-foreground"
          onClick={onClearSelection}
        >
          <X className="me-1 h-3.5 w-3.5" aria-hidden />
          {resolved.clearSelection}
        </Button>
      ) : (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-7 px-1.5 font-medium text-primary"
          onClick={onSelectAllMatching}
        >
          {resolved.selectAllMatching(formatNumber(totalRows))}
        </Button>
      )}
    </div>
  );
}
