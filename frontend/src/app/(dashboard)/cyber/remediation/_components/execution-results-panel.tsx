'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Minus, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ExecutionResult, StepResult } from '@/types/cyber';
import { useRemediationLabels } from '../_lib/remediation-i18n';

function stepStatusIcon(status: StepResult['status']) {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-4 w-4 shrink-0 text-primary dark:text-primary" aria-hidden />;
    case 'failure':
      return <XCircle className="h-4 w-4 shrink-0 text-error-500 dark:text-error-300" aria-hidden />;
    case 'skipped':
      return <Minus className="h-4 w-4 shrink-0 text-foreground/45 dark:text-foreground/55" aria-hidden />;
  }
}

function StepRow({ step }: { step: StepResult }) {
  const t = useRemediationLabels();
  const [expanded, setExpanded] = useState(false);
  const hasOutput = Boolean(step.output);
  const hasTruncated = hasOutput && step.output!.length > 200;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-bold tabular-nums">
          {step.step_number}
        </div>
        {stepStatusIcon(step.status)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium capitalize">{step.status}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{step.duration_ms} ms</span>
          </div>

          {step.error && (
            <p className="mt-1 text-xs text-error-500 dark:text-error-300">{step.error}</p>
          )}

          {hasOutput && (
            <div className="mt-1.5">
              <pre className="rounded bg-muted px-2 py-1.5 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
                {hasTruncated && !expanded
                  ? `${step.output!.slice(0, 200)}…`
                  : step.output}
              </pre>
              {hasTruncated && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                  {expanded ? t.execution.showLess : t.execution.showMore}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExecutionResultsPanel({ result }: { result: ExecutionResult }) {
  const t = useRemediationLabels();
  return (
    <div className="space-y-5">
      {/* Header */}
      <div
        className={`flex items-start gap-3 rounded-xl border p-4 ${
          result.success
            ? 'border-primary/30 bg-primary/10 dark:border-primary dark:bg-brand-primary-800/20'
            : 'border-error-100 bg-error-50 dark:border-error-700 dark:bg-error-700/20'
        }`}
      >
        {result.success
          ? <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary dark:text-primary" aria-hidden />
          : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-error-500 dark:text-error-300" aria-hidden />
        }
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`font-semibold ${result.success ? 'text-primary dark:text-primary' : 'text-error-700 dark:text-error-300'}`}>
              {t.execution.title}
            </p>
            <Badge
              variant={result.success ? 'default' : 'destructive'}
              className="text-xs"
            >
              {result.success ? t.execution.success : t.execution.failed}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.execution.completedIn((result.duration_ms / 1000).toFixed(2))}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold tabular-nums">
            {result.steps_executed}
            <span className="text-base font-normal text-muted-foreground">/{result.steps_total}</span>
          </p>
          <p className="text-xs text-muted-foreground">{t.execution.stepsExecuted}</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold tabular-nums">{result.changes_applied.length}</p>
          <p className="text-xs text-muted-foreground">{t.execution.changesApplied}</p>
        </div>
      </div>

      {/* Step-by-step list */}
      {result.step_results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">{t.execution.steps}</p>
          {result.step_results.map((step) => (
            <StepRow key={step.step_number} step={step} />
          ))}
        </div>
      )}

      {/* Changes Applied */}
      {result.changes_applied.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">{t.execution.changesApplied}</p>
          {result.changes_applied.map((change, idx) => (
            <div key={idx} className="rounded-lg border bg-card p-3 space-y-1.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs capitalize">
                    {change.change_type}
                  </Badge>
                  <span className="text-xs font-medium text-muted-foreground">{change.asset_id}</span>
                </div>
              </div>
              <p className="text-xs">{change.description}</p>
              {(change.old_value || change.new_value) && (
                <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                  <div>
                    <p className="mb-0.5 text-xs text-muted-foreground">{t.execution.before}</p>
                    <code className="block rounded bg-error-50 px-2 py-1 text-xs font-mono text-error-600 dark:bg-error-700/30 dark:text-error-300">
                      {change.old_value ?? '—'}
                    </code>
                  </div>
                  <div>
                    <p className="mb-0.5 text-xs text-muted-foreground">{t.execution.after}</p>
                    <code className="block rounded bg-primary/10 px-2 py-1 text-xs font-mono text-primary dark:bg-brand-primary-800/30 dark:text-primary">
                      {change.new_value ?? '—'}
                    </code>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
