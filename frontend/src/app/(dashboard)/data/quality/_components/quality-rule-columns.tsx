'use client';

import { useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { type QualityRule } from '@/lib/data-suite';
import { formatMaybeDateTime, qualitySeverityVisuals } from '@/lib/data-suite/utils';
import { useDataLabels, type DataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface QualityRuleColumnOptions {
  labels: DataLabels;
  runningId: string | null;
  togglingId: string | null;
  deletingId: string | null;
  onRun: (rule: QualityRule) => void;
  onEdit: (rule: QualityRule) => void;
  onToggleEnabled: (rule: QualityRule, enabled: boolean) => void;
  onDelete: (rule: QualityRule) => void;
}

interface QualityRuleActionsCellProps extends Omit<QualityRuleColumnOptions, 'labels'> {
  rule: QualityRule;
}

function QualityRuleActionsCell({
  rule,
  runningId,
  togglingId: _togglingId,
  deletingId,
  onRun,
  onEdit,
  onToggleEnabled: _onToggleEnabled,
  onDelete,
}: QualityRuleActionsCellProps) {
  const labels = useDataLabels();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => onEdit(rule)}>
        {labels.common.edit}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onRun(rule)}
        disabled={runningId === rule.id}
      >
        {runningId === rule.id ? labels.common.running : labels.common.runNow}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={deletingId === rule.id}
        onClick={() => setDeleteOpen(true)}
      >
        {deletingId === rule.id ? labels.common.deleting : labels.common.delete}
      </Button>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={labels.quality.deleteRuleTitle}
        description={labels.quality.deleteRuleDesc(rule.name)}
        confirmLabel={labels.common.delete}
        variant="destructive"
        onConfirm={() => onDelete(rule)}
      />
    </div>
  );
}

export function buildQualityRuleColumns({
  labels,
  runningId,
  togglingId,
  deletingId,
  onRun,
  onEdit,
  onToggleEnabled,
  onDelete,
}: QualityRuleColumnOptions): ColumnDef<QualityRule>[] {
  return [
    {
      id: 'name',
      header: labels.quality.colRule,
      accessorKey: 'name',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.rule_type} {row.original.column_name ? `• ${row.original.column_name}` : ''}
          </div>
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
      id: 'enabled',
      header: labels.common.enabled,
      cell: ({ row }) => (
        <Switch
          checked={row.original.enabled}
          onCheckedChange={(checked) => onToggleEnabled(row.original, checked)}
          disabled={togglingId === row.original.id}
        />
      ),
    },
    {
      id: 'last_status',
      header: labels.quality.colLastStatus,
      cell: ({ row }) => row.original.last_status ?? labels.quality.neverRun,
    },
    {
      id: 'last_run_at',
      header: labels.quality.colLastRun,
      cell: ({ row }) => formatMaybeDateTime(row.original.last_run_at),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <QualityRuleActionsCell
          rule={row.original}
          runningId={runningId}
          togglingId={togglingId}
          deletingId={deletingId}
          onRun={onRun}
          onEdit={onEdit}
          onToggleEnabled={onToggleEnabled}
          onDelete={onDelete}
        />
      ),
    },
  ];
}
