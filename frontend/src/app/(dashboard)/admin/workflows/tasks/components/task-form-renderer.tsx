'use client';

import { useCallback, useMemo } from 'react';
import {
  useForm,
  useWatch,
  Controller,
  type Control,
  type FieldErrors,
  type Resolver,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { Combobox } from '@/components/shared/forms/combobox';
import { DateRangePicker } from '@/components/shared/forms/date-range-picker';
import { FileUpload } from '@/components/shared/forms/file-upload';
import { buildDynamicZodSchema, isFieldVisible } from '@/lib/workflow-utils';
import type { FieldType, FormField } from '@/types/models';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import { resolveLocalized, normalizeOptions } from '@/lib/i18n/localized';
import type { AppDirection, AppLocale } from '@/lib/i18n';
import { getAdminWorkflowLabels } from '../_lib/admin-workflow-i18n';

interface TaskFormRendererProps {
  fields: FormField[];
  initialData?: Record<string, unknown> | null;
  readOnly: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
  formRef?: React.Ref<HTMLFormElement>;
}

/**
 * Free-text field types whose direction should follow the content (dir="auto")
 * unless the field author forced a direction. Option/structured fields inherit
 * the page direction.
 */
const FREE_TEXT_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'text',
  'textarea',
  'email',
  'url',
  'phone',
  'number',
  'currency',
]);

/**
 * fieldDirection resolves the dir attribute for a field: an explicit, non-auto
 * field.dir wins; otherwise free-text fields get "auto" (the glyph run decides)
 * and structured fields inherit the page direction.
 */
function fieldDirection(field: FormField, pageDir: AppDirection): AppDirection | 'auto' {
  if (field.dir === 'ltr' || field.dir === 'rtl') {
    return field.dir;
  }
  if (field.dir === 'auto') {
    return 'auto';
  }
  return FREE_TEXT_TYPES.has(field.type) ? 'auto' : pageDir;
}

/**
 * radixDir collapses an "auto" direction to the page direction for Radix
 * primitives (RadioGroup) whose `dir` prop only accepts "ltr"/"rtl".
 */
function radixDir(
  dir: AppDirection | 'auto',
  pageDir: AppDirection,
): AppDirection {
  return dir === 'auto' ? pageDir : dir;
}

export function TaskFormRenderer({
  fields,
  initialData,
  readOnly,
  onSubmit,
  formRef,
}: TaskFormRendererProps) {
  const { locale, direction } = useLocaleOrDefault();

  const defaults = useMemo<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      out[f.name] =
        initialData?.[f.name] ?? f.default ?? getFieldDefault(f.type);
    }
    return out;
  }, [fields, initialData]);

  // The schema depends on the CURRENT values (conditional visible/required) and
  // the active locale. A resolver closure that rebuilds the schema against the
  // live values at every validation pass keeps conditional rules in lock-step
  // with what the user has entered, the same way the backend re-evaluates
  // ValidateSubmission against the submitted FormData. Because hidden fields are
  // excluded from the schema, a required-but-hidden field never blocks submit.
  const resolver = useCallback<Resolver<Record<string, unknown>>>(
    (values, context, options) => {
      const schema = buildDynamicZodSchema(fields, { locale, values });
      return zodResolver(schema)(values, context, options);
    },
    [fields, locale],
  );

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, unknown>>({
    resolver,
    defaultValues: defaults,
  });

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit((data) => onSubmit(data))}
      className="space-y-3"
      dir={direction}
    >
      {fields.map((field) => (
        <RenderedField
          key={field.name}
          field={field}
          control={control}
          errors={errors}
          readOnly={readOnly}
          locale={locale}
          pageDir={direction}
        />
      ))}
    </form>
  );
}

interface RenderedFieldProps {
  field: FormField;
  control: Control<Record<string, unknown>>;
  errors: FieldErrors<Record<string, unknown>>;
  readOnly: boolean;
  locale: AppLocale;
  pageDir: AppDirection;
}

function RenderedField({
  field,
  control,
  errors,
  readOnly,
  locale,
  pageDir,
}: RenderedFieldProps) {
  const t = useT('admin');
  const labels = getAdminWorkflowLabels(locale);
  // CONDITIONAL VISIBILITY: watch all values and re-evaluate visibleWhen against
  // them. A hidden field is NOT rendered (and is excluded from the schema, so it
  // cannot block submit). Re-runs on every value change.
  const watched = useWatch({ control }) as Record<string, unknown>;
  const values = watched ?? {};

  if (!isFieldVisible(field, values)) {
    return null;
  }

  const fieldLabel = resolveLocalized(field.label, locale);
  const fieldPlaceholder = resolveLocalized(field.placeholder, locale) || undefined;
  const fieldDescription = resolveLocalized(field.description, locale) || undefined;
  const fieldOptions = normalizeOptions(field.options).map((opt) => ({
    value: opt.value,
    label: resolveLocalized(opt.label, locale),
  }));
  const dir = fieldDirection(field, pageDir);
  const inputId = `field-${field.name}`;

  // section: a heading, no input.
  if (field.type === 'section') {
    return (
      <div className="pt-2">
        <h3 className="text-sm font-semibold" dir={dir}>
          {fieldLabel}
        </h3>
        {fieldDescription && (
          <p className="text-overline text-muted-foreground" dir={dir}>
            {fieldDescription}
          </p>
        )}
      </div>
    );
  }

  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: rhf }) => (
        <div className="space-y-1">
          {field.type !== 'boolean' && (
            <Label htmlFor={inputId} className="text-xs">
              {fieldLabel}
              {field.required && <span className="text-destructive ms-0.5">*</span>}
            </Label>
          )}
          {fieldDescription && field.type !== 'section' && (
            <p className="text-overline text-muted-foreground" dir={dir}>
              {fieldDescription}
            </p>
          )}

          {field.type === 'boolean' ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={inputId}
                checked={Boolean(rhf.value)}
                onCheckedChange={rhf.onChange}
                disabled={readOnly}
              />
              <label htmlFor={inputId} className="text-sm">
                {fieldLabel}
                {field.required && <span className="text-destructive ms-0.5">*</span>}
              </label>
            </div>
          ) : field.type === 'select' ? (
            <Select
              value={(rhf.value as string) ?? ''}
              onValueChange={rhf.onChange}
              disabled={readOnly || fieldOptions.length === 0}
            >
              <SelectTrigger id={inputId} className="h-8 text-sm" dir={dir}>
                <SelectValue placeholder={fieldPlaceholder ?? t('tfr.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {fieldOptions.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    {t('tfr.noOptions')}
                  </SelectItem>
                ) : (
                  fieldOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          ) : field.type === 'radio' ? (
            <RadioGroup
              value={(rhf.value as string) ?? ''}
              onValueChange={rhf.onChange}
              disabled={readOnly}
              dir={radixDir(dir, pageDir)}
              className="flex flex-col gap-1.5"
            >
              {fieldOptions.map((opt) => (
                <div key={opt.value} className="flex items-center gap-2">
                  <RadioGroupItem value={opt.value} id={`${inputId}-${opt.value}`} />
                  <Label
                    htmlFor={`${inputId}-${opt.value}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : field.type === 'multiselect' ? (
            <MultiSelect
              options={fieldOptions}
              selected={Array.isArray(rhf.value) ? (rhf.value as string[]) : []}
              onChange={rhf.onChange}
              placeholder={fieldPlaceholder ?? labels.common.selectPlaceholder}
              disabled={readOnly}
            />
          ) : field.type === 'combobox' ? (
            <Combobox
              options={fieldOptions}
              value={(rhf.value as string) ?? ''}
              onChange={rhf.onChange}
              placeholder={fieldPlaceholder ?? labels.common.selectPlaceholder}
              searchPlaceholder={labels.common.searchPlaceholder}
              disabled={readOnly}
              className="h-8 w-full text-sm"
            />
          ) : field.type === 'daterange' ? (
            <DateRangePicker
              value={tupleToRange(rhf.value)}
              onChange={(range) => rhf.onChange(rangeToTuple(range))}
              disabled={readOnly}
              className="h-8 w-full text-sm"
            />
          ) : field.type === 'file' ? (
            <div>
              <FileUpload
                onUpload={async (files) => {
                  // Persist the selected file's name as the field value; the
                  // upload service resolves the opaque reference downstream.
                  rhf.onChange(files[0]?.name ?? '');
                }}
                disabled={readOnly}
              />
              {typeof rhf.value === 'string' && rhf.value !== '' && (
                <p className="mt-1 text-overline text-muted-foreground">{rhf.value}</p>
              )}
            </div>
          ) : field.type === 'textarea' ? (
            <Textarea
              id={inputId}
              value={(rhf.value as string) ?? ''}
              onChange={rhf.onChange}
              placeholder={fieldPlaceholder}
              disabled={readOnly}
              rows={3}
              dir={dir}
              className="text-sm"
            />
          ) : field.type === 'number' || field.type === 'currency' ? (
            <Input
              id={inputId}
              type="number"
              inputMode="decimal"
              value={rhf.value !== undefined && rhf.value !== null ? String(rhf.value) : ''}
              onChange={(e) =>
                rhf.onChange(
                  e.target.value === '' ? undefined : Number(e.target.value),
                )
              }
              placeholder={fieldPlaceholder}
              disabled={readOnly}
              dir={dir}
              className="h-8 text-sm"
            />
          ) : field.type === 'date' ? (
            <Input
              id={inputId}
              type="date"
              value={(rhf.value as string) ?? ''}
              onChange={rhf.onChange}
              disabled={readOnly}
              className="h-8 text-sm"
            />
          ) : field.type === 'datetime' ? (
            <Input
              id={inputId}
              type="datetime-local"
              value={(rhf.value as string) ?? ''}
              onChange={rhf.onChange}
              disabled={readOnly}
              className="h-8 text-sm"
            />
          ) : (
            // text, email, url, phone
            <Input
              id={inputId}
              type={inputTypeFor(field.type)}
              inputMode={inputModeFor(field.type)}
              value={(rhf.value as string) ?? ''}
              onChange={rhf.onChange}
              placeholder={fieldPlaceholder}
              disabled={readOnly}
              dir={dir}
              className="h-8 text-sm"
            />
          )}

          {errors[field.name] && (
            <p className="text-overline normal-case tracking-normal text-destructive" dir={dir}>
              {errors[field.name]?.message as string}
            </p>
          )}
        </div>
      )}
    />
  );
}

function inputTypeFor(type: FieldType): string {
  switch (type) {
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'phone':
      return 'tel';
    default:
      return 'text';
  }
}

function inputModeFor(
  type: FieldType,
): 'email' | 'url' | 'tel' | 'text' | undefined {
  switch (type) {
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'phone':
      return 'tel';
    default:
      return undefined;
  }
}

/** tupleToRange maps a stored [start, end] ISO tuple to the picker's DateRange. */
function tupleToRange(value: unknown): { from: Date | undefined; to: Date | undefined } {
  if (Array.isArray(value)) {
    const [from, to] = value as [unknown, unknown];
    return {
      from: typeof from === 'string' && from !== '' ? new Date(from) : undefined,
      to: typeof to === 'string' && to !== '' ? new Date(to) : undefined,
    };
  }
  return { from: undefined, to: undefined };
}

/** rangeToTuple serializes the picker's DateRange back to a [start, end] tuple. */
function rangeToTuple(range: {
  from: Date | undefined;
  to: Date | undefined;
}): [string, string] {
  return [
    range.from ? toISODate(range.from) : '',
    range.to ? toISODate(range.to) : '',
  ];
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getFieldDefault(type: string): unknown {
  switch (type) {
    case 'boolean':
      return false;
    case 'number':
    case 'currency':
      return undefined;
    case 'multiselect':
      return [];
    case 'daterange':
      return ['', ''];
    default:
      return '';
  }
}
