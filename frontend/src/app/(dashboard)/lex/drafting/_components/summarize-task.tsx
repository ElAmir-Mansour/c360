'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Loader2, ScrollText } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
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
import type { LexDraftingContractSummary, LexDraftingSummaryRequest } from '@/types/suites';
import {
  CONTRACT_TYPE_VALUES,
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

function summaryToText(summary: LexDraftingContractSummary): string {
  const parts = [summary.executive_summary];
  if (summary.key_terms?.length) {
    parts.push(
      `Key terms\n${summary.key_terms
        .map((term) => `${term.label}: ${term.value}`)
        .join('\n')}`,
    );
  }
  if (summary.obligations?.length) {
    parts.push(`Obligations\n${summary.obligations.map((item) => `- ${item}`).join('\n')}`);
  }
  if (summary.risks?.length) {
    parts.push(`Risks\n${summary.risks.map((item) => `- ${item}`).join('\n')}`);
  }
  if (summary.renewal_notes) {
    parts.push(`Renewal notes\n${summary.renewal_notes}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function SummarizeTask() {
  const labels = useDraftingLabels();
  const t = labels.summarize;
  const options = draftingOptions(labels);
  const [text, setText] = useState('');
  const [contractType, setContractType] = useState<string>(CONTRACT_TYPE_VALUES[0]);
  const [language, setLanguage] = useState<string>(LANGUAGE_VALUES[0]);
  const [result, setResult] = useState<LexDraftingContractSummary | null>(null);
  const [editableText, setEditableText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handoff = consumeDraftingHandoff('summarize');
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

    const payload: LexDraftingSummaryRequest = {
      text: trimmedText,
      contract_type: contractType,
      language,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    try {
      const summary = await enterpriseApi.lex.drafting.summarizeContract(payload);
      const resultText = summaryToText(summary);
      setResult(summary);
      setEditableText(resultText);
      saveDraftingRun({
        task: 'summarize',
        title: t.resultTitle,
        input: payload,
        result: summary,
        text: resultText,
        confidence: numericMeta(summary.meta, 'confidence') ?? null,
        riskScore: numericMeta(summary.meta, 'risk_score') ?? null,
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="summarize-contract-type">{t.contractType}</Label>
              <Select value={contractType} onValueChange={setContractType} disabled={isLoading}>
                <SelectTrigger id="summarize-contract-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(options.contractTypes ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="summarize-language">{labels.common.language}</Label>
              <Select value={language} onValueChange={setLanguage} disabled={isLoading}>
                <SelectTrigger id="summarize-language">
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

          <div className="space-y-2">
            <Label htmlFor="summarize-text">{t.textLabel}</Label>
            <Textarea
              id="summarize-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={12}
              placeholder={t.textPlaceholder}
              disabled={isLoading}
            />
          </div>

          <SourcePicker onUseText={(sourceText) => setText(sourceText)} />
          <QualityChecklist
            items={[
              { id: 'text', label: 'Contract text', ok: text.trim().length >= 40 },
              { id: 'type', label: 'Contract type', ok: Boolean(contractType) },
              { id: 'language', label: 'Output language', ok: Boolean(language) },
            ]}
          />

          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <ScrollText className="me-2 h-4 w-4" />
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
          emptyIcon={<ScrollText className="h-8 w-8" />}
          showAssemblyHint
        >
          {result ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t.executiveSummary}</p>
                <p className="text-sm leading-7 text-muted-foreground">{result.executive_summary}</p>
              </div>

              {result.key_terms?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.keyTerms}</p>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {result.key_terms.map((term, index) => (
                      <div key={`${term.label}-${index}`} className="rounded-lg border p-3">
                        <dt className="text-xs font-medium uppercase text-muted-foreground">
                          {term.label}
                        </dt>
                        <dd className="mt-1 text-sm">{term.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {result.obligations?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.obligations}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.obligations.map((obligation) => (
                      <li key={obligation}>{obligation}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.risks?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.risks}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.renewal_notes ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t.renewalNotes}</p>
                  <p className="text-sm text-muted-foreground">{result.renewal_notes}</p>
                </div>
              ) : null}

              <DraftingResultActionBar
                copyText={editableText || summaryToText(result)}
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="summarize"
                title={t.resultTitle}
                json={result}
              />
              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} />
              <DraftingRiskDashboard
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                issues={result.risks ?? []}
              />
              <SaveDraftTargetActions
                title={t.resultTitle}
                text={editableText || summaryToText(result)}
                payload={{ source_task: 'summarize', contract_type: contractType }}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
