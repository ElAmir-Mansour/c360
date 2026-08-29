'use client';

import * as React from 'react';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Braces, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Shared, RHF-bound field primitives for the SIEM operations console. These
 * replace the page-local `Field` / `JsonField` / `Toggle` helpers with
 * validated, accessible controls that consume design-system tokens.
 */

interface FieldBinding<TFieldValues extends FieldValues> {
  name: FieldPath<TFieldValues>;
  control: Control<TFieldValues>;
}

/* ------------------------------------------------------------------------- *
 * JsonField — a validated JSON <Textarea>. The raw string lives in the form;
 * the surrounding zod schema parses it (on blur / submit) and the wrapping
 * FormField renders the inline error. A "Format" affordance pretty-prints
 * valid JSON in place.
 * ------------------------------------------------------------------------- */

export function JsonField<TFieldValues extends FieldValues>({
  name,
  control,
  rows = 6,
  placeholder,
  formatLabel = 'Format',
}: FieldBinding<TFieldValues> & {
  rows?: number;
  placeholder?: string;
  formatLabel?: string;
}) {
  const { field, fieldState } = useController<TFieldValues>({ name, control });
  const value = typeof field.value === 'string' ? field.value : '';

  const format = () => {
    try {
      field.onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      // Invalid JSON — leave the text untouched; the blur validation surfaces it.
    }
  };

  return (
    <div className="relative">
      <Textarea
        id={name}
        name={name}
        value={value}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={Boolean(fieldState.error)}
        className={cn(
          'min-h-[120px] pe-24 font-mono text-xs',
          fieldState.error &&
            'border-destructive focus-visible:ring-destructive/40',
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={format}
        className="absolute end-2 top-2 h-6 gap-1 px-2 text-caption text-muted-foreground"
      >
        <Braces className="h-3 w-3" aria-hidden />
        {formatLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * KeyValueEditor — a structured editor for a flat string→string map (e.g. a
 * source's `tags`). Rows of key/value inputs with add/remove, bound to an RHF
 * object field. Empty-keyed rows are dropped from the committed value.
 * ------------------------------------------------------------------------- */

interface KVRow {
  id: string;
  key: string;
  value: string;
}

let kvRowSeq = 0;
function nextRowId(): string {
  kvRowSeq += 1;
  return `kv-${kvRowSeq}`;
}

export function KeyValueEditor<TFieldValues extends FieldValues>({
  name,
  control,
  addLabel = 'Add entry',
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
  removeLabel = 'Remove entry',
}: FieldBinding<TFieldValues> & {
  addLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  removeLabel?: string;
}) {
  const { field } = useController<TFieldValues>({ name, control });

  const [rows, setRows] = React.useState<KVRow[]>(() => {
    const record =
      field.value && typeof field.value === 'object'
        ? (field.value as Record<string, unknown>)
        : {};
    const initial = Object.entries(record).map(([key, value]) => ({
      id: nextRowId(),
      key,
      value: value == null ? '' : String(value),
    }));
    return initial.length > 0 ? initial : [{ id: nextRowId(), key: '', value: '' }];
  });

  const commit = React.useCallback(
    (next: KVRow[]) => {
      setRows(next);
      const record: Record<string, string> = {};
      for (const row of next) {
        const key = row.key.trim();
        if (key) record[key] = row.value;
      }
      field.onChange(record);
    },
    [field],
  );

  const updateRow = (id: string, patch: Partial<Pick<KVRow, 'key' | 'value'>>) =>
    commit(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const removeRow = (id: string) => {
    const next = rows.filter((row) => row.id !== id);
    commit(next.length > 0 ? next : [{ id: nextRowId(), key: '', value: '' }]);
  };

  const addRow = () => commit([...rows, { id: nextRowId(), key: '', value: '' }]);

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              value={row.key}
              onChange={(event) => updateRow(row.id, { key: event.target.value })}
              onBlur={field.onBlur}
              placeholder={keyPlaceholder}
              className="flex-1 font-mono text-xs"
              aria-label={keyPlaceholder}
            />
            <Input
              value={row.value}
              onChange={(event) => updateRow(row.id, { value: event.target.value })}
              onBlur={field.onBlur}
              placeholder={valuePlaceholder}
              className="flex-1 font-mono text-xs"
              aria-label={valuePlaceholder}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeRow(row.id)}
              aria-label={removeLabel}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {addLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * SiemToggleField — a labelled Switch row bound to an RHF boolean field.
 * ------------------------------------------------------------------------- */

export function SiemToggleField<TFieldValues extends FieldValues>({
  name,
  control,
  label,
}: FieldBinding<TFieldValues> & { label: string }) {
  const { field } = useController<TFieldValues>({ name, control });
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
        {label}
      </span>
      <Switch
        checked={Boolean(field.value)}
        onCheckedChange={field.onChange}
        aria-label={label}
      />
    </label>
  );
}
