'use client';

import Link from 'next/link';
import { AlertTriangle, ShieldAlert, Minus, TrendingDown } from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import { EmptyState } from '@/components/common/empty-state';
import type { AlertSummary, CyberSeverity } from '@/types/cyber';
import { useCyberDashboardLabels, useCyberAlertStatusLabels } from '../_lib/cyber-i18n';

interface RecentAlertsTableProps {
  alerts: AlertSummary[];
}

const SEVERITY_CONFIG: Record<CyberSeverity, { icon: React.ElementType; color: string; bg: string }> = {
  critical: { icon: ShieldAlert, color: 'text-severity-critical', bg: 'bg-severity-critical/15' },
  high: { icon: AlertTriangle, color: 'text-severity-high', bg: 'bg-severity-high/15' },
  medium: { icon: AlertTriangle, color: 'text-warning-700 dark:text-warning-300', bg: 'bg-severity-medium/15' },
  low: { icon: TrendingDown, color: 'text-severity-low', bg: 'bg-severity-low/15' },
  info: { icon: Minus, color: 'text-foreground/55', bg: 'bg-secondary' },
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-status-error/15 text-status-error',
  acknowledged: 'bg-status-warning/15 text-warning-700 dark:text-warning-300',
  investigating: 'bg-status-info/15 text-status-info',
  in_progress: 'bg-status-pending/15 text-status-pending',
  resolved: 'bg-primary/15 text-primary',
  closed: 'bg-secondary text-foreground',
  false_positive: 'bg-secondary text-foreground/70',
  escalated: 'bg-status-error/25 text-status-error',
};

export function RecentAlertsTable({ alerts }: RecentAlertsTableProps) {
  const t = useCyberDashboardLabels();
  const statusLabels = useCyberAlertStatusLabels();
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t.recentAlertsEmptyTitle}
        description={t.recentAlertsEmptyDescription}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30">
          <tr>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{t.colSev}</th>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{t.colTitle}</th>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground hidden md:table-cell">{t.colStatus}</th>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground hidden lg:table-cell">{t.colConfidence}</th>
            <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{t.colDetected}</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => {
            const sevConfig = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
            const SevIcon = sevConfig.icon;
            return (
              <tr key={alert.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2">
                  <span className={cn('inline-flex items-center justify-center rounded-full p-1', sevConfig.bg)}>
                    <SevIcon className={cn('h-3 w-3', sevConfig.color)} />
                  </span>
                </td>
                <td className="px-3 py-2 max-w-[120px] sm:max-w-[200px]">
                  <Link
                    href={`/cyber/alerts/${alert.id}`}
                    className="font-medium hover:underline line-clamp-1"
                  >
                    {alert.title}
                  </Link>
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[alert.status] ?? 'bg-secondary text-foreground')}>
                    {statusLabels[alert.status] ?? alert.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 hidden lg:table-cell">
                  {alert.confidence_score !== undefined ? (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            alert.confidence_score > 0.8 ? 'bg-primary' : alert.confidence_score > 0.5 ? 'bg-status-warning' : 'bg-status-error',
                          )}
                          style={{ width: `${Math.round(alert.confidence_score * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{Math.round(alert.confidence_score * 100)}%</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo(alert.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
