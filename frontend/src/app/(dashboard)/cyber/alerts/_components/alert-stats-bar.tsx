'use client';

import { Activity, BadgeAlert, Clock3, ShieldAlert, Siren } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { API_ENDPOINTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { AlertStats, NamedCount } from '@/types/cyber';

import { useAlertLabels } from '../_lib/alerts-i18n';

interface AlertStatsBarProps {
  onFilterByStatus?: (status: string[]) => void;
}

export function AlertStatsBar({ onFilterByStatus }: AlertStatsBarProps) {
  const t = useAlertLabels();
  const { data: envelope } = useRealtimeData<{ data: AlertStats }>(
    API_ENDPOINTS.CYBER_ALERTS_STATS,
    {
      pollInterval: 60000,
      wsTopics: ['cyber.alert.created', 'cyber.alert.status_changed', 'cyber.alert.escalated'],
    },
  );

  const stats = envelope?.data;
  const byStatus = Object.fromEntries((stats?.by_status ?? []).map((item) => [item.name, item.count]));

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      <StatCard
        title={t.stats.newAlerts}
        value={byStatus.new ?? 0}
        subtitle={t.stats.newAlertsSub}
        icon={Siren}
        tone="red"
        pulse={(byStatus.new ?? 0) > 0}
        onClick={() => onFilterByStatus?.(['new'])}
      />
      <StatCard
        title={t.stats.investigating}
        value={sumCounts(stats?.by_status ?? [], ['investigating', 'in_progress'])}
        subtitle={t.stats.investigatingSub}
        icon={BadgeAlert}
        tone="amber"
        onClick={() => onFilterByStatus?.(['investigating', 'in_progress'])}
      />
      <StatCard
        title={t.stats.falsePositiveRate}
        value={formatPercent(stats?.false_positive_rate)}
        subtitle={t.stats.falsePositiveRateSub}
        icon={ShieldAlert}
        tone="purple"
      />
      <StatCard
        title={t.stats.mtta}
        value={formatHours(stats?.mtta_hours)}
        subtitle={t.stats.mttaSub}
        icon={Clock3}
        tone="blue"
      />
      <StatCard
        title={t.stats.mttr}
        value={formatHours(stats?.mttr_hours)}
        subtitle={t.stats.mttrSub}
        icon={Activity}
        tone="green"
      />
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: typeof Activity;
  tone: 'red' | 'amber' | 'purple' | 'blue' | 'green';
  pulse?: boolean;
  onClick?: () => void;
}

function StatCard({ title, value, subtitle, icon: Icon, tone, pulse = false, onClick }: StatCardProps) {
  const clickable = typeof onClick === 'function';

  return (
    <Card className={cn(
      'overflow-hidden',
      clickable && 'cursor-pointer',
    )}>
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        className={cn('w-full text-start', !clickable && 'cursor-default')}
      >
        <CardContent className="flex items-start justify-between gap-4 p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                {title}
              </span>
              {pulse && <span className="h-2.5 w-2.5 rounded-full bg-error-500 animate-pulse" aria-hidden="true" />}
            </div>
            <div className="text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {value}
            </div>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className={cn(
            'flex h-11 w-11 items-center justify-center rounded-2xl border',
            toneClasses[tone],
          )}>
            <Icon className="h-5 w-5" />
          </div>
        </CardContent>
      </button>
    </Card>
  );
}

const toneClasses = {
  red: 'border-error-100 bg-error-50 dark:border-error-700 dark:bg-error-700/30 text-error-500 dark:text-error-300',
  amber: 'border-warning-300 bg-warning-50 dark:border-warning-800 dark:bg-warning-800/30 text-warning-700 dark:text-warning-300',
  purple: 'border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400',
  blue: 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400',
  green: 'border-primary/30 bg-primary/10 text-primary',
} as const;

function sumCounts(items: NamedCount[], names: string[]): number {
  const lookup = new Set(names);
  return items.reduce((total, item) => (
    lookup.has(item.name) ? total + item.count : total
  ), 0);
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0%';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatHours(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0h';
  }
  return `${value.toFixed(1)}h`;
}
