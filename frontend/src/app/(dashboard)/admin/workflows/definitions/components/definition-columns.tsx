'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import {
  dateColumn,
  statusColumn,
  actionsColumn,
} from '@/components/shared/data-table/columns/common-columns';
import {
  Calendar,
  Globe,
  MousePointerClick,
  Webhook,
} from 'lucide-react';
import type { WorkflowDefinition } from '@/types/models';
import {
  formatCategoryLabel,
  formatTriggerLabel,
  getDefinitionStatusConfig,
  type DefinitionLabels,
} from '../definition-i18n';

const triggerIcons: Record<string, React.ElementType> = {
  manual: MousePointerClick,
  event: Globe,
  schedule: Calendar,
  webhook: Webhook,
};

interface DefinitionColumnOptions {
  labels: DefinitionLabels;
  locale: string;
  onEdit: (def: WorkflowDefinition) => void;
  onView: (def: WorkflowDefinition) => void;
  onPublish: (def: WorkflowDefinition) => void;
  onArchive: (def: WorkflowDefinition) => void;
  onClone: (def: WorkflowDefinition) => void;
  onDelete: (def: WorkflowDefinition) => void;
}

export function getDefinitionColumns(
  options: DefinitionColumnOptions,
): ColumnDef<WorkflowDefinition>[] {
  const { labels, locale, onEdit, onView, onPublish, onArchive, onClone, onDelete } = options;

  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: labels.columns.name,
      cell: ({ getValue, row }) => {
        const name = getValue() as string;
        return (
          <button
            onClick={() => onView(row.original)}
            className="text-sm font-medium text-start hover:underline"
          >
            {name}
          </button>
        );
      },
      enableSorting: true,
    },
    {
      id: 'category',
      accessorKey: 'category',
      header: labels.columns.category,
      cell: ({ getValue }) => {
        const category = getValue() as string | undefined;
        return category ? (
          <Badge variant="secondary" className="text-xs">
            {formatCategoryLabel(category, locale)}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">&mdash;</span>
        );
      },
      enableSorting: true,
    },
    statusColumn<WorkflowDefinition>(
      'status',
      labels.columns.status,
      getDefinitionStatusConfig(locale),
    ),
    {
      id: 'version',
      accessorKey: 'version',
      header: labels.columns.version,
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">v{getValue() as number}</span>
      ),
      enableSorting: true,
      size: 80,
    },
    {
      id: 'trigger',
      header: labels.columns.trigger,
      cell: ({ row }) => {
        const trigger = row.original.trigger_config;
        const Icon = triggerIcons[trigger.type] ?? Globe;
        return (
          <div className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">{formatTriggerLabel(trigger.type, locale)}</span>
          </div>
        );
      },
      size: 120,
      enableSorting: false,
    },
    {
      id: 'steps',
      header: labels.columns.steps,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.steps.length}
        </span>
      ),
      size: 70,
      enableSorting: false,
    },
    {
      id: 'instance_count',
      accessorKey: 'instance_count',
      header: labels.columns.instances,
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {(getValue() as number | undefined) ?? 0}
        </span>
      ),
      size: 90,
      enableSorting: true,
    },
    dateColumn<WorkflowDefinition>('updated_at', labels.columns.lastUpdated, {
      relative: true,
    }),
    actionsColumn<WorkflowDefinition>((def) => [
      ...(def.status === 'draft'
        ? [{ label: labels.actions.edit, onClick: () => onEdit(def) }]
        : []),
      { label: labels.actions.view, onClick: () => onView(def) },
      ...(def.status === 'draft'
        ? [{ label: labels.actions.publish, onClick: () => onPublish(def) }]
        : []),
      ...(def.status === 'active'
        ? [{ label: labels.actions.archive, onClick: () => onArchive(def) }]
        : []),
      { label: labels.actions.clone, onClick: () => onClone(def) },
      ...(def.status === 'draft'
        ? [
            {
              label: labels.actions.delete,
              onClick: () => onDelete(def),
              variant: 'destructive' as const,
            },
          ]
        : []),
    ]),
  ];
}
