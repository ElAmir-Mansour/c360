'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
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
import { RedlineView } from '@/components/shared/redline-view';
import { enterpriseApi } from '@/lib/enterprise';
import { useLocale } from '@/components/providers/locale-provider';
import type { LexDraftingClauseRewrite, LexDraftingRewriteRequest } from '@/types/suites';
import {
  LANGUAGE_VALUES,
  type DraftingErrorState,
  DraftingResultActionBar,
  DraftingResultShell,
  buildDraftingError,
  draftingOptions,
  numericMeta,
  requiredError,
  riskBadgeVariant,
  useDraftingLabels,
} from './drafting-shared';
import { BatchTextEditor } from './drafting-structured-editors';
import {
  ClauseLibraryPicker,
  DraftingRiskDashboard,
  EditableResultPanel,
  PromptTemplateBar,
  QualityChecklist,
  SourcePicker,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';
import {
  BatchJobQueuePanel,
  createDraftingBatchJobSeeds,
  parseDraftingBatchText,
  useBatchJobQueue,
} from './batch-job-queue';

export function RewriteTask() {
  const labels = useDraftingLabels();
  const { direction } = useLocale();
  const t = labels.rewrite;
  const options = draftingOptions(labels);
  const [text, setText] = useState('');
  const [submittedText, setSubmittedText] = useState('');
  const [targetTone, setTargetTone] = useState('');
  const [riskPosture, setRiskPosture] = useState('');
  const [instructions, setInstructions] = useState('');
  const [language, setLanguage] = useState<string>(LANGUAGE_VALUES[0]);
  const [result, setResult] = useState<LexDraftingClauseRewrite | null>(null);
  const [editableText, setEditableText] = useState('');
  const [batchText, setBatchText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const batchQueue = useBatchJobQueue<LexDraftingRewriteRequest, LexDraftingClauseRewrite>();
  const isBusy = isLoading || batchQueue.isRunning;

  useEffect(() => {
    const handoff = consumeDraftingHandoff('rewrite');
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

    const payload: LexDraftingRewriteRequest = {
      text: trimmedText,
      target_tone: targetTone.trim() || undefined,
      risk_posture: riskPosture.trim() || undefined,
      instructions: instructions.trim() || undefined,
      language,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    batchQueue.clear();
    setSubmittedText(trimmedText);
    try {
      const rewritten = await enterpriseApi.lex.drafting.rewriteClause(payload);
      setResult(rewritten);
      setEditableText(rewritten.rewritten_text);
      saveDraftingRun({
        task: 'rewrite',
        title: t.actionTitle,
        input: payload,
        result: rewritten,
        text: rewritten.rewritten_text,
        riskLevel: rewritten.risk_shift,
        confidence: numericMeta(rewritten.meta, 'confidence') ?? null,
        riskScore: numericMeta(rewritten.meta, 'risk_score') ?? null,
      });
      setIsLoading(false);

      const batchItems = parseDraftingBatchText(batchText);
      if (batchItems.length > 0) {
        const batchJobs = createDraftingBatchJobSeeds<LexDraftingRewriteRequest>({
          texts: batchItems,
          idPrefix: 'rewrite',
          labelPrefix: t.resultTitle,
          makeInput: (item) => ({
            ...payload,
            text: item,
          }),
        });

        void batchQueue.run(batchJobs, (itemPayload) =>
          enterpriseApi.lex.drafting.rewriteClause(itemPayload),
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
            <Label htmlFor="rewrite-text">{t.textLabel}</Label>
            <Textarea
              id="rewrite-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder={t.textPlaceholder}
              disabled={isBusy}
            />
          </div>

          <SourcePicker onUseText={(sourceText) => setText(sourceText)} />
          <ClauseLibraryPicker onUseClause={(entry) => setText(entry.text_en)} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rewrite-tone">{t.targetTone}</Label>
              <Input
                id="rewrite-tone"
                value={targetTone}
                onChange={(event) => setTargetTone(event.target.value)}
                placeholder={t.targetTonePlaceholder}
                disabled={isBusy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rewrite-risk">{t.riskPosture}</Label>
              <Input
                id="rewrite-risk"
                value={riskPosture}
                onChange={(event) => setRiskPosture(event.target.value)}
                placeholder={t.riskPosturePlaceholder}
                disabled={isBusy}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rewrite-instructions">{t.instructions}</Label>
            <Textarea
              id="rewrite-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={3}
              placeholder={t.instructionsPlaceholder}
              disabled={isBusy}
            />
          </div>

          <PromptTemplateBar task="rewrite" currentValue={instructions} onApply={setInstructions} />
          <BatchTextEditor label={t.batchTitle} value={batchText} onChange={setBatchText} />
          <QualityChecklist
            items={[
              { id: 'text', label: 'Clause text', ok: text.trim().length >= 20 },
              { id: 'tone', label: 'Target tone', ok: targetTone.trim().length > 0 },
              { id: 'risk', label: 'Risk posture', ok: riskPosture.trim().length > 0 },
            ]}
          />

          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="rewrite-language">{labels.common.language}</Label>
            <Select value={language} onValueChange={setLanguage} disabled={isBusy}>
              <SelectTrigger id="rewrite-language">
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

          <Button type="submit" disabled={isBusy} className="w-full sm:w-auto">
            {isBusy ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <PenLine className="me-2 h-4 w-4" />
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
          emptyIcon={<PenLine className="h-8 w-8" />}
          showAssemblyHint
        >
          {result ? (
            <div className="space-y-5">
              {result.risk_shift ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.riskShift}</span>
                  <Badge variant={riskBadgeVariant(result.risk_shift)}>{result.risk_shift}</Badge>
                </div>
              ) : null}

              {submittedText ? (
                <RedlineView
                  original={submittedText}
                  revised={result.rewritten_text}
                  mode="split"
                  originalLabel={t.redlineOriginal}
                  revisedLabel={t.redlineRevised}
                  dir={direction}
                />
              ) : (
                <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-7">
                  {result.rewritten_text}
                </div>
              )}

              {result.changes?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.changes}</p>
                  <ul className="space-y-2">
                    {result.changes.map((change, index) => (
                      <li key={`${change.summary}-${index}`} className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">{change.summary}</p>
                        {change.reason ? (
                          <p className="mt-1 text-muted-foreground">{change.reason}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.residual_risks?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.residualRisks}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.residual_risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <DraftingResultActionBar
                copyText={editableText || result.rewritten_text}
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="rewrite"
                title={t.actionTitle}
                json={result}
                prefill={{
                  text_en: language === 'ar' ? undefined : editableText || result.rewritten_text,
                  text_ar: language === 'ar' ? editableText || result.rewritten_text : undefined,
                  risk_level: result.risk_shift,
                }}
              />
              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} dir={direction === 'rtl' ? 'rtl' : 'ltr'} />
              <DraftingRiskDashboard
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                riskLevel={result.risk_shift}
                issues={result.residual_risks ?? []}
              />
              <BatchJobQueuePanel
                title={t.batchTitle}
                jobs={batchQueue.jobs}
                summary={batchQueue.summary}
                isRunning={batchQueue.isRunning}
                resultToText={(item) => item.rewritten_text}
                exportFilename="clause-rewrite-batch-results.json"
                dir={direction === 'rtl' ? 'rtl' : 'ltr'}
                onRetryFailed={() =>
                  void batchQueue.retryFailed((itemPayload) =>
                    enterpriseApi.lex.drafting.rewriteClause(itemPayload),
                  )
                }
                onClear={batchQueue.clear}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
