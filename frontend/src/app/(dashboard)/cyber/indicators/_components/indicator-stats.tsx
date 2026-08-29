'use client';

import { useMemo } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Fingerprint,
  Shield,
  Zap,
} from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import { cn } from '@/lib/utils';
import { getIndicatorSourceLabel } from '@/lib/cyber-indicators';
import type { IndicatorStats as IndicatorStatsType } from '@/types/cyber';

import { useIndicatorLabels } from '../_lib/indicators-i18n';

interface IndicatorStatsProps {
  stats?: IndicatorStatsType;
  loading?: boolean;
}

const SOURCE_COLORS: Record<string, { bar: string; dot: string }> = {
  osint:    { bar: 'from-violet-500 to-purple-600',   dot: 'bg-violet-500' },
  stix:     { bar: 'from-blue-500 to-indigo-600',     dot: 'bg-blue-500' },
  internal: { bar: 'from-primary to-primary',    dot: 'bg-primary' },
  vendor:   { bar: 'from-warning-500 to-orange-500',    dot: 'bg-warning-500' },
  manual:   { bar: 'from-rose-400 to-pink-500',       dot: 'bg-rose-500' },
};

function getSourceColor(name: string) {
  return SOURCE_COLORS[name.toLowerCase()] ?? { bar: 'from-neutral-ink/40 to-neutral-ink/50', dot: 'bg-neutral-ink/35' };
}

export function IndicatorStats({ stats, loading = false }: IndicatorStatsProps) {
  const t = useIndicatorLabels();
  const sourceBreakdown = useMemo(() => {
    const total = Math.max(
      1,
      (stats?.by_source ?? []).reduce((sum, item) => sum + item.count, 0),
    );

    return (stats?.by_source ?? []).map((item) => ({
      ...item,
      label: getIndicatorSourceLabel(item.name),
      percent: (item.count / total) * 100,
    }));
  }, [stats?.by_source]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <KpiCard
        title={t.stats.totalIocs}
        value={stats?.total ?? 0}
        icon={Fingerprint}
        tone="sky"
        description={t.stats.totalIocsDesc}
        loading={loading}
      />
      <KpiCard
        title={t.stats.activeIocs}
        value={stats?.active ?? 0}
        icon={Shield}
        tone="emerald"
        description={stats?.total ? t.stats.activeIocsDesc(Math.round(((stats.active ?? 0) / stats.total) * 100)) : t.stats.monitoring}
        loading={loading}
      />
      <KpiCard
        title={t.stats.expiringSoon}
        value={stats?.expiring_soon ?? 0}
        icon={Clock}
        tone="gold"
        description={t.stats.expiringSoonDesc}
        loading={loading}
      />

      {/* Source Mix — custom card */}
      <div className="kpi-card-themed kpi-theme-primary">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="kpi-icon-badge">
            <BarChart3 className="h-[18px] w-[18px]" />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--kpi-accent)' }}>
            {t.stats.sourceMix}
          </span>
        </div>

        <div className="space-y-2.5">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-1.5">
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-1.5 animate-pulse rounded-full bg-muted" />
              </div>
            ))
          ) : sourceBreakdown.length > 0 ? (
            sourceBreakdown.map((item) => {
              const colors = getSourceColor(item.name);
              return (
                <div key={item.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', colors.dot)} />
                      <span className="font-medium text-foreground/70">{item.label}</span>
                    </div>
                    <span className="font-bold tabular-nums text-foreground">{item.count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary">
                    <div
                      className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', colors.bar)}
                      style={{ width: `${Math.max(item.percent, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">{t.stats.noSourceTelemetry}</p>
          )}
        </div>
      </div>
    </div>
  );
}
