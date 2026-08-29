'use client';

import { ColumnDef, Row } from '@tanstack/react-table';
import Link from 'next/link';
import { MoreHorizontal, CheckCircle, PlayCircle } from 'lucide-react';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { timeAgo } from '@/lib/utils';
import { RemediationLifecycleBadge } from './remediation-lifecycle-badge';
import type { RemediationAction } from '@/types/cyber';
import type { RemediationLabels } from '../_lib/remediation-i18n';

interface RemediationColumnOptions {
  labels: RemediationLabels;
  onApprove?: (action: RemediationAction) => void;
  onExecute?: (action: RemediationAction) => void;
}

export function getRemediationColumns(options: RemediationColumnOptions): ColumnDef<RemediationAction>[] {
  const t = options.labels;
  return [
    {
      id: 'severity',
      accessorKey: 'severity',
      header: t.columns.severity,
      cell: ({ row }: { row: Row<RemediationAction> }) => (
        <SeverityIndicator severity={row.original.severity} showLabel />
      ),
      enableSorting: true,
    },
    {
      id: 'title',
      accessorKey: 'title',
      header: t.columns.remediation,
      cell: ({ row }: { row: Row<RemediationAction> }) => {
        const action = row.original;
        return (
          <div>
            <Link href={`/cyber/remediation/${action.id}`} className="font-medium hover:underline">
              {action.title}
            </Link>
            <p className="text-xs text-muted-foreground capitalize">{action.type.replace(/_/g, ' ')}</p>
          </div>
        );
      },
      enableSorting: true,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t.columns.status,
      cell: ({ row }: { row: Row<RemediationAction> }) => (
        <RemediationLifecycleBadge status={row.original.status} />
      ),
      enableSorting: true,
    },
    {
      id: 'plan.reversible',
      header: t.columns.reversible,
      cell: ({ row }: { row: Row<RemediationAction> }) => (
        <span className={`text-xs ${row.original.plan.reversible ? 'text-primary' : 'text-warning-700 dark:text-warning-300'}`}>
          {row.original.plan.reversible ? t.columns.yes : t.columns.no}
        </span>
      ),
    },
    {
      id: 'created_by_name',
      header: t.columns.createdBy,
      cell: ({ row }: { row: Row<RemediationAction> }) => (
        <span className="text-sm text-muted-foreground">{row.original.created_by_name ?? '—'}</span>
      ),
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: t.columns.created,
      cell: ({ row }: { row: Row<RemediationAction> }) => (
        <span className="text-sm text-muted-foreground">{timeAgo(row.original.created_at)}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }: { row: Row<RemediationAction> }) => {
        const action = row.original;
        const canApprove = action.status === 'pending_approval';
        const canExecute = action.status === 'dry_run_completed' || action.status === 'approved';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={t.columns.actionsAria}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canApprove && (
                <DropdownMenuItem onClick={() => options.onApprove?.(action)}>
                  <CheckCircle className="me-2 h-3.5 w-3.5 text-primary" /> {t.columns.approve}
                </DropdownMenuItem>
              )}
              {canExecute && (
                <DropdownMenuItem onClick={() => options.onExecute?.(action)}>
                  <PlayCircle className="me-2 h-3.5 w-3.5 text-blue-600" /> {t.columns.execute}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link href={`/cyber/remediation/${action.id}`}>{t.columns.viewDetails}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      enableSorting: false,
    },
  ];
}
