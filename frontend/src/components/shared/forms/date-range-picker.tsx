"use client";
import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { Locale } from "date-fns";
import { ar as arLocale, enUS as enLocale } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { getLocaleDirection, normalizeLocale, type AppDirection, type AppLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

export type DateRangePresetKey =
  | "last24Hours"
  | "last7Days"
  | "last30Days"
  | "last90Days"
  | "thisMonth"
  | "lastMonth";

export interface DateRangePickerLabels {
  placeholder?: string;
  rangeSeparator?: string;
  presets?: Partial<Record<DateRangePresetKey, string>>;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets?: Array<{ label: string; from: Date; to: Date }>;
  labels?: DateRangePickerLabels;
  locale?: string;
  dir?: AppDirection;
  calendarLocale?: Locale;
  dateFormatOptions?: Intl.DateTimeFormatOptions;
  formatDate?: (date: Date) => string;
  disabled?: boolean;
  className?: string;
}

const defaultLabels: Record<AppLocale, Required<DateRangePickerLabels> & { presets: Record<DateRangePresetKey, string> }> = {
  en: {
    placeholder: "Select date range",
    rangeSeparator: " – ",
    presets: {
      last24Hours: "Last 24 hours",
      last7Days: "Last 7 days",
      last30Days: "Last 30 days",
      last90Days: "Last 90 days",
      thisMonth: "This month",
      lastMonth: "Last month",
    },
  },
  ar: {
    placeholder: "اختر النطاق الزمني",
    rangeSeparator: " – ",
    presets: {
      last24Hours: "آخر 24 ساعة",
      last7Days: "آخر 7 أيام",
      last30Days: "آخر 30 يومًا",
      last90Days: "آخر 90 يومًا",
      thisMonth: "هذا الشهر",
      lastMonth: "الشهر الماضي",
    },
  },
};

const dateFnsLocales: Record<AppLocale, Locale> = {
  ar: arLocale,
  en: enLocale,
};

const defaultDateFormatOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

function getDefaultPresets(labels: Record<DateRangePresetKey, string>) {
  const now = new Date();
  const lastMonth = subMonths(now, 1);

  return [
    { label: labels.last24Hours, from: subDays(now, 1), to: now },
    { label: labels.last7Days, from: subDays(now, 7), to: now },
    { label: labels.last30Days, from: subDays(now, 30), to: now },
    { label: labels.last90Days, from: subDays(now, 90), to: now },
    { label: labels.thisMonth, from: startOfMonth(now), to: now },
    { label: labels.lastMonth, from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) },
  ];
}

function isValidDate(value: Date | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function DateRangePicker({
  value,
  onChange,
  presets,
  labels,
  locale,
  dir,
  calendarLocale,
  dateFormatOptions = defaultDateFormatOptions,
  formatDate,
  disabled = false,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const { locale: appLocale, direction: appDirection } = useLocaleOrDefault();
  const normalizedLocale = normalizeLocale(locale ?? appLocale) ?? appLocale;
  const displayLocale = locale ?? (normalizedLocale === "ar" ? "ar" : "en-US");
  const direction = dir ?? (locale ? getLocaleDirection(normalizedLocale) : appDirection);
  const text = defaultLabels[normalizedLocale];
  const resolvedLabels = {
    placeholder: labels?.placeholder ?? text.placeholder,
    rangeSeparator: labels?.rangeSeparator ?? text.rangeSeparator,
    presets: {
      ...text.presets,
      ...labels?.presets,
    },
  };
  const resolvedPresets = presets ?? getDefaultPresets(resolvedLabels.presets);
  const from = isValidDate(value.from) ? value.from : undefined;
  const to = isValidDate(value.to) ? value.to : undefined;
  const formatDisplayDate = (date: Date) =>
    formatDate?.(date) ?? new Intl.DateTimeFormat(displayLocale, dateFormatOptions).format(date);

  const displayText = from
    ? to
      ? `${formatDisplayDate(from)}${resolvedLabels.rangeSeparator}${formatDisplayDate(to)}`
      : formatDisplayDate(from)
    : resolvedLabels.placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("justify-start gap-2 font-normal", !from && "text-muted-foreground", className)}
          disabled={disabled}
          dir={direction}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" aria-hidden />
          {displayText}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto gap-0 p-0" align="start" dir={direction}>
        <div className="flex flex-col gap-1 border-e p-3 text-sm">
          {resolvedPresets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="rounded px-2 py-1 text-start hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-nowrap"
              onClick={() => { onChange({ from: preset.from, to: preset.to }); setOpen(false); }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={(range) => {
            onChange({ from: range?.from, to: range?.to });
          }}
          numberOfMonths={2}
          locale={calendarLocale ?? dateFnsLocales[normalizedLocale]}
          dir={direction}
          classNames={{
            months: "flex flex-col gap-y-4 sm:flex-row sm:gap-x-4",
            nav: "flex items-center gap-1",
            nav_button_previous: "absolute start-1",
            nav_button_next: "absolute end-1",
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
