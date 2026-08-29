'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Languages, Loader2 } from 'lucide-react';
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
  LexClauseLibraryEntry,
  LexCreateClauseLibraryEntryPayload,
  LexUpdateClauseLibraryEntryPayload,
} from '@/types/suites';
import { useClauseLibraryLabels } from './clause-content-labels';
import { useClauseTaxonomyLabels } from './clause-taxonomy-labels';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';

const CLAUSE_TYPE_OPTIONS = [
  'indemnification',
  'termination',
  'limitation_of_liability',
  'confidentiality',
  'ip_ownership',
  'non_compete',
  'payment_terms',
  'warranty',
  'force_majeure',
  'dispute_resolution',
  'data_protection',
  'governing_law',
  'assignment',
  'insurance',
  'audit_rights',
  'sla',
  'auto_renewal',
  'representations',
  'non_solicitation',
  'other',
] as const;

const CLAUSE_STATUS_OPTIONS = ['draft', 'active', 'deprecated', 'archived'] as const;
const RISK_LEVEL_OPTIONS = ['none', 'low', 'medium', 'high', 'critical'] as const;

interface ClauseFormValues {
  code: string;
  clause_type: string;
  title_en: string;
  title_ar: string;
  text_en: string;
  text_ar: string;
  category: string;
  jurisdiction: string;
  source: string;
  source_url: string;
  risk_level: string;
  status: string;
  tags: string;
}

/**
 * Optional pre-fill for the create dialog (closed-loop "Save to Clause Library"
 * cross-launch from the AI drafting surface). Only the fields the drafting op
 * produced are supplied; the rest fall back to the create defaults.
 */
export interface ClauseFormPrefill {
  title_en?: string;
  title_ar?: string;
  text_en?: string;
  text_ar?: string;
  clause_type?: string;
  risk_level?: string;
}

export interface ClauseFormDialogProps {
  open: boolean;
  entry?: LexClauseLibraryEntry | null;
  prefill?: ClauseFormPrefill | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}

export function ClauseFormDialog({ open, entry, prefill, onOpenChange, onSaved }: ClauseFormDialogProps) {
  const isEdit = Boolean(entry);
  const allLabels = useClauseLibraryLabels();
  const taxonomy = useClauseTaxonomyLabels();
  const labels = allLabels.form;
  const [values, setValues] = useState<ClauseFormValues>(() => clauseFormDefaults(entry, prefill));

  const saveMutation = useMutation({
    mutationFn: (payload: LexCreateClauseLibraryEntryPayload | LexUpdateClauseLibraryEntryPayload) =>
      isEdit && entry
        ? enterpriseApi.lex.updateClauseLibraryEntry(entry.id, payload as LexUpdateClauseLibraryEntryPayload)
        : enterpriseApi.lex.createClauseLibraryEntry(payload as LexCreateClauseLibraryEntryPayload),
    onSuccess: async () => {
      showSuccess(isEdit ? allLabels.toast.updated : allLabels.toast.created);
      await onSaved();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updateValue = <K extends keyof ClauseFormValues>(key: K, value: ClauseFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  // Translate the side with content into the empty side. Default EN→AR when both
  // (or neither) are populated, since the create flow is most often EN-first.
  const translateDirection: 'en_to_ar' | 'ar_to_en' = useMemo(() => {
    const hasEn = values.text_en.trim() !== '';
    const hasAr = values.text_ar.trim() !== '';
    if (hasAr && !hasEn) {
      return 'ar_to_en';
    }
    return 'en_to_ar';
  }, [values.text_en, values.text_ar]);

  const translateMutation = useMutation({
    mutationFn: async () => {
      const enToAr = translateDirection === 'en_to_ar';
      const source = (enToAr ? values.text_en : values.text_ar).trim();
      if (!source) {
        throw new Error(labels.translateEmpty);
      }
      const response = await enterpriseApi.lex.drafting.translateText({
        text: source,
        source_lang: enToAr ? 'en' : 'ar',
        target_lang: enToAr ? 'ar' : 'en',
      });
      return { enToAr, translation: response.translation };
    },
    onSuccess: ({ enToAr, translation }) => {
      updateValue(enToAr ? 'text_ar' : 'text_en', translation);
      showSuccess(labels.translateDone);
    },
    onError: showApiError,
  });

  const handleTranslate = () => {
    translateMutation.mutate();
  };

  const canSubmit =
    values.code.trim() !== '' && values.title_en.trim() !== '' && values.text_en.trim() !== '';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      showApiError(new Error(labels.requiredError));
      return;
    }
    saveMutation.mutate(buildClausePayload(values, isEdit));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.editTitle : labels.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? labels.editDescription : labels.createDescription}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          {!isEdit ? <LexCreationGuidance workflow="clause" /> : null}
          <fieldset className="space-y-4" disabled={saveMutation.isPending}>
            <legend className="sr-only">{labels.sectionIdentity}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="clause-code">{labels.code}</Label>
                <Input
                  id="clause-code"
                  value={values.code}
                  onChange={(event) => updateValue('code', event.target.value)}
                  placeholder={labels.codePlaceholder}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clause-type">{labels.clauseType}</Label>
                <Select value={values.clause_type} onValueChange={(value) => updateValue('clause_type', value)}>
                  <SelectTrigger id="clause-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUSE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {taxonomy.clauseType(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="clause-category">{labels.category}</Label>
                <Input
                  id="clause-category"
                  value={values.category}
                  onChange={(event) => updateValue('category', event.target.value)}
                  placeholder={labels.categoryPlaceholder}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4" disabled={saveMutation.isPending}>
            <legend className="text-sm font-medium">{labels.sectionContent}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clause-title-en">{labels.titleEn}</Label>
                <Input
                  id="clause-title-en"
                  value={values.title_en}
                  onChange={(event) => updateValue('title_en', event.target.value)}
                  placeholder={labels.titleEnPlaceholder}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clause-title-ar">{labels.titleAr}</Label>
                <Input
                  id="clause-title-ar"
                  dir="rtl"
                  value={values.title_ar}
                  onChange={(event) => updateValue('title_ar', event.target.value)}
                  placeholder={labels.titleArPlaceholder}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clause-text-en">{labels.textEn}</Label>
                <Textarea
                  id="clause-text-en"
                  value={values.text_en}
                  onChange={(event) => updateValue('text_en', event.target.value)}
                  rows={6}
                  placeholder={labels.textEnPlaceholder}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="clause-text-ar">{labels.textAr}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={handleTranslate}
                    disabled={translateMutation.isPending || saveMutation.isPending}
                  >
                    {translateMutation.isPending ? (
                      <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Languages className="me-1.5 h-3.5 w-3.5" aria-hidden />
                    )}
                    {translateDirection === 'en_to_ar' ? labels.translateEnToAr : labels.translateArToEn}
                  </Button>
                </div>
                <Textarea
                  id="clause-text-ar"
                  dir="rtl"
                  value={values.text_ar}
                  onChange={(event) => updateValue('text_ar', event.target.value)}
                  rows={6}
                  placeholder={labels.textArPlaceholder}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4" disabled={saveMutation.isPending}>
            <legend className="text-sm font-medium">{labels.sectionClassification}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clause-jurisdiction">{labels.jurisdiction}</Label>
                <Input
                  id="clause-jurisdiction"
                  value={values.jurisdiction}
                  onChange={(event) => updateValue('jurisdiction', event.target.value)}
                  placeholder={labels.jurisdictionPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clause-source">{labels.source}</Label>
                <Input
                  id="clause-source"
                  value={values.source}
                  onChange={(event) => updateValue('source', event.target.value)}
                  placeholder={labels.sourcePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clause-risk">{labels.riskLevel}</Label>
                <Select value={values.risk_level} onValueChange={(value) => updateValue('risk_level', value)}>
                  <SelectTrigger id="clause-risk">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_LEVEL_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {taxonomy.risk(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="clause-status">{labels.status}</Label>
                <Select value={values.status} onValueChange={(value) => updateValue('status', value)}>
                  <SelectTrigger id="clause-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUSE_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {taxonomy.status(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clause-source-url">{labels.sourceUrl}</Label>
              <Input
                id="clause-source-url"
                type="url"
                value={values.source_url}
                onChange={(event) => updateValue('source_url', event.target.value)}
                placeholder={labels.sourceUrlPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clause-tags">{labels.tags}</Label>
              <Input
                id="clause-tags"
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

function clauseFormDefaults(
  entry: LexClauseLibraryEntry | null | undefined,
  prefill?: ClauseFormPrefill | null,
): ClauseFormValues {
  return {
    code: entry?.code ?? '',
    clause_type: normalizeClauseType(prefill?.clause_type) ?? (entry?.clause_type as string) ?? 'other',
    title_en: entry?.title_en ?? prefill?.title_en ?? '',
    title_ar: entry?.title_ar ?? prefill?.title_ar ?? '',
    text_en: entry?.text_en ?? prefill?.text_en ?? '',
    text_ar: entry?.text_ar ?? prefill?.text_ar ?? '',
    category: entry?.category ?? '',
    jurisdiction: entry?.jurisdiction ?? 'SA',
    source: entry?.source ?? (prefill ? 'ai_drafting' : 'internal_template'),
    source_url: entry?.source_url ?? '',
    risk_level: (entry?.risk_level as string) ?? normalizeRiskLevel(prefill?.risk_level) ?? 'medium',
    status: (entry?.status as string) ?? 'draft',
    tags: entry?.tags?.join(', ') ?? '',
  };
}

/** Maps a free-form clause type to a known option, or `undefined` if no match. */
function normalizeClauseType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (CLAUSE_TYPE_OPTIONS as readonly string[]).includes(normalized) ? normalized : undefined;
}

/** Maps a free-form risk hint to a known risk-level option, or `undefined`. */
function normalizeRiskLevel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return (RISK_LEVEL_OPTIONS as readonly string[]).includes(normalized) ? normalized : undefined;
}

function buildClausePayload(
  values: ClauseFormValues,
  isEdit: boolean,
): LexCreateClauseLibraryEntryPayload & LexUpdateClauseLibraryEntryPayload {
  return {
    code: values.code.trim(),
    clause_type: values.clause_type,
    title_en: values.title_en.trim(),
    title_ar: values.title_ar.trim(),
    text_en: values.text_en.trim(),
    text_ar: values.text_ar.trim(),
    category: values.category.trim(),
    jurisdiction: values.jurisdiction.trim() || 'SA',
    source: values.source.trim() || 'internal_template',
    source_url: optionalString(values.source_url),
    status: values.status,
    tags: parseTags(values.tags),
    metadata: {
      source_surface: 'watheeq_clause_library_page',
      risk_level: values.risk_level,
      ...(isEdit ? { last_authored_at: new Date().toISOString() } : {}),
    },
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
