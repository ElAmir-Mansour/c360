'use client';

import {
  differenceInCalendarDays,
  isValid,
  parseISO,
} from 'date-fns';
import {
  CalendarCheck,
  CalendarClock,
  CalendarX,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { deriveRenewalDate } from '../../_lib/renewal-date';

export interface KeyDatesStripProps {
  /** ISO effective date. */
  effective: string | null | undefined;
  /** ISO renewal date. */
  renewal: string | null | undefined;
  /** ISO expiry date. */
  expiry: string | null | undefined;
  /**
   * Contract `auto_renew` flag. An auto-renewing contract stores no separate
   * `renewal_date` — it rolls over on its expiry date — so the renewal node is
   * derived from {@link KeyDatesStripProps.expiry} instead of reading "Not set",
   * which would contradict the flag.
   */
  autoRenew?: boolean;
  /** Contract `renewal_notice_days`; drives the opt-out caption on auto-renew. */
  noticeDays?: number | null;
  /** When true, the renewal node is highlighted in the danger tone. */
  overdue?: boolean;
  /** Optional className passthrough for layout placement. */
  className?: string;
}

type DateTone = 'past' | 'neutral' | 'warning' | 'danger';

interface DateNode {
  key: 'effective' | 'renewal' | 'expiry';
  label: string;
  icon: LucideIcon;
  date: Date | null;
  /** Shown in place of a formatted date when `date` is null. */
  placeholder: string;
  /** Small chip beside the node label (auto-renew marker). */
  badge?: string;
  /** Extra caption line under the countdown (opt-out deadline). */
  note?: string;
  tone: DateTone;
}

/* ------------------------------------------------------------------------- *
 * Local bilingual (English + Modern Standard Arabic) copy bundle. Node labels,
 * the "Not set" placeholder, the countdown phrasing, and the list aria-label all
 * resolve through here so the strip never leaks English in Arabic mode. Day
 * counts are interpolated as a pre-localized (Arabic-Indic in ar) number string.
 * ------------------------------------------------------------------------- */

interface KeyDatesStripCopy {
  effective: string;
  renewal: string;
  expiry: string;
  notSet: string;
  today: string;
  inDays: (days: string, count: number) => string;
  daysAgo: (days: string, count: number) => string;
  /** Chip beside the renewal label when the contract auto-renews. */
  autoBadge: string;
  /** Renewal value when auto-renew is on but no expiry date exists to derive from. */
  autoNoDate: string;
  /** Caption naming the date the contract actually rolls over. */
  renewsOn: (date: string) => string;
  ariaLabel: string;
}

const KEY_DATES_STRIP_COPY: Record<'en' | 'ar', KeyDatesStripCopy> = {
  en: {
    effective: 'Effective',
    renewal: 'Renewal',
    expiry: 'Expiry',
    notSet: 'Not set',
    today: 'Today',
    inDays: (days, count) => `in ${days} ${count === 1 ? 'day' : 'days'}`,
    daysAgo: (days, count) => `${days} ${count === 1 ? 'day' : 'days'} ago`,
    autoBadge: 'Auto',
    autoNoDate: 'Auto-renew',
    renewsOn: (date) => `Renews ${date}`,
    ariaLabel: 'Key contract dates',
  },
  ar: {
    effective: 'السريان',
    renewal: 'التجديد',
    expiry: 'الانتهاء',
    notSet: 'غير محدد',
    today: 'اليوم',
    inDays: (days, count) => `خلال ${days} ${count === 1 ? 'يوم' : 'يوم'}`,
    daysAgo: (days, count) => `قبل ${days} ${count === 1 ? 'يوم' : 'يوم'}`,
    autoBadge: 'تلقائي',
    autoNoDate: 'تجديد تلقائي',
    renewsOn: (date) => `يُجدَّد في ${date}`,
    ariaLabel: 'تواريخ العقد الرئيسية',
  },
};

// Tones follow the platform vocabulary: dates are time/deadline metrics, so an
// active (neutral) lifecycle date rides the `gold` accent; a date in the notice
// window escalates to a stronger gold (warning) and an overdue/expired date to
// `rose` (danger). Past, settled dates stay muted.
const TONE_STYLES: Record<DateTone, { chip: string; icon: string; ring: string }> = {
  past: {
    chip: 'text-muted-foreground',
    icon: 'text-muted-foreground',
    ring: 'border-border/70 bg-muted/40',
  },
  neutral: {
    chip: 'text-foreground',
    icon: 'text-warning-700 dark:text-warning-300',
    ring: 'border-warning-500/25 bg-warning-500/5',
  },
  warning: {
    chip: 'text-warning-700 dark:text-warning-300',
    icon: 'text-warning-700 dark:text-warning-300',
    ring: 'border-warning-500/30 bg-warning-500/10',
  },
  danger: {
    chip: 'text-destructive',
    icon: 'text-destructive',
    ring: 'border-destructive/30 bg-destructive/10',
  },
};

function parse(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

/**
 * Compact horizontal timeline of the three lifecycle dates
 * (effective -> renewal -> expiry) with countdown chips. The renewal node is
 * emphasised in the danger tone when {@link KeyDatesStripProps.overdue} is set.
 */
export function KeyDatesStrip({
  effective,
  renewal,
  expiry,
  autoRenew = false,
  noticeDays,
  overdue = false,
  className,
}: KeyDatesStripProps) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const copy = KEY_DATES_STRIP_COPY[locale === 'ar' ? 'ar' : 'en'];

  const effectiveDate = parse(effective);
  const explicitRenewalDate = parse(renewal);
  const expiryDate = parse(expiry);

  // Auto-renewal is a flag, not a date, and contracts created before the form
  // derived one carry no `renewal_date` — reading the raw column alone would
  // render "Not set" on a contract that plainly renews. Fall back to the same
  // `expiry - notice` rule the contract form applies.
  const renewalDate =
    explicitRenewalDate ?? (autoRenew ? deriveRenewalDate(expiryDate, noticeDays) : null);

  const now = new Date();
  const isPast = (date: Date | null) => date !== null && differenceInCalendarDays(date, now) < 0;

  // KSA-aware date label: Gregorian in English, Hijri + Arabic-Indic in ar.
  const formatDateLabel = (date: Date | null, placeholder: string): string =>
    date ? f.formatDate(date) : placeholder;

  // Countdown copy with a pre-localized day count (Arabic-Indic digits in ar).
  const countdownLabel = (date: Date | null): string | null => {
    if (!date) {
      return null;
    }
    const diff = differenceInCalendarDays(date, now);
    if (diff === 0) {
      return copy.today;
    }
    if (diff > 0) {
      return copy.inDays(f.formatNumber(diff), diff);
    }
    const overdueBy = Math.abs(diff);
    return copy.daysAgo(f.formatNumber(overdueBy), overdueBy);
  };

  const renewalTone: DateTone = overdue
    ? 'danger'
    : renewalDate
      ? 'warning'
      : 'neutral';

  // The renewal date is the decision deadline, so name the rollover it defends
  // against. Suppressed when the two coincide (no notice period configured).
  const renewalNote =
    autoRenew &&
    expiryDate &&
    renewalDate &&
    differenceInCalendarDays(expiryDate, renewalDate) !== 0
      ? copy.renewsOn(f.formatDate(expiryDate))
      : undefined;

  const nodes: DateNode[] = [
    {
      key: 'effective',
      label: copy.effective,
      icon: CalendarCheck,
      date: effectiveDate,
      placeholder: copy.notSet,
      tone: isPast(effectiveDate) ? 'past' : 'neutral',
    },
    {
      key: 'renewal',
      label: copy.renewal,
      icon: CalendarClock,
      date: renewalDate,
      placeholder: autoRenew ? copy.autoNoDate : copy.notSet,
      badge: autoRenew ? copy.autoBadge : undefined,
      note: renewalNote,
      tone: renewalTone,
    },
    {
      key: 'expiry',
      label: copy.expiry,
      icon: CalendarX,
      date: expiryDate,
      placeholder: copy.notSet,
      tone: isPast(expiryDate) ? 'danger' : 'neutral',
    },
  ];

  return (
    <ol
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0',
        className,
      )}
      aria-label={copy.ariaLabel}
    >
      {nodes.map((node, index) => {
        const styles = TONE_STYLES[node.tone];
        const countdown = countdownLabel(node.date);
        const Icon = node.icon;
        const isLast = index === nodes.length - 1;

        return (
          <li
            key={node.key}
            className="flex flex-1 items-center gap-2 sm:gap-0"
          >
            <div
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5',
                styles.ring,
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', styles.icon)} aria-hidden="true" />
              <div className="min-w-0 space-y-0.5">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>{node.label}</span>
                  {node.badge ? (
                    <span className="rounded-full border border-warning-500/40 bg-warning-500/10 px-1.5 py-px text-[10px] font-semibold text-warning-700 dark:text-warning-300">
                      {node.badge}
                    </span>
                  ) : null}
                </p>
                <p className={cn('truncate text-sm font-semibold', styles.chip)}>
                  {formatDateLabel(node.date, node.placeholder)}
                </p>
                {countdown ? (
                  <p className={cn('text-xs', styles.chip)}>{countdown}</p>
                ) : null}
                {node.note ? (
                  <p className="truncate text-xs text-muted-foreground">{node.note}</p>
                ) : null}
              </div>
            </div>
            {!isLast ? (
              <ChevronRight
                className="mx-1 hidden h-4 w-4 shrink-0 text-muted-foreground/60 sm:block rtl:rotate-180"
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
