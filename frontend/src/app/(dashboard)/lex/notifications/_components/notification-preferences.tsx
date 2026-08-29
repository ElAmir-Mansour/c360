'use client';

/**
 * NotificationPreferences renders the per-user, per-(category, channel)
 * subscription override matrix (CAP-157). Opt-out model: a channel is ON unless
 * a stored override sets enabled=false. Toggling a switch upserts the override;
 * the inbox (in_app) channel is informational since durable delivery is always
 * available. lex:write gates the toggles. RTL-safe (`.table-premium`).
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  LEX_NOTIFICATION_CATEGORIES,
  LEX_NOTIFICATION_CHANNELS,
  lexNotificationsApi,
  type LexNotificationCategory,
  type LexNotificationChannel,
  type LexNotificationSubscription,
} from '@/lib/lex/notifications';
import type { NotificationsLabels } from '../_lib/notifications-labels';

interface NotificationPreferencesProps {
  labels: NotificationsLabels;
}

/** Key a (category, channel) pair into a single string for override lookup. */
function key(category: LexNotificationCategory, channel: LexNotificationChannel): string {
  return `${category}:${channel}`;
}

export function NotificationPreferences({ labels }: NotificationPreferencesProps) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // §8.7/§9 — editing notification preferences is a notification-manage action.
  const canWrite = hasPermission('lex:notification:manage');

  const subsQuery = useQuery({
    queryKey: ['lex-notifications', 'subscriptions'],
    queryFn: () => lexNotificationsApi.listSubscriptions(),
  });

  // Build an override lookup: only rows with enabled=false suppress a channel.
  const overrides = useMemo(() => {
    const map = new Map<string, LexNotificationSubscription>();
    for (const sub of subsQuery.data ?? []) {
      map.set(key(sub.category, sub.channel), sub);
    }
    return map;
  }, [subsQuery.data]);

  const upsertMutation = useMutation({
    mutationFn: (payload: {
      category: LexNotificationCategory;
      channel: LexNotificationChannel;
      enabled: boolean;
    }) => lexNotificationsApi.upsertSubscription(payload),
    onSuccess: async () => {
      showSuccess(labels.preferences.saved);
      await queryClient.invalidateQueries({ queryKey: ['lex-notifications', 'subscriptions'] });
    },
    onError: showApiError,
  });

  const isEnabled = (category: LexNotificationCategory, channel: LexNotificationChannel): boolean => {
    const override = overrides.get(key(category, channel));
    return override ? override.enabled : true;
  };

  if (subsQuery.isLoading) {
    return <LoadingSkeleton variant="card" count={2} />;
  }
  if (subsQuery.isError) {
    return <ErrorState message={labels.preferences.loadError} onRetry={() => void subsQuery.refetch()} />;
  }

  return (
    <SectionCard title={labels.preferences.title} description={labels.preferences.description}>
      <div className="overflow-x-auto">
        <table className="table-premium w-full">
          <thead>
            <tr>
              <th>{labels.preferences.category}</th>
              {LEX_NOTIFICATION_CHANNELS.map((channel) => (
                <th key={channel} className="text-center">
                  {labels.channelLabels[channel]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEX_NOTIFICATION_CATEGORIES.map((category) => (
              <tr key={category}>
                <td className="font-medium">{labels.categoryLabels[category]}</td>
                {LEX_NOTIFICATION_CHANNELS.map((channel) => {
                  const enabled = isEnabled(category, channel);
                  return (
                    <td key={channel} className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Switch
                          id={`pref-${category}-${channel}`}
                          checked={enabled}
                          disabled={!canWrite || upsertMutation.isPending}
                          onCheckedChange={(next) =>
                            upsertMutation.mutate({ category, channel, enabled: next })
                          }
                        />
                        <span className="sr-only">
                          {enabled ? labels.preferences.enabled : labels.preferences.muted}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{labels.preferences.note}</p>
      <p className="text-xs text-muted-foreground">{labels.preferences.inAppNote}</p>
    </SectionCard>
  );
}
