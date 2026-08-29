'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import type { LexDraftingFallbackRequest, LexDraftingFallbackSet } from '@/types/suites';
import {
  LANGUAGE_VALUES,
  type DraftingErrorState,
  DraftingResultActionBar,
  DraftingResultShell,
  buildDraftingError,
  draftingOptions,
  numericMeta,
  requiredError,
  useDraftingLabels,
} from './drafting-shared';
import { BatchTextEditor } from './drafting-structured-editors';
import {
  ClauseLibraryPicker,
  DraftingRiskDashboard,
  EditableResultPanel,
  QualityChecklist,
  SaveDraftTargetActions,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';
import {
  BatchJobQueuePanel,
  createDraftingBatchJobSeeds,
  parseDraftingBatchText,
  useBatchJobQueue,
} from './batch-job-queue';

const COUNT_OPTIONS = ['2', '3', '4', '5'] as const;

function fallbackSetToText(result: LexDraftingFallbackSet): string {
  return result.fallbacks
    .map((fallback, index) => {
      const header = fallback.label ?? `Fallback ${index + 1}`;
      const details = [
        fallback.text,
        fallback.concession_level ? `Concession level: ${fallback.concession_level}` : '',
        fallback.when_to_use ? `When to use: ${fallback.when_to_use}` : '',
      ].filter(Boolean);
      return `${header}\n${details.join('\n')}`;
    })
    .join('\n\n');
}

export function FallbacksTask() {
  const labels = useDraftingLabels();
  const t = labels.fallbacks;
  const options = draftingOptions(labels);
  const [clauseText, setClauseText] = useState('');
  const [position, setPosition] = useState('');
  const [count, setCount] = useState<string>('3');
  const [language, setLanguage] = useState<string>(LANGUAGE_VALUES[0]);
  const [result, setResult] = useState<LexDraftingFallbackSet | null>(null);
  const [editableText, setEditableText] = useState('');
  const [batchText, setBatchText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const batchQueue = useBatchJobQueue<LexDraftingFallbackRequest, LexDraftingFallbackSet>();
  const isBusy = isLoading || batchQueue.isRunning;

  useEffect(() => {
    const handoff = consumeDraftingHandoff('fallbacks');
    if (handoff?.text) {
      setClauseText(handoff.text);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedText = clauseText.trim();
    if (!trimmedText) {
      setError(requiredError(labels.errors.requiredTitle, t.clauseTextRequired));
      setResult(null);
      return;
    }

    const payload: LexDraftingFallbackRequest = {
      clause_text: trimmedText,
      position: position.trim() || undefined,
      count: Number.parseInt(count, 10),
      language,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    batchQueue.clear();
    try {
      const fallbacks = await enterpriseApi.lex.drafting.suggestClauseFallbacks(payload);
      const resultText = fallbackSetToText(fallbacks);
      setResult(fallbacks);
      setEditableText(resultText);
      saveDraftingRun({
        task: 'fallbacks',
        title: t.actionTitle,
        input: payload,
        result: fallbacks,
        text: resultText,
        confidence: numericMeta(fallbacks.meta, 'confidence') ?? null,
        riskScore: numericMeta(fallbacks.meta, 'risk_score') ?? null,
      });
      setIsLoading(false);

      const batchItems = parseDraftingBatchText(batchText);
      if (batchItems.length > 0) {
        const batchJobs = createDraftingBatchJobSeeds<LexDraftingFallbackRequest>({
          texts: batchItems,
          idPrefix: 'fallbacks',
          labelPrefix: t.resultTitle,
          makeInput: (item) => ({
            ...payload,
            clause_text: item,
          }),
        });

        void batchQueue.run(batchJobs, (itemPayload) =>
          enterpriseApi.lex.drafting.suggestClauseFallbacks(itemPayload),
        );
      }
    } catch (err) {
      setError(buildDraftingError(err, labels.errors));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <SectionCard title={t.cardTitle} description={t.cardDescription}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="fallbacks-text">{t.clauseText}</Label>
            <Textarea
              id="fallbacks-text"
              value={clauseText}
              onChange={(event) => setClauseText(event.target.value)}
              rows={6}
              placeholder={t.clauseTextPlaceholder}
              disabled={isBusy}
            />
          </div>

          <ClauseLibraryPicker
            onUseClause={(entry) => {
              setClauseText(entry.text_en || entry.text_ar || '');
              setPosition(entry.title_en);
            }}
          />

          <div className="space-y-2">
            <Label htmlFor="fallbacks-position">{t.position}</Label>
            <Input
              id="fallbacks-position"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              placeholder={t.positionPlaceholder}
              disabled={isBusy}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fallbacks-count">{t.count}</Label>
              <Select value={count} onValueChange={setCount} disabled={isBusy}>
                <SelectTrigger id="fallbacks-count">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallbacks-language">{labels.common.language}</Label>
              <Select value={language} onValueChange={setLanguage} disabled={isBusy}>
                <SelectTrigger id="fallbacks-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(options.languages ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <BatchTextEditor label={t.batchTitle} value={batchText} onChange={setBatchText} />
          <QualityChecklist
            items={[
              { id: 'clause', label: 'Clause text', ok: clauseText.trim().length >= 20 },
              { id: 'position', label: 'Negotiation position', ok: position.trim().length > 0 },
              { id: 'count', label: 'Fallback count', ok: Number.parseInt(count, 10) > 1 },
            ]}
          />

          <Button type="submit" disabled={isBusy} className="w-full sm:w-auto">
            {isBusy ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Layers className="me-2 h-4 w-4" />
            )}
            {t.submit}
          </Button>
        </form>
      </SectionCard>

      <SectionCard title={t.resultTitle} description={t.resultDescription}>
        <DraftingResultShell
          isLoading={isLoading}
          error={error}
          isEmpty={!result || result.fallbacks.length === 0}
          emptyHeading={t.emptyHeading}
          emptyIcon={<Layers className="h-8 w-8" />}
          showAssemblyHint
        >
          {result && result.fallbacks.length > 0 ? (
            <div className="space-y-5">
              <ol className="space-y-4">
                {result.fallbacks.map((fallback, index) => (
                  <li key={`${fallback.label ?? 'fallback'}-${index}`} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {fallback.label ?? `${t.cardTitle} ${index + 1}`}
                      </p>
                      {fallback.concession_level ? (
                        <Badge variant="outline">
                          {t.concessionLevel}: {fallback.concession_level}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                      {fallback.text}
                    </p>
                    {fallback.when_to_use ? (
                      <p className="mt-2 text-sm">
                        <span className="font-medium">{t.whenToUse}: </span>
                        <span className="text-muted-foreground">{fallback.when_to_use}</span>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>

              <DraftingResultActionBar
                copyText={editableText || fallbackSetToText(result)}
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="fallbacks"
                title={t.actionTitle}
                json={result}
              />
              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} />
              <DraftingRiskDashboard
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
              />
              <BatchJobQueuePanel
                title={t.batchTitle}
                jobs={batchQueue.jobs}
                summary={batchQueue.summary}
                isRunning={batchQueue.isRunning}
                resultToText={fallbackSetToText}
                exportFilename="fallbacks-batch-results.json"
                onRetryFailed={() =>
                  void batchQueue.retryFailed((itemPayload) =>
                    enterpriseApi.lex.drafting.suggestClauseFallbacks(itemPayload),
                  )
                }
                onClear={batchQueue.clear}
              />
              <SaveDraftTargetActions
                title={t.actionTitle}
                text={editableText || fallbackSetToText(result)}
                payload={{ source_task: 'fallbacks' }}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
