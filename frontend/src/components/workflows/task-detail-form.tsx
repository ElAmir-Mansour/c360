'use client';

import { forwardRef, useImperativeHandle } from 'react';
import { Controller, useWatch, type Control } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { Combobox } from '@/components/shared/forms/combobox';
import { DateRangePicker } from '@/components/shared/forms/date-range-picker';
import { FileUpload } from '@/components/shared/forms/file-upload';
import { useTaskForm } from '@/hooks/use-task-form';
import { isFieldVisible } from '@/lib/workflow-utils';
import type { FieldType, FormField as TaskFormField } from '@/types/models';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized, normalizeOptions } from '@/lib/i18n/localized';
import type { AppDirection, AppLocale } from '@/lib/i18n';

export interface TaskDetailFormHandle {
  submit: () => Promise<void>;
  saveDraft: () => void;
  getValues: () => Record<string, unknown>;
  isDirty: () => boolean;
}

interface TaskDetailFormProps {
  formSchema: TaskFormField[];
  initialValues?: Record<string, unknown>;
  readOnly?: boolean;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onDraftSave?: (data: Record<string, unknown>) => void;
  isSubmitting?: boolean;
  formId?: string;
  showSubmitButton?: boolean;
}

const FREE_TEXT_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'text',
  'textarea',
  'email',
  'url',
  'phone',
  'number',
  'currency',
]);

function fieldDirection(
  field: TaskFormField,
  pageDir: AppDirection,
): AppDirection | 'auto' {
  if (field.dir === 'ltr' || field.dir === 'rtl') {
    return field.dir;
  }
  if (field.dir === 'auto') {
    return 'auto';
  }
  return FREE_TEXT_TYPES.has(field.type) ? 'auto' : pageDir;
}

function radixDir(
  dir: AppDirection | 'auto',
  pageDir: AppDirection,
): AppDirection {
  return dir === 'auto' ? pageDir : dir;
}

export const TaskDetailForm = forwardRef<TaskDetailFormHandle, TaskDetailFormProps>(
  function TaskDetailForm(
    {
      formSchema,
      initialValues,
      readOnly = false,
      onSubmit,
      onDraftSave,
      isSubmitting = false,
      formId = 'task-detail-form',
      showSubmitButton = true,
    },
    ref,
  ) {
    const { locale, direction } = useLocaleOrDefault();
    const form = useTaskForm({ formSchema, initialValues, onDraftSave, readOnly, locale });

    useImperativeHandle(
      ref,
      () => ({
        submit: async () => {
          await form.handleSubmit(onSubmit)();
        },
        saveDraft: () => {
          if (onDraftSave) {
            onDraftSave(form.getValues());
          }
        },
        getValues: () => form.getValues(),
        isDirty: () => form.formState.isDirty,
      }),
      [form, onDraftSave, onSubmit],
    );

    if (formSchema.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          This task has no form fields to fill in.
        </p>
      );
    }

    return (
      <Form {...form}>
        <form
          id={formId}
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          dir={direction}
        >
          {formSchema.map((field) => (
            <DetailField
              key={field.name}
              field={field}
              control={form.control}
              readOnly={readOnly}
              locale={locale}
              pageDir={direction}
            />
          ))}

          {!readOnly && showSubmitButton && (
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </Button>
            </div>
          )}
        </form>
      </Form>
    );
  },
);

interface DetailFieldProps {
  field: TaskFormField;
  control: Control<Record<string, unknown>>;
  readOnly: boolean;
  locale: AppLocale;
  pageDir: AppDirection;
}

function DetailField({
  field,
  control,
  readOnly,
  locale,
  pageDir,
}: DetailFieldProps) {
  // CONDITIONAL VISIBILITY: re-evaluate visibleWhen against the live values.
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

  if (field.type === 'section') {
    return (
      <div className="space-y-1 border-t pt-4">
        <h3 className="text-base font-semibold" dir={dir}>
          {fieldLabel}
        </h3>
        {fieldDescription && (
          <p className="text-xs text-muted-foreground" dir={dir}>
            {fieldDescription}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>
        {fieldLabel}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </Label>

      <Controller
        control={control}
        name={field.name}
        render={({ field: rhfField, fieldState }) => {
          const errorMsg = fieldState.error?.message;
          const err = errorMsg ? (
            <p className="mt-1 text-xs text-destructive" dir={dir}>
              {errorMsg}
            </p>
          ) : null;

          if (field.type === 'boolean') {
            return (
              <div>
                <RadioGroup
                  value={
                    rhfField.value === true
                      ? 'true'
                      : rhfField.value === false
                        ? 'false'
                        : ''
                  }
                  onValueChange={(value) => rhfField.onChange(value === 'true')}
                  disabled={readOnly}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="true" id={`${field.name}-yes`} />
                    <Label htmlFor={`${field.name}-yes`} className="cursor-pointer font-normal">
                      Yes
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="false" id={`${field.name}-no`} />
                    <Label htmlFor={`${field.name}-no`} className="cursor-pointer font-normal">
                      No
                    </Label>
                  </div>
                </RadioGroup>
                {err}
              </div>
            );
          }

          if (field.type === 'radio') {
            return (
              <div>
                <RadioGroup
                  value={(rhfField.value as string) ?? ''}
                  onValueChange={rhfField.onChange}
                  disabled={readOnly}
                  dir={radixDir(dir, pageDir)}
                  className="flex flex-col gap-2"
                >
                  {fieldOptions.map((opt) => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <RadioGroupItem value={opt.value} id={`${inputId}-${opt.value}`} />
                      <Label
                        htmlFor={`${inputId}-${opt.value}`}
                        className="cursor-pointer font-normal"
                      >
                        {opt.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                {err}
              </div>
            );
          }

          if (field.type === 'textarea') {
            return (
              <div>
                <Textarea
                  id={inputId}
                  placeholder={fieldPlaceholder}
                  className="min-h-[100px]"
                  disabled={readOnly}
                  dir={dir}
                  {...rhfField}
                  value={(rhfField.value as string) ?? ''}
                />
                {err}
              </div>
            );
          }

          if (field.type === 'select') {
            return (
              <div>
                <Select
                  value={(rhfField.value as string) ?? ''}
                  onValueChange={rhfField.onChange}
                  disabled={readOnly || fieldOptions.length === 0}
                >
                  <SelectTrigger id={inputId} dir={dir}>
                    <SelectValue placeholder={fieldPlaceholder ?? 'Select...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {fieldOptions.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No options available
                      </SelectItem>
                    ) : (
                      fieldOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {err}
              </div>
            );
          }

          if (field.type === 'multiselect') {
            return (
              <div>
                <MultiSelect
                  options={fieldOptions}
                  selected={Array.isArray(rhfField.value) ? (rhfField.value as string[]) : []}
                  onChange={rhfField.onChange}
                  placeholder={fieldPlaceholder ?? 'Select...'}
                  disabled={readOnly}
                />
                {err}
              </div>
            );
          }

          if (field.type === 'combobox') {
            return (
              <div>
                <Combobox
                  options={fieldOptions}
                  value={(rhfField.value as string) ?? ''}
                  onChange={rhfField.onChange}
                  placeholder={fieldPlaceholder ?? 'Select...'}
                  disabled={readOnly}
                  className="w-full"
                />
                {err}
              </div>
            );
          }

          if (field.type === 'daterange') {
            return (
              <div>
                <DateRangePicker
                  value={tupleToRange(rhfField.value)}
                  onChange={(range) => rhfField.onChange(rangeToTuple(range))}
                  disabled={readOnly}
                  className="w-full"
                />
                {err}
              </div>
            );
          }

          if (field.type === 'file') {
            return (
              <div>
                <FileUpload
                  onUpload={async (files) => {
                    rhfField.onChange(files[0]?.name ?? '');
                  }}
                  disabled={readOnly}
                />
                {typeof rhfField.value === 'string' && rhfField.value !== '' && (
                  <p className="mt-1 text-xs text-muted-foreground">{rhfField.value}</p>
                )}
                {err}
              </div>
            );
          }

          if (field.type === 'number' || field.type === 'currency') {
            return (
              <div>
                <Input
                  id={inputId}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder={fieldPlaceholder}
                  disabled={readOnly}
                  dir={dir}
                  {...rhfField}
                  value={(rhfField.value as number | '') ?? ''}
                  onChange={(event) => {
                    rhfField.onChange(
                      event.target.value === '' ? undefined : Number(event.target.value),
                    );
                  }}
                />
                {err}
              </div>
            );
          }

          if (field.type === 'date') {
            return (
              <div>
                <Input
                  id={inputId}
                  type="date"
                  disabled={readOnly}
                  {...rhfField}
                  value={(rhfField.value as string) ?? ''}
                />
                {err}
              </div>
            );
          }

          if (field.type === 'datetime') {
            return (
              <div>
                <Input
                  id={inputId}
                  type="datetime-local"
                  disabled={readOnly}
                  {...rhfField}
                  value={(rhfField.value as string) ?? ''}
                />
                {err}
              </div>
            );
          }

          // text, email, url, phone
          return (
            <div>
              <Input
                id={inputId}
                type={inputTypeFor(field.type)}
                inputMode={inputModeFor(field.type)}
                placeholder={fieldPlaceholder}
                disabled={readOnly}
                dir={dir}
                {...rhfField}
                value={(rhfField.value as string) ?? ''}
              />
              {err}
            </div>
          );
        }}
      />

      {fieldDescription && (
        <p className="text-xs text-muted-foreground" dir={dir}>
          {fieldDescription}
        </p>
      )}
    </div>
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
