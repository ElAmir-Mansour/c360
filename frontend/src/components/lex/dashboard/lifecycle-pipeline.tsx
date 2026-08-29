'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { contractStatusConfig } from '@/lib/status-configs';
import { WATHEEQ_LIFECYCLE_STAGES } from '@/lib/lex-watheeq';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  lexContractStatusLabels,
  resolveLexBilingual,
  type LexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';

/** Component-local bilingual bundle for the pipeline chrome copy. */
interface LifecyclePipelineLabels {
  /** aria-label on the proportional funnel bar. */
  distributionAria: string;
  /** Total caption below the funnel bar. */
  caption: (total: number, stages: number) => string;
  /** Per-tile "share of pipeline" footer. */
  ofPipeline: (pct: number) => string;
}

const lifecyclePipelineLabels: LexBilingual<LifecyclePipelineLabels> = {
  en: {
    distributionAria: 'Contract lifecycle distribution',
    caption: (total, stages) =>
      `${total.toLocaleString()} contract${total === 1 ? '' : 's'} across ${stages} lifecycle stages`,
    ofPipeline: (pct) => `${pct}% of pipeline`,
  },
  ar: {
    distributionAria: 'توزيع دورة حياة العقود',
    caption: (total, stages) =>
      `${total.toLocaleString()} عقد موزّعة على ${stages} مراحل من دورة الحياة`,
    ofPipeline: (pct) => `${pct}% من المسار`,
  },
};

/**
 * Per-stage accent palette keyed by the `color` field in contractStatusConfig.
 * Drives the proportion bar, the tile icon chip, and the per-stage progress bar.
 */
const STAGE_PALETTE: Record<
  string,
  { bar: string; tint: string; text: string; surface: string }
> = {
  gray: {
    bar: 'bg-neutral-400',
    tint: 'bg-neutral-100 dark:bg-neutral-500/15',
    text: 'text-neutral-600 dark:text-neutral-300',
    surface:
      'border-neutral-200/80 bg-gradient-to-br from-neutral-100/80 via-card to-card hover:border-neutral-400/50 dark:border-neutral-700/70 dark:from-neutral-500/10',
  },
  yellow: {
    bar: 'bg-warning-300',
    tint: 'bg-warning-100 dark:bg-warning-500/15',
    text: 'text-warning-700 dark:text-warning-300',
    surface:
      'border-warning-200/80 bg-gradient-to-br from-warning-100/70 via-card to-card hover:border-warning-400/60 dark:border-warning-500/20 dark:from-warning-500/10',
  },
  orange: {
    bar: 'bg-warning-500',
    tint: 'bg-warning-100 dark:bg-warning-500/15',
    text: 'text-warning-700 dark:text-warning-300',
    surface:
      'border-warning-300/80 bg-gradient-to-br from-warning-100/80 via-card to-card hover:border-warning-500/60 dark:border-warning-500/25 dark:from-warning-500/15',
  },
  blue: {
    bar: 'bg-brand-teal-700',
    tint: 'bg-brand-teal-100 dark:bg-brand-teal-500/15',
    text: 'text-brand-teal-700 dark:text-brand-teal-300',
    surface:
      'border-brand-teal-200/80 bg-gradient-to-br from-brand-teal-100/70 via-card to-card hover:border-brand-teal-400/60 dark:border-brand-teal-500/20 dark:from-brand-teal-500/10',
  },
  green: {
    bar: 'bg-primary',
    tint: 'bg-primary/10',
    text: 'text-primary',
    surface:
      'border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card hover:border-primary/40',
  },
  teal: {
    bar: 'bg-brand-teal-700',
    tint: 'bg-brand-teal-100 dark:bg-brand-teal-500/15',
    text: 'text-brand-teal-700 dark:text-brand-teal-300',
    surface:
      'border-brand-teal-200/80 bg-gradient-to-br from-brand-teal-100/70 via-card to-card hover:border-brand-teal-400/60 dark:border-brand-teal-500/20 dark:from-brand-teal-500/10',
  },
  red: {
    bar: 'bg-error-500',
    tint: 'bg-error-100 dark:bg-error-500/15',
    text: 'text-error-600 dark:text-error-300',
    surface:
      'border-error-200/80 bg-gradient-to-br from-error-100/70 via-card to-card hover:border-error-400/60 dark:border-error-500/20 dark:from-error-500/10',
  },
};

function paletteFor(color: string) {
  return STAGE_PALETTE[color] ?? STAGE_PALETTE.gray;
}

interface LifecyclePipelineProps {
  countsByStatus: Record<string, number>;
  className?: string;
}

/**
 * Watheeq contract lifecycle visualisation: a proportional funnel bar plus a
 * responsive grid of stage tiles. Tiles stack icon → label → count vertically so
 * labels never collide with badges (the previous cramped 6-column layout did).
 */
export function LifecyclePipeline({ countsByStatus, className }: LifecyclePipelineProps) {
  const { locale } = useLocaleOrDefault();
  const t = resolveLexBilingual(lifecyclePipelineLabels, locale);
  const statusLabels = resolveLexBilingual(lexContractStatusLabels, locale);
  const stages = WATHEEQ_LIFECYCLE_STAGES.map((stage) => {
    const cfg = contractStatusConfig[stage];
    return {
      key: stage,
      label: statusLabels[stage] ?? cfg?.label ?? stage,
      color: (cfg?.color as string) ?? 'gray',
      Icon: cfg?.icon as LucideIcon | undefined,
      count: countsByStatus[stage] ?? 0,
    };
  });
  const total = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className={cn('space-y-5', className)}>
      <div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t.distributionAria}>
          {total === 0
            ? <div className="h-full w-full" />
            : stages.map((s) => {
                if (s.count === 0) return null;
                const pct = (s.count / total) * 100;
                return (
                  <Link
                    key={s.key}
                    className={cn('h-full first:rounded-l-full last:rounded-r-full', paletteFor(s.color).bar)}
                    style={{ width: `${pct}%` }}
                    title={`${s.label}: ${s.count.toLocaleString()} (${Math.round(pct)}%)`}
                    href={`/lex/contracts?status=${encodeURIComponent(s.key)}`}
                    aria-label={`${s.label}: ${s.count.toLocaleString()}`}
                  />
                );
              })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t.caption(total, stages.length)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {stages.map((s) => {
          const p = paletteFor(s.color);
          const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          const Icon = s.Icon;
          return (
            <Link
              key={s.key}
              href={`/lex/contracts?status=${encodeURIComponent(s.key)}`}
              className={cn(
                'flex flex-col gap-2 rounded-2xl border p-3.5 shadow-elevation-1 transition-[border-color,background-color,box-shadow] hover:shadow-elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                p.surface,
              )}
            >
              <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-xl', p.tint, p.text)}>
                {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
              </span>
              <span className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                {s.label}
              </span>
              <span
                className={cn(
                  'text-2xl font-bold leading-none',
                  s.count > 0 ? p.text : 'text-muted-foreground',
                )}
              >
                {s.count.toLocaleString()}
              </span>
              <div className="mt-auto space-y-1 pt-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full transition-all', p.bar)} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] text-muted-foreground">{t.ofPipeline(pct)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
