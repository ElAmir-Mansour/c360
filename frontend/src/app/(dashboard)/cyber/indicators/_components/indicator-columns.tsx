'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';
import { MoreHorizontal } from 'lucide-react';
import { CopyButton } from '@/components/shared/copy-button';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import {
  INDICATOR_TYPE_BADGE_CLASSES,
  getIndicatorSourceLabel,
} from '@/lib/cyber-indicators';
import { getIndicatorTypeLabel } from '@/lib/cyber-threats';
import type { ThreatIndicator } from '@/types/cyber';

import { indicatorLabels } from '../_lib/indicators-i18n';

type IndicatorColumnLabels = (typeof indicatorLabels)['en']['columns'];

interface IndicatorColumnOptions {
  canWrite: boolean;
  labels?: IndicatorColumnLabels;
  onView: (indicator: ThreatIndicator) => void;
  onEdit?: (indicator: ThreatIndicator) => void;
  onDelete?: (indicator: ThreatIndicator) => void;
  onToggleActive?: (indicator: ThreatIndicator, active: boolean) => void;
  onOpenThreat?: (indicator: ThreatIndicator) => void;
}

export function getIndicatorColumns(options: IndicatorColumnOptions): ColumnDef<ThreatIndicator>[] {
  const labels = options.labels ?? indicatorLabels.en.columns;
  return [
    {
      id: 'type',
      accessorKey: 'type',
      header: labels.type,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <Badge
          variant="secondary"
          className={cn(
            'border-transparent text-[11px] font-semibold',
            INDICATOR_TYPE_BADGE_CLASSES[row.original.type] ?? 'bg-secondary text-foreground',
          )}
        >
          {getIndicatorTypeLabel(row.original.type)}
        </Badge>
      ),
    },
    {
      id: 'value',
      accessorKey: 'value',
      header: labels.value,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="max-w-[180px] sm:max-w-[280px] truncate text-start font-mono text-xs hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              options.onView(row.original);
            }}
          >
            {row.original.value}
          </button>
          <CopyButton value={row.original.value} />
        </div>
      ),
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: labels.severity,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <SeverityIndicator severity={row.original.severity} />
      ),
    },
    {
      id: 'source',
      accessorKey: 'source',
      header: labels.source,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <Badge variant="outline" className="text-[11px] font-medium">
          {getIndicatorSourceLabel(row.original.source)}
        </Badge>
      ),
    },
    {
      id: 'confidence',
      accessorKey: 'confidence',
      header: labels.confidence,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <div className="min-w-[128px] space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{labels.signal}</span>
            <span className="font-medium text-foreground">
              {Math.round(row.original.confidence * 100)}%
            </span>
          </div>
          <Progress value={row.original.confidence * 100} className="h-2" />
        </div>
      ),
    },
    {
      id: 'threat_name',
      header: labels.linkedThreat,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        row.original.threat_id && row.original.threat_name ? (
          <button
            type="button"
            className="max-w-[120px] sm:max-w-[180px] truncate text-start text-sm font-medium hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              options.onOpenThreat?.(row.original);
            }}
          >
            {row.original.threat_name}
          </button>
        ) : (
          <span className="text-sm text-muted-foreground">{labels.unlinked}</span>
        )
      ),
    },
    {
      id: 'active',
      accessorKey: 'active',
      header: labels.active,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <div
          className="flex items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          <Switch
            checked={row.original.active}
            disabled={!options.canWrite}
            onCheckedChange={(checked) => options.onToggleActive?.(row.original, checked)}
            aria-label={row.original.active ? labels.deactivateIndicator : labels.activateIndicator}
          />
          <span className="text-xs text-muted-foreground">
            {row.original.active ? labels.enabled : labels.disabled}
          </span>
        </div>
      ),
    },
    {
      id: 'first_seen_at',
      accessorKey: 'first_seen_at',
      header: labels.firstSeen,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <RelativeTime date={row.original.first_seen_at} />
      ),
    },
    {
      id: 'last_seen_at',
      accessorKey: 'last_seen_at',
      header: labels.lastSeen,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <span className="text-sm text-muted-foreground">{timeAgo(row.original.last_seen_at)}</span>
      ),
    },
    {
      id: 'expires_at',
      accessorKey: 'expires_at',
      header: labels.expiresAt,
      enableSorting: true,
      cell: ({ row }: { row: Row<ThreatIndicator> }) => {
        const expiresAt = row.original.expires_at;
        const isExpiringSoon = expiresAt
          ? new Date(expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
          : false;
        return (
          <span
            className={cn(
              'text-sm',
              isExpiringSoon ? 'font-medium text-error-500' : 'text-muted-foreground',
            )}
          >
            {formatDate(expiresAt)}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }: { row: Row<ThreatIndicator> }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={labels.indicatorActions}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => options.onView(row.original)}>
              {labels.viewDetails}
            </DropdownMenuItem>
            {options.canWrite && options.onEdit && (
              <DropdownMenuItem onClick={() => options.onEdit?.(row.original)}>
                {labels.editIndicator}
              </DropdownMenuItem>
            )}
            {options.canWrite && options.onDelete && (
              <DropdownMenuItem
                className="text-error-500 focus:text-error-500"
                onClick={() => options.onDelete?.(row.original)}
              >
                {labels.deleteIndicator}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}
