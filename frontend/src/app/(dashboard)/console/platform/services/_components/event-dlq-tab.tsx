'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useT } from '@/components/providers/locale-provider';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { prettyJson, unwrapList, unwrapTotal } from '@/lib/response-shape';

type DeadLetterEntry = {
  id: string;
  original_event_id: string;
  original_type: string;
  original_topic: string;
  tenant_id: string;
  error: string;
  retry_count: number;
  event_data?: unknown;
  failed_at: string;
  status: string;
};

export function EventDLQTab() {
  const t = useT();
  const queryClient = useQueryClient();
  const [pendingClear, setPendingClear] = useState<DeadLetterEntry | null>(null);
  const dlqQuery = useQuery({
    queryKey: ['platform-event-dlq'],
    queryFn: () => apiGet<unknown>(API_ENDPOINTS.EVENT_DEAD_LETTER),
    refetchInterval: 30_000,
  });

  const replayMutation = useMutation({
    mutationFn: (entry: DeadLetterEntry) => apiPost(API_ENDPOINTS.EVENT_DEAD_LETTER_REPLAY(entry.id), {}),
    onSuccess: () => {
      toast.success(t('platformConsole.services.dlqReplayToast'));
      void queryClient.invalidateQueries({ queryKey: ['platform-event-dlq'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: DeadLetterEntry) => apiDelete<void>(API_ENDPOINTS.EVENT_DEAD_LETTER_DETAIL(entry.id)),
    onSuccess: () => {
      toast.success(t('platformConsole.services.dlqClearToast'));
      void queryClient.invalidateQueries({ queryKey: ['platform-event-dlq'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const entries = unwrapList<DeadLetterEntry>(dlqQuery.data, ['entries']);
  const total = unwrapTotal(dlqQuery.data, entries.length);
  const pending = entries.filter((entry) => entry.status === 'pending').length;

  const statusLabel = (status: string) => {
    if (status === 'pending') return t('platformConsole.services.dlqStatusPending');
    if (status === 'replayed') return t('platformConsole.services.dlqStatusReplayed');
    if (status === 'acknowledged') return t('platformConsole.services.dlqStatusAcknowledged');
    return status || t('platformConsole.services.unknown');
  };

  const clearEntry = async () => {
    if (!pendingClear) return;
    await deleteMutation.mutateAsync(pendingClear);
  };

  if (dlqQuery.isLoading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton variant="kpi" count={3} />
        <LoadingSkeleton variant="list" count={3} />
      </div>
    );
  }

  if (dlqQuery.error) {
    return <ErrorState error={dlqQuery.error} onRetry={() => void dlqQuery.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title={t('platformConsole.services.dlqEntries')} value={String(total)} detail={t('platformConsole.services.dlqEntriesDetail')} />
        <MetricCard title={t('platformConsole.services.dlqPendingReplay')} value={String(pending)} detail={t('platformConsole.services.dlqPendingReplayDetail')} />
        <MetricCard title={t('platformConsole.services.dlqReplayed')} value={String(entries.filter((entry) => entry.status === 'replayed').length)} detail={t('platformConsole.services.dlqReplayedDetail')} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            {t('platformConsole.services.dlqTitle')}
          </CardTitle>
          <CardDescription>{t('platformConsole.services.dlqDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{entry.original_type || entry.id}</p>
                    <Badge variant="outline">{statusLabel(entry.status)}</Badge>
                    <Badge variant="secondary">{entry.original_topic || t('platformConsole.services.dlqUnknownTopic')}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('platformConsole.services.dlqEntryMeta')
                      .replace('{tenant}', entry.tenant_id || t('platformConsole.services.unknown'))
                      .replace('{failedAt}', entry.failed_at ? new Date(entry.failed_at).toLocaleString() : t('platformConsole.services.unknown'))
                      .replace('{retries}', String(entry.retry_count ?? 0))}
                  </p>
                  {entry.error && <p className="mt-2 text-sm text-destructive">{entry.error}</p>}
                  <Textarea value={prettyJson(entry.event_data ?? {})} readOnly className="mt-3 min-h-[120px] font-mono text-xs" />
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => replayMutation.mutate(entry)}
                    disabled={replayMutation.isPending || entry.status === 'replayed'}
                    aria-label={`${t('platformConsole.services.dlqReplay')} - ${entry.original_type || entry.id}`}
                  >
                    <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                    {t('platformConsole.services.dlqReplay')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setPendingClear(entry)}
                    disabled={deleteMutation.isPending}
                    aria-label={`${t('platformConsole.services.dlqClear')} - ${entry.original_type || entry.id}`}
                  >
                    <Trash2 className="me-1.5 h-3.5 w-3.5" />
                    {t('platformConsole.services.dlqClear')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {entries.length === 0 && (
            <EmptyState
              icon={Inbox}
              title={t('platformConsole.services.dlqEmpty')}
              description={t('platformConsole.services.dlqEmptyDesc')}
              size="compact"
            />
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={Boolean(pendingClear)}
        onOpenChange={(open) => {
          if (!open) setPendingClear(null);
        }}
        title={t('platformConsole.services.dlqClearTitle')}
        description={t('platformConsole.services.dlqClearDesc').replace('{entry}', pendingClear?.original_type || pendingClear?.id || '')}
        confirmLabel={t('platformConsole.services.dlqClear')}
        cancelLabel={t('platformConsole.services.cancel')}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={clearEntry}
      />
    </div>
  );
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
