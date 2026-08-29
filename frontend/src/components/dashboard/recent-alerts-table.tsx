'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Shield, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_ENDPOINTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatRelativeAt } from '@/lib/format/datetime';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import type { PaginatedResponse } from '@/types/api';
import type { Alert, Notification } from '@/types/models';
import { Button } from '@/components/ui/button';
import { HighlightAnimation } from '@/components/realtime/highlight-animation';
import { severityVar, statusVar } from '@/lib/design-tokens';
import { useDashboardRealtimeData } from './use-dashboard-realtime-data';
import { useDashboardText } from './dashboard-i18n';
import { useDashboardViewPreferences } from './widget-board/dashboard-preferences-context';
import { formatISO, subDays } from 'date-fns';

const SEVERITY_COLORS: Record<string, string> = {
  critical: severityVar('critical'),
  high: severityVar('high'),
  medium: severityVar('medium'),
  low: severityVar('info'),
  info: statusVar('neutral'),
};

function severityClass(severity: string): string {
  return cn(
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
    severity === 'critical' && 'bg-error-100 text-error-700 dark:bg-error-700/40 dark:text-error-300',
    severity === 'high' && 'bg-warning-100 text-warning-700 dark:bg-warning-800/40 dark:text-warning-300',
    severity === 'medium' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
    severity === 'low' && 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
    severity === 'info' && 'bg-secondary text-foreground',
  );
}

function statusClass(status: string): string {
  return cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
    status === 'new' && 'bg-destructive/10 text-destructive',
    status === 'acknowledged' && 'bg-warning-100 text-warning-700 dark:bg-warning-800/40 dark:text-warning-300',
    status === 'investigating' && 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
    status === 'resolved' && 'bg-primary/15 text-primary',
    status === 'false_positive' && 'bg-muted text-muted-foreground',
  );
}

export function RecentAlertsTable() {
  const { locale } = useLocaleOrDefault();
  const t = useDashboardText();
  const { horizonDays } = useDashboardViewPreferences();
  const alertStart = useMemo(
    () => formatISO(subDays(new Date(), horizonDays)),
    [horizonDays],
  );
  const [pendingAlert, setPendingAlert] = useState<Notification | null>(null);
  const [highlightedAlertId, setHighlightedAlertId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const {
    data,
    isLoading,
    error,
    mutate,
  } = useDashboardRealtimeData<PaginatedResponse<Alert>>(API_ENDPOINTS.CYBER_ALERTS, {
    params: {
      sort: 'created_at',
      order: 'desc',
      per_page: 5,
      date_from: alertStart,
    },
    wsTopics: ['alert.created'],
    onNewItem: (notification) => {
      setPendingAlert(notification);
    },
  });

  const handleShow = async () => {
    await mutate();
    const alertId = getAlertId(pendingAlert);
    if (alertId) {
      setHighlightedAlertId(alertId);
      window.setTimeout(() => setHighlightedAlertId(null), 3000);
    }
    setPendingAlert(null);
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <motion.div
      ref={tableRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="flex flex-col rounded-2xl border border-border/60"
      style={{
        background: 'hsl(var(--card) / 0.6)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t.alerts.title}</h3>
        </div>
        <Link
          href="/cyber/alerts"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t.alerts.viewAll}
          <ArrowRight className="h-3 w-3 rtl:-scale-x-100" />
        </Link>
      </div>

      <AnimatePresence>
        {pendingAlert && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-warning-50/60 px-5 py-2 text-sm dark:bg-warning-800/30">
              <span className="font-medium text-warning-700 dark:text-warning-300">{t.alerts.newDetected}</span>
              <Button variant="ghost" size="sm" onClick={() => void handleShow()}>
                {t.alerts.show}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="p-4">
          <LoadingSkeleton variant="table-row" count={5} />
        </div>
      ) : error ? (
        <ErrorState message={t.alerts.loadFailed} onRetry={() => void mutate()} />
      ) : !data || data.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-success/[0.08]">
            <Shield className="h-[22px] w-[22px] text-primary" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-muted-foreground">{t.alerts.emptyTitle}</p>
            <p className="mt-0.5 text-xs text-muted-foreground/70">{t.alerts.emptyHint}</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border/40 bg-muted/20">
              <tr>
                <th className="px-5 py-2.5 text-start text-xs font-medium text-muted-foreground">{t.alerts.colSeverity}</th>
                <th className="px-4 py-2.5 text-start text-xs font-medium text-muted-foreground">{t.alerts.colTitle}</th>
                <th className="hidden px-4 py-2.5 text-start text-xs font-medium text-muted-foreground sm:table-cell">{t.alerts.colStatus}</th>
                <th className="hidden px-4 py-2.5 text-start text-xs font-medium text-muted-foreground md:table-cell">{t.alerts.colTime}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((alert) => (
                <tr
                  key={alert.id}
                  className="border-b border-border/30 last:border-0 transition-colors hover:bg-muted/20"
                >
                  <td colSpan={4} className="p-0">
                    <HighlightAnimation
                      highlight={highlightedAlertId === alert.id}
                      highlightKey={highlightedAlertId === alert.id ? alert.id : null}
                    >
                      <div className="grid cursor-pointer grid-cols-[140px_1fr] sm:grid-cols-[140px_1fr_160px] md:grid-cols-[140px_1fr_160px_120px]">
                        <div className="flex items-center gap-2 px-5 py-2.5">
                          {/* Severity dot */}
                          <div
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{
                              backgroundColor: SEVERITY_COLORS[alert.severity] ?? statusVar('neutral'),
                              boxShadow: alert.severity === 'critical'
                                ? '0 0 8px hsl(var(--severity-critical) / 0.5)'
                                : 'none',
                            }}
                          />
                          <span className={severityClass(alert.severity)}>
                            {t.alerts.severity[alert.severity] ?? alert.severity}
                          </span>
                        </div>
                        <div className="px-4 py-2.5">
                          <Link
                            href={`/cyber/alerts/${alert.id}`}
                            className="block max-w-[240px] truncate font-medium hover:underline"
                          >
                            {alert.title}
                          </Link>
                        </div>
                        <div className="hidden px-4 py-2.5 sm:block">
                          <span className={statusClass(alert.status)}>
                            {t.alerts.status[alert.status] ?? alert.status.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="hidden px-4 py-2.5 text-muted-foreground md:block">
                          {formatRelativeAt(alert.created_at, locale, new Date())}
                        </div>
                      </div>
                    </HighlightAnimation>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

function getAlertId(notification: Notification | null): string | null {
  if (!notification) {
    return null;
  }
  if (typeof notification.data?.id === 'string') {
    return notification.data.id;
  }
  if (typeof notification.action_url === 'string') {
    const parts = notification.action_url.split('/');
    return parts[parts.length - 1] ?? null;
  }
  return null;
}
