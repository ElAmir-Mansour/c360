'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { type Contradiction } from '@/lib/data-suite';
import { formatMaybeDateTime, qualitySeverityVisuals } from '@/lib/data-suite/utils';
import { type DataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface ContradictionColumnOptions {
  labels: DataLabels;
  onOpen: (contradiction: Contradiction) => void;
}

export function buildContradictionColumns({
  labels,
  onOpen,
}: ContradictionColumnOptions): ColumnDef<Contradiction>[] {
  const typeLabels: Record<Contradiction['type'], string> = {
    logical: labels.contradictions.ctLogical,
    semantic: labels.contradictions.ctSemantic,
    temporal: labels.contradictions.ctTemporal,
    analytical: labels.contradictions.ctAnalytical,
  };
  return [
    {
      id: 'type',
      header: labels.contradictions.colType,
      cell: ({ row }) => <Badge variant="outline">{typeLabels[row.original.type]}</Badge>,
    },
    {
      id: 'title',
      header: labels.contradictions.colTitle,
      accessorKey: 'title',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.title}</div>
          <div className="text-xs text-muted-foreground">{row.original.description}</div>
        </div>
      ),
    },
    {
      id: 'severity',
      header: labels.common.severity,
      cell: ({ row }) => {
        const severity = qualitySeverityVisuals[row.original.severity];
        return (
          <Badge variant="outline" className={severity.className}>
            {severity.label}
          </Badge>
        );
      },
    },
    {
      id: 'sources',
      header: labels.contradictions.colSources,
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          <div>{row.original.source_a.source_name}</div>
          <div>{row.original.source_b.source_name}</div>
        </div>
      ),
    },
    {
      id: 'affected_records',
      header: labels.contradictions.colAffected,
      cell: ({ row }) => row.original.affected_records.toLocaleString(),
    },
    {
      id: 'confidence',
      header: labels.contradictions.colConfidence,
      cell: ({ row }) => `${(row.original.confidence_score * 100).toFixed(0)}%`,
    },
    {
      id: 'status',
      header: labels.common.status,
      cell: ({ row }) => (
        <Badge variant="outline">
          {labels.contradictions.status[
            row.original.status as keyof typeof labels.contradictions.status
          ] ?? row.original.status}
        </Badge>
      ),
    },
    {
      id: 'created_at',
      header: labels.contradictions.colCreated,
      cell: ({ row }) => formatMaybeDateTime(row.original.created_at),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button type="button" size="sm" variant="outline" onClick={() => onOpen(row.original)}>
          {labels.contradictions.investigate}
        </Button>
      ),
    },
  ];
}
