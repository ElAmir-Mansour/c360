"use client";

import type { LucideIcon } from "lucide-react";
import { InboxIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";

/**
 * @deprecated Use `EmptyState` from `@/components/common/empty-state` — the
 * canonical empty-state primitive. Kept as a thin adapter because the shared
 * `DataTable` renders it for zero-result states.
 */
interface DataTableEmptyProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: LucideIcon };
  hasActiveFilters?: boolean;
  className?: string;
}

/**
 * Bilingual (English + Modern Standard Arabic) copy for the zero-result states.
 * The app defaults to Arabic (RTL), so the previously hardcoded English defaults
 * leaked through on tables that render the shared `DataTable` without a custom
 * `emptyState` (e.g. /workflows). Callers may still override `title` /
 * `description`; only the DEFAULTS are localized here.
 */
const EMPTY_COPY = {
  en: {
    title: "No results found",
    filtered: "No results match your current filters. Try adjusting or clearing your filters.",
    empty: "No data available yet.",
  },
  ar: {
    title: "لا توجد نتائج",
    filtered: "لا توجد نتائج مطابقة للمرشحات الحالية. حاول تعديل المرشحات أو مسحها.",
    empty: "لا توجد بيانات متاحة بعد",
  },
} as const;

/** @deprecated Thin adapter over the canonical `EmptyState` (compact). */
export function DataTableEmpty({
  icon = InboxIcon,
  title,
  description,
  action,
  hasActiveFilters = false,
  className,
}: DataTableEmptyProps) {
  const { locale } = useLocaleOrDefault();
  const copy = EMPTY_COPY[locale] ?? EMPTY_COPY.en;
  const defaultDescription = hasActiveFilters ? copy.filtered : copy.empty;

  return (
    <EmptyState
      role="status"
      aria-live="polite"
      icon={icon}
      title={title ?? copy.title}
      description={description ?? defaultDescription}
      action={action}
      size="compact"
      className={className}
    />
  );
}
