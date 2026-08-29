'use client';

/**
 * ENTITY-360 detail hero band (#1) — the flat `card p-6` hero that anchors a
 * single organization's 360° view. Mirrors the service-desk `RequestHero`
 * pattern (the shell owns the chrome now, so the hero is a flat token
 * card): an org avatar + the entity name (`dir="auto"`), DERIVED posture chips
 * (records / open cases / active contracts — an entity is a profile, so it has
 * no lifecycle status or type to chip), a header actions slot (holds the
 * nav/shareability toolbar), and 3–4 scannable fact tiles.
 *
 * Every number / SAR value is KSA-formatted via the injected `useLexFormat` so
 * Arabic mode renders Arabic-Indic digits + SAR-first money. Presentational.
 */

import type { ReactNode } from 'react';
import { Building2, CalendarClock, Layers, Percent, Wallet, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { LexFormatter } from '@/lib/lex/ksa';
import type { EntityFootprint } from '../../_lib/entity-data';
import { useEntityDetailLabels } from './entity-detail-labels';

export interface EntityHeroBandProps {
  entity: EntityFootprint;
  f: LexFormatter;
  actions?: ReactNode;
}

/** Local initials helper — no shared avatar util needed for a single org glyph. */
function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function EntityHeroBand({ entity, f, actions }: EntityHeroBandProps) {
  const t = useEntityDetailLabels().hero;

  const exposure = f.formatCurrencyCompact(entity.totalExposure, { currency: 'SAR' });
  const recovery = entity.settlementValue > 0 ? f.formatPercent(entity.recoveryRate) : '—';
  const lastActivity = entity.lastActivityAt
    ? f.formatRelative(entity.lastActivityAt)
    : t.noActivity;

  const facts: { key: string; icon: LucideIcon; label: string; value: string; mono?: boolean }[] = [
    { key: 'records', icon: Layers, label: t.facts.records, value: f.formatNumber(entity.totalRecords) },
    { key: 'exposure', icon: Wallet, label: t.facts.exposure, value: exposure, mono: true },
    { key: 'recovery', icon: Percent, label: t.facts.recovery, value: recovery, mono: true },
    { key: 'activity', icon: CalendarClock, label: t.facts.lastActivity, value: lastActivity },
  ];

  return (
    <section className="card p-6 sm:p-7">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[image:var(--ds-gradient-primary)] text-lg font-semibold text-primary-foreground shadow-elevation-1 ring-1 ring-inset ring-white/15"
              aria-hidden
            >
              {orgInitials(entity.name) || <Building2 className="h-6 w-6" />}
            </span>
            <div className="min-w-0 space-y-2">
              <span className="text-overline font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                {t.eyebrow}
              </span>
              <h1
                className="text-h2 font-bold leading-tight tracking-tight text-foreground"
                dir="auto"
              >
                {entity.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" size="sm" className="tabular-nums">
                  {t.recordsChip(f.formatNumber(entity.totalRecords))}
                </Badge>
                {entity.openCaseCount > 0 ? (
                  <Badge variant="warning" size="sm" className="tabular-nums">
                    {t.openCasesChip(f.formatNumber(entity.openCaseCount))}
                  </Badge>
                ) : null}
                {entity.activeContractCount > 0 ? (
                  <Badge variant="info" size="sm" className="tabular-nums">
                    {t.activeContractsChip(f.formatNumber(entity.activeContractCount))}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {facts.map((fact) => {
            const Icon = fact.icon;
            return (
              <div
                key={fact.key}
                className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 shadow-elevation-1"
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd
                    className={`truncate text-sm font-medium text-foreground${fact.mono ? ' tabular-nums' : ''}`}
                    dir={fact.mono ? 'ltr' : 'auto'}
                    title={fact.value}
                  >
                    {fact.value}
                  </dd>
                </div>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
