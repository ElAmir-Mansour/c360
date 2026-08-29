'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';

export interface RenewalAlertBannerProps {
  /** ISO date string for the renewal/anchor date. */
  renewalDate: string | null | undefined;
  /**
   * Days the renewal is overdue (positive number). Mutually exclusive with
   * {@link RenewalAlertBannerProps.daysUntil}. When > 0 the banner renders in
   * the danger tone.
   */
  daysOverdue?: number | null;
  /**
   * Days remaining until renewal (positive number, within the notice window).
   * Mutually exclusive with {@link RenewalAlertBannerProps.daysOverdue}.
   * When provided (and not overdue) the banner renders in the amber tone.
   */
  daysUntil?: number | null;
  /** Href for the "Renew now" CTA. */
  onRenewHref: string;
  /** When true, renders a dismiss control that hides the banner locally. */
  dismissible?: boolean;
  /** Optional className passthrough for layout placement. */
  className?: string;
}

const COPY = {
  en: {
    overdueTitle: (n: string) => `Renewal overdue by ${n}`,
    dueToday: 'Renewal due today',
    dueIn: (n: string) => `Renewal due in ${n}`,
    day: 'day',
    days: 'days',
    overdueDetail: (d: string) =>
      `This contract passed its renewal date on ${d}. Renew now to stay compliant.`,
    overdueDetailNoDate:
      'This contract has passed its renewal date. Renew now to stay compliant.',
    upcomingDetail: (d: string) =>
      `Renewal date is ${d}. Start the renewal before the notice window closes.`,
    upcomingDetailNoDate:
      'Renewal is within the notice window. Start the renewal before it closes.',
    renew: 'Renew now',
    dismiss: 'Dismiss renewal alert',
  },
  ar: {
    overdueTitle: (n: string) => `تأخّر التجديد بمقدار ${n}`,
    dueToday: 'التجديد مستحق اليوم',
    dueIn: (n: string) => `التجديد خلال ${n}`,
    day: 'يوم',
    days: 'أيام',
    overdueDetail: (d: string) =>
      `تجاوز هذا العقد تاريخ تجديده في ${d}. جدّد الآن للحفاظ على الامتثال.`,
    overdueDetailNoDate: 'تجاوز هذا العقد تاريخ تجديده. جدّد الآن للحفاظ على الامتثال.',
    upcomingDetail: (d: string) =>
      `تاريخ التجديد هو ${d}. ابدأ التجديد قبل انتهاء فترة الإشعار.`,
    upcomingDetailNoDate: 'التجديد ضمن فترة الإشعار. ابدأ التجديد قبل انتهائها.',
    renew: 'جدّد الآن',
    dismiss: 'إغلاق تنبيه التجديد',
  },
} as const;

/**
 * Prominent renewal alert. Renders only when the renewal is overdue
 * (`daysOverdue > 0`) or within the notice window (`daysUntil >= 0`).
 * Overdue uses the danger tone; upcoming uses the amber/warning tone.
 * Fully bilingual + KSA-formatted (Hijri/Arabic-Indic) via useLexFormat.
 */
export function RenewalAlertBanner({
  renewalDate,
  daysOverdue,
  daysUntil,
  onRenewHref,
  dismissible = false,
  className,
}: RenewalAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const { locale } = useLocale();
  const f = useLexFormat();
  const t = COPY[locale] ?? COPY.en;

  const overdue = typeof daysOverdue === 'number' && daysOverdue > 0;
  const upcoming = !overdue && typeof daysUntil === 'number' && daysUntil >= 0;

  if (dismissed || (!overdue && !upcoming)) {
    return null;
  }

  const formattedDate = renewalDate
    ? f.formatDate(renewalDate, { dateStyle: 'medium' }) || null
    : null;
  const Icon = overdue ? ShieldAlert : CalendarClock;

  const dayCount = (n: number) => `${f.formatNumber(n)} ${n === 1 ? t.day : t.days}`;

  const title = overdue
    ? t.overdueTitle(dayCount(daysOverdue as number))
    : daysUntil === 0
      ? t.dueToday
      : t.dueIn(dayCount(daysUntil as number));

  const detail = overdue
    ? formattedDate
      ? t.overdueDetail(formattedDate)
      : t.overdueDetailNoDate
    : formattedDate
      ? t.upcomingDetail(formattedDate)
      : t.upcomingDetailNoDate;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between',
        overdue
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-warning-500/30 bg-warning-500/10',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            overdue
              ? 'bg-destructive/15 text-destructive'
              : 'bg-warning-500/15 text-warning-700 dark:text-warning-300',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="space-y-0.5">
          <p
            className={cn(
              'text-sm font-semibold',
              overdue ? 'text-destructive' : 'text-warning-700 dark:text-warning-300',
            )}
          >
            {title}
          </p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 ps-12 sm:ps-0">
        <Button asChild size="sm" variant={overdue ? 'destructive' : 'default'}>
          <Link href={onRenewHref}>{t.renew}</Link>
        </Button>
        {dismissible ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => setDismissed(true)}
            aria-label={t.dismiss}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
