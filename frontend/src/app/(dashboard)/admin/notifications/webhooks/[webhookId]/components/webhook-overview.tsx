'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { RelativeTime } from '@/components/shared/relative-time';
import type { StatTone } from '@/components/shared/stat-card';
import { useTestWebhook, useRotateWebhookSecret } from '@/hooks/use-webhooks';
import { WebhookSecretDialog } from '../../components/webhook-secret-dialog';
import { showSuccess, showError, showApiError } from '@/lib/toast';
import { Send, KeyRound, CheckCircle, XCircle } from 'lucide-react';
import { useT } from '@/components/providers/locale-provider';
import type { NotificationWebhook } from '@/types/models';

const statusVariants: Record<string, 'success' | 'secondary' | 'destructive'> = {
  active: 'success',
  inactive: 'secondary',
  failing: 'destructive',
};

/** Webhook status tone: healthy -> emerald, failing -> rose, otherwise slate. */
const statusTones: Record<string, StatTone> = {
  active: 'emerald',
  inactive: 'slate',
  failing: 'rose',
};

interface WebhookOverviewProps {
  webhook: NotificationWebhook;
  onRefresh: () => void;
}

export function WebhookOverview({ webhook, onRefresh }: WebhookOverviewProps) {
  const [testOpen, setTestOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [secretData, setSecretData] = useState<{ name: string; secret: string } | null>(null);
  const t = useT('admin');

  const testMutation = useTestWebhook();
  const rotateMutation = useRotateWebhookSecret();

  const handleTest = async () => {
    try {
      const result = await testMutation.mutateAsync(webhook.id);
      if (result.success) {
        showSuccess(t('wo.testOk'), `HTTP ${result.response_status}`);
      } else {
        showError(t('wo.testFail'), result.response_body);
      }
    } catch (error) {
      showApiError(error);
    }
    setTestOpen(false);
  };

  const handleRotate = async () => {
    try {
      const result = await rotateMutation.mutateAsync(webhook.id);
      setRotateOpen(false);
      setSecretData({ name: webhook.name, secret: result.secret });
      onRefresh();
    } catch (error) {
      showApiError(error);
    }
  };

  const totalDeliveries = webhook.success_count + webhook.failure_count;
  const successRateValue = totalDeliveries > 0 ? (webhook.success_count / totalDeliveries) * 100 : null;
  const successRate = successRateValue !== null ? successRateValue.toFixed(1) : '—';
  // Health sentiment: high delivery success -> emerald, degraded -> rose.
  const successRateTone: StatTone =
    successRateValue === null ? 'neutral' : successRateValue >= 90 ? 'emerald' : 'rose';

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}>
          <Send className="me-2 h-3.5 w-3.5" />
          {t('wo.test')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRotateOpen(true)}>
          <KeyRound className="me-2 h-3.5 w-3.5" />
          {t('wo.rotateSecret')}
        </Button>
      </div>

      {/* Status and delivery stat tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailStatCard
          label={t('c.status')}
          tone={statusTones[webhook.status] ?? 'slate'}
          value={
            <Badge variant={statusVariants[webhook.status] ?? 'secondary'} className="text-sm">
              {webhook.status}
            </Badge>
          }
        />
        <DetailStatCard
          label={t('wo.success')}
          tone="emerald"
          icon={CheckCircle}
          value={webhook.success_count.toLocaleString()}
        />
        <DetailStatCard
          label={t('wo.failures')}
          tone={webhook.failure_count > 0 ? 'rose' : 'neutral'}
          icon={XCircle}
          value={webhook.failure_count.toLocaleString()}
        />
        <DetailStatCard
          label={t('wo.successRate')}
          tone={successRateTone}
          value={`${successRate}%`}
        />
      </div>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('wo.configuration')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-muted-foreground">URL</span>
            <span className="break-all font-mono text-xs">{webhook.url}</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-muted-foreground">{t('wo.events')}</span>
            <div className="flex flex-wrap gap-1">
              {webhook.events.map((event) => (
                <Badge key={event} variant="outline" className="text-xs">
                  {event}
                </Badge>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-muted-foreground">{t('wo.retryPolicy')}</span>
            <span>
              {t('wo.retriesN', { n: webhook.retry_policy.max_retries })}، {webhook.retry_policy.backoff_type} {t('wo.backoff')}،{' '}
              {t('wo.delayN', { n: webhook.retry_policy.initial_delay_seconds })}
            </span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <span className="text-muted-foreground">{t('wo.lastTriggered')}</span>
            <span>
              {webhook.last_triggered_at ? (
                <RelativeTime date={webhook.last_triggered_at} />
              ) : (
                t('c.never')
              )}
            </span>
          </div>
          {Object.keys(webhook.headers).length > 0 && (
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <span className="text-muted-foreground">{t('wo.headers')}</span>
              <div className="space-y-1">
                {Object.entries(webhook.headers).map(([key, value]) => (
                  <p key={key} className="font-mono text-xs">
                    {key}: {value}
                  </p>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <ConfirmDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        title={t('wo.testWebhook')}
        description={t('wo.testDesc', { name: webhook.name })}
        confirmLabel={t('wo.sendTest')}
        onConfirm={handleTest}
        loading={testMutation.isPending}
      />

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={t('wo.rotateSecret')}
        description={t('wo.rotateDesc')}
        confirmLabel={t('wo.rotate')}
        variant="destructive"
        onConfirm={handleRotate}
        loading={rotateMutation.isPending}
      />

      <WebhookSecretDialog
        open={Boolean(secretData)}
        onOpenChange={() => setSecretData(null)}
        webhookName={secretData?.name ?? ''}
        secret={secretData?.secret ?? ''}
      />
    </div>
  );
}
