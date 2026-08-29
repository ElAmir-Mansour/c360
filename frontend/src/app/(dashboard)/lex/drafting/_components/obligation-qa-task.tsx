'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { enterpriseApi } from '@/lib/enterprise';
import { formatPercentage } from '@/lib/format';
import type {
  JsonObject,
  LexDraftingObligationQaRequest,
  LexDraftingObligationQaReview,
} from '@/types/suites';
import {
  type DraftingErrorState,
  DraftingResultActionBar,
  DraftingResultShell,
  buildDraftingError,
  numericMeta,
  requiredError,
  severityBadgeVariant,
  useDraftingLabels,
} from './drafting-shared';
import { ObjectArrayEditor } from './drafting-structured-editors';
import {
  DraftingRiskDashboard,
  QualityChecklist,
  SaveDraftTargetActions,
  SourcePicker,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';

const SAMPLE_OBLIGATIONS: JsonObject[] = [
  {
    description: 'Supplier provides monthly uptime report by the 5th business day.',
    owner: 'Supplier',
    due: 'Monthly',
    type: 'reporting',
  },
  {
    description: 'Customer pays invoices within 30 days of receipt.',
    owner: 'Customer',
    due: 'Net 30',
    type: 'payment',
  },
];

function obligationReviewToText(result: LexDraftingObligationQaReview): string {
  const parts = [`Overall confidence: ${formatPercentage(result.overall_confidence)}`];
  if (result.issues.length) {
    parts.push(
      `Issues\n${result.issues
        .map((issue) => {
          const suggestion = issue.suggestion ? ` Suggestion: ${issue.suggestion}` : '';
          return `- Obligation #${issue.obligation_index + 1} (${issue.severity}): ${issue.issue}${suggestion}`;
        })
        .join('\n')}`,
    );
  }
  if (result.missing_obligations?.length) {
    parts.push(`Missing obligations\n${result.missing_obligations.map((item) => `- ${item}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

export function ObligationQaTask() {
  const labels = useDraftingLabels();
  const t = labels.obligationQa;
  const [contractText, setContractText] = useState('');
  const [obligations, setObligations] = useState<JsonObject[]>(SAMPLE_OBLIGATIONS);
  const [result, setResult] = useState<LexDraftingObligationQaReview | null>(null);
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handoff = consumeDraftingHandoff('obligationQa');
    if (handoff?.text) {
      setContractText(handoff.text);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedText = contractText.trim();
    if (!trimmedText) {
      setError(requiredError(labels.errors.requiredTitle, t.contractTextRequired));
      setResult(null);
      return;
    }

    if (obligations.length === 0) {
      setError(requiredError(labels.errors.requiredTitle, t.obligationsRequired));
      setResult(null);
      return;
    }

    const payload: LexDraftingObligationQaRequest = {
      contract_text: trimmedText,
      obligations,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const review = await enterpriseApi.lex.drafting.reviewObligationExtraction(payload);
      setResult(review);
      saveDraftingRun({
        task: 'obligationQa',
        title: t.cardTitle,
        input: payload,
        result: review,
        text: obligationReviewToText(review),
        confidence: review.overall_confidence,
        riskScore: numericMeta(review.meta, 'risk_score') ?? null,
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
            <Label htmlFor="qa-contract-text">{t.contractText}</Label>
            <Textarea
              id="qa-contract-text"
              value={contractText}
              onChange={(event) => setContractText(event.target.value)}
              rows={8}
              placeholder={t.contractTextPlaceholder}
              disabled={isLoading}
            />
          </div>

          <SourcePicker onUseText={(sourceText) => setContractText(sourceText)} />
          <ObjectArrayEditor
            label={t.obligations}
            rows={obligations}
            onChange={setObligations}
            sampleRow={{
              description: 'Describe the obligation',
              owner: 'Supplier',
              due: 'Date or cadence',
              type: 'reporting',
            }}
          />
          <QualityChecklist
            items={[
              { id: 'contract', label: 'Contract text', ok: contractText.trim().length >= 40 },
              { id: 'obligations', label: 'Obligation rows', ok: obligations.length > 0 },
              {
                id: 'owners',
                label: 'Owners provided',
                ok: obligations.every((item) => String(item.owner ?? '').trim().length > 0),
              },
            ]}
          />

          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="me-2 h-4 w-4" />
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
          emptyIcon={<ShieldCheck className="h-8 w-8" />}
          showAssemblyHint
        >
          {result ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <p className="text-sm font-medium">{t.overallConfidence}</p>
                <Badge variant="outline">{formatPercentage(result.overall_confidence)}</Badge>
              </div>

              {result.issues.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.issues}</p>
                  <ul className="space-y-2">
                    {result.issues.map((issue, index) => (
                      <li key={`${issue.obligation_index}-${index}`} className="rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {t.obligationIndex} #{issue.obligation_index + 1}
                          </span>
                          <Badge variant={severityBadgeVariant(issue.severity)}>{issue.severity}</Badge>
                        </div>
                        <p className="mt-2 text-muted-foreground">{issue.issue}</p>
                        {issue.suggestion ? (
                          <p className="mt-2">
                            <span className="font-medium">{t.suggestion}: </span>
                            <span className="text-muted-foreground">{issue.suggestion}</span>
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{labels.common.none}</p>
              )}

              {result.missing_obligations?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.missingObligations}</p>
                  <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                    {result.missing_obligations.map((missing) => (
                      <li key={missing}>{missing}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <DraftingResultActionBar
                copyText={obligationReviewToText(result)}
                confidence={result.overall_confidence}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="obligationQa"
                title={t.cardTitle}
                json={result}
                showInsert={false}
              />
              <DraftingRiskDashboard
                confidence={result.overall_confidence}
                riskScore={numericMeta(result.meta, 'risk_score')}
                issues={[
                  ...result.issues.map((issue) => issue.issue),
                  ...(result.missing_obligations ?? []),
                ]}
              />
              <SaveDraftTargetActions
                title={t.cardTitle}
                text={obligationReviewToText(result)}
                payload={{ source_task: 'obligationQa' }}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
