'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';

import { Skeleton } from '@/components/ui/skeleton';
import { useLexFormat } from '@/lib/lex/ksa';

import { useLegalDirectorDashboardLabels } from '../../../_lib/role-dashboards/legal-director-i18n';
import styles from './kpi-card.module.css';

export type KpiTone = 'slate' | 'cyan' | 'olive' | 'green' | 'ink' | 'blue';

export interface KpiCardProps {
  label: string;
  value: number;
  format: 'count' | 'percent';
  tone: KpiTone;
  href?: string;
}

const TONE_BORDER: Record<KpiTone, string> = {
  slate: 'var(--wt-teal-700)',
  cyan: 'var(--wt-teal-300)',
  olive: 'var(--wt-lime-500)',
  green: 'var(--wt-ok)',
  ink: 'var(--wt-teal-900)',
  blue: 'var(--wt-service-investigation-dot)',
};

function cardStyle(tone: KpiTone): CSSProperties {
  return { borderColor: TONE_BORDER[tone] };
}

function KpiCardBody({ label, display }: { label: string; display: string }) {
  return (
    <>
      <p className={styles.label}>{label}</p>
      <p className={styles.value}>{display}</p>
    </>
  );
}

export function KpiCard({ label, value, format, tone, href }: KpiCardProps) {
  const formatter = useLexFormat();
  const display =
    format === 'percent'
      ? formatter.formatPercent(value, {
          fromPercent: true,
          maximumFractionDigits: 0,
        })
      : formatter.formatNumber(value);

  const body = <KpiCardBody label={label} display={display} />;
  const style = cardStyle(tone);

  if (href !== undefined) {
    return (
      <Link
        href={href}
        className={`${styles.card} ${styles.cardInteractive}`}
        style={style}
        aria-label={formatter.locale === 'ar' ? `فتح ${label}` : `Open ${label}`}
      >
        {body}
      </Link>
    );
  }

  return (
    <article className={styles.card} style={style}>
      {body}
    </article>
  );
}

export interface KpiCardSkeletonProps {
  label: string;
  tone: KpiTone;
}

export function KpiCardSkeleton({ label, tone }: KpiCardSkeletonProps) {
  return (
    <article
      className={styles.card}
      style={cardStyle(tone)}
      aria-label={label}
      aria-busy="true"
    >
      <Skeleton className={styles.skeletonLabel} />
      <Skeleton className={styles.skeletonValue} />
    </article>
  );
}

export interface KpiCardUnavailableProps {
  label: string;
}

/** Typographic placeholder standing in for a value that was never resolved. */
const UNAVAILABLE_VALUE = '—';

/**
 * Fail-soft companion for a KPI the caller may not read. `isAvailable: false`
 * is a permission or non-retryable source signal, not an error, so the card
 * holds its position in the strip instead of degrading to a skeleton that would
 * never resolve. It carries no tone: an unavailable value has no reading to
 * colour, and the neutral border keeps the strip from implying one.
 */
export function KpiCardUnavailable({ label }: KpiCardUnavailableProps) {
  const labels = useLegalDirectorDashboardLabels();

  return (
    <article
      className={`${styles.card} ${styles.cardUnavailable}`}
      aria-label={labels.accessibility.kpiUnavailable(label)}
    >
      <p className={styles.label}>{label}</p>
      <p
        className={`${styles.value} ${styles.valueUnavailable}`}
        aria-hidden="true"
      >
        {UNAVAILABLE_VALUE}
      </p>
    </article>
  );
}
