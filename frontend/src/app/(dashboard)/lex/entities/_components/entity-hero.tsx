'use client';

/**
 * ENTITY-360 detail hero — a flat, solid token card that anchors a single
 * organization's 360° view. It restates the org identity and surfaces the five
 * most-scanned facts (exposure, recovery, contracts, cases, settlements) as
 * fact tiles. Every number / SAR value is KSA-formatted via the injected
 * `useLexFormat` so Arabic mode renders Arabic-Indic digits + SAR-first money.
 *
 * Purely presentational. Modeled on the contracts `ContractHeroBand` exemplar so
 * the suite reads as one product.
 */

import { Building2, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { LexFormatter } from '@/lib/lex/ksa';
import type { EntityFootprint } from '../_lib/entity-data';
import type { EntityLabels } from '../_lib/entity-i18n';

export interface EntityHeroProps {
  entity: EntityFootprint;
  labels: EntityLabels['detail'];
  f: LexFormatter;
}

export function EntityHero({ entity, labels, f }: EntityHeroProps) {
  const exposure = f.formatCurrency(entity.totalExposure, { currency: 'SAR' });
  const recovery =
    entity.settlementValue > 0 ? f.formatPercent(entity.recoveryRate) : '—';
  const lastActivity = entity.lastActivityAt
    ? f.formatRelative(entity.lastActivityAt)
    : labels.hero.noActivity;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6',
        'shadow-elevation-2 motion-safe:animate-fade-up',
      )}
    >
      <div className="relative space-y-5 text-foreground">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-border bg-muted text-muted-foreground"
              aria-hidden
            >
              <Building2 className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                {labels.hero.eyebrow}
              </span>
              <h1
                className="truncate text-h3 font-bold leading-tight sm:text-h2"
                dir="auto"
              >
                {entity.name}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {labels.hero.records(entity.totalRecords)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted text-muted-foreground px-3 py-1 text-xs">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span className="text-muted-foreground">{labels.hero.lastActivity}</span>
            <span className="font-medium text-foreground">{lastActivity}</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <HeroFact label={labels.hero.facts.exposure} value={exposure} mono />
          <HeroFact label={labels.hero.facts.recovery} value={recovery} mono />
          <HeroFact
            label={labels.hero.facts.contracts}
            value={f.formatNumber(entity.contractCount)}
          />
          <HeroFact
            label={labels.hero.facts.cases}
            value={f.formatNumber(entity.caseCount)}
          />
          <HeroFact
            label={labels.hero.facts.settlements}
            value={f.formatNumber(entity.settlementCount)}
          />
        </dl>
      </div>
    </section>
  );
}

function HeroFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-sm font-semibold text-foreground',
          mono && 'tabular-nums',
        )}
        dir={mono ? 'ltr' : 'auto'}
      >
        {value}
      </dd>
    </div>
  );
}
