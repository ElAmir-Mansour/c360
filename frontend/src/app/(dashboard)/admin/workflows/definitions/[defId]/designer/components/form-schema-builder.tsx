'use client';

import { useCallback } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ConditionBuilder,
  type EditableCondition,
} from './condition-builder';
import {
  FIELD_TYPES,
  OPTION_BACKED_TYPES,
  RULE_KINDS,
} from '@/types/forms';
import type {
  Condition,
  FieldDir,
  FieldType,
  FormField,
  FormOption,
  LocalizedText,
  RuleKind,
  ValidationRule,
} from '@/types/forms';
import { normalizeLocalized, normalizeOptions } from '@/lib/i18n/localized';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import { getDefinitionLabels } from '../../../definition-i18n';
import '@/app/(dashboard)/admin/_lib/admin-i18n';

/** Rule kinds an author can ADD from the rule editor (with their param shape). */
const ADDABLE_RULES: { kind: RuleKind; label: string; hasParam: boolean; paramHint?: string }[] = [
  { kind: 'required', label: 'Required', hasParam: false },
  { kind: 'minLength', label: 'Min length', hasParam: true, paramHint: 'e.g. 3' },
  { kind: 'maxLength', label: 'Max length', hasParam: true, paramHint: 'e.g. 50' },
  { kind: 'min', label: 'Min value', hasParam: true, paramHint: 'e.g. 0' },
  { kind: 'max', label: 'Max value', hasParam: true, paramHint: 'e.g. 100' },
  { kind: 'pattern', label: 'Pattern (regex)', hasParam: true, paramHint: 'e.g. ^[A-Z]+$' },
  { kind: 'email', label: 'Email', hasParam: false },
  { kind: 'url', label: 'URL', hasParam: false },
  { kind: 'uuid', label: 'UUID', hasParam: false },
  { kind: 'enum', label: 'Enum', hasParam: true, paramHint: 'a, b, c' },
];

/** The set of rule kinds whose param is numeric. */
const NUMERIC_PARAM_RULES: ReadonlySet<RuleKind> = new Set([
  'minLength',
  'maxLength',
  'min',
  'max',
]);

const DIR_OPTIONS: { value: FieldDir; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'auto', label: 'Auto' },
  { value: 'ltr', label: 'LTR' },
  { value: 'rtl', label: 'RTL' },
];

const RULE_PARAM_HINT_AR: Partial<Record<RuleKind, string>> = {
  minLength: 'مثال: 3',
  maxLength: 'مثال: 50',
  min: 'مثال: 0',
  max: 'مثال: 100',
  pattern: 'مثال: ^[A-Z]+$',
  enum: 'a, b, c',
};

interface FormSchemaBuilderProps {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
  readOnly?: boolean;
  /** Names of the other fields a visibleWhen condition may reference. */
  expandedByDefault?: boolean;
}

/** lt is a tiny helper to read a localized side from any accepted label shape. */
function ltSide(value: LocalizedText | string | undefined, side: 'ar' | 'en'): string {
  return normalizeLocalized(value)[side];
}

/** setSide updates one locale of a localized text, preserving the other. */
function setSide(
  value: LocalizedText | string | undefined,
  side: 'ar' | 'en',
  next: string,
): LocalizedText {
  const current = normalizeLocalized(value);
  return { ...current, [side]: next };
}

export function FormSchemaBuilder({ fields, onChange, readOnly }: FormSchemaBuilderProps) {
  const t = useT('admin');
  const handleAdd = useCallback(() => {
    const name = `field_${fields.length + 1}`;
    const next: FormField = {
      name,
      type: 'text',
      label: { ar: '', en: '' },
      required: false,
      placeholder: { ar: '', en: '' },
    };
    onChange([...fields, next]);
  }, [fields, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(fields.filter((_, i) => i !== index));
    },
    [fields, onChange],
  );

  const handleUpdate = useCallback(
    (index: number, updates: Partial<FormField>) => {
      onChange(fields.map((f, i) => (i === index ? { ...f, ...updates } : f)));
    },
    [fields, onChange],
  );

  const handleMove = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= fields.length) return;
      const updated = [...fields];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange(updated);
    },
    [fields, onChange],
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs">{t('fsb.formFields')}</Label>

      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('fsb.noFormFields')}
        </p>
      )}

      {fields.map((field, i) => (
        <FieldEditor
          key={i}
          index={i}
          field={field}
          total={fields.length}
          otherFieldNames={fields.filter((_, j) => j !== i).map((f) => f.name).filter(Boolean)}
          readOnly={readOnly}
          onUpdate={(updates) => handleUpdate(i, updates)}
          onRemove={() => handleRemove(i)}
          onMove={(dir) => handleMove(i, dir)}
        />
      ))}

      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs"
          onClick={handleAdd}
        >
          <Plus className="me-1 h-3 w-3" />
          {t('fsb.addField')}
        </Button>
      )}
    </div>
  );
}

interface FieldEditorProps {
  index: number;
  field: FormField;
  total: number;
  otherFieldNames: string[];
  readOnly?: boolean;
  onUpdate: (updates: Partial<FormField>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

function FieldEditor({
  index,
  field,
  total,
  otherFieldNames,
  readOnly,
  onUpdate,
  onRemove,
  onMove,
}: FieldEditorProps) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const localLabels = getDefinitionLabels(locale);
  const isOptionBacked = OPTION_BACKED_TYPES.includes(field.type);
  const isSection = field.type === 'section';
  const options = normalizeOptions(field.options);
  const rules = field.validation ?? [];
  const visibleWhen = field.visibleWhen ?? [];

  // ── Options ──
  const updateOptions = (next: FormOption[]) => onUpdate({ options: next });
  const addOption = () =>
    updateOptions([...options, { value: `option_${options.length + 1}`, label: { ar: '', en: '' } }]);
  const removeOption = (oi: number) => updateOptions(options.filter((_, j) => j !== oi));
  const updateOption = (oi: number, updates: Partial<FormOption>) =>
    updateOptions(options.map((o, j) => (j === oi ? { ...o, ...updates } : o)));

  // ── Validation rules ──
  const updateRules = (next: ValidationRule[]) => onUpdate({ validation: next });
  const addRule = (kind: RuleKind) =>
    updateRules([...rules, { kind, ...(NUMERIC_PARAM_RULES.has(kind) ? { param: 0 } : {}) }]);
  const removeRule = (ri: number) => updateRules(rules.filter((_, j) => j !== ri));
  const updateRule = (ri: number, updates: Partial<ValidationRule>) =>
    updateRules(rules.map((r, j) => (j === ri ? { ...r, ...updates } : r)));

  // ── visibleWhen (canonical Condition[] via the shared ConditionBuilder) ──
  const updateVisibleWhen = (next: EditableCondition[]) =>
    onUpdate({ visibleWhen: next as Condition[] });

  return (
    <details className="rounded-md border bg-muted/30" open={index === 0}>
      <summary className="flex items-center gap-1.5 p-2 cursor-pointer list-none">
        {!readOnly && (
          <span className="flex flex-col -my-1">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={index === 0}
              onClick={(e) => {
                e.preventDefault();
                onMove(-1);
              }}
              aria-label={t('fsb.moveUp')}
            >
              <GripVertical className="h-3 w-3 rotate-90" />
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              disabled={index === total - 1}
              onClick={(e) => {
                e.preventDefault();
                onMove(1);
              }}
              aria-label={t('fsb.moveDown')}
            >
              <GripVertical className="h-3 w-3 -rotate-90" />
            </button>
          </span>
        )}
        <ChevronRight className="h-3 w-3 shrink-0 group-open:hidden [details[open]_&]:hidden" />
        <ChevronDown className="hidden h-3 w-3 shrink-0 [details[open]_&]:block" />
        <span className="font-mono text-xs flex-1 truncate">
          {field.name || `field_${index + 1}`}
        </span>
        <span className="text-overline text-muted-foreground">
          {t('fsb.ft.' + field.type)}
        </span>
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => {
              e.preventDefault();
              onRemove();
            }}
            aria-label={t('fsb.removeField')}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </summary>

      <div className="space-y-2 p-2 pt-0">
        {/* Name + Type + Required */}
        <div className="flex items-center gap-1.5">
          <Input
            value={field.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="field_name"
            disabled={readOnly}
            className="h-7 text-xs flex-1 font-mono"
            aria-label={t('fsb.fieldName')}
          />
          <Select
            value={field.type}
            onValueChange={(v) => onUpdate({ type: v as FieldType })}
            disabled={readOnly}
          >
            <SelectTrigger className="h-7 w-32 text-xs" aria-label={t('fsb.fieldType')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((ft) => (
                <SelectItem key={ft} value={ft}>
                  {t('fsb.ft.' + ft)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isSection && (
            <div className="flex items-center gap-1">
              <Switch
                checked={field.required}
                onCheckedChange={(v) => onUpdate({ required: v })}
                disabled={readOnly}
                className="scale-75"
                aria-label={t('fsb.required')}
              />
              <span className="text-overline text-muted-foreground">{t('fsb.req')}</span>
            </div>
          )}
        </div>

        {/* Label (AR + EN) */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-0.5">
            <Label className="text-overline text-muted-foreground">{t('fsb.labelAr')}</Label>
            <Input
              value={ltSide(field.label, 'ar')}
              onChange={(e) => onUpdate({ label: setSide(field.label, 'ar', e.target.value) })}
              placeholder={t('fsb.phLabelAr')}
              dir="rtl"
              disabled={readOnly}
              className="h-7 text-xs"
              aria-label={t('fsb.labelArAria')}
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-overline text-muted-foreground">{t('fsb.labelEn')}</Label>
            <Input
              value={ltSide(field.label, 'en')}
              onChange={(e) => onUpdate({ label: setSide(field.label, 'en', e.target.value) })}
              placeholder={t('fsb.phLabelEn')}
              disabled={readOnly}
              className="h-7 text-xs"
              aria-label={t('fsb.labelEnAria')}
            />
          </div>
        </div>

        {!isSection && (
          <>
            {/* Placeholder (AR + EN) */}
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                value={ltSide(field.placeholder, 'ar')}
                onChange={(e) =>
                  onUpdate({ placeholder: setSide(field.placeholder, 'ar', e.target.value) })
                }
                placeholder={t('fsb.phPlaceholderAr')}
                dir="rtl"
                disabled={readOnly}
                className="h-7 text-xs"
                aria-label={t('fsb.placeholderArAria')}
              />
              <Input
                value={ltSide(field.placeholder, 'en')}
                onChange={(e) =>
                  onUpdate({ placeholder: setSide(field.placeholder, 'en', e.target.value) })
                }
                placeholder={t('fsb.phPlaceholderEn')}
                disabled={readOnly}
                className="h-7 text-xs"
                aria-label={t('fsb.placeholderEnAria')}
              />
            </div>

            {/* Description (AR + EN) */}
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                value={ltSide(field.description, 'ar')}
                onChange={(e) =>
                  onUpdate({ description: setSide(field.description, 'ar', e.target.value) })
                }
                placeholder={t('fsb.phDescriptionAr')}
                dir="rtl"
                disabled={readOnly}
                className="h-7 text-xs"
                aria-label={t('fsb.descriptionArAria')}
              />
              <Input
                value={ltSide(field.description, 'en')}
                onChange={(e) =>
                  onUpdate({ description: setSide(field.description, 'en', e.target.value) })
                }
                placeholder={t('fsb.phDescriptionEn')}
                disabled={readOnly}
                className="h-7 text-xs"
                aria-label={t('fsb.descriptionEnAria')}
              />
            </div>

            {/* Default + Direction */}
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                value={field.default !== undefined && field.default !== null ? String(field.default) : ''}
                onChange={(e) =>
                  onUpdate({ default: e.target.value === '' ? undefined : e.target.value })
                }
                placeholder={t('fsb.phDefaultValue')}
                disabled={readOnly}
                className="h-7 text-xs"
                aria-label={t('fsb.defaultValueAria')}
              />
              <Select
                value={field.dir ?? ''}
                onValueChange={(v) => onUpdate({ dir: v as FieldDir })}
                disabled={readOnly}
              >
                <SelectTrigger className="h-7 text-xs" aria-label={t('fsb.directionAria')}>
                  <SelectValue placeholder={t('fsb.phDirection')} />
                </SelectTrigger>
                <SelectContent>
                  {DIR_OPTIONS.map((d) => (
                    <SelectItem key={d.value || 'default'} value={d.value || 'default'}>
                      {t('fsb.dir.' + (d.value || 'default'))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Options (option-backed types) */}
        {isOptionBacked && (
          <div className="space-y-1">
            <Label className="text-overline text-muted-foreground">{t('fsb.options')}</Label>
            {options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-1">
                <Input
                  value={opt.value}
                  onChange={(e) => updateOption(oi, { value: e.target.value })}
                  placeholder={t('fsb.phOptValue')}
                  disabled={readOnly}
                  className="h-6 text-[11px] flex-1 font-mono"
                  aria-label={t('fsb.optValueAria', { n: oi + 1 })}
                />
                <Input
                  value={normalizeLocalized(opt.label).ar}
                  onChange={(e) =>
                    updateOption(oi, { label: setSide(opt.label, 'ar', e.target.value) })
                  }
                  placeholder="AR"
                  dir="rtl"
                  disabled={readOnly}
                  className="h-6 text-[11px] flex-1"
                  aria-label={t('fsb.optLabelArAria', { n: oi + 1 })}
                />
                <Input
                  value={normalizeLocalized(opt.label).en}
                  onChange={(e) =>
                    updateOption(oi, { label: setSide(opt.label, 'en', e.target.value) })
                  }
                  placeholder="EN"
                  disabled={readOnly}
                  className="h-6 text-[11px] flex-1"
                  aria-label={t('fsb.optLabelEnAria', { n: oi + 1 })}
                />
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => removeOption(oi)}
                    aria-label={t('fsb.removeOptionAria', { n: oi + 1 })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px] w-full"
                onClick={addOption}
              >
                <Plus className="me-1 h-3 w-3" />
                {t('fsb.addOption')}
              </Button>
            )}
          </div>
        )}

        {/* Validation rules */}
        {!isSection && (
          <div className="space-y-1">
            <Label className="text-overline text-muted-foreground">{t('fsb.validationRules')}</Label>
            {rules.map((rule, ri) => {
              const meta = ADDABLE_RULES.find((m) => m.kind === rule.kind);
              const hasParam = meta?.hasParam ?? false;
              return (
                <div key={ri} className="space-y-1 rounded border bg-background/60 p-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium flex-1">{rule.kind}</span>
                    {hasParam && (
                      <Input
                        value={rule.param !== undefined && rule.param !== null ? String(rule.param) : ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          let param: unknown = raw;
                          if (NUMERIC_PARAM_RULES.has(rule.kind)) {
                            param = raw === '' ? 0 : Number(raw);
                          } else if (rule.kind === 'enum') {
                            param = raw
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean);
                          }
                          updateRule(ri, { param });
                        }}
                        placeholder={
                          locale === 'ar'
                            ? RULE_PARAM_HINT_AR[rule.kind] ?? 'المعامل'
                            : meta?.paramHint ?? 'param'
                        }
                        disabled={readOnly}
                        className="h-6 text-[11px] w-32"
                        aria-label={localLabels.aria.ruleParam(rule.kind)}
                      />
                    )}
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => removeRule(ri)}
                        aria-label={localLabels.aria.removeRule(rule.kind)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {/* Optional bilingual error message */}
                  <div className="grid grid-cols-2 gap-1">
                    <Input
                      value={normalizeLocalized(rule.message).ar}
                      onChange={(e) =>
                        updateRule(ri, { message: setSide(rule.message, 'ar', e.target.value) })
                      }
                      placeholder={t('fsb.errorAr')}
                      dir="rtl"
                      disabled={readOnly}
                      className="h-6 text-[11px]"
                      aria-label={localLabels.aria.ruleMessageAr(rule.kind)}
                    />
                    <Input
                      value={normalizeLocalized(rule.message).en}
                      onChange={(e) =>
                        updateRule(ri, { message: setSide(rule.message, 'en', e.target.value) })
                      }
                      placeholder={t('fsb.errorEn')}
                      disabled={readOnly}
                      className="h-6 text-[11px]"
                      aria-label={localLabels.aria.ruleMessageEn(rule.kind)}
                    />
                  </div>
                </div>
              );
            })}
            {!readOnly && (
              <Select
                value=""
                onValueChange={(v) => addRule(v as RuleKind)}
              >
                <SelectTrigger className="h-6 text-[11px]" aria-label={t('fsb.addRuleAria')}>
                  <SelectValue placeholder={t('fsb.addRule')} />
                </SelectTrigger>
                <SelectContent>
                  {ADDABLE_RULES.filter((m) => RULE_KINDS.includes(m.kind)).map((m) => (
                    <SelectItem key={m.kind} value={m.kind}>
                      {t('fsb.rule.' + m.kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* Visible When (conditional visibility) */}
        {!isSection && (
          <div className="space-y-1">
            <ConditionBuilder<EditableCondition>
              conditions={visibleWhen as EditableCondition[]}
              onChange={updateVisibleWhen}
              readOnly={readOnly}
              label={t('fsb.visibleWhen')}
              fieldPlaceholder={otherFieldNames[0] ?? 'other_field'}
              hideLogic
            />
          </div>
        )}
      </div>
    </details>
  );
}
