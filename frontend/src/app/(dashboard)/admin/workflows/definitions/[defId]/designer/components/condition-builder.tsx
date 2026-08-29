'use client';

import { useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import type { WorkflowCondition } from '@/types/models';
import type { ConditionOperator } from '@/types/forms';
import '@/app/(dashboard)/admin/_lib/admin-i18n';

/**
 * EditableCondition is the union of operators the builder can author: the 13
 * canonical form {@link ConditionOperator}s PLUS the two legacy workflow-only
 * operators (`not_in`, `matches`). This keeps the existing
 * properties-panel consumer (which passes {@link WorkflowCondition}[]) working
 * while letting the form designer author the canonical vocabulary.
 *
 * The shape is structurally compatible with both {@link WorkflowCondition} (it
 * has the optional `logic`) and the canonical form `Condition`.
 */
export type EditableConditionOperator =
  | ConditionOperator
  | 'not_in'
  | 'matches';

export interface EditableCondition {
  field: string;
  operator: EditableConditionOperator;
  value?: unknown;
  /** Legacy AND/OR chaining used by the workflow transition/condition panel. */
  logic?: 'and' | 'or';
}

/** Operators that take NO value (presence / truthiness checks). */
const NO_VALUE_OPERATORS: ReadonlySet<EditableConditionOperator> = new Set([
  'truthy',
  'falsy',
  'isSet',
  'isEmpty',
]);

/** Operators whose value is an array literal (membership tests). */
const ARRAY_OPERATORS: ReadonlySet<EditableConditionOperator> = new Set([
  'in',
  'notIn',
  'not_in',
]);

/** All operators offered in the dropdown, canonical 13 first, legacy last. */
const OPERATORS: EditableConditionOperator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'contains',
  'truthy',
  'falsy',
  'isSet',
  'isEmpty',
  // Legacy workflow-only operators (retained so existing definitions still load).
  'not_in',
  'matches',
];

const OPERATOR_LABELS: Record<'en' | 'ar', Record<EditableConditionOperator, string>> = {
  en: {
    eq: '=',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    in: 'in',
    notIn: 'not in',
    contains: 'contains',
    truthy: 'is truthy',
    falsy: 'is falsy',
    isSet: 'is set',
    isEmpty: 'is empty',
    not_in: 'not in (legacy)',
    matches: 'matches (legacy)',
  },
  ar: {
    eq: '=',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    in: 'ضمن',
    notIn: 'ليس ضمن',
    contains: 'يحتوي على',
    truthy: 'صحيح منطقيًا',
    falsy: 'خطأ منطقيًا',
    isSet: 'له قيمة',
    isEmpty: 'فارغ',
    not_in: 'ليس ضمن (قديم)',
    matches: 'يطابق (قديم)',
  },
};

/**
 * coerceScalar turns the raw text of the value input into the most specific
 * JSON type the backend expects: a boolean for true/false, a number for a
 * numeric string, otherwise the trimmed string. Empty input stays an empty
 * string. This mirrors how the Go validator compiles literals (numbers /
 * booleans are emitted unquoted; numeric-coercing equality compares them).
 */
export function coerceScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // A finite number (reject things like "" / "1,2" / "abc").
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return n;
  }
  return trimmed;
}

/**
 * coerceArray splits comma-separated text into an array, coercing each element
 * with {@link coerceScalar}. Used for `in` / `notIn` so the wire value is a JSON
 * array (the backend requires an array for these operators).
 */
export function coerceArray(raw: string): (string | number | boolean)[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(coerceScalar);
}

/**
 * coerceConditionValue picks the right coercion for an operator: an array for
 * membership operators, nothing (undefined) for no-value operators, otherwise a
 * scalar. The result is what gets stored on Condition.value.
 */
export function coerceConditionValue(
  operator: EditableConditionOperator,
  raw: string,
): unknown {
  if (NO_VALUE_OPERATORS.has(operator)) return undefined;
  if (ARRAY_OPERATORS.has(operator)) return coerceArray(raw);
  return coerceScalar(raw);
}

/** displayValue renders a stored Condition.value back into the text input. */
function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  return String(value);
}

interface ConditionBuilderProps<T extends EditableCondition = WorkflowCondition> {
  conditions: T[];
  onChange: (conditions: T[]) => void;
  readOnly?: boolean;
  /**
   * Optional label override (e.g. "Visible When" in the form designer). Defaults
   * to "Conditions".
   */
  label?: string;
  /** Placeholder for the field reference input. */
  fieldPlaceholder?: string;
  /** Hide the AND/OR logic selector (the form designer AND-combines silently). */
  hideLogic?: boolean;
}

export function ConditionBuilder<T extends EditableCondition = WorkflowCondition>({
  conditions,
  onChange,
  readOnly,
  label,
  fieldPlaceholder = 'variables.field',
  hideLogic = false,
}: ConditionBuilderProps<T>) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const operatorLabels = locale === 'ar' ? OPERATOR_LABELS.ar : OPERATOR_LABELS.en;
  const resolvedLabel = label ?? t('cb.conditions');
  const handleAdd = useCallback(() => {
    onChange([
      ...conditions,
      { field: '', operator: 'eq', value: '', logic: 'and' } as T,
    ]);
  }, [conditions, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(conditions.filter((_, i) => i !== index));
    },
    [conditions, onChange],
  );

  const handleUpdate = useCallback(
    (index: number, updates: Partial<EditableCondition>) => {
      onChange(
        conditions.map((c, i) => (i === index ? ({ ...c, ...updates } as T) : c)),
      );
    },
    [conditions, onChange],
  );

  const handleOperatorChange = useCallback(
    (index: number, operator: EditableConditionOperator) => {
      const current = conditions[index];
      const rawText = displayValue(current?.value);
      // Re-coerce the existing text under the new operator (e.g. switching to
      // `in` turns "a, b" into an array; switching to `truthy` drops the value).
      const value = coerceConditionValue(operator, rawText);
      handleUpdate(index, { operator, value });
    },
    [conditions, handleUpdate],
  );

  const handleValueChange = useCallback(
    (index: number, raw: string) => {
      const operator = conditions[index]?.operator ?? 'eq';
      handleUpdate(index, { value: coerceConditionValue(operator, raw) });
    },
    [conditions, handleUpdate],
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs">{resolvedLabel}</Label>

      {conditions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('cb.noConditions')}
        </p>
      )}

      {conditions.map((cond, i) => {
        const takesValue = !NO_VALUE_OPERATORS.has(cond.operator);
        const isArrayOp = ARRAY_OPERATORS.has(cond.operator);
        return (
          <div key={i} className="space-y-1.5 rounded-md border bg-muted/30 p-2">
            {!hideLogic && i > 0 && (
              <Select
                value={cond.logic ?? 'and'}
                onValueChange={(v) =>
                  handleUpdate(i, { logic: v as 'and' | 'or' })
                }
                disabled={readOnly}
              >
                <SelectTrigger className="h-6 w-16 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">{locale === 'ar' ? 'و' : 'AND'}</SelectItem>
                  <SelectItem value="or">{locale === 'ar' ? 'أو' : 'OR'}</SelectItem>
                </SelectContent>
              </Select>
            )}

            <div className="flex items-center gap-1.5">
              {/* Field */}
              <Input
                value={cond.field}
                onChange={(e) => handleUpdate(i, { field: e.target.value })}
                placeholder={fieldPlaceholder}
                disabled={readOnly}
                className="h-7 text-xs flex-1"
                aria-label={t('cb.fieldAria')}
              />

              {/* Operator */}
              <Select
                value={cond.operator}
                onValueChange={(v) =>
                  handleOperatorChange(i, v as EditableConditionOperator)
                }
                disabled={readOnly}
              >
                <SelectTrigger className="h-7 w-24 text-xs" aria-label={t('cb.operatorAria')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op} value={op}>
                      {operatorLabels[op]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Value (hidden for no-value operators) */}
              {takesValue && (
                <Input
                  value={displayValue(cond.value)}
                  onChange={(e) => handleValueChange(i, e.target.value)}
                  placeholder={isArrayOp ? t('cb.phArray') : t('cb.phValue')}
                  disabled={readOnly}
                  className="h-7 text-xs flex-1"
                  aria-label={t('cb.valueAria')}
                />
              )}

              {/* Remove */}
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => handleRemove(i)}
                  aria-label={t('cb.removeAria')}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs"
          onClick={handleAdd}
        >
          <Plus className="me-1 h-3 w-3" />
          {t('cb.add')}
        </Button>
      )}
    </div>
  );
}
