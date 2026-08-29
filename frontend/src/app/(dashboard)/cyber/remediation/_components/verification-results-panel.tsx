'use client';

import { CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { VerificationResult } from '@/types/cyber';
import { useRemediationLabels } from '../_lib/remediation-i18n';

export function VerificationResultsPanel({ result }: { result: VerificationResult }) {
  const t = useRemediationLabels();
  return (
    <div className="space-y-5">
      {/* Header */}
      <div
        className={`flex items-start gap-3 rounded-xl border p-4 ${
          result.verified
            ? 'border-primary/30 bg-primary/10 dark:border-primary dark:bg-brand-primary-800/20'
            : 'border-error-100 bg-error-50 dark:border-error-700 dark:bg-error-700/20'
        }`}
      >
        {result.verified
          ? <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary dark:text-primary" aria-hidden />
          : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-error-500 dark:text-error-300" aria-hidden />
        }
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`font-semibold ${result.verified ? 'text-primary dark:text-primary' : 'text-error-700 dark:text-error-300'}`}>
              {t.verification.title}
            </p>
            <Badge
              variant={result.verified ? 'default' : 'destructive'}
              className="text-xs"
            >
              {result.verified ? t.verification.verified : t.verification.failed}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.verification.completedIn((result.duration_ms / 1000).toFixed(2))}
          </p>
        </div>
      </div>

      {/* Checks */}
      {result.checks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {t.verification.checks(result.checks.filter((c) => c.passed).length, result.checks.length)}
          </p>
          {result.checks.map((check, idx) => (
            <div key={idx} className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                {check.passed
                  ? <CheckCircle className="h-4 w-4 shrink-0 text-primary dark:text-primary" aria-hidden />
                  : <XCircle className="h-4 w-4 shrink-0 text-error-500 dark:text-error-300" aria-hidden />
                }
                <span className="text-sm font-medium">{check.name}</span>
              </div>

              <div className="grid grid-cols-1 gap-2 ps-6 sm:grid-cols-2">
                <div>
                  <p className="mb-0.5 text-xs text-muted-foreground">{t.verification.expected}</p>
                  <p className="rounded bg-muted px-2 py-1 text-xs font-mono">{check.expected}</p>
                </div>
                <div>
                  <p className="mb-0.5 text-xs text-muted-foreground">{t.verification.actual}</p>
                  <p
                    className={`rounded px-2 py-1 text-xs font-mono ${
                      check.passed
                        ? 'bg-muted'
                        : 'bg-error-50 text-error-600 dark:bg-error-700/30 dark:text-error-300'
                    }`}
                  >
                    {check.actual}
                  </p>
                </div>
              </div>

              {check.notes && (
                <p className="ps-6 text-xs text-muted-foreground">{check.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Failure reason */}
      {!result.verified && result.failure_reason && (
        <div className="rounded-lg border border-error-100 bg-error-50 px-4 py-3 dark:border-error-700 dark:bg-error-700/20">
          <p className="text-xs font-semibold text-error-600 dark:text-error-300">{t.verification.failureReason}</p>
          <p className="mt-1 text-sm text-error-600 dark:text-error-300">{result.failure_reason}</p>
        </div>
      )}
    </div>
  );
}
