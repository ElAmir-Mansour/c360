'use client';

import { ColumnDef, Row } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Globe, Lock } from 'lucide-react';
import type { DataAsset } from '@/types/cyber';
import type { resolveDspmLabels } from '../_lib/dspm-i18n';

type ColumnLabels = ReturnType<typeof resolveDspmLabels>['columns'];

const CLASSIFICATION_COLORS: Record<string, string> = {
  public: 'bg-primary/15 text-primary',
  internal: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  confidential: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  restricted: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  top_secret: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
};

function ScoreBar({ score, invert = false }: { score: number; invert?: boolean }) {
  const color = invert
    ? score <= 30 ? 'bg-primary' : score <= 60 ? 'bg-severity-medium' : 'bg-severity-critical'
    : score >= 80 ? 'bg-primary' : score >= 60 ? 'bg-severity-medium' : 'bg-severity-critical';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums">{score.toFixed(0)}</span>
    </div>
  );
}

export function buildDataAssetColumns(t: ColumnLabels): ColumnDef<DataAsset>[] {
  return [
  {
    id: 'asset_name',
    accessorKey: 'asset_name',
    header: t.asset,
    cell: ({ row }: { row: Row<DataAsset> }) => {
      const asset = row.original;
      return (
        <div>
          <p className="font-medium text-sm">{asset.asset_name}</p>
          <p className="text-xs capitalize text-muted-foreground">{asset.asset_type}</p>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    id: 'classification',
    accessorKey: 'data_classification',
    header: t.classification,
    cell: ({ row }: { row: Row<DataAsset> }) => {
      const cls = row.original.data_classification;
      const color = CLASSIFICATION_COLORS[cls] ?? 'bg-muted text-muted-foreground';
      return (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${color}`}>
          {cls.replace(/_/g, ' ')}
        </span>
      );
    },
    enableSorting: true,
  },
  {
    id: 'posture_score',
    accessorKey: 'posture_score',
    header: t.posture,
    cell: ({ row }: { row: Row<DataAsset> }) => <ScoreBar score={row.original.posture_score} />,
    enableSorting: true,
  },
  {
    id: 'risk_score',
    accessorKey: 'risk_score',
    header: t.risk,
    cell: ({ row }: { row: Row<DataAsset> }) => <ScoreBar score={row.original.risk_score} invert />,
    enableSorting: true,
  },
  {
    id: 'encrypted',
    header: t.encrypted,
    cell: ({ row }: { row: Row<DataAsset> }) => {
      const at = row.original.encrypted_at_rest;
      const in_ = row.original.encrypted_in_transit;
      return (
        <div className="flex items-center gap-2 text-xs">
          <span title={t.atRest}>{at ? <Lock className="h-3.5 w-3.5 text-primary" /> : <XCircle className="h-3.5 w-3.5 text-status-error" />}</span>
          <span title={t.inTransit}>{in_ ? <CheckCircle className="h-3.5 w-3.5 text-primary" /> : <XCircle className="h-3.5 w-3.5 text-status-error" />}</span>
        </div>
      );
    },
  },
  {
    id: 'network_exposure',
    header: t.exposure,
    cell: ({ row }: { row: Row<DataAsset> }) => {
      const exp = row.original.network_exposure;
      if (!exp) return <span className="text-xs text-muted-foreground">—</span>;
      const isInternet = exp === 'internet_facing';
      return (
        <div className={`flex items-center gap-1 text-xs ${isInternet ? 'text-status-error' : 'text-muted-foreground'}`}>
          {isInternet && <Globe className="h-3.5 w-3.5" />}
          <span className="capitalize">{exp.replace(/_/g, ' ')}</span>
        </div>
      );
    },
  },
  {
    id: 'pii',
    header: t.piiTypes,
    cell: ({ row }: { row: Row<DataAsset> }) => {
      const types = row.original.pii_types ?? [];
      if (!types.length) return <span className="text-xs text-muted-foreground">{t.none}</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {types.slice(0, 2).map((t) => (
            <Badge key={t} variant="outline" className="text-xs px-1.5 py-0">{t.replace(/_/g, ' ')}</Badge>
          ))}
          {types.length > 2 && <Badge variant="outline" className="text-xs px-1.5 py-0">+{types.length - 2}</Badge>}
        </div>
      );
    },
  },
  {
    id: 'compliance',
    header: t.compliance,
    cell: ({ row }: { row: Row<DataAsset> }) => {
      const tags = row.original.metadata?.compliance_tags ?? [];
      if (!tags.length) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 2).map((tag) => (
            <Badge key={`${tag.framework}-${tag.article}`} variant="outline" className="text-xs px-1.5 py-0">
              {tag.framework.toUpperCase()} {tag.article}
            </Badge>
          ))}
          {tags.length > 2 ? <Badge variant="outline" className="text-xs px-1.5 py-0">+{tags.length - 2}</Badge> : null}
        </div>
      );
    },
  },
  {
    id: 'findings',
    header: t.findings,
    cell: ({ row }: { row: Row<DataAsset> }) => {
      const count = (row.original.posture_findings ?? []).length;
      if (!count) return <span className="text-xs text-primary">{t.clean}</span>;
      return <span className="text-xs font-medium text-severity-high">{t.issue(count)}</span>;
    },
  },
  ];
}
