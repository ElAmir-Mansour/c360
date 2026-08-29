'use client';

import { useMemo, type ReactNode } from 'react';
import { FileSignature, Layers3 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  JsonObject,
  JsonValue,
  LexDraftingContractDraft,
  LexDraftingTemplateSection,
} from '@/types/suites';

export type DealTermFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'date';

export interface DealTermSelectOption {
  label: string;
  value: string;
}

export interface DealTermFieldDefinition {
  key: string;
  label: string;
  type?: DealTermFieldType;
  placeholder?: string;
  description?: string;
  required?: boolean;
  options?: DealTermSelectOption[];
  rows?: number;
}

export interface DealTermsBuilderLabels {
  title: string;
  description: string;
  dealTermsJson: string;
  templateVariables: string;
  draftPreview: string;
  sections: string;
  openItems: string;
  missing: string;
  ready: string;
  none: string;
}

export interface DealTermsBuilderProps {
  value: JsonObject;
  onChange: (nextValue: JsonObject) => void;
  fields?: DealTermFieldDefinition[];
  templateSections?: LexDraftingTemplateSection[];
  contractDraft?: LexDraftingContractDraft | null;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  disabled?: boolean;
  showJsonPreview?: boolean;
  className?: string;
  labels?: Partial<DealTermsBuilderLabels>;
}

export const DEFAULT_DEAL_TERM_FIELDS: DealTermFieldDefinition[] = [
  { key: 'customer_name', label: 'Customer name', required: true },
  { key: 'supplier_name', label: 'Supplier name', required: true },
  { key: 'term_months', label: 'Term months', type: 'number' },
  { key: 'annual_value', label: 'Annual value' },
  { key: 'payment_terms', label: 'Payment terms' },
  { key: 'governing_law', label: 'Governing law' },
  {
    key: 'include_data_processing',
    label: 'Include data processing',
    type: 'boolean',
    description: 'Controls conditional data protection sections.',
  },
];

const DEFAULT_LABELS: DealTermsBuilderLabels = {
  title: 'Deal terms builder',
  description: 'Build structured deal terms for contract drafting or deterministic assembly.',
  dealTermsJson: 'Deal terms JSON',
  templateVariables: 'Template variables',
  draftPreview: 'Draft preview',
  sections: 'Sections',
  openItems: 'Open items',
  missing: 'Missing',
  ready: 'Ready',
  none: 'None',
};

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function extractTemplateVariablesFromText(text: string): string[] {
  const variables = new Set<string>();
  let match = TEMPLATE_VARIABLE_PATTERN.exec(text);
  while (match) {
    variables.add(match[1]);
    match = TEMPLATE_VARIABLE_PATTERN.exec(text);
  }
  TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
  return Array.from(variables).sort((a, b) => a.localeCompare(b));
}

export function extractTemplateVariables(
  sections: LexDraftingTemplateSection[] = [],
): string[] {
  const variables = new Set<string>();
  for (const section of sections) {
    for (const variable of extractTemplateVariablesFromText(section.body)) {
      variables.add(variable);
    }
    if (section.condition) {
      for (const variable of extractTemplateVariablesFromText(section.condition)) {
        variables.add(variable);
      }
    }
  }
  return Array.from(variables).sort((a, b) => a.localeCompare(b));
}

export function hasDealTermValue(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

export function setDealTermValue(
  dealTerms: JsonObject,
  key: string,
  nextValue: JsonValue | undefined,
): JsonObject {
  const nextTerms: JsonObject = { ...dealTerms };
  if (nextValue === undefined) {
    delete nextTerms[key];
  } else {
    nextTerms[key] = nextValue;
  }
  return nextTerms;
}

export function coerceDealTermInput(
  field: DealTermFieldDefinition,
  rawValue: string | boolean,
): JsonValue {
  const fieldType = field.type ?? 'text';
  if (fieldType === 'boolean') {
    return Boolean(rawValue);
  }
  if (fieldType === 'number') {
    const parsed = Number.parseFloat(String(rawValue));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return String(rawValue);
}

export function contractDraftToTemplateSections(
  draft: LexDraftingContractDraft,
  idPrefix = 'draft',
): LexDraftingTemplateSection[] {
  return draft.sections.map((section, index) => ({
    id: `${idPrefix}-${index + 1}`,
    heading: section.heading,
    body: section.body,
  }));
}

export function formatDealTermsJson(value: JsonObject): string {
  return JSON.stringify(value, null, 2);
}

export function DealTermsBuilder({
  value,
  onChange,
  fields = DEFAULT_DEAL_TERM_FIELDS,
  templateSections = [],
  contractDraft,
  title,
  description,
  actions,
  disabled = false,
  showJsonPreview = true,
  className,
  labels,
}: DealTermsBuilderProps) {
  const t = { ...DEFAULT_LABELS, ...labels };
  const templateVariables = useMemo(
    () => extractTemplateVariables(templateSections),
    [templateSections],
  );
  const missingVariables = templateVariables.filter(
    (variable) => !hasDealTermValue(value[variable] as JsonValue | undefined),
  );

  const updateField = (field: DealTermFieldDefinition, rawValue: string | boolean) => {
    onChange(setDealTermValue(value, field.key, coerceDealTermInput(field, rawValue)));
  };

  return (
    <SectionCard
      title={title ?? t.title}
      description={description ?? t.description}
      actions={actions}
      className={className}
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map((field) => (
            <DealTermField
              key={field.key}
              field={field}
              value={value[field.key] as JsonValue | undefined}
              disabled={disabled}
              onChange={(rawValue) => updateField(field, rawValue)}
            />
          ))}
        </div>

        {templateVariables.length > 0 ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">{t.templateVariables}</p>
              </div>
              <Badge variant={missingVariables.length ? 'warning' : 'success'}>
                {missingVariables.length ? t.missing : t.ready}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {templateVariables.map((variable) => (
                <Badge
                  key={variable}
                  variant={hasDealTermValue(value[variable] as JsonValue | undefined) ? 'outline' : 'warning'}
                  className="normal-case tracking-normal"
                >
                  {variable}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {contractDraft ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">{t.draftPreview}</p>
            </div>
            <div className="space-y-2 text-sm">
              <p className="font-semibold">{contractDraft.title}</p>
              <p className="text-muted-foreground">
                {t.sections}: {contractDraft.sections.length}
              </p>
              {contractDraft.open_items?.length ? (
                <p className="text-muted-foreground">
                  {t.openItems}: {contractDraft.open_items.length}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {showJsonPreview ? (
          <div className="space-y-2">
            <Label>{t.dealTermsJson}</Label>
            <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/30 p-4 text-xs leading-6">
              {formatDealTermsJson(value)}
            </pre>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function DealTermField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: DealTermFieldDefinition;
  value: JsonValue | undefined;
  disabled: boolean;
  onChange: (rawValue: string | boolean) => void;
}) {
  const fieldType = field.type ?? 'text';
  const inputId = `deal-term-${field.key}`;
  const stringValue = value === undefined || value === null ? '' : String(value);

  if (fieldType === 'boolean') {
    return (
      <div className="flex min-h-[76px] items-start justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-1">
          <Label htmlFor={inputId} className={cn(field.required && 'after:ms-1 after:content-[\"*\"]')}>
            {field.label}
          </Label>
          {field.description ? (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          ) : null}
        </div>
        <Switch
          id={inputId}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={field.label}
        />
      </div>
    );
  }

  if (fieldType === 'select' && field.options?.length) {
    return (
      <div className="space-y-2">
        <FieldLabel id={inputId} field={field} />
        <Select value={stringValue} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={inputId}>
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription description={field.description} />
      </div>
    );
  }

  if (fieldType === 'textarea') {
    return (
      <div className="space-y-2 md:col-span-2">
        <FieldLabel id={inputId} field={field} />
        <Textarea
          id={inputId}
          value={stringValue}
          rows={field.rows ?? 4}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <FieldDescription description={field.description} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <FieldLabel id={inputId} field={field} />
      <Input
        id={inputId}
        type={fieldType === 'number' ? 'number' : fieldType === 'date' ? 'date' : 'text'}
        value={stringValue}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldDescription description={field.description} />
    </div>
  );
}

function FieldLabel({ id, field }: { id: string; field: DealTermFieldDefinition }) {
  return (
    <Label htmlFor={id} className={cn(field.required && 'after:ms-1 after:content-[\"*\"]')}>
      {field.label}
    </Label>
  );
}

function FieldDescription({ description }: { description?: string }) {
  return description ? <p className="text-xs text-muted-foreground">{description}</p> : null;
}
