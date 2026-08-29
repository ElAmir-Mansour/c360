'use client';

import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock } from 'lucide-react';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DSPMRemediation, DSPMRemediationStatus, DSPMFindingType } from '@/types/cyber';

interface RemediationQueueTableProps {
  remediations: DSPMRemediation[];
  onRowClick: (id: string) => void;
}

const STATUS_COLORS: Record<DSPMRemediationStatus, string> = {
  open: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  in_progress: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  awaiting_approval: 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300',
  completed: 'bg-primary/15 text-primary',
  failed: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  cancelled: 'bg-secondary text-foreground',
  rolled_back: 'bg-severity-high/10 text-severity-high',
  exception_granted: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  high: 'bg-severity-high/10 text-severity-high',
  medium: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  low: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  info: 'bg-secondary text-foreground',
};

function formatFindingType(type: DSPMFindingType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatStatusLabel(status: DSPMRemediationStatus): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimeRemaining(dueAt: string, overdueLabel: string): { text: string; color: string } {
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { text: overdueLabel, color: 'text-status-error' };
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  let text: string;
  if (totalDays > 0) {
    text = `${totalDays}d`;
  } else if (totalHours > 0) {
    const remainingMinutes = totalMinutes % 60;
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

export function RemediationQueueTable({ remediations, onRowClick }: RemediationQueueTableProps) {
  const t = useDspmLabels().remediationQueue;
  if (remediations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">{t.noRemediations}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colTitle}</th>
            <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colSeverity}</th>
            <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colAsset}</th>
            <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colAssignee}</th>
            <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colStatus}</th>
            <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colSla}</th>
            <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t.colProgress}</th>
          </tr>
        </thead>
        <tbody>
          {remediations.map((rem) => {
            const progressPct = rem.total_steps > 0
              ? Math.round((rem.current_step / rem.total_steps) * 100)
              : 0;

            return (
              <tr
                key={rem.id}
                onClick={() => onRowClick(rem.id)}
                className="cursor-pointer border-b transition-colors hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium">{rem.title}</p>
                    <Badge variant="outline" className="mt-1 text-xs capitalize">
                      {formatFindingType(rem.finding_type)}
                    </Badge>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SEVERITY_COLORS[rem.severity] ?? 'bg-secondary text-foreground'}`}>
                    {rem.severity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm">{rem.data_asset_name ?? '---'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm">{rem.assigned_to ?? rem.assigned_team ?? '---'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[rem.status] ?? 'bg-secondary text-foreground'}`}>
                    {formatStatusLabel(rem.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {rem.sla_breached ? (
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-status-error" />
                      <span className="text-xs font-semibold text-status-error">{t.slaBreached}</span>
                    </div>
                  ) : rem.sla_due_at ? (
                    (() => {
                      const { text, color } = formatTimeRemaining(rem.sla_due_at, t.overdue);
                      return (
                        <div className="flex items-center gap-1.5">
                          <Clock className={`h-3.5 w-3.5 ${color}`} />
                          <span className={`text-xs font-medium ${color}`}>{text}</span>
                        </div>
                      );
                    })()
                  ) : (
                    <span className="text-xs text-muted-foreground">---</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {rem.current_step}/{rem.total_steps} ({progressPct}%)
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
