'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { AlertTriangle, BookText, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import type { LexDraftingGlossaryRequest, LexDraftingGlossaryResult } from '@/types/suites';
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
import {
  DraftingRiskDashboard,
  EditableResultPanel,
  QualityChecklist,
  SaveDraftTargetActions,
  SourcePicker,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';

function glossaryToText(result: LexDraftingGlossaryResult): string {
  const terms = result.glossary.map((entry) => `${entry.term}: ${entry.definition}`).join('\n');
  const issues = result.inconsistencies?.length
    ? `\n\nInconsistencies\n${result.inconsistencies
        .map((entry) => `- ${entry.term}: ${entry.issue}`)
        .join('\n')}`
    : '';
  return `${terms}${issues}`.trim();
}

export function GlossaryTask() {
  const labels = useDraftingLabels();
  const t = labels.glossary;
  const options = draftingOptions(labels);
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<string>(LANGUAGE_VALUES[0]);
  const [result, setResult] = useState<LexDraftingGlossaryResult | null>(null);
  const [editableText, setEditableText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handoff = consumeDraftingHandoff('glossary');
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

    const payload: LexDraftingGlossaryRequest = {
      text: trimmedText,
      language,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    try {
      const glossary = await enterpriseApi.lex.drafting.generateGlossary(payload);
      const resultText = glossaryToText(glossary);
      setResult(glossary);
      setEditableText(resultText);
      saveDraftingRun({
        task: 'glossary',
        title: t.actionTitle,
        input: payload,
        result: glossary,
        text: resultText,
        confidence: numericMeta(glossary.meta, 'confidence') ?? null,
      });
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
          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="glossary-language">{labels.common.language}</Label>
            <Select value={language} onValueChange={setLanguage} disabled={isLoading}>
              <SelectTrigger id="glossary-language">
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

          <div className="space-y-2">
            <Label htmlFor="glossary-text">{t.textLabel}</Label>
            <Textarea
              id="glossary-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={14}
              placeholder={t.textPlaceholder}
              disabled={isLoading}
            />
          </div>

          <SourcePicker onUseText={(sourceText) => setText(sourceText)} />
          <QualityChecklist
            items={[
              { id: 'text', label: 'Contract text', ok: text.trim().length >= 40 },
              { id: 'language', label: 'Language', ok: Boolean(language) },
            ]}
          />

          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <BookText className="me-2 h-4 w-4" />
            )}
            {t.submit}
          </Button>
        </form>
      </SectionCard>

      <SectionCard title={t.resultTitle} description={t.resultDescription}>
        <DraftingResultShell
          isLoading={isLoading}
          error={error}
          isEmpty={!result || result.glossary.length === 0}
          emptyHeading={t.emptyHeading}
          emptyIcon={<BookText className="h-8 w-8" />}
          showAssemblyHint
        >
          {result && result.glossary.length > 0 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">{t.terms}</p>
                <dl className="space-y-2">
                  {result.glossary.map((entry, index) => (
                    <div key={`${entry.term}-${index}`} className="rounded-lg border p-3">
                      <dt className="text-sm font-semibold">{entry.term}</dt>
                      <dd className="mt-1 text-sm text-muted-foreground">{entry.definition}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {result.inconsistencies?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.inconsistencies}</p>
                  <ul className="space-y-2">
                    {result.inconsistencies.map((entry, index) => (
                      <li key={`${entry.term}-${index}`}>
                        <Alert variant="warning">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>{entry.term}</AlertTitle>
                          <AlertDescription>{entry.issue}</AlertDescription>
                        </Alert>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <DraftingResultActionBar
                copyText={editableText || glossaryToText(result)}
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="glossary"
                title={t.actionTitle}
                json={result}
              />
              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} />
              <DraftingRiskDashboard
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                issues={(result.inconsistencies ?? []).map((entry) => entry.issue)}
              />
              <SaveDraftTargetActions
                title={t.actionTitle}
                text={editableText || glossaryToText(result)}
                payload={{ source_task: 'glossary' }}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
