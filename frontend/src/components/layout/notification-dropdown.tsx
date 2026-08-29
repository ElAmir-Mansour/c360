'use client';

import { useState, useRef, useEffect, memo, useCallback, useId } from 'react';
import { Bell, Shield, Database, Workflow, Settings, Gavel, AlertTriangle, CloudUpload } from 'lucide-react';
import Link from 'next/link';
import { useNotificationStore } from '@/stores/notification-store';
import { cn } from '@/lib/utils';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import type { Notification, NotificationCategory } from '@/types/models';
import { useNotificationActions } from '@/hooks/use-notification-actions';
import { isNotificationRead } from '@/lib/notification-utils';
import { useNavigationLabels } from './navigation-labels';
import { useFormat } from '@/lib/format/index';

function getCategoryIcon(category: NotificationCategory) {
  const icons: Record<NotificationCategory, React.ElementType> = {
    security: Shield,
    data: Database,
    workflow: Workflow,
    system: Settings,
    governance: Gavel,
    legal: AlertTriangle,
    migration: CloudUpload,
  };
  return icons[category] ?? Bell;
}

function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    critical: 'text-error-500',
    high: 'text-warning-700 dark:text-warning-300',
    medium: 'text-blue-500',
    low: 'text-muted-foreground',
  };
  return colors[priority] ?? 'text-muted-foreground';
}

const NotificationItem = memo(function NotificationItem({
  notification,
  onRead,
  relativeTime,
}: {
  notification: Notification;
  onRead: (id: string, url?: string | null) => void;
  relativeTime: (value: string | Date | null | undefined) => string;
}) {
  const Icon = getCategoryIcon(notification.category);
  const iconColor = getPriorityColor(notification.priority);
  const unread = !isNotificationRead(notification);

  return (
    <button
      onClick={() => onRead(notification.id, notification.action_url)}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/50',
        unread && 'bg-primary/5',
      )}
      type="button"
    >
      <div className={cn('mt-0.5 shrink-0', iconColor)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {unread && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          )}
          <p className={cn('truncate text-sm', unread && 'font-medium')}>
            {notification.title}
          </p>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
        <time
          dateTime={notification.created_at}
          className="mt-1 block text-xs text-muted-foreground"
        >
          {relativeTime(notification.created_at)}
        </time>
      </div>
    </button>
  );
});

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const panelId = useId();
  // Granular selectors: each property subscribes independently,
  // so a change in e.g. connectionStatus doesn't re-render the whole list.
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const recentNotifications = useNotificationStore((s) => s.recentNotifications);
  const isInitialized = useNotificationStore((s) => s.isInitialized);
  const connectionStatus = useNotificationStore((s) => s.connectionStatus);
  const { markAsRead, markAllAsRead } = useNotificationActions();
  const { direction, shell } = useNavigationLabels();
  const format = useFormat();

  const notificationLabel = shell('shell.notifications');
  const triggerLabel = unreadCount > 0
    ? `${notificationLabel} (${format.formatNumber(unreadCount)} ${shell('shell.notificationsUnread')})`
    : notificationLabel;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleRead = useCallback(async (id: string, url?: string | null) => {
    await markAsRead(id);
    setOpen(false);
    if (url) {
      window.location.href = url;
    }
  }, [markAsRead]);

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await markAllAsRead();
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div ref={dropdownRef} className="relative" dir={direction}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-card text-foreground/80 shadow-sm transition-all hover:border-primary/35 hover:bg-secondary hover:text-primary"
        type="button"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
            connectionStatus === 'connected' && 'bg-success-500',
            (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && 'bg-warning-500',
            connectionStatus === 'disconnected' && 'bg-foreground/50',
            connectionStatus === 'failed' && 'bg-error-600',
          )}
        />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute end-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-destructive-foreground"
          >
            {unreadCount > 9 ? `${format.formatNumber(9)}+` : format.formatNumber(unreadCount)}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
          className="surface-card absolute end-0 top-full z-50 mt-2 flex max-h-[min(72dvh,36rem)] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <h3 id={headingId} className="text-sm font-semibold">{notificationLabel}</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={markingAll}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                type="button"
              >
                {markingAll
                  ? shell('shell.markingAllNotificationsRead')
                  : shell('shell.markAllNotificationsRead')}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {!isInitialized ? (
              <div className="p-4">
                <LoadingSkeleton variant="list-item" count={3} />
              </div>
            ) : recentNotifications.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <Bell className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  {shell('shell.noNewNotifications')}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {recentNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onRead={handleRead}
                    relativeTime={format.formatRelative}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border/70 px-4 py-3">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center text-xs font-medium text-primary hover:underline"
            >
              {shell('shell.viewAllNotifications')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
