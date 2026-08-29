'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { Copy, Eye, FlaskConical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { getRuleTypeColor, getRuleTypeLabel } from '@/lib/cyber-rules';
import { timeAgo } from '@/lib/utils';
import type { DetectionRule } from '@/types/cyber';

import { RulePerformanceCard } from './rule-performance-card';
import { useRulesLabels, type RulesLabels } from '../_lib/rules-i18n';

interface RuleColumnOptions {
  onToggle: (rule: DetectionRule) => void;
  onEdit: (rule: DetectionRule) => void;
  onDuplicate: (rule: DetectionRule) => void;
  onDelete: (rule: DetectionRule) => void;
  onTest: (rule: DetectionRule) => void;
}

function ActionsCell({
  rule,
  options,
}: {
  rule: DetectionRule;
  options: RuleColumnOptions;
}) {
  const t = useRulesLabels();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t.columns.ruleActionsAria}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/cyber/detection-rules/${rule.id}`}>
              <Eye className="me-2 h-4 w-4" />
              {t.columns.viewDetails}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => options.onEdit(rule)}>
            <Pencil className="me-2 h-4 w-4" />
            {t.columns.edit}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => options.onDuplicate(rule)}>
            <Copy className="me-2 h-4 w-4" />
            {t.columns.duplicate}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => options.onTest(rule)}>
            <FlaskConical className="me-2 h-4 w-4" />
            {t.columns.testRule}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-error-500 focus:text-error-500" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="me-2 h-4 w-4" />
            {t.columns.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.columns.deleteTitle}
        description={t.columns.deleteDescription(rule.name)}
        confirmLabel={t.columns.deleteConfirm}
        variant="destructive"
        onConfirm={() => options.onDelete(rule)}
      />
    </>
  );
}

export function getRuleColumns(options: RuleColumnOptions, labels: RulesLabels): ColumnDef<DetectionRule>[] {
  const c = labels.columns;
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: c.ruleName,
      enableSorting: true,
      cell: ({ row }: { row: Row<DetectionRule> }) => (
        <div className="space-y-1">
          <Link href={`/cyber/detection-rules/${row.original.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
            {row.original.name}
          </Link>
          <p className="max-w-md truncate text-xs text-muted-foreground">{row.original.description || c.noDescription}</p>
        </div>
      ),
    },
    {
      id: 'type',
      accessorKey: 'rule_type',
      header: c.type,
      cell: ({ row }: { row: Row<DetectionRule> }) => (
        <Badge className={getRuleTypeColor(row.original.rule_type)}>
          {getRuleTypeLabel(row.original.rule_type)}
        </Badge>
      ),
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: c.severity,
      cell: ({ row }: { row: Row<DetectionRule> }) => (
        <SeverityIndicator severity={row.original.severity} showLabel />
      ),
    },
    {
      id: 'mitre',
      header: c.mitreTechnique,
      cell: ({ row }: { row: Row<DetectionRule> }) => {
        const techniques = row.original.mitre_technique_ids ?? [];
        if (techniques.length === 0) {
          return <span className="text-sm text-muted-foreground">{c.unmapped}</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {techniques.slice(0, 2).map((techniqueId) => (
              <Badge key={techniqueId} variant="outline" className="font-mono text-xs">
                {techniqueId}
              </Badge>
            ))}
            {techniques.length > 2 ? (
              <span className="text-xs text-muted-foreground">+{techniques.length - 2}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'enabled',
      accessorKey: 'enabled',
      header: c.status,
      cell: ({ row }: { row: Row<DetectionRule> }) => (
        <div className="flex items-center gap-3">
          <Switch checked={row.original.enabled} onCheckedChange={() => options.onToggle(row.original)} aria-label={row.original.enabled ? c.disableRuleAria : c.enableRuleAria} />
          <span className="text-sm text-muted-foreground">{row.original.enabled ? c.enabled : c.disabled}</span>
        </div>
      ),
    },
    {
      id: 'performance',
      header: c.tpFp,
      cell: ({ row }: { row: Row<DetectionRule> }) => <RulePerformanceCard rule={row.original} />,
    },
    {
      id: 'trigger_count',
      accessorKey: 'trigger_count',
      header: c.alertsGenerated,
      enableSorting: true,
      cell: ({ row }: { row: Row<DetectionRule> }) => (
        <span className="tabular-nums text-sm">{row.original.trigger_count.toLocaleString()}</span>
      ),
    },
    {
      id: 'last_triggered_at',
      accessorKey: 'last_triggered_at',
      header: c.lastTriggered,
      enableSorting: true,
      cell: ({ row }: { row: Row<DetectionRule> }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.last_triggered_at ? timeAgo(row.original.last_triggered_at) : c.never}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }: { row: Row<DetectionRule> }) => <ActionsCell rule={row.original} options={options} />,
    },
  ];
}
