'use client';

import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, GitCompareArrows, History, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AIDashboardModelRow, AIDriftLevel } from '@/types/ai-governance';
import { resolveAdminLabels } from '../../_lib/admin-i18n';
import type { AppLocale } from '@/lib/i18n';
import { driftLevelLabel, modelTypeLabel, riskTierLabel } from '../_lib/enum-labels';

interface ModelColumnOptions {
  busyModelId?: string | null;
  onPromote: (row: AIDashboardModelRow) => void;
  onRollback: (row: AIDashboardModelRow) => void;
  onStartShadow: (row: AIDashboardModelRow) => void;
  locale?: AppLocale;
}

function driftVariant(level: AIDriftLevel) {
  switch (level) {
    case 'significant':
      return 'destructive';
    case 'moderate':
      return 'warning';
    case 'low':
      return 'secondary';
    default:
      return 'success';
  }
}

function riskVariant(level: string) {
  switch (level) {
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

export function createModelColumns({
  busyModelId,
  onPromote,
  onRollback,
  onStartShadow,
  locale = 'en',
}: ModelColumnOptions): ColumnDef<AIDashboardModelRow>[] {
  const labels = resolveAdminLabels(locale);
  return [
    {
      id: 'name',
      header: labels.aiGovernance.colModel,
      accessorKey: 'name',
      enableSorting: true,
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="font-medium">{row.original.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.slug}</div>
        </div>
      ),
    },
    {
      id: 'suite',
      header: labels.aiGovernance.colSuite,
      accessorKey: 'suite',
      cell: ({ row }) => <Badge variant="secondary">{row.original.suite}</Badge>,
    },
    {
      id: 'type',
      header: labels.aiGovernance.colType,
      accessorKey: 'type',
      cell: ({ row }) => <Badge variant="outline">{modelTypeLabel(row.original.type, locale)}</Badge>,
    },
    {
      id: 'versions',
      header: labels.aiGovernance.colVersions,
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <div>
            {labels.aiGovernance.prod}:{' '}
            <span className="font-medium">
              {row.original.production_version ? `v${row.original.production_version.version_number}` : labels.aiGovernance.none}
            </span>
          </div>
          <div className="text-muted-foreground">
            {labels.aiGovernance.shadow}:{' '}
            <span className="font-medium text-foreground">
              {row.original.shadow_version ? `v${row.original.shadow_version.version_number}` : labels.aiGovernance.inactive}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'predictions_24h',
      header: labels.aiGovernance.colPredictions,
      accessorKey: 'predictions_24h',
      enableSorting: true,
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <div className="font-medium">{row.original.predictions_24h.toLocaleString()}</div>
          <div className="text-muted-foreground">
            {labels.aiGovernance.avgConf} {row.original.avg_confidence ? `${Math.round(row.original.avg_confidence * 100)}%` : labels.aiGovernance.notAvailable}
          </div>
        </div>
      ),
    },
    {
      id: 'drift_status',
      header: labels.aiGovernance.colDrift,
      accessorKey: 'drift_status',
      cell: ({ row }) => (
        <Badge variant={driftVariant(row.original.drift_status)}>
          {driftLevelLabel(row.original.drift_status, locale)}
        </Badge>
      ),
    },
    {
      id: 'risk_tier',
      header: labels.aiGovernance.colRiskTier,
      accessorKey: 'risk_tier',
      cell: ({ row }) => <Badge variant={riskVariant(row.original.risk_tier)}>{riskTierLabel(row.original.risk_tier, locale)}</Badge>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const isBusy = busyModelId === row.original.id;
        return (
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/admin/ai-governance/${row.original.id}`}>{labels.aiGovernance.details}</Link>
            </Button>
            {row.original.shadow_version ? (
              <Button variant="outline" size="sm" disabled={isBusy} onClick={() => onPromote(row.original)}>
                <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                {labels.aiGovernance.promote}
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={isBusy} onClick={() => onStartShadow(row.original)}>
                <GitCompareArrows className="me-1.5 h-3.5 w-3.5" />
                {labels.aiGovernance.startShadow}
              </Button>
            )}
            {row.original.production_version ? (
              <Button variant="outline" size="sm" disabled={isBusy} onClick={() => onRollback(row.original)}>
                <History className="me-1.5 h-3.5 w-3.5" />
                {labels.aiGovernance.rollback}
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/admin/ai-governance/${row.original.id}#shadow`}>
                <ArrowRightLeft className="me-1.5 h-3.5 w-3.5" />
                {labels.aiGovernance.shadow}
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];
}
