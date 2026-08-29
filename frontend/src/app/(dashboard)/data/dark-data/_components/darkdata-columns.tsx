'use client';

import { MoreHorizontal } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type DarkDataAsset } from '@/lib/data-suite';
import { formatMaybeBytes, formatMaybeDateTime, getClassificationBadge } from '@/lib/data-suite/utils';
import { type DataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface DarkDataColumnOptions {
  labels: DataLabels;
  onReview: (asset: DarkDataAsset) => void;
  onGovern: (asset: DarkDataAsset) => void;
  onArchive: (asset: DarkDataAsset) => void;
  onScheduleDeletion: (asset: DarkDataAsset) => void;
}

export function buildDarkDataColumns({
  labels,
  onReview,
  onGovern,
  onArchive,
  onScheduleDeletion,
}: DarkDataColumnOptions): ColumnDef<DarkDataAsset>[] {
  return [
    {
      id: 'name',
      header: labels.darkData.colName,
      accessorKey: 'name',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.file_path || row.original.table_name || row.original.source_name || labels.darkData.unknownLocation}
          </div>
        </div>
      ),
    },
    {
      id: 'type',
      header: labels.darkData.colType,
      cell: ({ row }) => <Badge variant="outline">{row.original.asset_type}</Badge>,
    },
    {
      id: 'reason',
      header: labels.darkData.colReason,
      cell: ({ row }) => <Badge variant="outline">{row.original.reason}</Badge>,
    },
    {
      id: 'size',
      header: labels.darkData.colSize,
      cell: ({ row }) => formatMaybeBytes(row.original.estimated_size_bytes),
    },
    {
      id: 'classification',
      header: labels.darkData.colClassification,
      cell: ({ row }) => {
        const badge = getClassificationBadge(row.original.inferred_classification);
        return (
          <Badge variant="outline" className={badge.className}>
            {badge.label}
          </Badge>
        );
      },
    },
    {
      id: 'risk',
      header: labels.darkData.colRisk,
      cell: ({ row }) => `${row.original.risk_score.toFixed(0)}%`,
    },
    {
      id: 'last_accessed',
      header: labels.darkData.colLastAccessed,
      cell: ({ row }) => formatMaybeDateTime(row.original.last_accessed_at),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onReview(row.original)}>
            {labels.darkData.review}
          </Button>
          <Button type="button" size="sm" onClick={() => onGovern(row.original)}>
            {labels.darkData.govern}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" aria-label={labels.darkData.ddActions}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onArchive(row.original)}>{labels.darkData.archive}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onScheduleDeletion(row.original)}>
                {labels.darkData.scheduleDeletion}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
}
