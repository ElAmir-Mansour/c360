'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  RefreshCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { parseApiError } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type DraftingLabels, useDraftingLabels } from './drafting-shared';
import { downloadDraftingText } from './drafting-workspace';

export type BatchJobStatus = 'queued' | 'running' | 'success' | 'failed';

export interface BatchJobSeed<TInput> {
  id?: string;
  label: string;
  input: TInput;
  preview: string;
}

export interface BatchJob<TInput, TResult> extends BatchJobSeed<TInput> {
  id: string;
  status: BatchJobStatus;
  progress: number;
  result?: TResult;
  error?: string;
}

export interface BatchJobSummary {
  total: number;
  queued: number;
  running: number;
  success: number;
  failed: number;
  completed: number;
  progress: number;
}

export type BatchJobRunner<TInput, TResult> = (
  input: TInput,
  job: BatchJob<TInput, TResult>,
) => Promise<TResult>;

type BatchJobsUpdater<TInput, TResult> =
  | BatchJob<TInput, TResult>[]
  | ((current: BatchJob<TInput, TResult>[]) => BatchJob<TInput, TResult>[]);

export function parseDraftingBatchText(text: string): string[] {
  return text
    .split(/\n{2,}|\n(?=\d+\.|[-*]\s)/)
    .map((item) => item.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean);
}

export function createDraftingBatchJobSeeds<TInput>({
  texts,
  idPrefix,
  labelPrefix,
  makeInput,
}: {
  texts: string[];
  idPrefix: string;
  labelPrefix: string;
  makeInput: (text: string, index: number) => TInput;
}): BatchJobSeed<TInput>[] {
  return texts.map((text, index) => ({
    id: createBatchJobId(idPrefix, text, index),
    label: `${labelPrefix} ${index + 1}`,
    input: makeInput(text, index),
    preview: text,
  }));
}

export function summarizeBatchJobs<TInput, TResult>(
  jobs: BatchJob<TInput, TResult>[],
): BatchJobSummary {
  const total = jobs.length;
  const queued = jobs.filter((job) => job.status === 'queued').length;
  const running = jobs.filter((job) => job.status === 'running').length;
  const success = jobs.filter((job) => job.status === 'success').length;
  const failed = jobs.filter((job) => job.status === 'failed').length;
  const completed = success + failed;

  return {
    total,
    queued,
    running,
    success,
    failed,
    completed,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function useBatchJobQueue<TInput, TResult>() {
  const [jobs, setJobs] = useState<BatchJob<TInput, TResult>[]>([]);
  const jobsRef = useRef<BatchJob<TInput, TResult>[]>([]);
  const runIdRef = useRef(0);

  const commitJobs = useCallback((updater: BatchJobsUpdater<TInput, TResult>) => {
    setJobs((current) => {
      const next =
        typeof updater === 'function'
          ? (updater as (value: BatchJob<TInput, TResult>[]) => BatchJob<TInput, TResult>[])(current)
          : updater;
      jobsRef.current = next;
      return next;
    });
  }, []);

  const executeJobs = useCallback(
    async (
      targetJobs: BatchJob<TInput, TResult>[],
      runner: BatchJobRunner<TInput, TResult>,
      runId: number,
    ) => {
      for (const target of targetJobs) {
        if (runIdRef.current !== runId) return;

        commitJobs((current) =>
          current.map((job) =>
            job.id === target.id
              ? { ...job, status: 'running', progress: 50, error: undefined, result: undefined }
              : job,
          ),
        );

        try {
          const result = await runner(target.input, target);
          if (runIdRef.current !== runId) return;

          commitJobs((current) =>
            current.map((job) =>
              job.id === target.id
                ? { ...job, status: 'success', progress: 100, result, error: undefined }
                : job,
            ),
          );
        } catch (error) {
          if (runIdRef.current !== runId) return;

          commitJobs((current) =>
            current.map((job) =>
              job.id === target.id
                ? {
                    ...job,
                    status: 'failed',
                    progress: 100,
                    result: undefined,
                    error: parseApiError(error),
                  }
                : job,
            ),
          );
        }
      }
    },
    [commitJobs],
  );

  const run = useCallback(
    async (seeds: BatchJobSeed<TInput>[], runner: BatchJobRunner<TInput, TResult>) => {
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;

      const nextJobs = seeds.map<BatchJob<TInput, TResult>>((seed, index) => ({
        ...seed,
        id: seed.id ?? createBatchJobId('batch', seed.preview, index),
        status: 'queued',
        progress: 0,
        result: undefined,
        error: undefined,
      }));

      commitJobs(nextJobs);
      await executeJobs(nextJobs, runner, runId);
    },
    [commitJobs, executeJobs],
  );

  const retryFailed = useCallback(
    async (runner: BatchJobRunner<TInput, TResult>) => {
      const failedJobs = jobsRef.current.filter((job) => job.status === 'failed');
      if (failedJobs.length === 0) return;

      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      const retryJobs = failedJobs.map<BatchJob<TInput, TResult>>((job) => ({
        ...job,
        status: 'queued',
        progress: 0,
        result: undefined,
        error: undefined,
      }));

      commitJobs((current) =>
        current.map((job) => retryJobs.find((retry) => retry.id === job.id) ?? job),
      );
      await executeJobs(retryJobs, runner, runId);
    },
    [commitJobs, executeJobs],
  );

  const clear = useCallback(() => {
    runIdRef.current += 1;
    commitJobs([]);
  }, [commitJobs]);

  const summary = useMemo(() => summarizeBatchJobs(jobs), [jobs]);
  const isRunning = summary.queued > 0 || summary.running > 0;

  return {
    jobs,
    summary,
    isRunning,
    run,
    retryFailed,
    clear,
  };
}

export function BatchJobQueuePanel<TInput, TResult>({
  title,
  jobs,
  summary = summarizeBatchJobs(jobs),
  isRunning = summary.queued > 0 || summary.running > 0,
  resultToText,
  resultToExport,
  exportFilename = 'drafting-batch-results.json',
  dir,
  className,
  onRetryFailed,
  onClear,
}: {
  title: string;
  jobs: BatchJob<TInput, TResult>[];
  summary?: BatchJobSummary;
  isRunning?: boolean;
  resultToText: (result: TResult, job: BatchJob<TInput, TResult>) => string;
  resultToExport?: (result: TResult, job: BatchJob<TInput, TResult>) => unknown;
  exportFilename?: string;
  dir?: 'ltr' | 'rtl';
  className?: string;
  onRetryFailed?: () => void;
  onClear?: () => void;
}) {
  const bq = useDraftingLabels().batchQueue;
  if (jobs.length === 0) {
    return null;
  }

  const canExport = summary.completed > 0;

  const handleExport = () => {
    const payload = {
      title,
      generated_at: new Date().toISOString(),
      summary,
      items: jobs.map((job, index) => ({
        index: index + 1,
        id: job.id,
        label: job.label,
        status: job.status,
        progress: job.progress,
        input: job.preview,
        result:
          job.result === undefined
            ? undefined
            : resultToExport?.(job.result, job) ?? resultToText(job.result, job),
        error: job.error,
      })),
    };

    downloadDraftingText(
      exportFilename,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    );
  };

  return (
    <div className={cn('space-y-3 rounded-lg border bg-muted/20 p-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {bq.summary(summary.completed, summary.total, summary.failed)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={summary.failed > 0 ? 'warning' : isRunning ? 'outline' : 'success'}>
            {summary.progress}%
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryFailed}
            disabled={isRunning || summary.failed === 0 || !onRetryFailed}
          >
            <RefreshCcw className="me-1.5 h-4 w-4" aria-hidden="true" />
            {bq.retryFailed}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={!canExport}>
            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
            {bq.export}
          </Button>
          {onClear ? (
            <Button type="button" variant="ghost" size="icon" onClick={onClear} disabled={isRunning}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{bq.clearBatchJobs}</span>
            </Button>
          ) : null}
        </div>
      </div>

      <Progress value={summary.progress} className="h-1.5" />

      <ol className="divide-y rounded-md border bg-background">
        {jobs.map((job, index) => (
          <BatchJobRow
            key={job.id}
            job={job}
            index={index}
            resultToText={resultToText}
            dir={dir}
          />
        ))}
      </ol>
    </div>
  );
}

function BatchJobRow<TInput, TResult>({
  job,
  index,
  resultToText,
  dir,
}: {
  job: BatchJob<TInput, TResult>;
  index: number;
  resultToText: (result: TResult, job: BatchJob<TInput, TResult>) => string;
  dir?: 'ltr' | 'rtl';
}) {
  const bq = useDraftingLabels().batchQueue;
  const resultText = job.result === undefined ? '' : resultToText(job.result, job);
  const StatusIcon = statusIcon(job.status);

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline">#{index + 1}</Badge>
          <Badge variant={statusVariant(job.status)} className="gap-1">
            <StatusIcon className={cn('h-3.5 w-3.5', job.status === 'running' && 'animate-spin')} aria-hidden="true" />
            {statusLabel(job.status, bq)}
          </Badge>
          <span className="truncate text-sm font-medium">{job.label}</span>
        </div>
        <span className="text-xs text-muted-foreground">{job.progress}%</span>
      </div>

      <Progress value={job.progress} className="h-1" />

      <p className="max-h-16 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
        {job.preview}
      </p>

      {job.error ? (
        <div className="rounded-md border border-error-100 bg-error-50 p-2 text-xs text-error-600">
          <span className="font-medium">{bq.failureReason}</span>
          {job.error}
        </div>
      ) : null}

      {resultText ? (
        <div dir={dir} className="max-h-40 overflow-auto rounded-md border bg-muted/30 p-3 text-sm leading-6">
          <pre className="whitespace-pre-wrap font-sans">{resultText}</pre>
        </div>
      ) : null}
    </li>
  );
}

function statusIcon(status: BatchJobStatus) {
  if (status === 'success') return CheckCircle2;
  if (status === 'failed') return XCircle;
  if (status === 'running') return Loader2;
  return Clock3;
}

function statusLabel(status: BatchJobStatus, bq: DraftingLabels['batchQueue']): string {
  if (status === 'success') return bq.statusDone;
  if (status === 'failed') return bq.statusFailed;
  if (status === 'running') return bq.statusRunning;
  return bq.statusQueued;
}

function statusVariant(
  status: BatchJobStatus,
): 'default' | 'destructive' | 'warning' | 'success' | 'outline' {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'running') return 'warning';
  return 'outline';
}

function createBatchJobId(prefix: string, text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const hash = Array.from(text).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);

  return `${prefix}-${index + 1}-${hash.toString(36)}-${slug || 'item'}`;
}
