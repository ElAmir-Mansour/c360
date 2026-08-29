'use client';

import { motion } from 'framer-motion';
import {
  Clock,
  Timer,
  Shield,
  Activity,
  Users,
  FileCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatNumber } from '@/lib/format/numerals';
import type { AppLocale } from '@/lib/i18n';
import { API_ENDPOINTS } from '@/lib/constants';
import { statusVar } from '@/lib/design-tokens';
import { useDashboardRealtimeData } from './use-dashboard-realtime-data';
import { useDashboardText } from './dashboard-i18n';

interface DashboardMetrics {
  mttr_minutes?: number;
  mtta_minutes?: number;
  sla_compliance_pct?: number;
  active_incidents?: number;
  active_users_today?: number;
  pending_reviews?: number;
}

const STATUS_COLORS = {
  green: statusVar('success'),
  amber: statusVar('warning'),
  red: statusVar('error'),
} as const;

type StatusColor = (typeof STATUS_COLORS)[keyof typeof STATUS_COLORS];

function getStatusColor(
  value: number | undefined | null,
  evaluate: (v: number) => StatusColor,
): StatusColor {
  if (value == null) return STATUS_COLORS.green;
  return evaluate(value);
}

interface MetricConfig {
  key: string;
  label: string;
  icon: LucideIcon;
  value: number | undefined;
  suffix: string;
  colorFn: (v: number) => StatusColor;
  permission?: string;
}

/** Localized duration/percent/count formatting. Digits follow the active locale. */
function formatMetricValue(
  value: number,
  suffix: string,
  locale: AppLocale,
  units: { day: string; hour: string; minute: string },
): string {
  const num = (n: number, fractionDigits = 0) =>
    formatNumber(n, locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  if (suffix === 'min') {
    if (value >= 1440) {
      return `${num(value / 1440, 1)}${units.day}`;
    }
    if (value >= 60) {
      return `${num(value / 60, 1)}${units.hour}`;
    }
    return `${num(Math.round(value))}${units.minute}`;
  }
  if (suffix === '%') {
    return `${num(Math.round(value))}%`;
  }
  return formatNumber(value, locale);
}

export function SecondaryMetricsStrip() {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const t = useDashboardText();
  const hasCyber = hasPermission('cyber:read');

  const { data: envelope, isLoading, error } = useDashboardRealtimeData<{ data: DashboardMetrics }>(
    API_ENDPOINTS.CYBER_DASHBOARD_METRICS,
    {
      wsTopics: ['dashboard.metrics.updated'],
      enabled: hasCyber,
    },
  );
  const data = envelope?.data;

  // Hide entire strip when user has no cyber access (all data comes from cyber endpoint)
  if (!hasCyber) return null;
  // Hide entire strip if the endpoint doesn't exist or returned an error
  if (error && !isLoading) return null;
  // Also hide if we got a response but all values are undefined (no data)
  if (!isLoading && data && Object.values(data).every((v) => v === undefined || v === null)) return null;

  const metrics: MetricConfig[] = [
    {
      key: 'mttr',
      label: t.metrics.mttr,
      icon: Clock,
      value: data?.mttr_minutes,
      suffix: 'min',
      colorFn: (v: number) =>
        v <= 60 ? STATUS_COLORS.green : v <= 120 ? STATUS_COLORS.amber : STATUS_COLORS.red,
      permission: 'cyber:read',
    },
    {
      key: 'mtta',
      label: t.metrics.mtta,
      icon: Timer,
      value: data?.mtta_minutes,
      suffix: 'min',
      colorFn: (v: number) =>
        v <= 15 ? STATUS_COLORS.green : v <= 30 ? STATUS_COLORS.amber : STATUS_COLORS.red,
      permission: 'cyber:read',
    },
    {
      key: 'sla',
      label: t.metrics.sla,
      icon: Shield,
      value: data?.sla_compliance_pct,
      suffix: '%',
      colorFn: (v: number) =>
        v >= 95 ? STATUS_COLORS.green : v >= 85 ? STATUS_COLORS.amber : STATUS_COLORS.red,
    },
    {
      key: 'incidents',
      label: t.metrics.incidents,
      icon: Activity,
      value: data?.active_incidents,
      suffix: '',
      colorFn: (v: number) =>
        v === 0 ? STATUS_COLORS.green : v <= 3 ? STATUS_COLORS.amber : STATUS_COLORS.red,
      permission: 'cyber:read',
    },
    {
      key: 'users',
      label: t.metrics.users,
      icon: Users,
      value: data?.active_users_today,
      suffix: '',
      colorFn: (_v: number) => STATUS_COLORS.green,
    },
    {
      key: 'reviews',
      label: t.metrics.reviews,
      icon: FileCheck,
      value: data?.pending_reviews,
      suffix: '',
      colorFn: (v: number) =>
        v === 0 ? STATUS_COLORS.green : v <= 5 ? STATUS_COLORS.amber : STATUS_COLORS.red,
    },
  ].filter((m) => {
    if (m.permission === 'cyber:read' && !hasCyber) return false;
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.4 }}
      className="overflow-x-auto rounded-2xl border border-border/60"
      style={{
        background: 'hsl(var(--card) / 0.55)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div className="flex flex-nowrap">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          const color = getStatusColor(metric.value, metric.colorFn);
          const isLast = index === metrics.length - 1;

          return (
            <div
              key={metric.key}
              className={`flex flex-1 flex-col items-center justify-center gap-1 px-4 py-3 min-w-[100px] ${!isLast ? 'border-r border-border/40' : ''}`}
            >
              <Icon className="h-3 w-3 text-muted-foreground" />

              {isLoading ? (
                <div className="h-4 w-8 animate-pulse rounded bg-muted/50" />
              ) : (
                <bdi
                  dir="ltr"
                  className="text-sm font-semibold tabular-nums"
                  style={{ color }}
                >
                  {metric.value != null
                    ? formatMetricValue(metric.value, metric.suffix, locale, {
                        day: t.metrics.unitDay,
                        hour: t.metrics.unitHour,
                        minute: t.metrics.unitMinute,
                      })
                    : '—'}
                </bdi>
              )}

              <span className="whitespace-nowrap text-overline font-medium uppercase tracking-wider text-muted-foreground">
                {metric.label}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
