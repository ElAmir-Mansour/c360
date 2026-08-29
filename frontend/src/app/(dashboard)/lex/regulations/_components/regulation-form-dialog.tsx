'use client';

import { type FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  LexCreateRegulationPayload,
  LexRegulation,
  LexUpdateRegulationPayload,
} from '@/types/suites';
import { useRegulationLabels } from './regulation-content-labels';
import { useRegulationTypeLabel } from './regulation-type-labels';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';

const REGULATION_TYPE_OPTIONS = ['law', 'regulation', 'directive', 'standard', 'guideline', 'circular', 'decree', 'other'] as const;
const JURISDICTION_OPTIONS = ['SA', 'GCC', 'GLOBAL'] as const;
const REGULATION_STATUS_OPTIONS = ['draft', 'active', 'superseded', 'deprecated', 'archived'] as const;

interface RegulationFormValues {
  code: string;
  title_en: string;
  title_ar: string;
  description_en: string;
  description_ar: string;
  authority: string;
  jurisdiction: string;
  regulation_type: string;
  source: string;
  source_url: string;
  effective_date: string;
  status: string;
  tags: string;
}

export interface RegulationFormDialogProps {
  open: boolean;
  regulation?: LexRegulation | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}

export function RegulationFormDialog({ open, regulation, onOpenChange, onSaved }: RegulationFormDialogProps) {
  const isEdit = Boolean(regulation);
  const allLabels = useRegulationLabels();
  const labels = allLabels.form;
  const typeLabel = useRegulationTypeLabel();
  const statusOptionLabels = allLabels.filters.statusOptions as Record<string, string>;
  const jurisdictionOptionLabels = allLabels.filters.jurisdictionOptions as Record<string, string>;
  const [values, setValues] = useState<RegulationFormValues>(() => regulationFormDefaults(regulation));

  const saveMutation = useMutation({
    mutationFn: (payload: LexCreateRegulationPayload | LexUpdateRegulationPayload) =>
      isEdit && regulation
        ? enterpriseApi.lex.updateRegulation(regulation.id, payload as LexUpdateRegulationPayload)
        : enterpriseApi.lex.createRegulation(payload as LexCreateRegulationPayload),
    onSuccess: async () => {
      showSuccess(isEdit ? allLabels.toast.updated : allLabels.toast.created);
      await onSaved();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const canSubmit = values.code.trim() !== '' && values.title_en.trim() !== '';

  const updateValue = <K extends keyof RegulationFormValues>(key: K, value: RegulationFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      showApiError(new Error(labels.requiredError));
      return;
    }
    saveMutation.mutate(buildRegulationPayload(values));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.editTitle : labels.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? labels.editDescription : labels.createDescription}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          {!isEdit ? <LexCreationGuidance workflow="regulation" /> : null}
          <fieldset className="space-y-4" disabled={saveMutation.isPending}>
            <legend className="text-sm font-medium">{labels.sectionIdentity}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="regulation-code">{labels.code}</Label>
                <Input
                  id="regulation-code"
                  value={values.code}
                  onChange={(event) => updateValue('code', event.target.value)}
                  placeholder={labels.codePlaceholder}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regulation-authority">{labels.authority}</Label>
                <Input
                  id="regulation-authority"
                  value={values.authority}
                  onChange={(event) => updateValue('authority', event.target.value)}
                  placeholder={labels.authorityPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regulation-type">{labels.regulationType}</Label>
                <Select value={values.regulation_type} onValueChange={(value) => updateValue('regulation_type', value)}>
                  <SelectTrigger id="regulation-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGULATION_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {typeLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="regulation-title-en">{labels.titleEn}</Label>
                <Input
                  id="regulation-title-en"
                  value={values.title_en}
                  onChange={(event) => updateValue('title_en', event.target.value)}
                  placeholder={labels.titleEnPlaceholder}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regulation-title-ar">{labels.titleAr}</Label>
                <Input
                  id="regulation-title-ar"
                  dir="rtl"
                  value={values.title_ar}
                  onChange={(event) => updateValue('title_ar', event.target.value)}
                  placeholder={labels.titleArPlaceholder}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4" disabled={saveMutation.isPending}>
            <legend className="text-sm font-medium">{labels.sectionContent}</legend>
            <div className="space-y-2">
              <Label htmlFor="regulation-description-en">{labels.descriptionEn}</Label>
              <Textarea
                id="regulation-description-en"
                value={values.description_en}
                onChange={(event) => updateValue('description_en', event.target.value)}
                rows={3}
                placeholder={labels.descriptionEnPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regulation-description-ar">{labels.descriptionAr}</Label>
              <Textarea
                id="regulation-description-ar"
                dir="rtl"
                value={values.description_ar}
                onChange={(event) => updateValue('description_ar', event.target.value)}
                rows={3}
                placeholder={labels.descriptionArPlaceholder}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-4" disabled={saveMutation.isPending}>
            <legend className="text-sm font-medium">{labels.sectionClassification}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="regulation-jurisdiction">{labels.jurisdiction}</Label>
                <Select value={values.jurisdiction} onValueChange={(value) => updateValue('jurisdiction', value)}>
                  <SelectTrigger id="regulation-jurisdiction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JURISDICTION_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {jurisdictionOptionLabels[option] ?? option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="regulation-status">{labels.status}</Label>
                <Select value={values.status} onValueChange={(value) => updateValue('status', value)}>
                  <SelectTrigger id="regulation-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGULATION_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {statusOptionLabels[option] ?? formatToken(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="regulation-source">{labels.source}</Label>
                <Input
                  id="regulation-source"
                  value={values.source}
                  onChange={(event) => updateValue('source', event.target.value)}
                  placeholder={labels.sourcePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regulation-effective-date">{labels.effectiveDate}</Label>
                <Input
                  id="regulation-effective-date"
                  type="date"
                  value={values.effective_date}
                  onChange={(event) => updateValue('effective_date', event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="regulation-source-url">{labels.sourceUrl}</Label>
              <Input
                id="regulation-source-url"
                type="url"
                value={values.source_url}
                onChange={(event) => updateValue('source_url', event.target.value)}
                placeholder={labels.sourceUrlPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regulation-tags">{labels.tags}</Label>
              <Input
                id="regulation-tags"
                value={values.tags}
                onChange={(event) => updateValue('tags', event.target.value)}
                placeholder={labels.tagsPlaceholder}
              />
              <p className="text-xs text-muted-foreground">{labels.tagsHint}</p>
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit || saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {isEdit ? labels.submitEdit : labels.submitCreate}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function regulationFormDefaults(regulation: LexRegulation | null | undefined): RegulationFormValues {
  return {
    code: regulation?.code ?? '',
    title_en: regulation?.title_en ?? '',
    title_ar: regulation?.title_ar ?? '',
    description_en: regulation?.description_en ?? '',
    description_ar: regulation?.description_ar ?? '',
    authority: regulation?.authority ?? '',
    jurisdiction: regulation?.jurisdiction ?? 'SA',
    regulation_type: regulation?.regulation_type || 'regulation',
    source: regulation?.source ?? 'official_gazette',
    source_url: regulation?.source_url ?? '',
    effective_date: toDateInput(regulation?.effective_date),
    status: (regulation?.status as string) ?? 'draft',
    tags: regulation?.tags?.join(', ') ?? '',
  };
}

function buildRegulationPayload(values: RegulationFormValues): LexCreateRegulationPayload & LexUpdateRegulationPayload {
  return {
    code: values.code.trim(),
    title_en: values.title_en.trim(),
    title_ar: values.title_ar.trim(),
    description_en: values.description_en.trim(),
    description_ar: values.description_ar.trim(),
    authority: values.authority.trim(),
    jurisdiction: values.jurisdiction.trim() || 'SA',
    regulation_type: values.regulation_type,
    source: values.source.trim() || 'official_gazette',
    source_url: optionalString(values.source_url),
    effective_date: optionalString(values.effective_date),
    status: values.status,
    tags: parseTags(values.tags),
    metadata: { source_surface: 'watheeq_regulation_library_page' },
  };
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDateInput(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return '';
  }
  return parsed.toISOString().slice(0, 10);
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}
