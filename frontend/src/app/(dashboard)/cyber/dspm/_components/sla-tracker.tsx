'use client';

import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { CyberSeverity } from '@/types/cyber';

interface SLATrackerProps {
  slaDueAt?: string;
  slaBreached: boolean;
  severity?: CyberSeverity;
}

const SLA_TARGETS: Record<CyberSeverity, string> = {
  critical: '4h',
  high: '24h',
  medium: '72h',
  low: '168h',
  info: '---',
};

function computeTimeRemaining(dueAt: string, overdueLabel: string): {
  text: string;
  color: string;
} {
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { text: overdueLabel, color: 'text-status-error' };
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  const remainingMinutes = totalMinutes % 60;

  let text: string;
  if (totalDays > 0) {
    text = `${totalDays}d ${remainingHours}h`;
  } else if (totalHours > 0) {
    text = `${totalHours}h ${remainingMinutes}m`;
  } else {
    text = `${totalMinutes}m`;
  }

  let color: string;
  if (totalHours >= 24) {
    color = 'text-primary';
  } else if (totalHours >= 4) {
    color = 'text-warning-700 dark:text-warning-300';
  } else {
    color = 'text-status-error';
  }

  return { text, color };
}

export function SLATracker({ slaDueAt, slaBreached, severity }: SLATrackerProps) {
  const t = useDspmLabels().slaTracker;
  if (slaBreached) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-status-error" />
        <span className="text-xs font-semibold text-status-error">{t.breached}</span>
      </div>
    );
  }

  if (!slaDueAt) {
    return (
      <span className="text-xs text-muted-foreground">{t.noSla}</span>
    );
  }

  const { text, color } = computeTimeRemaining(slaDueAt, t.overdue);
  const slaTarget = severity ? SLA_TARGETS[severity] : undefined;

  return (
    <div
      className="inline-flex items-center gap-1.5"
      title={slaTarget && severity ? t.slaTargetTitle(slaTarget, severity) : undefined}
    >
      <Clock className={cn('h-3.5 w-3.5', color)} />
      <span className={cn('text-xs font-medium tabular-nums', color)}>{text}</span>
    </div>
  );
}
