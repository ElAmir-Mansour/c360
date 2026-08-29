'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Download, Languages, ListPlus, Play, RotateCcw, Trash2, Wand2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { useDraftingLabels } from './drafting-shared';
import type {
  LexDraftingClauseRewrite,
  LexDraftingRewriteRequest,
  LexDraftingTranslateRequest,
  LexDraftingTranslationResult,
} from '@/types/suites';

export type LexDraftingBatchKind = 'translate' | 'rewrite';
export type LexDraftingBatchStatus = 'queued' | 'running' | 'success' | 'error';
export type BatchTextDelimiter = 'line' | 'blank-line';

export interface LexDraftingBatchItem {
  id: string;
  kind: LexDraftingBatchKind;
  text: string;
  label?: string;
  sourceLang?: string;
  targetLang?: string;
  targetTone?: string;
  riskPosture?: string;
  instructions?: string;
}

export interface LexDraftingBatchResult {
  itemId: string;
  status: LexDraftingBatchStatus;
  result?: LexDraftingTranslationResult | LexDraftingClauseRewrite | string;
  error?: string;
}

export type DraftingBatchJobStatus = LexDraftingBatchStatus;

export interface DraftingBatchJob<TResult = unknown> {
  id: string;
  label: string;
  text: string;
  status: DraftingBatchJobStatus;
  result?: TResult;
  error?: string;
}

export interface BatchJobQueuePanelProps<TResult = unknown> {
  jobs: DraftingBatchJob<TResult>[];
  title?: ReactNode;
  emptyLabel?: ReactNode;
  resultToText?: (result: TResult) => string;
  filenameBase?: string;
  onRetryFailed?: () => void;
  className?: string;
}

export interface BatchProcessingHelperLabels {
  translationTitle: string;
  rewriteTitle: string;
  description: string;
  bulkInput: string;
  bulkPlaceholder: string;
  sourceLanguage: string;
  targetLanguage: string;
  targetTone: string;
  riskPosture: string;
  instructions: string;
  parseItems: string;
  addItem: string;
  runBatch: string;
  clear: string;
  noItems: string;
  itemText: string;
  label: string;
  result: string;
  removeItem: string;
}

export interface BatchProcessingHelperProps {
  kind: LexDraftingBatchKind;
  items: LexDraftingBatchItem[];
  onItemsChange: (nextItems: LexDraftingBatchItem[]) => void;
  onRunBatch?: (items: LexDraftingBatchItem[]) => void;
  results?: Record<string, LexDraftingBatchResult>;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  disabled?: boolean;
  delimiter?: BatchTextDelimiter;
  appendParsedItems?: boolean;
  defaultSourceLang?: string;
  defaultTargetLang?: string;
  defaultTargetTone?: string;
  defaultRiskPosture?: string;
  defaultInstructions?: string;
  languageOptions?: Array<{ label: string; value: string }>;
  className?: string;
  labels?: Partial<BatchProcessingHelperLabels>;
}

// Language names are rendered as autonyms (each language in its own name), the
// standard for a locale-independent language picker: 'English' / 'العربية' read
// correctly in both the English and Arabic (RTL) surfaces.
export const DEFAULT_BATCH_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

const DEFAULT_LABELS: BatchProcessingHelperLabels = {
  translationTitle: 'Batch translation',
  rewriteTitle: 'Batch rewrite',
  description: 'Prepare multiple drafting requests before sending them through a task runner.',
  bulkInput: 'Bulk input',
  bulkPlaceholder: 'Paste one item per blank line.',
  sourceLanguage: 'Source language',
  targetLanguage: 'Target language',
  targetTone: 'Target tone',
  riskPosture: 'Risk posture',
  instructions: 'Instructions',
  parseItems: 'Parse items',
  addItem: 'Add item',
  runBatch: 'Run batch',
  clear: 'Clear',
  noItems: 'No batch items yet.',
  itemText: 'Item text',
  label: 'Label',
  result: 'Result',
  removeItem: 'Remove item',
};

export function createBatchDraftingItemsFromText({
  text,
  kind,
  delimiter = 'blank-line',
  sourceLang,
  targetLang,
  targetTone,
  riskPosture,
  instructions,
}: {
  text: string;
  kind: LexDraftingBatchKind;
  delimiter?: BatchTextDelimiter;
  sourceLang?: string;
  targetLang?: string;
  targetTone?: string;
  riskPosture?: string;
  instructions?: string;
}): LexDraftingBatchItem[] {
  const chunks = delimiter === 'line' ? text.split(/\r?\n/) : text.split(/\n\s*\n/);
  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => ({
      id: createBatchItemId(kind, chunk, index),
      kind,
      text: chunk,
      label: `Item ${index + 1}`,
      sourceLang,
      targetLang,
      targetTone,
      riskPosture,
      instructions,
    }));
}

export function batchItemsToTranslateRequests(
  items: LexDraftingBatchItem[],
): LexDraftingTranslateRequest[] {
  return items
    .filter((item) => item.kind === 'translate')
    .map((item) => ({
      text: item.text,
      source_lang: item.sourceLang,
      target_lang: item.targetLang ?? 'ar',
    }));
}

export function batchItemsToRewriteRequests(
  items: LexDraftingBatchItem[],
): LexDraftingRewriteRequest[] {
  return items
    .filter((item) => item.kind === 'rewrite')
    .map((item) => ({
      text: item.text,
      target_tone: item.targetTone,
      risk_posture: item.riskPosture,
      instructions: item.instructions,
    }));
}

export function createDraftingBatchJobsFromText<TResult = unknown>(
  text: string,
  prefix: string,
): DraftingBatchJob<TResult>[] {
  return text
    .split(/\n{2,}|\n(?=\d+\.|[-*]\s)/)
    .map((item) => item.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .map((item, index) => ({
      id: `${prefix}-${index + 1}-${Date.now().toString(36)}`,
      label: `Item ${index + 1}`,
      text: item,
      status: 'queued' as const,
    }));
}

export async function runDraftingBatchQueue<TResult>(
  jobs: DraftingBatchJob<TResult>[],
  runner: (job: DraftingBatchJob<TResult>) => Promise<TResult>,
  onUpdate: (jobs: DraftingBatchJob<TResult>[]) => void,
): Promise<DraftingBatchJob<TResult>[]> {
  let nextJobs: DraftingBatchJob<TResult>[] = jobs.map((job) => ({
    ...job,
    status: 'queued',
    error: undefined,
  }));
  onUpdate(nextJobs);

  for (const job of nextJobs) {
    nextJobs = nextJobs.map((item) =>
      item.id === job.id ? { ...item, status: 'running' as const, error: undefined } : item,
    );
    onUpdate(nextJobs);
    try {
      const result = await runner(job);
      nextJobs = nextJobs.map((item) =>
        item.id === job.id ? { ...item, status: 'success' as const, result, error: undefined } : item,
      );
    } catch (error) {
      nextJobs = nextJobs.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: 'error' as const,
              error: error instanceof Error ? error.message : 'Batch item failed.',
            }
          : item,
      );
    }
    onUpdate(nextJobs);
  }

  return nextJobs;
}

export function BatchJobQueuePanel<TResult = unknown>({
  jobs,
  title,
  emptyLabel,
  resultToText = (result) => String(result ?? ''),
  filenameBase = 'drafting-batch-results',
  onRetryFailed,
  className,
}: BatchJobQueuePanelProps<TResult>) {
  const bq = useDraftingLabels().batchQueue;
  const resolvedTitle = title ?? bq.batchJobQueue;
  const resolvedEmptyLabel = emptyLabel ?? bq.noBatchJobs;
  if (jobs.length === 0) {
    return null;
  }

  const completed = jobs.filter((job) => job.status === 'success' || job.status === 'error').length;
  const failed = jobs.filter((job) => job.status === 'error').length;
  const percent = Math.round((completed / jobs.length) * 100);

  return (
    <div className={cn('space-y-3 rounded-md border bg-muted/20 p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ListPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {resolvedTitle}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={failed ? 'destructive' : completed === jobs.length ? 'success' : 'outline'}>
            {completed}/{jobs.length}
          </Badge>
          {onRetryFailed && failed > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetryFailed}>
              <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {bq.retryFailed}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => exportBatchJobsCsv(jobs, resultToText, filenameBase)}>
            <Download className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {bq.exportCsv}
          </Button>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {resolvedEmptyLabel}
        </div>
      ) : (
        <ol className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-md border bg-card px-3 py-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{job.label}</p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-muted-foreground">{job.text}</p>
                </div>
                <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
              </div>
              {job.error ? <p className="mt-2 text-destructive">{job.error}</p> : null}
              {job.result ? (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-sans text-xs">
                  {resultToText(job.result)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function exportBatchJobsCsv<TResult>(
  jobs: DraftingBatchJob<TResult>[],
  resultToText: (result: TResult) => string,
  filenameBase: string,
): void {
  if (typeof document === 'undefined') {
    return;
  }
  const rows = [
    ['label', 'status', 'input', 'result', 'error'],
    ...jobs.map((job) => [
      job.label,
      job.status,
      job.text,
      job.result ? resultToText(job.result) : '',
      job.error ?? '',
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenameBase}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BatchProcessingHelper({
  kind,
  items,
  onItemsChange,
  onRunBatch,
  results = {},
  title,
  description,
  actions,
  disabled = false,
  delimiter = 'blank-line',
  appendParsedItems = true,
  defaultSourceLang = 'en',
  defaultTargetLang = 'ar',
  defaultTargetTone = '',
  defaultRiskPosture = '',
  defaultInstructions = '',
  languageOptions: languageOptionsProp,
  className,
  labels,
}: BatchProcessingHelperProps) {
  const draftingLabels = useDraftingLabels();
  const t = { ...DEFAULT_LABELS, ...labels };
  const languageOptions =
    languageOptionsProp ??
    DEFAULT_BATCH_LANGUAGE_OPTIONS.map((option) => ({
      ...option,
      label: draftingLabels.options.languages[option.value as 'en' | 'ar'] ?? option.label,
    }));
  const [bulkText, setBulkText] = useState('');
  const [sourceLang, setSourceLang] = useState(defaultSourceLang);
  const [targetLang, setTargetLang] = useState(defaultTargetLang);
  const [targetTone, setTargetTone] = useState(defaultTargetTone);
  const [riskPosture, setRiskPosture] = useState(defaultRiskPosture);
  const [instructions, setInstructions] = useState(defaultInstructions);
  const Icon = kind === 'translate' ? Languages : Wand2;
  const batchTitle = title ?? (kind === 'translate' ? t.translationTitle : t.rewriteTitle);
  const readyCount = useMemo(
    () => items.filter((item) => item.kind === kind && item.text.trim()).length,
    [items, kind],
  );

  const parseBulkItems = () => {
    const parsedItems = createBatchDraftingItemsFromText({
      text: bulkText,
      kind,
      delimiter,
      sourceLang,
      targetLang,
      targetTone,
      riskPosture,
      instructions,
    });
    onItemsChange(appendParsedItems ? [...items, ...parsedItems] : parsedItems);
    setBulkText('');
  };

  const addItem = () => {
    onItemsChange([
      ...items,
      {
        id: createBatchItemId(kind, `${Date.now()}`, items.length),
        kind,
        text: '',
        label: `Item ${items.length + 1}`,
        sourceLang,
        targetLang,
        targetTone,
        riskPosture,
        instructions,
      },
    ]);
  };

  const updateItem = (itemId: string, patch: Partial<LexDraftingBatchItem>) => {
    onItemsChange(items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  };

  const removeItem = (itemId: string) => {
    onItemsChange(items.filter((item) => item.id !== itemId));
  };

  return (
    <SectionCard
      title={batchTitle}
      description={description ?? t.description}
      actions={actions}
      className={className}
    >
      <div className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
          <div className="space-y-2">
            <Label htmlFor={`batch-${kind}-bulk`}>{t.bulkInput}</Label>
            <Textarea
              id={`batch-${kind}-bulk`}
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              rows={7}
              placeholder={t.bulkPlaceholder}
              disabled={disabled}
            />
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            {kind === 'translate' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <LanguageSelect
                  id="batch-source-language"
                  label={t.sourceLanguage}
                  value={sourceLang}
                  options={languageOptions}
                  disabled={disabled}
                  onChange={setSourceLang}
                />
                <LanguageSelect
                  id="batch-target-language"
                  label={t.targetLanguage}
                  value={targetLang}
                  options={languageOptions}
                  disabled={disabled}
                  onChange={setTargetLang}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="batch-target-tone">{t.targetTone}</Label>
                  <Input
                    id="batch-target-tone"
                    value={targetTone}
                    onChange={(event) => setTargetTone(event.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="batch-risk-posture">{t.riskPosture}</Label>
                  <Input
                    id="batch-risk-posture"
                    value={riskPosture}
                    onChange={(event) => setRiskPosture(event.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="batch-instructions">{t.instructions}</Label>
                  <Textarea
                    id="batch-instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    rows={3}
                    disabled={disabled}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={parseBulkItems}
                disabled={disabled || !bulkText.trim()}
              >
                <ListPlus className="me-1.5 h-4 w-4" aria-hidden="true" />
                {t.parseItems}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={disabled}>
                <Icon className="me-1.5 h-4 w-4" aria-hidden="true" />
                {t.addItem}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Badge variant="outline">{readyCount}</Badge>
          <Button
            type="button"
            size="sm"
            onClick={() => onRunBatch?.(items)}
            disabled={disabled || !onRunBatch || readyCount === 0}
          >
            <Play className="me-1.5 h-4 w-4" aria-hidden="true" />
            {t.runBatch}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onItemsChange([])}
            disabled={disabled || items.length === 0}
          >
            {t.clear}
          </Button>
        </div>

        {items.length > 0 ? (
          <ol className="space-y-3">
            {items.map((item, index) => (
              <li key={item.id}>
                <BatchItemEditor
                  item={item}
                  index={index}
                  kind={kind}
                  result={results[item.id]}
                  labels={t}
                  disabled={disabled}
                  languageOptions={languageOptions}
                  onChange={(patch) => updateItem(item.id, patch)}
                  onRemove={() => removeItem(item.id)}
                />
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t.noItems}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function BatchItemEditor({
  item,
  index,
  kind,
  result,
  labels,
  disabled,
  languageOptions,
  onChange,
  onRemove,
}: {
  item: LexDraftingBatchItem;
  index: number;
  kind: LexDraftingBatchKind;
  result?: LexDraftingBatchResult;
  labels: BatchProcessingHelperLabels;
  disabled: boolean;
  languageOptions: Array<{ label: string; value: string }>;
  onChange: (patch: Partial<LexDraftingBatchItem>) => void;
  onRemove: () => void;
}) {
  const resultText = result ? batchResultToText(result.result) : '';

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">#{index + 1}</Badge>
          {result ? <Badge variant={statusVariant(result.status)}>{result.status}</Badge> : null}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} disabled={disabled}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{labels.removeItem}</span>
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.35fr)]">
        <div className="space-y-2">
          <Label htmlFor={`${item.id}-text`}>{labels.itemText}</Label>
          <Textarea
            id={`${item.id}-text`}
            value={item.text}
            onChange={(event) => onChange({ text: event.target.value })}
            rows={5}
            disabled={disabled}
          />
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`${item.id}-label`}>{labels.label}</Label>
            <Input
              id={`${item.id}-label`}
              value={item.label ?? ''}
              onChange={(event) => onChange({ label: event.target.value })}
              disabled={disabled}
            />
          </div>

          {kind === 'translate' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <LanguageSelect
                id={`${item.id}-source`}
                label={labels.sourceLanguage}
                value={item.sourceLang ?? ''}
                options={languageOptions}
                disabled={disabled}
                onChange={(sourceLang) => onChange({ sourceLang })}
              />
              <LanguageSelect
                id={`${item.id}-target`}
                label={labels.targetLanguage}
                value={item.targetLang ?? ''}
                options={languageOptions}
                disabled={disabled}
                onChange={(targetLang) => onChange({ targetLang })}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`${item.id}-tone`}>{labels.targetTone}</Label>
                <Input
                  id={`${item.id}-tone`}
                  value={item.targetTone ?? ''}
                  onChange={(event) => onChange({ targetTone: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${item.id}-posture`}>{labels.riskPosture}</Label>
                <Input
                  id={`${item.id}-posture`}
                  value={item.riskPosture ?? ''}
                  onChange={(event) => onChange({ riskPosture: event.target.value })}
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {resultText || result?.error ? (
        <div className="mt-4 rounded-lg border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-caps-xwide text-muted-foreground">
            {labels.result}
          </p>
          <p className={cn('whitespace-pre-wrap text-sm', result?.error && 'text-destructive')}>
            {result?.error ?? resultText}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function LanguageSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function batchResultToText(
  result: LexDraftingTranslationResult | LexDraftingClauseRewrite | string | undefined,
): string {
  if (!result) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  if ('translation' in result) {
    return result.translation;
  }
  return result.rewritten_text;
}

function statusVariant(
  status: LexDraftingBatchStatus,
): 'default' | 'destructive' | 'warning' | 'success' | 'outline' {
  if (status === 'success') {
    return 'success';
  }
  if (status === 'error') {
    return 'destructive';
  }
  if (status === 'running') {
    return 'warning';
  }
  return 'outline';
}

function createBatchItemId(kind: LexDraftingBatchKind, text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `${kind}-${index + 1}-${slug || 'item'}`;
}
