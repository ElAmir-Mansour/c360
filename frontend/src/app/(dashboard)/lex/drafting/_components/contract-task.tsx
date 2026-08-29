'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { FileSignature, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
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
import type { LexDraftingContractDraft, LexDraftingContractRequest } from '@/types/suites';
import {
  CONTRACT_TYPE_VALUES,
  LANGUAGE_VALUES,
  type DraftingErrorState,
  DraftingResultActionBar,
  DraftingResultShell,
  buildDraftingError,
  draftingOptions,
  languageLabel,
  numericMeta,
  useDraftingLabels,
} from './drafting-shared';
import { DEFAULT_DEAL_TERMS, DealTermsBuilder, dealTermsToJson } from './drafting-structured-editors';
import {
  DraftingRiskDashboard,
  EditableResultPanel,
  QualityChecklist,
  SaveDraftTargetActions,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';

function contractToPlainText(draft: LexDraftingContractDraft): string {
  const parts = [draft.title, draft.summary ?? ''];
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  for (const section of sections) {
    parts.push(`${section.heading}\n${section.body}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function ContractTask() {
  const labels = useDraftingLabels();
  const t = labels.contract;
  const options = draftingOptions(labels);
  const [contractType, setContractType] = useState<string>(CONTRACT_TYPE_VALUES[0]);
  const [templateHint, setTemplateHint] = useState('');
  const [language, setLanguage] = useState<string>(LANGUAGE_VALUES[0]);
  const [dealTerms, setDealTerms] = useState(DEFAULT_DEAL_TERMS);
  const [result, setResult] = useState<LexDraftingContractDraft | null>(null);
  const [editableText, setEditableText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const dealTermsJson = useMemo(() => JSON.stringify(dealTermsToJson(dealTerms), null, 2), [dealTerms]);

  useEffect(() => {
    const handoff = consumeDraftingHandoff('contract');
    if (handoff?.text) {
      setTemplateHint(handoff.text);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: LexDraftingContractRequest = {
      contract_type: contractType,
      deal_terms: dealTermsToJson(dealTerms),
      template_hint: templateHint.trim() || undefined,
      language,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    try {
      const draft = await enterpriseApi.lex.drafting.draftContract(payload);
      setResult(draft);
      const text = contractToPlainText(draft);
      setEditableText(text);
      saveDraftingRun({
        task: 'contract',
        title: draft.title,
        input: payload,
        result: draft,
        text,
        confidence: numericMeta(draft.meta, 'confidence') ?? null,
        riskScore: numericMeta(draft.meta, 'risk_score') ?? null,
      });
    } catch (err) {
      setError(buildDraftingError(err, labels.errors));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <SectionCard title={t.cardTitle} description={t.cardDescription}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contract-type">{t.contractType}</Label>
              <Select value={contractType} onValueChange={setContractType} disabled={isLoading}>
                <SelectTrigger id="contract-type">
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
              <Label htmlFor="contract-language">{labels.common.language}</Label>
              <Select value={language} onValueChange={setLanguage} disabled={isLoading}>
                <SelectTrigger id="contract-language">
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
            <Label htmlFor="contract-template-hint">{t.templateHint}</Label>
            <Input
              id="contract-template-hint"
              value={templateHint}
              onChange={(event) => setTemplateHint(event.target.value)}
              placeholder={t.templateHintPlaceholder}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.dealTerms}</Label>
            <DealTermsBuilder value={dealTerms} onChange={setDealTerms} />
            <details className="rounded-md border bg-muted/20 p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {labels.structuredEditors.jsonPreview}
              </summary>
              <pre className="mt-2 overflow-auto text-xs">{dealTermsJson}</pre>
            </details>
          </div>

          <QualityChecklist
            items={[
              { id: 'parties', label: 'Parties', ok: dealTerms.customer_name.trim().length > 0 && dealTerms.supplier_name.trim().length > 0 },
              { id: 'value', label: 'Value', ok: dealTerms.annual_value.trim().length > 0 },
              { id: 'law', label: 'Governing law', ok: dealTerms.governing_law.trim().length > 0 },
              { id: 'template', label: 'Template hint', ok: templateHint.trim().length > 4 },
            ]}
          />

          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <FileSignature className="me-2 h-4 w-4" />
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
          emptyIcon={<FileSignature className="h-8 w-8" />}
          showAssemblyHint
        >
          {result ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-h4 font-semibold">{result.title}</h2>
                {languageLabel(result.language, labels) ? (
                  <p className="mt-1 text-sm text-muted-foreground">{languageLabel(result.language, labels)}</p>
                ) : null}
              </div>

              {result.summary ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{labels.common.summary}</p>
                  <p className="text-sm text-muted-foreground">{result.summary}</p>
                </div>
              ) : null}

              <div className="space-y-4">
                {(Array.isArray(result.sections) ? result.sections : []).map((section, index) => (
                  <div key={`${section.heading}-${index}`} className="rounded-lg border bg-muted/30 p-4">
                    <h3 className="text-sm font-semibold">{section.heading}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                      {section.body}
                    </p>
                  </div>
                ))}
              </div>

              {result.open_items?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.openItems}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.open_items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <DraftingResultActionBar
                copyText={editableText || contractToPlainText(result)}
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="contract"
                title={result.title}
                json={result}
              />
              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} />
              <DraftingRiskDashboard confidence={numericMeta(result.meta, 'confidence')} riskScore={numericMeta(result.meta, 'risk_score')} issues={result.open_items ?? []} />
              <SaveDraftTargetActions title={result.title} text={editableText || contractToPlainText(result)} payload={{ source_task: 'contract' }} />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
