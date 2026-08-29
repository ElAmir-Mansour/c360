'use client';

/**
 * ENTITY-360 list table — a premium `.table-premium` register of counterparty
 * organizations. Each row links to `entities/[id]` and surfaces the org's
 * record mix, total SAR exposure, and settlement-recovery progress.
 *
 * Reuses the shared design system (`.table-premium`, `.badge-*`, KPI tints) and
 * KSA formatting (`useLexFormat`) so Arabic mode renders Arabic-Indic digits and
 * SAR-first currency. RTL-safe via logical spacing + `rtl:` directional arrows.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Building2,
  ChevronRight,
  FileText,
  Gavel,
  Handshake,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import type { EntityFootprint } from '../_lib/entity-data';
import type { EntityLabels } from '../_lib/entity-i18n';

export interface EntitiesTableProps {
  entities: EntityFootprint[];
  labels: EntityLabels['list'];
  dir: 'ltr' | 'rtl';
}

export function EntitiesTable({ entities, labels, dir }: EntitiesTableProps) {
  const f = useLexFormat();

  return (
    <div className="overflow-x-auto">
      <table className="table-premium w-full">
        <thead>
          <tr>
            <th scope="col" className="text-start">
              {labels.columns.organization}
            </th>
            <th scope="col" className="text-start">
              {labels.columns.records}
            </th>
            <th scope="col" className="text-end">
              {labels.columns.exposure}
            </th>
            <th scope="col" className="text-start">
              {labels.columns.recovery}
            </th>
            <th scope="col" className="text-start">
              {labels.columns.lastActivity}
            </th>
            <th scope="col" className="w-10" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {entities.map((entity, index) => (
            <EntityRow
              key={entity.id}
              entity={entity}
              labels={labels}
              dir={dir}
              index={index}
              f={f}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntityRow({
  entity,
  labels,
  dir,
  index,
  f,
}: {
  entity: EntityFootprint;
  labels: EntityLabels['list'];
  dir: 'ltr' | 'rtl';
  index: number;
  f: ReturnType<typeof useLexFormat>;
}) {
  const recoveryPct = Math.round(entity.recoveryRate * 100);
  const exposure = f.formatCurrencyCompact(entity.totalExposure, { currency: 'SAR' });
  const lastActivity = entity.lastActivityAt
    ? f.formatRelative(entity.lastActivityAt)
    : labels.noActivity;

  return (
    <tr
      className="group cursor-pointer motion-safe:animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      {/* Organization */}
      <td>
        <Link
          href={`/lex/entities/${entity.id}`}
          className="flex items-center gap-3 outline-none"
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[image:var(--ds-gradient-primary)] text-primary-foreground shadow-elevation-1 ring-1 ring-inset ring-white/15"
            aria-hidden
          >
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span
              className="block truncate font-semibold text-foreground group-hover:text-primary"
              dir="auto"
            >
              {entity.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground" dir="auto">
              {labels.recordSummary(
                entity.contractCount,
                entity.caseCount,
                entity.settlementCount,
              )}
            </span>
          </span>
        </Link>
      </td>

      {/* Record-mix chips */}
      <td>
        <div className="flex flex-wrap items-center gap-1.5">
          <RecordChip
            icon={FileText}
            count={entity.contractCount}
            value={f.formatNumber(entity.contractCount)}
            tone="info"
          />
          <RecordChip
            icon={Gavel}
            count={entity.caseCount}
            value={f.formatNumber(entity.caseCount)}
            tone="warning"
          />
          <RecordChip
            icon={Handshake}
            count={entity.settlementCount}
            value={f.formatNumber(entity.settlementCount)}
            tone="success"
          />
        </div>
      </td>

      {/* SAR exposure */}
      <td className="text-end">
        <span className="font-semibold tabular-nums text-foreground" dir="ltr">
          {exposure}
        </span>
      </td>

      {/* Recovery progress */}
      <td>
        {entity.settlementValue > 0 ? (
          <RecoveryMeter pct={recoveryPct} label={f.formatPercent(entity.recoveryRate)} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Last activity */}
      <td>
        <span className="text-sm text-muted-foreground">{lastActivity}</span>
      </td>

      {/* Affordance */}
      <td className="text-end">
        <ChevronRight
          className={cn(
            'h-4 w-4 text-muted-foreground/60 transition-transform group-hover:text-primary',
            dir === 'rtl' ? 'rtl:-scale-x-100' : '',
            'motion-safe:group-hover:translate-x-0.5',
          )}
          aria-hidden
        />
      </td>
    </tr>
  );
}

const RECORD_TONE: Record<'info' | 'warning' | 'success', string> = {
  info: 'badge-info',
  warning: 'badge-warning',
  success: 'badge-success',
};

function RecordChip({
  icon: Icon,
  count,
  value,
  tone,
}: {
  icon: typeof FileText;
  count: number;
  value: string;
  tone: 'info' | 'warning' | 'success';
}) {
  return (
    <span
      className={cn(
        'badge-base inline-flex items-center gap-1 tabular-nums',
        count > 0 ? RECORD_TONE[tone] : 'badge-neutral opacity-60',
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {value}
    </span>
  );
}

/** A compact recovery meter: progress bar + percent, tinted by completeness. */
export function RecoveryMeter({ pct, label }: { pct: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone =
    clamped >= 75
      ? 'bg-success-500'
      : clamped >= 40
        ? 'bg-warning-500'
        : 'bg-info-500';
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={cn('block h-full rounded-full transition-[width] duration-normal ease-standard', tone)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums text-muted-foreground" dir="ltr">
        {label}
      </span>
    </div>
  );
}
