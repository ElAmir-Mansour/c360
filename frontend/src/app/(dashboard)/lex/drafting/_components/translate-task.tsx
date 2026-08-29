'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import type { LexDraftingTranslateRequest, LexDraftingTranslationResult } from '@/types/suites';
import {
  type DraftingErrorState,
  DraftingResultActionBar,
  DraftingResultShell,
  buildDraftingError,
  equivalenceBadgeVariant,
  languageLabel,
  numericMeta,
  requiredError,
  useDraftingLabels,
} from './drafting-shared';
import { BatchTextEditor, ResultComparePanel } from './drafting-structured-editors';
import {
  ClauseLibraryPicker,
  DraftingRiskDashboard,
  EditableResultPanel,
  QualityChecklist,
  SaveDraftTargetActions,
  SourcePicker,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';
import {
  BatchJobQueuePanel,
  createDraftingBatchJobSeeds,
  parseDraftingBatchText,
  useBatchJobQueue,
} from './batch-job-queue';

const TRANSLATE_LANG_VALUES = ['en', 'ar'] as const;

export function TranslateTask() {
  const labels = useDraftingLabels();
  const t = labels.translate;
  const translateLanguages = TRANSLATE_LANG_VALUES.map((value) => ({
    value,
    label: labels.options.languages[value] ?? value,
  }));
  const [text, setText] = useState('');
  const [sourceLang, setSourceLang] = useState<string>('en');
  const [targetLang, setTargetLang] = useState<string>('ar');
  const [result, setResult] = useState<LexDraftingTranslationResult | null>(null);
  const [submittedText, setSubmittedText] = useState('');
  const [editableText, setEditableText] = useState('');
  const [batchText, setBatchText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const batchQueue = useBatchJobQueue<LexDraftingTranslateRequest, LexDraftingTranslationResult>();
  const isBusy = isLoading || batchQueue.isRunning;

  useEffect(() => {
    const handoff = consumeDraftingHandoff('translate');
    if (handoff?.text) {
      setText(handoff.text);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) {
      setError(requiredError(labels.errors.requiredTitle, t.textRequired));
      setResult(null);
      return;
    }

    const payload: LexDraftingTranslateRequest = {
      text: trimmedText,
      source_lang: sourceLang,
      target_lang: targetLang,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    batchQueue.clear();
    setSubmittedText(trimmedText);
    try {
      const translation = await enterpriseApi.lex.drafting.translateText(payload);
      setResult(translation);
      setEditableText(translation.translation);
      saveDraftingRun({
        task: 'translate',
        title: t.resultTitle,
        input: payload,
        result: translation,
        text: translation.translation,
        confidence: numericMeta(translation.meta, 'confidence') ?? null,
      });
      setIsLoading(false);

      const batchItems = parseDraftingBatchText(batchText);
      if (batchItems.length > 0) {
        const batchJobs = createDraftingBatchJobSeeds<LexDraftingTranslateRequest>({
          texts: batchItems,
          idPrefix: 'translate',
          labelPrefix: t.resultTitle,
          makeInput: (item) => ({
            ...payload,
            text: item,
          }),
        });

        void batchQueue.run(batchJobs, (itemPayload) =>
          enterpriseApi.lex.drafting.translateText(itemPayload),
        );
      }
    } catch (err) {
      setError(buildDraftingError(err, labels.errors));
    } finally {
      setIsLoading(false);
    }
  };

  const isArabicTarget = (result?.target_lang ?? targetLang) === 'ar';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <SectionCard title={t.cardTitle} description={t.cardDescription}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="translate-source">{t.sourceLang}</Label>
              <Select value={sourceLang} onValueChange={setSourceLang} disabled={isBusy}>
                <SelectTrigger id="translate-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {translateLanguages.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="translate-target">{t.targetLang}</Label>
              <Select value={targetLang} onValueChange={setTargetLang} disabled={isBusy}>
                <SelectTrigger id="translate-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {translateLanguages.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="translate-text">{t.textLabel}</Label>
            <Textarea
              id="translate-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={9}
              placeholder={t.textPlaceholder}
              disabled={isBusy}
            />
          </div>

          <SourcePicker onUseText={(sourceText) => setText(sourceText)} />
          <ClauseLibraryPicker
            onUseClause={(entry) => {
              setText(sourceLang === 'ar' ? entry.text_ar || entry.text_en : entry.text_en || entry.text_ar || '');
            }}
          />
          <BatchTextEditor label={t.batchTitle} value={batchText} onChange={setBatchText} />
          <QualityChecklist
            items={[
              { id: 'text', label: 'Source text', ok: text.trim().length >= 20 },
              { id: 'direction', label: 'Language direction', ok: sourceLang !== targetLang },
              { id: 'batch', label: 'Batch items optional', ok: true },
            ]}
          />

          <Button type="submit" disabled={isBusy} className="w-full sm:w-auto">
            {isBusy ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Languages className="me-2 h-4 w-4" />
            )}
            {t.submit}
          </Button>
        </form>
      </SectionCard>

      <SectionCard title={t.resultTitle} description={t.resultDescription}>
        <DraftingResultShell
          isLoading={isLoading}
          error={error}
          isEmpty={!result}
          emptyHeading={t.emptyHeading}
          emptyIcon={<Languages className="h-8 w-8" />}
          showAssemblyHint
        >
          {result ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {languageLabel(result.source_lang, labels) ?? languageLabel(sourceLang, labels)} →{' '}
                  {languageLabel(result.target_lang, labels) ?? languageLabel(targetLang, labels)}
                </p>
                {result.equivalence ? (
                  <Badge variant={equivalenceBadgeVariant(result.equivalence)}>
                    {t.equivalence}: {result.equivalence}
                  </Badge>
                ) : null}
              </div>

              <div
                dir={isArabicTarget ? 'rtl' : 'ltr'}
                className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-7"
              >
                {editableText || result.translation}
              </div>

              <ResultComparePanel
                original={submittedText}
                revised={editableText || result.translation}
                originalLabel="Source"
                revisedLabel="Translation"
                dir={isArabicTarget ? 'rtl' : 'ltr'}
              />

              {result.notes?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{labels.common.notes}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.caveats?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{labels.common.caveats}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <DraftingResultActionBar
                copyText={editableText || result.translation}
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="translate"
                title={t.resultTitle}
                json={result}
                prefill={{
                  text_en: isArabicTarget ? undefined : editableText || result.translation,
                  text_ar: isArabicTarget ? editableText || result.translation : undefined,
                }}
              />
              <EditableResultPanel
                title={t.editableTitle}
                value={editableText}
                onChange={setEditableText}
                dir={isArabicTarget ? 'rtl' : 'ltr'}
              />
              <DraftingRiskDashboard
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                equivalence={result.equivalence}
                issues={[...(result.notes ?? []), ...(result.caveats ?? [])]}
              />
              <BatchJobQueuePanel
                title={t.batchTitle}
                jobs={batchQueue.jobs}
                summary={batchQueue.summary}
                isRunning={batchQueue.isRunning}
                resultToText={(item) => item.translation}
                exportFilename="translation-batch-results.json"
                dir={isArabicTarget ? 'rtl' : 'ltr'}
                onRetryFailed={() =>
                  void batchQueue.retryFailed((itemPayload) =>
                    enterpriseApi.lex.drafting.translateText(itemPayload),
                  )
                }
                onClear={batchQueue.clear}
              />
              <SaveDraftTargetActions
                title={t.resultTitle}
                text={editableText || result.translation}
                payload={{ source_task: 'translate', source_lang: result.source_lang ?? sourceLang, target_lang: result.target_lang ?? targetLang }}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
