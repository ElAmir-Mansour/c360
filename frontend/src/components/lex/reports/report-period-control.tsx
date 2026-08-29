"use client";

import {
  DateRangePicker,
  type DateRange,
  type DateRangePickerProps,
} from "@/components/shared/forms/date-range-picker";
import { useLocale } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { formatReportPeriod } from "./printable-report";

export interface ReportPeriodControlProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
  disabled?: boolean;
  allTime?: boolean;
  fixedLabel?: string;
  presets?: DateRangePickerProps["presets"];
}

export function ReportPeriodControl({
  value,
  onChange,
  className,
  disabled = false,
  allTime = false,
  fixedLabel,
  presets,
}: ReportPeriodControlProps) {
  const { locale, direction } = useLocale();
  const periodLabel =
    fixedLabel ??
    formatReportPeriod(
      allTime ? undefined : { from: value.from, to: value.to },
      locale,
    );

  return (
    <div
      className={cn("lex-report-no-print flex flex-col gap-1.5", className)}
      dir={direction}
      data-report-no-print="true"
    >
      <span className="text-xs font-medium text-muted-foreground">
        {locale === "ar" ? "فترة التقرير" : "Report period"}
      </span>
      {allTime || fixedLabel ? (
        <div className="flex h-9 min-w-56 items-center rounded-lg border bg-card px-3 text-xs font-semibold">
          {periodLabel}
        </div>
      ) : (
        <DateRangePicker
          value={value}
          onChange={onChange}
          presets={presets}
          disabled={disabled}
          className="h-9 min-w-56 rounded-lg bg-card text-xs font-semibold shadow-none"
        />
      )}
      <span className="text-[11px] text-muted-foreground">{periodLabel}</span>
    </div>
  );
}
