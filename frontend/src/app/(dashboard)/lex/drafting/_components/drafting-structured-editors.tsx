'use client';

import { useMemo, useState } from 'react';
import { GitCompareArrows, Plus, Trash2 } from 'lucide-react';
import { RedlineView } from '@/components/shared/redline-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/format/currency';
import type { JsonObject, LexDraftingTemplateSection } from '@/types/suites';
import { useDraftingLabels } from './drafting-shared';

export interface DealTermsState {
  customer_name: string;
  supplier_name: string;
  term_months: string;
  annual_value: string;
  payment_terms: string;
  governing_law: string;
  renewal: string;
  sla: string;
  data_processing: string;
}

export const DEFAULT_DEAL_TERMS: DealTermsState = {
  customer_name: 'Watheeq Cloud LLC',
  supplier_name: 'Clario360 Ltd',
  term_months: '24',
  annual_value: formatCurrency(1200000, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  payment_terms: 'Net 30',
  governing_law: 'Kingdom of Saudi Arabia',
  renewal: 'One-year renewal unless either party gives 60 days notice.',
  sla: '99.5% monthly uptime with service credits.',
  data_processing: 'Supplier processes personal data only on documented instructions.',
};

export function dealTermsToJson(values: DealTermsState): JsonObject {
  return {
    customer_name: values.customer_name,
    supplier_name: values.supplier_name,
    term_months: Number.parseInt(values.term_months, 10) || values.term_months,
    annual_value: values.annual_value,
    payment_terms: values.payment_terms,
    governing_law: values.governing_law,
    renewal: values.renewal,
    sla: values.sla,
    data_processing: values.data_processing,
  };
}

export function DealTermsBuilder({
  value,
  onChange,
}: {
  value: DealTermsState;
  onChange: (value: DealTermsState) => void;
}) {
  const fields = useDraftingLabels().structuredEditors;
  const setField = (key: keyof DealTermsState, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DealInput id="customer" label={fields.customer} value={value.customer_name} onChange={(next) => setField('customer_name', next)} />
      <DealInput id="supplier" label={fields.supplier} value={value.supplier_name} onChange={(next) => setField('supplier_name', next)} />
      <DealInput id="term-months" label={fields.termMonths} value={value.term_months} onChange={(next) => setField('term_months', next)} />
      <DealInput id="annual-value" label={fields.annualValue} value={value.annual_value} onChange={(next) => setField('annual_value', next)} />
      <DealInput id="payment-terms" label={fields.paymentTerms} value={value.payment_terms} onChange={(next) => setField('payment_terms', next)} />
      <DealInput id="governing-law" label={fields.governingLaw} value={value.governing_law} onChange={(next) => setField('governing_law', next)} />
      <DealText id="renewal" label={fields.renewal} value={value.renewal} onChange={(next) => setField('renewal', next)} />
      <DealText id="sla" label={fields.sla} value={value.sla} onChange={(next) => setField('sla', next)} />
      <div className="md:col-span-2">
        <DealText id="data-processing" label={fields.dataProcessing} value={value.data_processing} onChange={(next) => setField('data_processing', next)} />
      </div>
    </div>
  );
}

function DealInput({ id: fieldId, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const id = `deal-${fieldId}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function DealText({ id: fieldId, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const id = `deal-${fieldId}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
    </div>
  );
}

export function ObjectArrayEditor({
  label,
  rows,
  onChange,
  sampleRow,
}: {
  label: string;
  rows: JsonObject[];
  onChange: (rows: JsonObject[]) => void;
  sampleRow: JsonObject;
}) {
  const fields = useDraftingLabels().structuredEditors;
  const [showJson, setShowJson] = useState(false);
  const jsonValue = useMemo(() => JSON.stringify(rows, null, 2), [rows]);
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShowJson((value) => !value)}>
            {showJson ? fields.rowsToggle : fields.jsonToggle}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, sampleRow])}>
            <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {fields.add}
          </Button>
        </div>
      </div>
      {showJson ? (
        <Textarea
          value={jsonValue}
          onChange={(event) => {
            try {
              const parsed = JSON.parse(event.target.value) as JsonObject[];
              if (Array.isArray(parsed)) onChange(parsed);
            } catch {
              // Keep current valid state until JSON is corrected.
            }
          }}
          rows={10}
          className="font-mono text-xs"
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="rounded-md border bg-background p-3">
              <div className="mb-2 flex items-center justify-between">
                <Badge variant="outline">#{index + 1}</Badge>
                <Button type="button" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}>
                  <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {Object.entries(row).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <Label>{fields.fieldLabels[key] ?? key}</Label>
                    <Input
                      value={String(value ?? '')}
                      onChange={(event) =>
                        onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: event.target.value } : item)))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplateSectionEditor({
  sections,
  onChange,
}: {
  sections: LexDraftingTemplateSection[];
  onChange: (sections: LexDraftingTemplateSection[]) => void;
}) {
  const fields = useDraftingLabels().structuredEditors;
  const [showJson, setShowJson] = useState(false);
  const jsonValue = useMemo(() => JSON.stringify(sections, null, 2), [sections]);
  const update = (index: number, patch: Partial<LexDraftingTemplateSection>) =>
    onChange(sections.map((section, itemIndex) => (itemIndex === index ? { ...section, ...patch } : section)));

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{fields.templateSections}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShowJson((value) => !value)}>
            {showJson ? fields.rowsToggle : fields.jsonToggle}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...sections, { id: `section-${sections.length + 1}`, heading: fields.newSection, body: '' }])}
          >
            <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {fields.add}
          </Button>
        </div>
      </div>
      {showJson ? (
        <Textarea
          value={jsonValue}
          onChange={(event) => {
            try {
              const parsed = JSON.parse(event.target.value) as LexDraftingTemplateSection[];
              if (Array.isArray(parsed)) onChange(parsed);
            } catch {
              // Keep the valid structured state while the user edits.
            }
          }}
          rows={14}
          className="font-mono text-xs"
        />
      ) : (
        <div className="space-y-3">
          {sections.map((section, index) => (
            <div key={`${section.id}-${index}`} className="rounded-md border bg-background p-3">
              <div className="mb-3 flex items-center justify-between">
                <Badge variant="outline">#{index + 1}</Badge>
                <Button type="button" variant="ghost" size="icon" onClick={() => onChange(sections.filter((_, itemIndex) => itemIndex !== index))}>
                  <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <DealInput id={`section-${index}-id`} label={fields.sectionId} value={section.id} onChange={(next) => update(index, { id: next })} />
                <DealInput id={`section-${index}-heading`} label={fields.sectionHeading} value={section.heading} onChange={(next) => update(index, { heading: next })} />
                <div className="md:col-span-2">
                  <DealInput id={`section-${index}-condition`} label={fields.sectionCondition} value={section.condition ?? ''} onChange={(next) => update(index, { condition: next || undefined })} />
                </div>
                <div className="md:col-span-2">
                  <DealText id={`section-${index}-body`} label={fields.sectionBody} value={section.body} onChange={(next) => update(index, { body: next })} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BatchTextEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const fields = useDraftingLabels().structuredEditors;
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <Label htmlFor="batch-editor">{label}</Label>
      <Textarea
        id="batch-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={6}
        placeholder={fields.batchPlaceholder}
      />
    </div>
  );
}

export function ResultComparePanel({
  original,
  revised,
  originalLabel,
  revisedLabel,
  dir = 'ltr',
}: {
  original: string;
  revised: string;
  originalLabel?: string;
  revisedLabel?: string;
  dir?: 'ltr' | 'rtl';
}) {
  const fields = useDraftingLabels().structuredEditors;
  if (!original || !revised) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <GitCompareArrows className="h-4 w-4 text-muted-foreground" aria-hidden />
        {fields.compare}
      </p>
      <RedlineView
        original={original}
        revised={revised}
        mode="split"
        originalLabel={originalLabel ?? fields.original}
        revisedLabel={revisedLabel ?? fields.generated}
        dir={dir}
      />
    </div>
  );
}
