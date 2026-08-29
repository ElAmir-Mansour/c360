'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/shared/relative-time';
import type { NamespacedTranslator } from '@/lib/i18n/registry';
import type { NotificationWebhook } from '@/types/models';

const statusVariants: Record<string, 'success' | 'secondary' | 'destructive'> = {
  active: 'success',
  inactive: 'secondary',
  failing: 'destructive',
};

export function getWebhookColumns(t: NamespacedTranslator): ColumnDef<NotificationWebhook>[] {
  return [
  {
    accessorKey: 'name',
    header: t('whc.colName'),
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: 'url',
    header: t('whc.colUrl'),
    cell: ({ row }) => {
      const url = row.original.url;
      const truncated = url.length > 50 ? `${url.slice(0, 50)}...` : url;
      return (
        <span className="font-mono text-xs text-muted-foreground" title={url}>
          {truncated}
        </span>
      );
    },
  },
  {
    accessorKey: 'status',
    header: t('whc.colStatus'),
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <Badge variant={statusVariants[status] ?? 'secondary'}>
          {status}
        </Badge>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: 'events',
    header: t('whc.colEvents'),
    cell: ({ row }) => {
      const events = row.original.events;
      const maxShow = 3;
      const visible = events.slice(0, maxShow);
      const remaining = events.length - maxShow;
      return (
        <div className="flex flex-wrap items-center gap-1">
          {visible.map((event) => (
            <Badge key={event} variant="outline" className="text-xs">
              {event}
            </Badge>
          ))}
          {remaining > 0 && (
            <Badge variant="secondary" className="text-xs">
              {t('whc.moreN', { n: remaining })}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'last_triggered_at',
    header: t('whc.colLastTriggered'),
    cell: ({ row }) => {
      const date = row.original.last_triggered_at;
      if (!date) return <span className="text-xs text-muted-foreground">{t('whc.never')}</span>;
      return <RelativeTime date={date} className="text-xs" />;
    },
    enableSorting: true,
  },
  {
    id: 'stats',
    header: t('whc.colStats'),
    cell: ({ row }) => (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-primary">{row.original.success_count}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-destructive">{row.original.failure_count}</span>
      </div>
    ),
  },
  ];
}
