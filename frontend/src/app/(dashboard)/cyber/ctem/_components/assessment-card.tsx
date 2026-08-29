'use client';

import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { timeAgo, cn } from '@/lib/utils';
import { Target, ChevronRight, Clock } from 'lucide-react';
import type { CTEMAssessment } from '@/types/cyber';
import { useCtemLabels } from '../_lib/ctem-i18n';

/** Map ALL backend CTEMAssessmentStatus values to display styles */
const STATUS_CONFIG: Record<string, { color: string; dot: string }> = {
  created: { color: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  scoping: { color: 'text-status-info', dot: 'bg-severity-info animate-pulse' },
  discovery: { color: 'text-status-info', dot: 'bg-severity-info animate-pulse' },
  prioritizing: { color: 'text-status-info', dot: 'bg-severity-info animate-pulse' },
  validating: { color: 'text-status-info', dot: 'bg-severity-info animate-pulse' },
  mobilizing: { color: 'text-status-info', dot: 'bg-severity-info animate-pulse' },
  completed: { color: 'text-primary', dot: 'bg-primary' },
  failed: { color: 'text-status-error', dot: 'bg-severity-critical' },
  cancelled: { color: 'text-foreground/55', dot: 'bg-foreground/35' },
};

interface AssessmentCardProps {
  assessment: CTEMAssessment;
}

export function AssessmentCard({ assessment }: AssessmentCardProps) {
  const router = useRouter();
  const t = useCtemLabels();
  const cfg = STATUS_CONFIG[assessment.status] ?? STATUS_CONFIG.created;
  const summary = assessment.findings_summary;

  return (
    <div
      className="group cursor-pointer rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-primary/40"
      onClick={() => router.push(`/cyber/ctem/${assessment.id}`)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Target className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold group-hover:underline">{assessment.name}</p>
            {assessment.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{assessment.description}</p>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className={cn('h-2 w-2 rounded-full', cfg.dot)} />
        <span className={cn('text-xs font-medium capitalize', cfg.color)}>{t.status[assessment.status] ?? assessment.status}</span>
        {assessment.current_phase && (
          <span className="text-xs text-muted-foreground capitalize">· {assessment.current_phase.replace('_', ' ')}</span>
        )}
      </div>

      {summary && (
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.critical > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-error-100 px-2 py-0.5 text-xs font-medium text-error-600 dark:bg-error-700/30 dark:text-error-300">
              {t.card.criticalSuffix(summary.critical)}
            </span>
          )}
          {summary.high > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-800/30 dark:text-warning-300">
              {t.card.highSuffix(summary.high)}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{t.card.totalFindings(summary.total)}</span>
        </div>
      )}

      {assessment.exposure_score != null && (
        <div className="mt-2">
          <span className="text-xs text-muted-foreground">{t.card.exposureScore}</span>
          <span className="text-xs font-bold">{assessment.exposure_score}</span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {timeAgo(assessment.created_at)}
      </div>
    </div>
  );
}
