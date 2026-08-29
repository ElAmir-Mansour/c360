'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, RotateCw, Wifi, WifiOff } from 'lucide-react';
import type { ConnectionStatus } from '@/types/models';
import { useNotificationStore } from '@/stores/notification-store';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatRelativeAt } from '@/lib/format/datetime';
import { cn } from '@/lib/utils';
import { useDashboardText } from './dashboard-i18n';
import { Button } from '@/components/ui/button';

interface DashboardDataStatusProps {
  lastUpdated: Date | null;
  connectionStatus: ConnectionStatus;
  isFallbackPolling: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  className?: string;
}

/**
 * Makes the dashboard's data contract visible: when the last successful read
 * completed, whether push updates are active, and explicit recovery controls.
 */
export function DashboardDataStatus({
  lastUpdated,
  connectionStatus,
  isFallbackPolling,
  isRefreshing,
  onRefresh,
  className,
}: DashboardDataStatusProps) {
  const { locale } = useLocaleOrDefault();
  const t = useDashboardText();
  const requestReconnect = useNotificationStore((state) => state.requestReconnect);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const canResume = connectionStatus === 'disconnected' || connectionStatus === 'failed';
  const updateLabel =
    lastUpdated && now
      ? `${t.freshness.updated} ${formatRelativeAt(lastUpdated, locale, now)}`
      : t.freshness.waiting;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
        {connectionStatus === 'connected' ? (
          <Wifi className="h-3.5 w-3.5 text-status-success" aria-hidden="true" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-warning-700 dark:text-warning-300" aria-hidden="true" />
        )}
        <span>{updateLabel}</span>
        <span aria-hidden="true">·</span>
        <span>{isFallbackPolling ? t.freshness.fallback : t.freshness.live}</span>
      </span>

      {canResume && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={requestReconnect}
          className="h-8 min-h-8 gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/5"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {t.freshness.resume}
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label={isRefreshing ? t.freshness.refreshing : t.freshness.refresh}
        title={isRefreshing ? t.freshness.refreshing : t.freshness.refresh}
        className="h-8 min-h-8 w-8 min-w-8 rounded-lg text-primary hover:bg-primary/5 disabled:cursor-wait"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} aria-hidden="true" />
      </Button>
    </div>
  );
}
