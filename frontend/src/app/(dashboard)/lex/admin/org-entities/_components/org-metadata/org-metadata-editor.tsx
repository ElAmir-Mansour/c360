'use client';

/**
 * OrgMetadataEditor — CONTROLLED, presentational editor for an org-entity's
 * custom-attributes / metadata master-data map.
 *
 * It does NOT fetch or mutate. It renders typed inputs for the standard schema
 * fields plus a free-form key/value list for arbitrary attributes, and emits the
 * merged `Record<string, unknown>` through `onChange`. Soft format issues surface
 * as inline, non-blocking amber warnings — they never gate input.
 *
 * Mount: inside the org-entity form dialog body as a collapsible "Attributes"
 * section. The orchestrator owns persistence (folds `value` into the entity
 * payload's `metadata`).
 */

import { useMemo } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  ORG_METADATA_SCHEMA,
  isSchemaKey,
  isBlank,
  metadataValueToString,
  type OrgMetadataField,
} from '../../_lib/org-metadata-schema';
import {
  resolveMetadataLabels,
  governorateOptions,
  type OrgMetadataLabels,
} from '../../_lib/org-metadata-i18n';

interface OrgMetadataEditorProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}

/** A free-form (non-schema) row derived from `value`. Order is preserved. */
interface CustomRow {
  key: string;
  value: string;
}

const NO_GOVERNORATE = '__none__';

function customRowsFrom(value: Record<string, unknown>): CustomRow[] {
  return Object.keys(value)
    .filter((key) => !isSchemaKey(key))
    .map((key) => ({ key, value: metadataValueToString(value[key]) }));
}

export default function OrgMetadataEditor({
  value,
  onChange,
  disabled = false,
}: OrgMetadataEditorProps) {
  const { locale, direction } = useLocaleOrDefault();
  const labels: OrgMetadataLabels = useMemo(() => resolveMetadataLabels(locale), [locale]);
  const customRows = useMemo(() => customRowsFrom(value), [value]);
  const govOptions = useMemo(() => governorateOptions(labels), [labels]);

  /** Replace one schema field's value, dropping the key entirely when blanked. */
  const setSchemaValue = (key: string, raw: string) => {
    const next: Record<string, unknown> = { ...value };
    if (raw.trim() === '') {
      delete next[key];
    } else {
      next[key] = raw;
    }
    onChange(next);
  };

  /**
   * Rebuild `value` from the schema fields (kept untouched) merged with an edited
   * custom-row list. Blank keys are skipped; duplicate keys collapse to the last.
   */
  const commitCustomRows = (rows: CustomRow[]) => {
    const schemaPart: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (isSchemaKey(key)) schemaPart[key] = value[key];
    }
    const customPart: Record<string, unknown> = {};
    for (const row of rows) {
      const k = row.key.trim();
      if (k === '' || isSchemaKey(k)) continue;
      if (row.value.trim() === '') {
        // keep the key so the empty row stays visible while editing
        customPart[k] = '';
      } else {
        customPart[k] = row.value;
      }
    }
    onChange({ ...schemaPart, ...customPart });
  };

  const updateCustomRow = (index: number, patch: Partial<CustomRow>) => {
    const nextRows = customRows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    commitCustomRows(nextRows);
  };

  const removeCustomRow = (index: number) => {
    commitCustomRows(customRows.filter((_, i) => i !== index));
  };

  const addCustomRow = () => {
    // Add a placeholder key the user immediately renames; unique-ish suffix.
    const base = 'attribute';
    let n = customRows.length + 1;
    let candidate = `${base}_${n}`;
    const taken = new Set(customRows.map((r) => r.key));
    while (taken.has(candidate) || isSchemaKey(candidate)) {
      n += 1;
      candidate = `${base}_${n}`;
    }
    commitCustomRows([...customRows, { key: candidate, value: '' }]);
  };

  return (
    <div className="space-y-5" dir={direction} lang={locale}>
      <div>
        <p className="text-sm font-medium">{labels.editor.sectionTitle}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{labels.editor.sectionDescription}</p>
      </div>

      {/* Standard schema attributes -------------------------------------- */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {labels.editor.schemaGroupLabel}
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {ORG_METADATA_SCHEMA.map((field) => (
            <SchemaField
              key={field.key}
              field={field}
              rawValue={value[field.key]}
              labels={labels}
              govOptions={govOptions}
              disabled={disabled}
              onChange={(raw) => setSchemaValue(field.key, raw)}
            />
          ))}
        </div>
      </div>

      {/* Free-form attributes ------------------------------------------- */}
      <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {labels.editor.customGroupLabel}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {labels.editor.customGroupDescription}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCustomRow}
            disabled={disabled}
          >
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {labels.editor.addAttribute}
          </Button>
        </div>

        {customRows.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">{labels.editor.emptyCustom}</p>
        ) : (
          <div className="space-y-2">
            {customRows.map((row, index) => {
              const trimmedKey = row.key.trim();
              const isDuplicate =
                trimmedKey !== '' &&
                customRows.findIndex((r) => r.key.trim() === trimmedKey) !== index;
              const isReserved = trimmedKey !== '' && isSchemaKey(trimmedKey);
              const warning = isReserved
                ? labels.editor.reservedKeyWarning
                : isDuplicate
                  ? labels.editor.duplicateKeyWarning
                  : null;
              return (
                <div key={index} className="space-y-1">
                  <div className="flex items-start gap-2">
                    <Input
                      aria-label={labels.editor.keyHeader}
                      className="font-mono text-xs"
                      placeholder={labels.editor.keyPlaceholder}
                      value={row.key}
                      disabled={disabled}
                      onChange={(e) => updateCustomRow(index, { key: e.target.value })}
                    />
                    <Input
                      aria-label={labels.editor.valueHeader}
                      placeholder={labels.editor.valuePlaceholder}
                      value={row.value}
                      disabled={disabled}
                      onChange={(e) => updateCustomRow(index, { value: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={labels.editor.removeAttribute}
                      disabled={disabled}
                      onClick={() => removeCustomRow(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  {warning ? <SoftWarning text={warning} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * Single schema-field input (text / email / number / select).
 * --------------------------------------------------------------------------- */

interface SchemaFieldProps {
  field: OrgMetadataField;
  rawValue: unknown;
  labels: OrgMetadataLabels;
  govOptions: { value: string; label: string }[];
  disabled: boolean;
  onChange: (raw: string) => void;
}

function SchemaField({ field, rawValue, labels, govOptions, disabled, onChange }: SchemaFieldProps) {
  const label = labels.fields[field.key];
  const placeholder = labels.placeholders[field.key];
  const fieldId = `metadata-${field.key}`;
  const stringValue = metadataValueToString(rawValue);

  // Soft validation: advisory amber warning, never blocks.
  const warning =
    field.validate && field.warningKey && !field.validate(rawValue)
      ? labels.warnings[field.warningKey]
      : null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId} className={disabled ? 'opacity-50' : undefined}>
        {label}
      </Label>
      {field.type === 'select' ? (
        <Select
          value={stringValue === '' ? NO_GOVERNORATE : stringValue}
          disabled={disabled}
          onValueChange={(v) => onChange(v === NO_GOVERNORATE ? '' : v)}
        >
          <SelectTrigger id={fieldId}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GOVERNORATE}>—</SelectItem>
            {govOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={fieldId}
          type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
          inputMode={field.type === 'number' ? 'numeric' : undefined}
          placeholder={placeholder}
          value={stringValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {warning && !isBlank(rawValue) ? <SoftWarning text={warning} /> : null}
    </div>
  );
}

function SoftWarning({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-warning-700 dark:text-warning-300" role="status">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
