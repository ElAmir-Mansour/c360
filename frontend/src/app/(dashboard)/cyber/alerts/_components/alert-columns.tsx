'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowUpCircle, CheckCircle2, MoreHorizontal, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { StatusBadge } from '@/components/shared/status-badge';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { ROUTES } from '@/lib/constants';
import {
  ALERT_STATUS_CONFIG,
  ALERT_STATUS_TRANSITIONS,
  alertConfidencePercent,
  getAlertStatusVariant,
} from '@/lib/cyber-alerts';
import { slugToTitle } from '@/lib/utils';
import type { CyberAlert } from '@/types/cyber';

import { alertLabels } from '../_lib/alerts-i18n';

type AlertColumnLabels = (typeof alertLabels)['en']['columns'];

interface AlertColumnOptions {
  includeSelection?: boolean;
  onAssign?: (alert: CyberAlert) => void;
  onEscalate?: (alert: CyberAlert) => void;
  onAcknowledge?: (alert: CyberAlert) => void;
  labels?: AlertColumnLabels;
}

function AlertActions({
  alert,
  onAssign,
  onEscalate,
  onAcknowledge,
  labels,
}: Omit<AlertColumnOptions, 'labels'> & { alert: CyberAlert; labels: AlertColumnLabels }) {
  const canAcknowledge = ALERT_STATUS_TRANSITIONS[alert.status]?.includes('acknowledged');
  const canEscalate = ALERT_STATUS_TRANSITIONS[alert.status]?.includes('escalated');

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={labels.alertActions}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link href={`${ROUTES.CYBER_ALERTS}/${alert.id}`}>{labels.open}</Link>
          </DropdownMenuItem>
          {canAcknowledge && (
            <DropdownMenuItem onClick={() => onAcknowledge?.(alert)}>
              <CheckCircle2 className="me-2 h-4 w-4" />
              {labels.acknowledge}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onAssign?.(alert)}>
            <UserCheck className="me-2 h-4 w-4" />
            {labels.assign}
          </DropdownMenuItem>
          {canEscalate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onEscalate?.(alert)}>
                <ArrowUpCircle className="me-2 h-4 w-4" />
                {labels.escalate}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function getAlertColumns(options: AlertColumnOptions = {}): ColumnDef<CyberAlert>[] {
  const labels = options.labels ?? alertLabels.en.columns;
  const columns: ColumnDef<CyberAlert>[] = [
    {
      id: 'severity',
      accessorKey: 'severity',
      header: labels.severity,
      cell: ({ row }) => <SeverityIndicator severity={row.original.severity} showLabel />,
      enableSorting: true,
      size: 130,
    },
    {
      id: 'title',
      accessorKey: 'title',
      header: labels.alertTitle,
      cell: ({ row }) => {
        const alert = row.original;

        return (
          <div className="min-w-0 space-y-1">
            <Link
              href={`${ROUTES.CYBER_ALERTS}/${alert.id}`}
              className="block truncate font-medium text-foreground hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {alert.title}
            </Link>
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {alert.description || labels.noDescription}
            </p>
          </div>
        );
      },
      enableSorting: true,
      size: 280,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.status,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={ALERT_STATUS_CONFIG}
          variant={getAlertStatusVariant(row.original.status)}
        />
      ),
      enableSorting: true,
      size: 150,
    },
    {
      id: 'confidence_score',
      accessorKey: 'confidence_score',
      header: labels.confidence,
      cell: ({ row }) => {
        const percent = alertConfidencePercent(row.original.confidence_score);
        const toneClass = percent >= 85
          ? 'bg-error-500'
          : percent >= 70
            ? 'bg-orange-500'
            : percent >= 50
              ? 'bg-yellow-500'
              : 'bg-primary';

        return (
          <div className="min-w-[138px] space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{percent}%</span>
            </div>
            <Progress
              value={percent}
              className="h-2"
              indicatorClassName={toneClass}
            />
          </div>
        );
      },
      enableSorting: true,
      size: 160,
    },
    {
      id: 'mitre_technique_id',
      accessorKey: 'mitre_technique_id',
      header: labels.mitreTechnique,
      cell: ({ row }) => (
        row.original.mitre_technique_id ? (
          <Badge variant="outline" className="font-mono text-[11px]">
            {row.original.mitre_technique_id}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
      size: 150,
    },
    {
      id: 'asset',
      header: labels.asset,
      cell: ({ row }) => {
        const alert = row.original;
        const label = alert.asset_name ?? alert.asset_hostname ?? alert.asset_ip_address;

        if (!label) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        if (!alert.asset_id) {
          return <span className="text-sm">{label}</span>;
        }

        return (
          <Link
            href={`/cyber/assets/${alert.asset_id}`}
            className="block truncate text-sm hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {label}
          </Link>
        );
      },
      size: 180,
    },
    {
      id: 'rule',
      header: labels.rule,
      cell: ({ row }) => {
        const alert = row.original;
        const label = alert.rule_name ?? labels.detectionPipeline;

        return (
          <div className="space-y-1">
            <p className="max-w-[120px] sm:max-w-[180px] truncate text-sm font-medium">{label}</p>
            {alert.rule_type && (
              <Badge variant="secondary" className="text-[11px]">
                {slugToTitle(alert.rule_type)}
              </Badge>
            )}
          </div>
        );
      },
      size: 200,
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: labels.createdAt,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} className="text-muted-foreground" />,
      enableSorting: true,
      size: 140,
    },
    {
      id: 'actions',
      header: labels.actions,
      cell: ({ row }) => <AlertActions alert={row.original} {...options} labels={labels} />,
      enableSorting: false,
      enableHiding: false,
      size: 74,
    },
  ];

  if (options.includeSelection) {
    return [selectColumn<CyberAlert>(), ...columns];
  }

  return columns;
}
