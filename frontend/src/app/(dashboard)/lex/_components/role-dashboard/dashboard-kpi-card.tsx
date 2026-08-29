'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

/**
 * KPI card for the per-role landing dashboards — matches the approved mockup:
 * an uppercase muted label, a large tabular value, and a tone-colored caption.
 * The whole card is a focusable deep link. Tone + caption are derived from the
 * live value against the KPI's `KpiToneKind`.
 */

import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { KpiCaptionSpec, KpiDatum } from '../../_lib/role-dashboards/use-role-dashboard-data';
import type { KpiToneKind } from '../../_lib/role-dashboards/registry';
import { useRoleDashboardStrings } from '../../_lib/role-dashboards/i18n';

/**
 * Rotating WatheeqTech-brand accents (teal → spring-teal → gold-green →
 * teal-green → deep teal) so each KPI card reads as a distinct colour while
 * staying on-brand. Each entry is a CSS colour EXPRESSION built from the
 * landing-theme brand tokens (available under the `data-lex-landing-theme`
 * wrapper the `/lex` page sets) — no hard-coded hex leaks into JS, and the
 * accents re-theme with the brand. The card derives its tinted wash, border,
 * top strip and darkened label from its accent via `color-mix`.
 */
export const DASHLET_ACCENTS: readonly string[] = [
  'var(--lex-landing-primary)', // brand teal
  'var(--lex-landing-spring-teal)', // spring teal
  'var(--lex-landing-accent)', // gold-green (brand accent)
  'color-mix(in srgb, var(--lex-landing-primary) 55%, var(--lex-landing-accent) 45%)', // teal-green
  'var(--lex-landing-dark-teal)', // deep teal
];

interface DashboardKpiCardProps {
  label: string;
  datum: KpiDatum;
  format: 'count' | 'percent';
  href: string;
  tone: KpiToneKind;
  /** Contextual caption from real data; overrides the tone-derived caption. */
  caption?: KpiCaptionSpec;
  /** Brand-family accent colour expression (tinted wash + top strip + label). */
  accent?: string;
}

type ResolvedTone = 'neutral' | 'success' | 'warning' | 'error';

function resolveTone(tone: KpiToneKind, value: number | null): ResolvedTone {
  if (value === null) return 'neutral';
  switch (tone) {
    case 'goodHighPct':
      return value >= 90 ? 'success' : value >= 75 ? 'warning' : 'error';
    case 'badWhenPositive':
      return value > 0 ? 'warning' : 'success';
    case 'criticalWhenPositive':
      return value > 0 ? 'error' : 'success';
    default:
      return 'neutral';
  }
}

const CAPTION_KEY: Record<ResolvedTone, string> = {
  success: 'caption.onTarget',
  warning: 'caption.needsAttention',
  error: 'caption.actionRequired',
  neutral: 'caption.tracking',
};

const CAPTION_CLASS: Record<ResolvedTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-muted-foreground',
};

export function DashboardKpiCard({ label, datum, format, href, tone, caption, accent }: DashboardKpiCardProps) {
  const f = useLexFormat();
  const { t } = useRoleDashboardStrings();
  const resolved = resolveTone(tone, datum.value);

  // A "bad" KPI sitting at zero reads as healthy (mirrors the command center).
  // This ONLY applies to bad/critical tones — a goodHighPct KPI at 0 (e.g. 0%
  // SLA compliance) is a FAILURE, not "all clear". Text and color both derive
  // from this single flag so they can never contradict.
  const isAllClear =
    (tone === 'badWhenPositive' || tone === 'criticalWhenPositive') && datum.value === 0;
  const toneCaptionKey = isAllClear ? 'caption.allClear' : CAPTION_KEY[resolved];
  const toneCaptionTone: ResolvedTone = isAllClear ? 'success' : resolved;

  // A contextual caption (real data, e.g. "3 hearings scheduled") wins over the
  // tone caption when present.
  const captionText = caption ? t(caption.key, caption.vars) : t(toneCaptionKey);
  const captionTone: ResolvedTone = caption ? caption.tone : toneCaptionTone;

  const display =
    datum.value === null
      ? '—'
      : format === 'percent'
        ? f.formatPercent(datum.value, { fromPercent: true, maximumFractionDigits: 0 })
        : f.formatNumber(datum.value);

  return (
    <Link
      href={href}
      title={statisticHint(label)}
      style={
        accent
          ? {
              backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${accent} 30%, transparent)`,
              borderTopColor: accent,
            }
          : undefined
      }
      className={cn(
        'group flex flex-col rounded-softest p-5 shadow-elevation-1',
        accent ? 'border border-t-[3px]' : 'border border-border bg-card',
        'transition-shadow hover:shadow-elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <p
        className={cn(
          'text-caption font-medium uppercase tracking-wide',
          !accent && 'text-muted-foreground',
        )}
        style={accent ? { color: `color-mix(in srgb, ${accent} 72%, black)` } : undefined}
      >
        {label}
      </p>
      {datum.isLoading ? (
        <Skeleton className="mt-2 h-8 w-16 rounded-soft" />
      ) : (
        <p className="mt-1 text-h1 font-semibold leading-none tabular-nums text-foreground">{display}</p>
      )}
      <p className={cn('mt-2 text-caption font-medium', CAPTION_CLASS[captionTone])}>
        {datum.value === null ? ' ' : captionText}
      </p>
    </Link>
  );
}
