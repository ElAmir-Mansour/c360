'use client';

import { useEffect, useMemo } from 'react';
import { AlertCircle, Braces, RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type { JsonObject, LexDraftingTemplateSection } from '@/types/suites';

export type JsonSchemaEditorKind =
  | 'json-object'
  | 'json-array'
  | 'template-sections'
  | 'obligations';

export type JsonSchemaParsedValue = JsonObject | JsonObject[] | LexDraftingTemplateSection[];

export interface JsonSchemaField {
  key: string;
  label?: string;
  required?: boolean;
  description?: string;
}

export interface JsonSchemaEditorValidation {
  ok: boolean;
  parsed: JsonSchemaParsedValue | null;
  errors: string[];
}

export interface JsonSchemaEditorLabels {
  format: string;
  loadSample: string;
  schema: string;
  valid: string;
  invalid: string;
  errors: string;
  required: string;
}

export interface JsonSchemaEditorProps {
  id: string;
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  kind: JsonSchemaEditorKind;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  description?: string;
  sampleValue?: JsonSchemaParsedValue;
  schemaFields?: JsonSchemaField[];
  requiredKeys?: string[];
  itemRequiredKeys?: string[];
  className?: string;
  textareaClassName?: string;
  labels?: Partial<JsonSchemaEditorLabels>;
  onParsedChange?: (validation: JsonSchemaEditorValidation) => void;
}

export const ASSEMBLY_SECTION_SCHEMA_FIELDS: JsonSchemaField[] = [
  { key: 'id', label: 'ID' },
  { key: 'heading', label: 'Heading', required: true },
  { key: 'body', label: 'Body', required: true },
  { key: 'condition', label: 'Condition' },
];

export const OBLIGATION_QA_SCHEMA_FIELDS: JsonSchemaField[] = [
  { key: 'description', label: 'Description' },
  { key: 'owner', label: 'Owner' },
  { key: 'due', label: 'Due' },
  { key: 'type', label: 'Type' },
];

const DEFAULT_LABELS: JsonSchemaEditorLabels = {
  format: 'Format JSON',
  loadSample: 'Load sample',
  schema: 'Schema',
  valid: 'Valid JSON',
  invalid: 'Invalid JSON',
  errors: 'Validation errors',
  required: 'Required',
};

const AR_LABELS: JsonSchemaEditorLabels = {
  format: 'تنسيق JSON',
  loadSample: 'تحميل عينة',
  schema: 'المخطط',
  valid: 'JSON صالح',
  invalid: 'JSON غير صالح',
  errors: 'أخطاء التحقق',
  required: 'مطلوب',
};

export function formatJsonForEditor(value: JsonSchemaParsedValue): string {
  return JSON.stringify(value, null, 2);
}

export function parseJsonObjectInput(value: string, objectError = 'JSON must be an object.'): JsonObject {
  const parsed = JSON.parse(value) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(objectError);
  }
  return parsed;
}

export function parseJsonObjectArrayInput(
  value: string,
  arrayError = 'JSON must be an array of objects.',
): JsonObject[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(arrayError);
  }
  return parsed.map((item, index) => {
    if (!isJsonObject(item)) {
      throw new Error(`Item ${index + 1} must be a JSON object.`);
    }
    return item;
  });
}

export function parseTemplateSectionsInput(value: string): LexDraftingTemplateSection[] {
  const parsed = parseJsonObjectArrayInput(value, 'Template sections must be a JSON array.');
  return parsed.map((item, index) => {
    const heading = stringField(item, 'heading').trim();
    const body = stringField(item, 'body');
    if (!heading || !body.trim()) {
      throw new Error(`Section ${index + 1} needs heading and body.`);
    }
    const id = stringField(item, 'id').trim() || toSectionId(heading, index);
    const condition = stringField(item, 'condition').trim();
    return {
      id,
      heading,
      body,
      condition: condition || undefined,
    };
  });
}

export function parseObligationQaObjectsInput(value: string): JsonObject[] {
  return parseJsonObjectArrayInput(value, 'Obligations must be a JSON array.');
}

export function validateJsonSchemaEditorValue({
  value,
  kind,
  requiredKeys = [],
  itemRequiredKeys = [],
}: {
  value: string;
  kind: JsonSchemaEditorKind;
  requiredKeys?: string[];
  itemRequiredKeys?: string[];
}): JsonSchemaEditorValidation {
  const errors: string[] = [];
  let parsed: JsonSchemaParsedValue | null = null;

  try {
    if (kind === 'json-object') {
      parsed = parseJsonObjectInput(value);
      errors.push(...missingKeys(parsed, requiredKeys, 'Root object'));
    } else if (kind === 'template-sections') {
      parsed = parseTemplateSectionsInput(value);
      errors.push(...missingItemKeys(parsed, itemRequiredKeys));
    } else if (kind === 'obligations') {
      parsed = parseObligationQaObjectsInput(value);
      errors.push(...missingItemKeys(parsed, itemRequiredKeys));
    } else {
      parsed = parseJsonObjectArrayInput(value);
      errors.push(...missingItemKeys(parsed, itemRequiredKeys));
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'JSON is invalid.');
  }

  return {
    ok: errors.length === 0,
    parsed,
    errors,
  };
}

export function JsonSchemaEditor({
  id,
  label,
  value,
  onChange,
  kind,
  rows = 12,
  disabled = false,
  placeholder,
  description,
  sampleValue,
  schemaFields,
  requiredKeys = [],
  itemRequiredKeys,
  className,
  textareaClassName,
  labels,
  onParsedChange,
}: JsonSchemaEditorProps) {
  const { locale } = useLocaleOrDefault();
  const t = { ...(locale === 'ar' ? AR_LABELS : DEFAULT_LABELS), ...labels };
  const resolvedItemRequiredKeys = itemRequiredKeys ?? requiredSchemaKeys(schemaFields);
  const validation = useMemo(
    () =>
      validateJsonSchemaEditorValue({
        value,
        kind,
        requiredKeys,
        itemRequiredKeys: resolvedItemRequiredKeys,
      }),
    [kind, requiredKeys, resolvedItemRequiredKeys, value],
  );
  const fields = schemaFields ?? defaultSchemaFields(kind, locale);

  useEffect(() => {
    onParsedChange?.(validation);
  }, [onParsedChange, validation]);

  const formatValue = () => {
    if (validation.parsed) {
      onChange(formatJsonForEditor(validation.parsed));
    }
  };

  const loadSample = () => {
    if (sampleValue) {
      onChange(formatJsonForEditor(sampleValue));
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor={id}>{label}</Label>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={validation.ok ? 'success' : 'warning'}>
            {validation.ok ? t.valid : t.invalid}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={formatValue}
            disabled={disabled || !validation.parsed}
          >
            <Braces className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t.format}
          </Button>
          {sampleValue ? (
            <Button type="button" variant="outline" size="sm" onClick={loadSample} disabled={disabled}>
              <RefreshCcw className="me-1.5 h-4 w-4" aria-hidden="true" />
              {t.loadSample}
            </Button>
          ) : null}
        </div>
      </div>

      {fields.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-caps-xwide text-muted-foreground">
            {t.schema}
          </p>
          <div className="flex flex-wrap gap-2">
            {fields.map((field) => (
              <Badge
                key={field.key}
                variant={field.required ? 'default' : 'outline'}
                title={field.description}
                className="normal-case tracking-normal"
              >
                {field.label ?? localizeSchemaKey(field.key, locale)}
                {field.required ? ` - ${t.required}` : null}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className={cn('font-mono text-xs leading-6', textareaClassName)}
        aria-invalid={!validation.ok}
      />

      {!validation.ok ? (
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t.errors}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 ps-5">
              {validation.errors.map((error) => (
                <li key={error}>{localizeJsonValidationError(error, locale)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function defaultSchemaFields(kind: JsonSchemaEditorKind, locale: string): JsonSchemaField[] {
  if (kind === 'template-sections') {
    return ASSEMBLY_SECTION_SCHEMA_FIELDS.map((field) => ({
      ...field,
      label: localizeSchemaKey(field.key, locale, field.label),
    }));
  }
  if (kind === 'obligations') {
    return OBLIGATION_QA_SCHEMA_FIELDS.map((field) => ({
      ...field,
      label: localizeSchemaKey(field.key, locale, field.label),
    }));
  }
  return [];
}

function localizeSchemaKey(key: string, locale: string, fallback?: string): string {
  if (locale !== 'ar') return fallback ?? key;
  const labels: Record<string, string> = {
    id: 'المعرّف',
    heading: 'العنوان',
    body: 'النص',
    condition: 'الشرط',
    description: 'الوصف',
    owner: 'المالك',
    due: 'الاستحقاق',
    type: 'النوع',
  };
  return labels[key] ?? key;
}

function localizeJsonValidationError(error: string, locale: string): string {
  if (locale !== 'ar') return error;
  if (error === 'JSON must be an object.') return 'يجب أن يكون JSON كائنًا.';
  if (error === 'JSON must be an array of objects.') return 'يجب أن يكون JSON مصفوفة كائنات.';
  if (error === 'Template sections must be a JSON array.') return 'يجب أن تكون أقسام القالب مصفوفة JSON.';
  if (error === 'Obligations must be a JSON array.') return 'يجب أن تكون الالتزامات مصفوفة JSON.';
  if (error === 'JSON is invalid.') return 'JSON غير صالح.';
  const itemObject = error.match(/^Item (\d+) must be a JSON object\.$/);
  if (itemObject) return `العنصر ${itemObject[1]} يجب أن يكون كائن JSON.`;
  const sectionFields = error.match(/^Section (\d+) needs heading and body\.$/);
  if (sectionFields) return `القسم ${sectionFields[1]} يحتاج إلى عنوان ونص.`;
  const missing = error.match(/^(.+) is missing (.+)\.$/);
  if (missing) return `${missing[1] === 'Root object' ? 'الكائن الجذري' : missing[1]} يفتقد ${localizeSchemaKey(missing[2], locale)}.`;
  return /[A-Za-z]{3,}/.test(error) ? 'تحقق من بنية JSON والحقول المطلوبة.' : error;
}

function requiredSchemaKeys(fields: JsonSchemaField[] | undefined): string[] {
  return fields?.filter((field) => field.required).map((field) => field.key) ?? [];
}

function missingItemKeys(items: Array<JsonObject | LexDraftingTemplateSection>, keys: string[]): string[] {
  return items.flatMap((item, index) => missingKeys(item, keys, `Item ${index + 1}`));
}

function missingKeys(item: object, keys: string[], label: string): string[] {
  const record = item as Record<string, unknown>;
  return keys
    .filter((key) => !hasJsonValue(record[key]))
    .map((key) => `${label} is missing ${key}.`);
}

function hasJsonValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(item: JsonObject, key: string): string {
  const value = item[key];
  return typeof value === 'string' ? value : '';
}

function toSectionId(heading: string, index: number): string {
  const slug = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `section-${index + 1}`;
}
