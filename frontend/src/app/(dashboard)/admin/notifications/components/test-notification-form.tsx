'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSendTestNotification } from '@/hooks/use-delivery-stats';
import { useNotificationWebhooks } from '@/hooks/use-webhooks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { showSuccess, showApiError } from '@/lib/toast';
import { useT } from '@/components/providers/locale-provider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Send } from 'lucide-react';
import type { NotificationType } from '@/types/models';

const NOTIFICATION_TYPES: { value: NotificationType; labelKey: string }[] = [
  { value: 'alert', labelKey: 'tnf.typeAlert' },
  { value: 'task', labelKey: 'tnf.typeTask' },
  { value: 'approval', labelKey: 'tnf.typeApproval' },
  { value: 'system', labelKey: 'tnf.typeSystem' },
  { value: 'mention', labelKey: 'tnf.typeMention' },
  { value: 'deadline', labelKey: 'tnf.typeDeadline' },
  { value: 'completion', labelKey: 'tnf.typeCompletion' },
  { value: 'error', labelKey: 'tnf.typeError' },
  { value: 'report', labelKey: 'tnf.typeReport' },
];

const CHANNELS = [
  { value: 'email', labelKey: 'tnf.chEmail' },
  { value: 'in_app', labelKey: 'tnf.chInApp' },
  { value: 'websocket', labelKey: 'tnf.chRealtime' },
  { value: 'webhook', labelKey: 'tnf.chWebhook' },
] as const;

const testSchema = z.object({
  type: z.enum(['alert', 'task', 'approval', 'system', 'mention', 'deadline', 'completion', 'error', 'report']),
  channel: z.enum(['email', 'in_app', 'websocket', 'webhook']),
  webhook_id: z.string().optional(),
});

type TestFormData = z.infer<typeof testSchema>;

export function TestNotificationForm() {
  const t = useT('admin');
  const form = useForm<TestFormData>({
    resolver: zodResolver(testSchema),
    defaultValues: {
      type: 'system',
      channel: 'in_app',
    },
  });

  const sendMutation = useSendTestNotification();
  const selectedChannel = form.watch('channel');

  const { data: webhooksData } = useNotificationWebhooks(
    selectedChannel === 'webhook' ? { page: 1, per_page: 100 } : undefined,
  );

  const onSubmit = async (data: TestFormData) => {
    try {
      const result = await sendMutation.mutateAsync({
        type: data.type,
        channel: data.channel,
        webhook_id: data.channel === 'webhook' ? data.webhook_id : undefined,
      });
      showSuccess(t('tnf.sentToast'), result.message);
    } catch (error) {
      showApiError(error);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-base">{t('tnf.title')}</CardTitle>
        <CardDescription>
          {t('tnf.desc')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>{t('tnf.notificationType')}</Label>
            <Select
              value={form.watch('type')}
              onValueChange={(v) => form.setValue('type', v as NotificationType)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('tnf.selectType')} />
              </SelectTrigger>
              <SelectContent>
                {NOTIFICATION_TYPES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.type && (
              <p className="text-xs text-destructive">{form.formState.errors.type.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('tnf.channel')}</Label>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((ch) => (
                <Button
                  key={ch.value}
                  type="button"
                  variant={selectedChannel === ch.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => form.setValue('channel', ch.value)}
                >
                  {t(ch.labelKey)}
                </Button>
              ))}
            </div>
          </div>

          {selectedChannel === 'webhook' && (
            <div className="space-y-2">
              <Label>{t('tnf.webhook')}</Label>
              <Select
                value={form.watch('webhook_id') ?? ''}
                onValueChange={(v) => form.setValue('webhook_id', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('tnf.selectWebhook')} />
                </SelectTrigger>
                <SelectContent>
                  {(webhooksData?.data ?? []).map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            type="submit"
            disabled={sendMutation.isPending}
            className="w-full"
          >
            <Send className="me-2 h-4 w-4" />
            {sendMutation.isPending ? t('tnf.sending') : t('tnf.sendTest')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
