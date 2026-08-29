'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDataLabels, type DataLabels, type StringKeys } from '@/app/(dashboard)/data/_lib/data-i18n';

export interface QueryFilterRowState {
  id: string;
  column: string;
  operator: string;
  value: string;
  secondaryValue: string;
}

interface QueryFilterBuilderProps {
  rows: QueryFilterRowState[];
  columnOptions: string[];
  onChange: (rows: QueryFilterRowState[]) => void;
}

const OPERATORS: Array<{ labelKey: StringKeys<DataLabels['analytics']>; value: string }> = [
  { labelKey: 'opEquals', value: 'eq' },
  { labelKey: 'opNotEquals', value: 'neq' },
  { labelKey: 'opGreaterThan', value: 'gt' },
  { labelKey: 'opGreaterOrEqual', value: 'gte' },
  { labelKey: 'opLessThan', value: 'lt' },
  { labelKey: 'opLessOrEqual', value: 'lte' },
  { labelKey: 'opIn', value: 'in' },
  { labelKey: 'opNotIn', value: 'not_in' },
  { labelKey: 'opLike', value: 'like' },
  { labelKey: 'opIlike', value: 'ilike' },
  { labelKey: 'opBetween', value: 'between' },
  { labelKey: 'opIsNull', value: 'is_null' },
  { labelKey: 'opIsNotNull', value: 'is_not_null' },
];

export function QueryFilterBuilder({
  rows,
  columnOptions,
  onChange,
}: QueryFilterBuilderProps) {
  const labels = useDataLabels();
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_1fr_auto]">
          <Select value={row.column} onValueChange={(value) => onChange(rows.map((item) => (item.id === row.id ? { ...item, column: value } : item)))}>
            <SelectTrigger>
              <SelectValue placeholder={labels.pipelines.columnPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {columnOptions.map((column) => (
                <SelectItem key={column} value={column}>
                  {column}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={row.operator} onValueChange={(value) => onChange(rows.map((item) => (item.id === row.id ? { ...item, operator: value } : item)))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((operator) => (
                <SelectItem key={operator.value} value={operator.value}>
                  {labels.analytics[operator.labelKey]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {row.operator === 'is_null' || row.operator === 'is_not_null' ? (
            <div className="flex items-center rounded-md border px-3 text-sm text-muted-foreground">{labels.pipelines.noValueRequired}</div>
          ) : row.operator === 'between' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={row.value}
                onChange={(event) => onChange(rows.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)))}
                placeholder={labels.pipelines.fromLabel}
              />
              <Input
                value={row.secondaryValue}
                onChange={(event) => onChange(rows.map((item) => (item.id === row.id ? { ...item, secondaryValue: event.target.value } : item)))}
                placeholder={labels.pipelines.toLabel}
              />
            </div>
          ) : (
            <Input
              value={row.value}
              onChange={(event) => onChange(rows.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)))}
              placeholder={row.operator === 'in' || row.operator === 'not_in' ? labels.analytics.commaSeparated : labels.pipelines.valuePlaceholder}
            />
          )}

          <Button type="button" variant="ghost" onClick={() => onChange(rows.filter((item) => item.id !== row.id))}>
            {labels.common.remove}
          </Button>
        </div>
      ))}
    </div>
  );
}
