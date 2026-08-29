'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
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
import { titleCase } from '@/lib/format';
import type { LexDraftingClauseRequest, LexDraftingGeneratedClause } from '@/types/suites';
import {
  CLAUSE_TYPE_VALUES,
  CONTRACT_TYPE_VALUES,
  LANGUAGE_VALUES,
  type DraftingErrorState,
  DraftingResultActionBar,
  DraftingResultShell,
  buildDraftingError,
  draftingOptions,
  languageLabel,
  numericMeta,
  requiredError,
  riskBadgeVariant,
  useDraftingLabels,
} from './drafting-shared';
import {
  ClauseLibraryPicker,
  DraftingRiskDashboard,
  EditableResultPanel,
  PromptTemplateBar,
  QualityChecklist,
  SaveDraftTargetActions,
} from './drafting-workspace-panels';
import { consumeDraftingHandoff, saveDraftingRun } from './drafting-workspace';

export function ClauseTask() {
  const labels = useDraftingLabels();
  const t = labels.clause;
  const options = draftingOptions(labels);
  const [intent, setIntent] = useState('');
  const [context, setContext] = useState('');
  const [clauseType, setClauseType] = useState<string>(CLAUSE_TYPE_VALUES[0]);
  const [contractType, setContractType] = useState<string>(CONTRACT_TYPE_VALUES[0]);
  const [language, setLanguage] = useState<string>(LANGUAGE_VALUES[0]);
  const [result, setResult] = useState<LexDraftingGeneratedClause | null>(null);
  const [editableText, setEditableText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Clause text as it streams in, before the assembled structured clause lands.
  const [streamedText, setStreamedText] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const handoff = consumeDraftingHandoff('clause');
    if (handoff?.text) {
      setIntent(handoff.text);
    }
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedIntent = intent.trim();
    if (!trimmedIntent) {
      setError(requiredError(labels.errors.requiredTitle, t.intentRequired));
      setResult(null);
      return;
    }

    const payload: LexDraftingClauseRequest = {
      intent: trimmedIntent,
      clause_type: clauseType,
      contract_type: contractType,
      language,
      context: context.trim() || undefined,
    };

    setIsLoading(true);
    setError(null);
    setResult(null);
    setEditableText('');
    setStreamedText('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await enterpriseApi.lex.drafting.generateClauseStream(payload, {
        signal: controller.signal,
        onToken: (text) => setStreamedText((prev) => prev + text),
        onClause: (clause) => {
          const generated = clause as unknown as LexDraftingGeneratedClause;
          setResult(generated);
          setEditableText(generated.text ?? '');
          saveDraftingRun({
            task: 'clause',
            title: generated.title,
            input: payload,
            result: generated,
            text: generated.text,
            riskLevel: generated.risk_level,
            confidence: numericMeta(generated.meta, 'confidence', 'overall_confidence') ?? null,
            riskScore: numericMeta(generated.meta, 'risk_score') ?? null,
          });
        },
        onError: (streamErr) =>
          setError(buildDraftingError(new Error(streamErr.message), labels.errors)),
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(buildDraftingError(err, labels.errors));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <SectionCard title={t.cardTitle} description={t.cardDescription}>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="clause-intent">{t.intentLabel}</Label>
            <Textarea
              id="clause-intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              rows={5}
              placeholder={t.intentPlaceholder}
              disabled={isLoading}
            />
          </div>

          <PromptTemplateBar task="clause" currentValue={intent} onApply={setIntent} />
          <QualityChecklist
            items={[
              { id: 'intent', label: 'Intent', ok: intent.trim().length >= 12 },
              { id: 'context', label: 'Context', ok: context.trim().length >= 20 },
              { id: 'language', label: 'Language', ok: Boolean(language) },
            ]}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="clause-type">{t.clauseType}</Label>
              <Select value={clauseType} onValueChange={setClauseType} disabled={isLoading}>
                <SelectTrigger id="clause-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(options.clauseTypes ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clause-contract-type">{t.contractType}</Label>
              <Select value={contractType} onValueChange={setContractType} disabled={isLoading}>
                <SelectTrigger id="clause-contract-type">
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
              <Label htmlFor="clause-language">{labels.common.language}</Label>
              <Select value={language} onValueChange={setLanguage} disabled={isLoading}>
                <SelectTrigger id="clause-language">
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
            <Label htmlFor="clause-context">{t.contextLabel}</Label>
            <Textarea
              id="clause-context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
              rows={4}
              placeholder={t.contextPlaceholder}
              disabled={isLoading}
            />
          </div>

          <ClauseLibraryPicker
            onUseClause={(entry) => {
              setIntent(entry.title_en);
              setContext(entry.text_en);
              setClauseType(String(entry.clause_type));
            }}
          />

          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="me-2 h-4 w-4" />
            )}
            {t.submit}
          </Button>
        </form>
      </SectionCard>

      <SectionCard title={t.resultTitle} description={t.resultDescription}>
        <DraftingResultShell
          isLoading={isLoading && !streamedText && !result}
          error={error}
          isEmpty={!result && !streamedText}
          emptyHeading={t.emptyHeading}
          emptyIcon={<Sparkles className="h-8 w-8" />}
          showAssemblyHint
        >
          {result ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-h4 font-semibold">{result.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {titleCase(String(result.clause_type))}
                    {languageLabel(result.language, labels) ? ` · ${languageLabel(result.language, labels)}` : ''}
                  </p>
                </div>
                {result.risk_level ? (
                  <Badge variant={riskBadgeVariant(result.risk_level)}>
                    {result.risk_level}
                  </Badge>
                ) : null}
              </div>

              <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-7">
                {result.text}
              </div>

              {result.rationale ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{labels.common.rationale}</p>
                  <p className="text-sm text-muted-foreground">{result.rationale}</p>
                </div>
              ) : null}

              {result.assumptions?.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.assumptions}</p>
                  <ul className="space-y-2">
                    {result.assumptions.map((assumption) => (
                      <li key={assumption} className="flex gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{assumption}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} />
              <DraftingRiskDashboard
                confidence={numericMeta(result.meta, 'confidence', 'overall_confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                riskLevel={result.risk_level}
              />

              <DraftingResultActionBar
                copyText={editableText || result.text}
                confidence={numericMeta(result.meta, 'confidence', 'overall_confidence')}
                riskScore={numericMeta(result.meta, 'risk_score')}
                sourceTask="clause"
                title={result.title}
                json={result}
                prefill={{
                  title_en: language === 'ar' ? undefined : result.title,
                  title_ar: language === 'ar' ? result.title : undefined,
                  text_en: language === 'ar' ? undefined : editableText || result.text,
                  text_ar: language === 'ar' ? editableText || result.text : undefined,
                  clause_type: String(result.clause_type),
                  risk_level: result.risk_level ? String(result.risk_level) : undefined,
                }}
              />
              <SaveDraftTargetActions title={result.title} text={editableText || result.text} payload={{ source_task: 'clause' }} />
            </div>
          ) : streamedText ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t.submit}…</span>
              </div>
              <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-7">
                {streamedText}
                <span className="ms-0.5 inline-block h-4 w-[2px] animate-pulse bg-foreground/60 align-middle" />
              </div>
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}
