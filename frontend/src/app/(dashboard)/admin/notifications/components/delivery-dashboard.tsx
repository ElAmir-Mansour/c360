'use client';

import { useState } from 'react';
import { useDeliveryStats, useRetryFailedDeliveries } from '@/hooks/use-delivery-stats';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { TONE_THEME_CLASS } from '@/components/shared/stat-card';
import { showSuccess, showApiError } from '@/lib/toast';
import { useT } from '@/components/providers/locale-provider';
import { Send, CheckCircle, XCircle, Clock, TrendingUp, RotateCw } from 'lucide-react';
import { DeliveryCharts } from './delivery-charts';

type Period = '7d' | '30d' | '90d';
type Channel = 'email' | 'in_app' | 'websocket' | 'webhook' | undefined;

export function DeliveryDashboard() {
  const t = useT('admin');
  const [period, setPeriod] = useState<Period>('7d');
  const [channel, setChannel] = useState<Channel>(undefined);
  const [retryOpen, setRetryOpen] = useState(false);

  const { data: stats, isLoading, isError, refetch } = useDeliveryStats({
    period,
    channel: channel as 'email' | 'in_app' | 'websocket' | 'webhook' | undefined,
  });

  const retryMutation = useRetryFailedDeliveries();

  const handleRetry = async () => {
    try {
      const result = await retryMutation.mutateAsync({
        channel: channel ?? undefined,
      });
      showSuccess(t('deld.retrying', { n: result.retried }));
      setRetryOpen(false);
      refetch();
    } catch (error) {
      showApiError(error);
    }
  };

  if (isLoading) return <LoadingSkeleton variant="kpi" count={5} />;
  if (isError) return <ErrorState message={t('deld.failedLoad')} onRetry={() => refetch()} />;
  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('deld.period')}</span>
          {(['7d', '30d', '90d'] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {p}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('deld.channel')}</span>
          {[
            { value: undefined, label: t('deld.chAll') },
            { value: 'email' as const, label: t('deld.chEmail') },
            { value: 'in_app' as const, label: t('deld.chInApp') },
            { value: 'websocket' as const, label: t('deld.chRealtime') },
            { value: 'webhook' as const, label: t('deld.chWebhook') },
          ].map((ch) => (
            <Button
              key={ch.label}
              variant={channel === ch.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setChannel(ch.value)}
            >
              {ch.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className={`kpi-card-themed ${TONE_THEME_CLASS.sky}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[color:var(--kpi-accent)]">{t('deld.totalSent')}</span>
            <div className="kpi-icon-badge shrink-0">
              <Send className="h-[18px] w-[18px]" aria-hidden />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{(stats.total_sent ?? 0).toLocaleString()}</div>
        </div>

        <div className={`kpi-card-themed ${TONE_THEME_CLASS.emerald}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[color:var(--kpi-accent)]">{t('deld.delivered')}</span>
            <div className="kpi-icon-badge shrink-0">
              <CheckCircle className="h-[18px] w-[18px]" aria-hidden />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{(stats.delivered ?? 0).toLocaleString()}</div>
        </div>

        <div className={`kpi-card-themed ${TONE_THEME_CLASS.rose}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[color:var(--kpi-accent)]">{t('deld.failed')}</span>
            <div className="kpi-icon-badge shrink-0">
              <XCircle className="h-[18px] w-[18px]" aria-hidden />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-foreground">{(stats.failed ?? 0).toLocaleString()}</span>
            {(stats.failed ?? 0) > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRetryOpen(true)}
                className="h-7 text-xs"
              >
                <RotateCw className="me-1 h-3 w-3" />
                {t('deld.retry')}
              </Button>
            )}
          </div>
        </div>

        <div className={`kpi-card-themed ${TONE_THEME_CLASS.emerald}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[color:var(--kpi-accent)]">{t('deld.deliveryRate')}</span>
            <div className="kpi-icon-badge shrink-0">
              <TrendingUp className="h-[18px] w-[18px]" aria-hidden />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {((stats.delivery_rate ?? 0) * 100).toFixed(1)}%
          </div>
        </div>

        <div className={`kpi-card-themed ${TONE_THEME_CLASS.gold}`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[color:var(--kpi-accent)]">{t('deld.avgDelivery')}</span>
            <div className="kpi-icon-badge shrink-0">
              <Clock className="h-[18px] w-[18px]" aria-hidden />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {(stats.avg_delivery_time_ms ?? 0) < 1000
              ? `${stats.avg_delivery_time_ms ?? 0}ms`
              : `${((stats.avg_delivery_time_ms ?? 0) / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>

      {/* Charts */}
      <DeliveryCharts stats={stats} />

      {/* Retry Dialog */}
      <ConfirmDialog
        open={retryOpen}
        onOpenChange={setRetryOpen}
        title={t('deld.retryTitle')}
        description={
          channel
            ? t('deld.retryDescChannel', { n: stats.failed ?? 0, channel })
            : t('deld.retryDescGeneric', { n: stats.failed ?? 0 })
        }
        confirmLabel={t('deld.retryAll')}
        onConfirm={handleRetry}
        loading={retryMutation.isPending}
      />
    </div>
  );
}
