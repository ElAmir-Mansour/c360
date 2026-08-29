'use client';

/**
 * VariablesEditor — reusable editor for a workflow definition's `variables`
 * (backend map[string]model.VariableDef).
 *
 * Model: each variable is keyed by name, value is { type, source?, default? }.
 * type ∈ string|number|boolean|object|array (backend ValidVariableTypes).
 * The `default` is type-coerced on the way out so the persisted JSON matches the
 * declared type (number/boolean/object/array parsed; string kept verbatim).
 *
 * Pure value/onChange — no canvas/definition coupling — so Phase C can remount it
 * unchanged inside the React Flow inspector / definition-settings drawer.
 */

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
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { getDefinitionLabels } from '../../../definition-i18n';
import type { BackendVariableDef } from '@/types/models';

type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array';

const VARIABLE_TYPES: VariableType[] = ['string', 'number', 'boolean', 'object', 'array'];

interface VariablesEditorProps {
  value: Record<string, BackendVariableDef>;
  onChange: (next: Record<string, BackendVariableDef>) => void;
  readOnly?: boolean;
}

const T = {
  en: {
    title: 'Variables',
    add: 'Add variable',
    empty: 'No variables declared.',
    name: 'Name',
    type: 'Type',
    defaultVal: 'Default',
    dupName: 'Duplicate name',
    string: 'String',
    number: 'Number',
    boolean: 'Boolean',
    object: 'Object',
    array: 'Array',
    truthy: 'true',
    falsy: 'false',
    jsonErr: 'Invalid JSON',
  },
  ar: {
    title: 'المتغيرات',
    add: 'إضافة متغير',
    empty: 'لا توجد متغيرات معرّفة.',
    name: 'الاسم',
    type: 'النوع',
    defaultVal: 'القيمة الافتراضية',
    dupName: 'اسم مكرر',
    string: 'نص',
    number: 'رقم',
    boolean: 'منطقي',
    object: 'كائن',
    array: 'مصفوفة',
    truthy: 'صحيح',
    falsy: 'خطأ',
    jsonErr: 'JSON غير صالح',
  },
} as const;

/** Ordered row view of the variables map (insertion order via Object.entries). */
interface Row {
  name: string;
  def: BackendVariableDef;
}

function toRows(value: Record<string, BackendVariableDef>): Row[] {
  return Object.entries(value).map(([name, def]) => ({ name, def }));
}

/** Re-key the map from rows; later duplicate names overwrite earlier ones. */
function fromRows(rows: Row[]): Record<string, BackendVariableDef> {
  const out: Record<string, BackendVariableDef> = {};
  for (const row of rows) {
    out[row.name] = row.def;
  }
  return out;
}

function defaultToText(def: BackendVariableDef): string {
  const v = def.default;
  if (v === undefined || v === null) return '';
  if (def.type === 'string') return typeof v === 'string' ? v : String(v);
  if (def.type === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function VariablesEditor({ value, onChange, readOnly = false }: VariablesEditorProps) {
  const { locale, direction } = useLocaleOrDefault();
  const t = locale === 'ar' ? T.ar : T.en;
  const localLabels = getDefinitionLabels(locale);

  const rows = toRows(value);
  const nameCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.name] = (acc[r.name] ?? 0) + 1;
    return acc;
  }, {});

  const commit = useCallback((next: Row[]) => onChange(fromRows(next)), [onChange]);

  const addRow = () => {
    // Generate a unique placeholder name so the new row doesn't collide.
    let i = rows.length + 1;
    let name = `var_${i}`;
    while (nameCounts[name]) {
      i += 1;
      name = `var_${i}`;
    }
    commit([...rows, { name, def: { type: 'string' } }]);
  };

  const updateRow = (index: number, patch: Partial<Row>) => {
    commit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRow = (index: number) => {
    commit(rows.filter((_, i) => i !== index));
  };

  const updateType = (index: number, type: VariableType) => {
    const row = rows[index];
    // Reset the default when the type changes so it can't carry an
    // incompatible value (e.g. a string default left on a number variable).
    updateRow(index, { def: { ...row.def, type, default: undefined } });
  };

  const updateDefault = (index: number, text: string) => {
    const row = rows[index];
    const type = row.def.type as VariableType;
    let parsed: unknown;
    if (text.trim() === '') {
      parsed = undefined;
    } else if (type === 'number') {
      const n = Number(text);
      parsed = Number.isFinite(n) ? n : text;
    } else if (type === 'boolean') {
      parsed = text === 'true';
    } else if (type === 'object' || type === 'array') {
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep the raw text so the user can finish typing; it won't coerce yet
        parsed = text;
      }
    } else {
      parsed = text;
    }
    updateRow(index, { def: { ...row.def, default: parsed } });
  };

  const typeLabel = (type: VariableType): string =>
    type === 'string'
      ? t.string
      : type === 'number'
        ? t.number
        : type === 'boolean'
          ? t.boolean
          : type === 'object'
            ? t.object
            : t.array;

  return (
    <div className="space-y-2" dir={direction}>
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold">{t.title}</Label>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            onClick={addRow}
          >
            <Plus className="me-1 h-3 w-3" />
            {t.add}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => {
            const isDup = (nameCounts[row.name] ?? 0) > 1;
            const type = row.def.type as VariableType;
            return (
              <div key={index} className="space-y-1 rounded-md border bg-muted/20 p-1.5">
                <div className="flex items-center gap-1">
                  <Input
                    value={row.name}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                    placeholder={t.name}
                    disabled={readOnly}
                    dir="ltr"
                    className="h-7 flex-1 text-xs font-mono"
                    aria-label={`${t.name} ${index + 1}`}
                  />
                  <Select
                    value={type}
                    onValueChange={(v) => updateType(index, v as VariableType)}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-7 w-24 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VARIABLE_TYPES.map((vt) => (
                        <SelectItem key={vt} value={vt}>
                          {typeLabel(vt)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(index)}
                      aria-label={localLabels.aria.removeVariable(index + 1)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                {/* Default value — boolean uses a select, others a text input */}
                {type === 'boolean' ? (
                  <Select
                    value={row.def.default ? 'true' : 'false'}
                    onValueChange={(v) =>
                      updateRow(index, { def: { ...row.def, default: v === 'true' } })
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">{t.falsy}</SelectItem>
                      <SelectItem value="true">{t.truthy}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={defaultToText(row.def)}
                    onChange={(e) => updateDefault(index, e.target.value)}
                    placeholder={t.defaultVal}
                    disabled={readOnly}
                    dir="ltr"
                    className="h-7 text-xs"
                    aria-label={`${t.defaultVal} ${index + 1}`}
                  />
                )}

                {isDup && <p className="text-overline text-destructive">{t.dupName}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
