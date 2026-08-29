'use client';

import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import { cn } from '@/lib/utils';
import type { DRGroupRollup } from '@/types/clario-dr';

/**
 * Shared presentational helpers + formatters for the `/dr/protect` route,
 * extracted (behaviour-preserving) from the original `dr/page.tsx` monolith.
 * Arbitrary Tailwind sizes used by the original helpers were swapped for token
 * sizes (`text-xs`) to satisfy the console's token-only rule; all logic is
 * identical to the monolith.
 */

export type ProtectTone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

const HEALTH_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  warning: 'Watch',
  critical: 'Critical',
  paused: 'Paused',
  seeding: 'Seeding',
  empty: 'Empty',
  streaming: 'Streaming',
  degraded: 'Degraded',
  error: 'Error',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
};

export function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone,
  accent,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: ProtectTone;
  /**
   * Optional semantic accent. When set (and not `neutral`), the card renders on
   * the materialized `.kpi-card-themed` accent-orb surface from globals.css
   * (matching `DetailStatCard`/`StatCard`). Defaults to `undefined` so existing
   * call sites keep the historic icon-soft-bg `ProtectTone` rendering unchanged.
   */
  accent?: StatTone;
}) {
  if (accent && accent !== 'neutral') {
    return (
      <div className={cn('kpi-card-themed overflow-hidden', TONE_THEME_CLASS[accent])}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-caps-wide text-[color:var(--kpi-accent)]">
              {title}
            </div>
            <div className="mt-3 truncate text-3xl font-semibold tracking-tight text-foreground">{value}</div>
          </div>
          <div className="kpi-icon-badge shrink-0">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </div>
        </div>
        <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{title}</div>
            <div className="mt-3 truncate text-3xl font-semibold tracking-tight">{value}</div>
          </div>
          <div className={cn('rounded-lg p-2.5', toneClass(tone, 'soft'))}>
            <Icon className={cn('h-5 w-5', toneClass(tone, 'text'))} />
          </div>
        </div>
        <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

export function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  /**
   * Optional semantic accent. When set (and not `neutral`), the tile rides the
   * materialized `.kpi-*` accent surface from globals.css with an accented label
   * (value text stays neutral). Defaults to `slate` (type/category) so a tile is
   * never flat white; pass an explicit tone (sky/gold/emerald/rose) by meaning.
   * An empty/`n/a`/zero value still keeps its tone but renders a muted em-dash.
   */
  tone?: StatTone;
}) {
  const resolved: StatTone = tone ?? 'slate';
  const empty =
    value === '' ||
    value === 'n/a' ||
    value === 0 ||
    value === '0' ||
    value === null ||
    value === undefined;
  return (
    <div
      className={cn(
        TONE_THEME_CLASS[resolved],
        'rounded-lg border bg-[var(--kpi-bg)] border-[var(--kpi-border)] px-3 py-2',
      )}
    >
      <div className="text-xs font-semibold uppercase text-[color:var(--kpi-accent)]">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 truncate text-sm font-semibold',
          empty ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {empty ? '—' : value}
      </div>
    </div>
  );
}

export function MiniDatum({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  /**
   * Optional semantic accent. When set (and not `neutral`), the label adopts the
   * matching `--kpi-accent` from globals.css. Defaults to the historic muted
   * label so existing `<MiniDatum label value />` call sites are unchanged.
   */
  tone?: StatTone;
}) {
  const toned = tone !== undefined && tone !== 'neutral';
  return (
    <div className={cn('min-w-0', toned && TONE_THEME_CLASS[tone])}>
      <div
        className={cn(
          'text-xs font-semibold uppercase',
          toned ? 'text-[color:var(--kpi-accent)]' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

export function PercentBar({ value, label }: { value?: number | null; label?: string }) {
  const pct = clampPercent(value) ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label ?? `${pct}%`}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <Progress
        value={pct}
        className="h-2"
        indicatorClassName={pct < 75 ? 'bg-amber-500' : pct < 95 ? 'bg-sky-500' : 'bg-primary'}
      />
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' ||
          normalized === 'degraded' ||
          normalized === 'paused' ||
          normalized === 'awaiting_approval'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'completed' ||
            normalized === 'passed' ||
            normalized === 'attested'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? labelFor(normalized)}</span>
    </Badge>
  );
}

export function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span>{text}</span>
    </div>
  );
}

export function toneFor(health?: string | null): ProtectTone {
  const normalized = normalizeStatus(health);
  if (normalized === 'critical' || normalized === 'error' || normalized === 'failed') return 'critical';
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'paused') return 'warning';
  if (normalized === 'healthy' || normalized === 'completed' || normalized === 'passed') return 'success';
  if (normalized === 'seeding' || normalized === 'streaming') return 'info';
  return 'neutral';
}

export function toneClass(tone: ProtectTone, part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
    critical: { soft: 'bg-error-50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300' },
    info: { soft: 'bg-sky-50 dark:bg-sky-950/25', text: 'text-sky-700 dark:text-sky-300' },
    neutral: { soft: 'bg-muted', text: 'text-muted-foreground' },
  } as const;
  return styles[tone][part];
}

export function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

export function labelFor(status?: string | null) {
  const normalized = normalizeStatus(status);
  return HEALTH_LABELS[normalized] ?? normalized.replace(/_/g, ' ');
}

export function resolveGroupId(group: DRGroupRollup) {
  const id = (group.group_id ?? '').trim();
  if (!id || id === 'null' || id === 'undefined') {
    return null;
  }
  return id;
}

export function formatSeconds(seconds?: number | null) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
}

export function formatDate(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatGeneratedAt(value?: string | Date | null) {
  if (!value) return 'not generated';
  return `updated ${formatDateTime(value)}`;
}

export function formatStatusCounts(counts?: Record<string, number>) {
  if (!counts || Object.keys(counts).length === 0) return 'No status counts';
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${count} ${labelFor(status)}`)
    .join(', ');
}

export function clampPercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
