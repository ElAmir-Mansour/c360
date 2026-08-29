'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Flag,
  PlayCircle,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useNotificationActions } from '@/hooks/use-notification-actions';
import { fetchMigrateNotifications } from '@/lib/migrate';
import type { Notification, NotificationPriority } from '@/types/models';
import { useMigrateLabels } from '../_lib/migrate-i18n';

// migrate.* notification types (Wave 5 H1) → the icon that best conveys the event.
// A migrate.<domain>.<event> type maps by its final segment; anything else falls
// back to the generic bell.
function iconForNotification(type?: string): ComponentType<{ className?: string }> {
  switch (type) {
    case 'migrate.move_group.approval_needed':
      return Flag;
    case 'migrate.move_group.decided':
    case 'migrate.gate.decided':
    case 'migrate.cutover.completed':
    case 'migrate.rollback.completed':
      return CheckCircle2;
    case 'migrate.cutover.started':
      return PlayCircle;
    case 'migrate.cutover.failed':
      return XCircle;
    case 'migrate.rollback.initiated':
      return RotateCcw;
    default:
      return Bell;
  }
}

function priorityBadgeVariant(
  priority: NotificationPriority,
): 'destructive' | 'warning' | 'secondary' | 'outline' {
  switch (priority) {
    case 'critical':
      return 'destructive';
    case 'high':
      return 'warning';
    case 'medium':
      return 'secondary';
    default:
      return 'outline';
  }
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// MigrateNotificationRail renders the current user's recent Clario Migrate
// notifications (the migrate.* events staged on the shared platform outbox and
// materialised into the platform inbox under category=migration). It is the
// command-center notification rail the Wave-4 audit found missing. Read-only apart
// from a per-item "Mark read" that reuses the shared notification action.
// The rail caches a bare Notification[] under its OWN key namespace (not the shared
// ['/api/v1/notifications'] prefix the notification-actions hook rewrites with a
// PaginatedResponse shape) so the two caches never collide on shape.
const RAIL_QUERY_KEY = ['migrate-notifications', { category: 'migration', limit: 12 }];

export function MigrateNotificationRail() {
  const labels = useMigrateLabels();
  const queryClient = useQueryClient();
  const { markAsRead } = useNotificationActions();
  const query = useQuery({
    queryKey: RAIL_QUERY_KEY,
    queryFn: () => fetchMigrateNotifications(12),
    // Poll so freshly-staged migrate events surface without a manual refresh.
    refetchInterval: 30_000,
  });

  // markRail marks a notification read (server + shared inbox cache/store) then
  // refetches the rail so its read state reflects the change.
  const markRail = async (notificationID: string) => {
    await markAsRead(notificationID);
    await queryClient.invalidateQueries({ queryKey: RAIL_QUERY_KEY });
  };

  const notifications: Notification[] = query.data ?? [];
  const unread = notifications.filter((item) => !item.read).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-4 w-4" />
          {labels.notifications.title}
          {unread > 0 ? <Badge variant="warning">{labels.notifications.unread(unread)}</Badge> : null}
        </CardTitle>
        <CardDescription>
          {labels.notifications.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingSkeleton variant="list" count={3} />
        ) : query.error ? (
          <ErrorState
            error={query.error}
            title={labels.notifications.errorTitle}
            onRetry={() => void query.refetch()}
          />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={labels.notifications.emptyTitle}
            description={labels.notifications.emptyDescription}
            size="compact"
          />
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => {
              const Icon = iconForNotification(notification.type);
              const isRisky =
                notification.priority === 'critical' || notification.priority === 'high';
              return (
                <div
                  key={notification.id}
                  className={`flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-start md:justify-between ${
                    notification.read ? 'bg-card' : 'border-primary/40 bg-primary/5'
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        isRisky ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {isRisky ? <AlertTriangle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {notification.title}
                      </p>
                      {notification.body ? (
                        <p className="text-xs text-muted-foreground">{notification.body}</p>
                      ) : null}
                      <p className="mt-1 text-caption text-muted-foreground">
                        {formatWhen(notification.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={priorityBadgeVariant(notification.priority)}>
                      {notification.priority}
                    </Badge>
                    {!notification.read ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void markRail(notification.id)}
                      >
                        {labels.notifications.markRead}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
