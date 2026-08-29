'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Bot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import type { NamespacedTranslator } from '@/lib/i18n/registry';
import type { AuditLog } from '@/types/models';

const serviceColors: Record<string, string> = {
  'iam-service': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'audit-service': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  'workflow-engine': 'bg-primary/15 text-primary dark:bg-primary/30 dark:text-primary',
  'notification-service': 'bg-warning-100 text-warning-700 dark:bg-warning-700/30 dark:text-warning-300',
  'file-service': 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  'cyber-service': 'bg-error-100 text-error-600 dark:bg-error-700/30 dark:text-error-300',
  'data-service': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
};

export function formatAuditAction(action: string): string {
  return action
    .split('.')
    .map((part) =>
      part
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    )
    .join(' › ');
}

export function getAuditColumns(
  t: NamespacedTranslator,
  onRowClick: (log: AuditLog) => void
): ColumnDef<AuditLog>[] {
  return [
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: t('ac.colTimestamp'),
      size: 140,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
      enableSorting: true,
    },
    {
      id: 'user',
      header: t('ac.colUser'),
      size: 180,
      cell: ({ row }) => {
        const log = row.original;
        const isSystem = !log.user_id || log.user_email === 'system';
        if (isSystem) {
          return (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              {t('ac.system')}
            </span>
          );
        }
        return (
          <div className="min-w-0">
            <p className="text-sm truncate">{log.user_email}</p>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: 'service',
      accessorKey: 'service',
      header: t('ac.colService'),
      size: 140,
      cell: ({ row }) => {
        const service = row.original.service ?? 'unknown';
        const colorClass = serviceColors[service] ?? 'bg-secondary text-foreground/70 dark:bg-neutral-ink dark:text-foreground/45';
        return (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
            {service}
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: 'action',
      accessorKey: 'action',
      header: t('ac.colAction'),
      size: 200,
      cell: ({ row }) => (
        <span className="text-sm">{formatAuditAction(row.original.action)}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'resource',
      header: t('ac.colResource'),
      size: 180,
      cell: ({ row }) => {
        const log = row.original;
        return (
          <div className="min-w-0">
            <span className="text-sm text-muted-foreground">{log.resource_type}</span>
            {log.resource_id && (
              <span className="text-xs font-mono text-muted-foreground ms-1">
                · {log.resource_id.slice(0, 8)}
              </span>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: t('ac.colSeverity'),
      size: 100,
      cell: ({ row }) => {
        const severity = row.original.severity;
        if (!severity) return <Badge variant="outline" className="text-xs">{t('ac.infoSeverity')}</Badge>;
        return <SeverityIndicator severity={severity === 'warning' ? 'medium' : severity === 'high' ? 'high' : severity === 'critical' ? 'critical' : 'info'} />;
      },
      enableSorting: true,
    },
    {
      id: 'ip_address',
      accessorKey: 'ip_address',
      header: t('ac.colIpAddress'),
      size: 130,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ip_address}
        </span>
      ),
      enableSorting: false,
    },
  ];
}
