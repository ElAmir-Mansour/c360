'use client';

import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import type { DryRunResult } from '@/types/cyber';
import { useRemediationLabels } from '../_lib/remediation-i18n';

interface DryRunResultsPanelProps {
  result: DryRunResult;
}

export function DryRunResultsPanel({ result }: DryRunResultsPanelProps) {
  const t = useRemediationLabels();
  return (
    <div className="space-y-4">
      {/* Overall status */}
      <div className={`flex items-center gap-3 rounded-xl border p-4 ${result.success ? 'border-primary/30 bg-primary/10 dark:bg-brand-primary-800/20' : 'border-error-100 bg-error-50 dark:bg-error-700/20'}`}>
        {result.success
          ? <CheckCircle className="h-6 w-6 text-primary shrink-0" />
          : <XCircle className="h-6 w-6 text-error-500 shrink-0" />
        }
        <div>
          <p className={`font-semibold ${result.success ? 'text-primary dark:text-primary' : 'text-error-700 dark:text-error-300'}`}>
            {result.success ? t.dryRun.succeeded : t.dryRun.failed}
          </p>
          <p className="text-xs text-muted-foreground">
            {t.dryRun.summary(result.simulated_changes.length, (result.duration_ms / 1000).toFixed(1))}
          </p>
        </div>
      </div>

      {/* Blockers */}
      {result.blockers.length > 0 && (
        <div className="rounded-lg border border-error-100 bg-error-50/50 p-3 dark:border-error-700 dark:bg-error-700/20">
          <p className="mb-2 text-xs font-semibold text-error-600">{t.dryRun.blockers}</p>
          {result.blockers.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-error-600">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {b}
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="rounded-lg border border-warning-300 bg-warning-50/50 p-3 dark:border-warning-800 dark:bg-warning-800/20">
          <p className="mb-2 text-xs font-semibold text-warning-700 dark:text-warning-300">{t.dryRun.warnings}</p>
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-warning-700 dark:text-warning-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Simulated changes */}
      {result.simulated_changes.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold">{t.dryRun.simulatedChanges}</p>
          <div className="space-y-1.5">
            {result.simulated_changes.map((c, i) => (
              <div key={i} className="rounded-lg border p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.asset_name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{c.change_type}</span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{c.description}</p>
                {(c.before_value || c.after_value) && (
                  <div className="mt-1 flex items-center gap-2 font-mono">
                    {c.before_value && <span className="rounded bg-error-100 px-1 text-error-600 line-through dark:bg-error-700/30 dark:text-error-300">{c.before_value}</span>}
                    {c.after_value && <span className="rounded bg-primary/15 px-1 text-primary dark:bg-brand-primary-800/30 dark:text-primary">{c.after_value}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Impact estimate */}
      <div className="rounded-lg border p-3">
        <p className="mb-2 text-xs font-semibold">{t.dryRun.estimatedImpact}</p>
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">{t.dryRun.downtime}</p>
            <p className="font-medium">{result.estimated_impact.downtime}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t.dryRun.servicesAffected}</p>
            <p className="font-medium">{result.estimated_impact.services_affected}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t.dryRun.riskLevel}</p>
            <p className="font-medium capitalize">{result.estimated_impact.risk_level}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t.dryRun.recommendedWindow}</p>
            <p className="font-medium">{result.estimated_impact.recommend_window}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
