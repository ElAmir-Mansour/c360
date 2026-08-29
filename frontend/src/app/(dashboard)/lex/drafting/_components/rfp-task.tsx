'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { ClipboardList, Loader2 } from 'lucide-react';
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
import type { LexDraftingRfpRequest, LexDraftingRfpResponse } from '@/types/suites';
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
  PromptTemplateBar,
  QualityChecklist,
  SaveDraftTargetActions,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';

function rfpToText(result: LexDraftingRfpResponse): string {
  const parts = result.summary ? [`Summary\n${result.summary}`] : [];
  parts.push(
    result.sections
      .map((section, index) => `${index + 1}. ${section.requirement}\n${section.response}`)
      .join('\n\n'),
  );
  if (result.gaps?.length) {
    parts.push(`Gaps\n${result.gaps.map((gap) => `- ${gap}`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function RfpTask() {
  const labels = useDraftingLabels();
  const t = labels.rfp;
  const options = draftingOptions(labels);
  const [requirements, setRequirements] = useState('');
  const [companyProfile, setCompanyProfile] = useState('');
  const [language, setLanguage] = useState<string>(LANGUAGE_VALUES[0]);
  const [result, setResult] = useState<LexDraftingRfpResponse | null>(null);
  const [editableText, setEditableText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handoff = consumeDraftingHandoff('rfp');
    if (handoff?.text) {
      setRequirements(handoff.text);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedRequirements = requirements.trim();
    if (!trimmedRequirements) {
      setError(requiredError(labels.errors.requiredTitle, t.requirementsRequired));
      setResult(null);
      return;
    }

    const payload: LexDraftingRfpRequest = {
      requirements: trimmedRequirements,
      company_profile: companyProfile.trim() || undefined,
      language,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    try {
      const rfp = await enterpriseApi.lex.drafting.generateRfpResponse(payload);
      const resultText = rfpToText(rfp);
      setResult(rfp);
      setEditableText(resultText);
      saveDraftingRun({
        task: 'rfp',
        title: t.resultTitle,
        input: payload,
        result: rfp,
        text: resultText,
        confidence: numericMeta(rfp.meta, 'confidence') ?? null,
        riskScore: numericMeta(rfp.meta, 'risk_score') ?? null,
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
          <div className="space-y-2">
            <Label htmlFor="rfp-requirements">{t.requirements}</Label>
            <Textarea
              id="rfp-requirements"
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              rows={8}
              placeholder={t.requirementsPlaceholder}
              disabled={isLoading}
            />
          </div>

          <PromptTemplateBar task="rfp" currentValue={requirements} onApply={setRequirements} />

          <div className="space-y-2">
            <Label htmlFor="rfp-company-profile">{t.companyProfile}</Label>
            <Textarea
              id="rfp-company-profile"
              value={companyProfile}
              onChange={(event) => setCompanyProfile(event.target.value)}
              rows={4}
              placeholder={t.companyProfilePlaceholder}
              disabled={isLoading}
            />
          </div>

          <QualityChecklist
            items={[
              { id: 'requirements', label: 'Requirements', ok: requirements.trim().length >= 20 },
              { id: 'profile', label: 'Company profile', ok: companyProfile.trim().length >= 20 },
              { id: 'language', label: 'Language', ok: Boolean(language) },
            ]}
          />

          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="rfp-language">{labels.common.language}</Label>
            <Select value={language} onValueChange={setLanguage} disabled={isLoading}>
              <SelectTrigger id="rfp-language">
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

          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <ClipboardList className="me-2 h-4 w-4" />
            )}
            {t.submit}
          </Button>
        </form>
      </SectionCard>

      <SectionCard title={t.resultTitle} description={t.resultDescription}>
        <DraftingResultShell
          isLoading={isLoading}
          error={error}
          isEmpty={!result || result.sections.length === 0}
          emptyHeading={t.emptyHeading}
          emptyIcon={<ClipboardList className="h-8 w-8" />}
          showAssemblyHint
        >
          {result && result.sections.length > 0 ? (
            <div className="space-y-5">
              {result.summary ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{labels.common.summary}</p>
                  <p className="text-sm leading-7 text-muted-foreground">{result.summary}</p>
                </div>
              ) : null}

              <ol className="space-y-4">
                {result.sections.map((section, index) => (
                  <li key={`${section.requirement}-${index}`} className="rounded-lg border p-4">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {t.requirement}
                    </p>
                    <p className="mt-1 text-sm font-semibold">{section.requirement}</p>
                    <p className="mt-3 text-xs font-medium uppercase text-muted-foreground">
                      {t.response}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                      {section.response}
                    </p>
                  </li>
                ))}
              </ol>

              {result.gaps?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{labels.common.gaps}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.gaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <DraftingResultActionBar
                copyText={editableText || rfpToText(result)}
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="rfp"
                title={t.resultTitle}
                json={result}
              />
              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} />
              <DraftingRiskDashboard
                confidence={numericMeta(result.meta, 'confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                issues={result.gaps ?? []}
              />
              <SaveDraftTargetActions
                title={t.resultTitle}
                text={editableText || rfpToText(result)}
                payload={{ source_task: 'rfp' }}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
