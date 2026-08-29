'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound, Link2, ShieldAlert, Table2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type DiscoveredSchema, type DiscoveredTable } from '@/lib/data-suite';
import {
  formatMaybeCompact,
  getClassificationBadge,
  getColumnPiiType,
  maskColumnSample,
} from '@/lib/data-suite/utils';
import { cn } from '@/lib/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SchemaTreeProps {
  schema: DiscoveredSchema;
  selectedTableName?: string | null;
  onSelectTable?: (table: DiscoveredTable) => void;
  filter?: string;
  showSummary?: boolean;
  className?: string;
  canViewPii?: boolean;
}

export function SchemaTree({
  schema,
  selectedTableName,
  onSelectTable,
  filter = '',
  showSummary = true,
  className,
  canViewPii = false,
}: SchemaTreeProps) {
  const labels = useDataLabels();
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  const tables = useMemo(() => {
    const lowered = filter.trim().toLowerCase();
    if (!lowered) {
      return schema.tables;
    }
    return schema.tables.filter((table) => `${table.schema_name ?? 'public'}.${table.name}`.toLowerCase().includes(lowered));
  }, [filter, schema.tables]);

  useEffect(() => {
    if (!selectedTableName || expandedTables[selectedTableName]) {
      return;
    }
    setExpandedTables((current) => ({ ...current, [selectedTableName]: true }));
  }, [expandedTables, selectedTableName]);

  return (
    <div className={cn('space-y-4', className)}>
      {showSummary ? (
        <div className="rounded-lg border bg-muted/20 p-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span>
              {labels.sourcesDetail.tablesDiscoveredLabel} <strong>{schema.table_count}</strong>
            </span>
            <span className="text-muted-foreground">
              {schema.contains_pii ? labels.sourcesDetail.withPiiDetected(String(schema.tables.filter((table) => table.contains_pii).length)) : labels.sourcesDetail.noPiiDetected}
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setExpandedTables(
              Object.fromEntries(schema.tables.map((table) => [table.name, true])),
            )
          }
        >
          {labels.sourcesDetail.expandAll}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpandedTables({})}>
          {labels.sourcesDetail.collapseAll}
        </Button>
      </div>

      <ScrollArea className="h-[520px] pe-3">
        <div className="space-y-2">
          {tables.map((table) => {
            const classification = getClassificationBadge(table.inferred_classification);
            const isExpanded = expandedTables[table.name] ?? selectedTableName === table.name;
            const isSelected = selectedTableName === table.name;

            return (
              <div key={`${table.schema_name ?? 'public'}.${table.name}`} className="rounded-lg border">
                <button
                  type="button"
                  data-testid={`schema-table-${table.name}`}
                  className={cn(
                    'flex w-full items-start gap-3 px-3 py-3 text-start transition-colors hover:bg-muted/40',
                    isSelected && 'bg-primary/5',
                  )}
                  onClick={() => {
                    setExpandedTables((current) => ({ ...current, [table.name]: !isExpanded }));
                    onSelectTable?.(table);
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  )}
                  <Table2 className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {(table.schema_name ?? 'public')}.{table.name}
                      </span>
                      <Badge variant="outline" className={classification.className}>
                        {classification.label}
                      </Badge>
                      {table.contains_pii ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-warning-300">
                          <ShieldAlert className="me-1 h-3 w-3" />
                          {labels.sourcesDetail.piiBadge(String(table.pii_column_count))}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{labels.sourcesDetail.rowsCount(formatMaybeCompact(table.estimated_rows))}</span>
                      <span>{labels.sourcesDetail.columnsCount(String(table.columns.length))}</span>
                      {table.comment ? <span className="truncate">{table.comment}</span> : null}
                    </div>
                  </div>
                </button>

                {isExpanded ? (
                  <div className="border-t bg-muted/10 px-4 py-3">
                    <div className="space-y-2">
                      {table.columns.map((column) => {
                        const piiType = getColumnPiiType(column);
                        const samples = maskColumnSample(column, canViewPii).slice(0, 2);

                        return (
                          <div
                            key={column.name}
                            className="flex items-start gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-background"
                            title={`${column.native_type} • ${column.nullable ? 'nullable' : 'not null'}${samples.length > 0 ? ` • samples: ${samples.join(', ')}` : ''}`}
                          >
                            <div className="mt-0.5 flex w-6 justify-center">
                              {column.is_primary_key ? (
                                <KeyRound className="h-3.5 w-3.5 text-warning-700 dark:text-warning-300" data-testid={`schema-icon-pk-${column.name}`} />
                              ) : column.is_foreign_key ? (
                                <Link2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" data-testid={`schema-icon-fk-${column.name}`} />
                              ) : piiType ? (
                                <ShieldAlert className="h-3.5 w-3.5 text-warning-700 dark:text-warning-300" data-testid={`schema-icon-pii-${column.name}`} />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{column.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {column.native_type || column.data_type}
                                </span>
                                {piiType ? (
                                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-warning-300">
                                    {piiType}
                                  </Badge>
                                ) : null}
                              </div>
                              {samples.length > 0 ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {samples.join(' • ')}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
