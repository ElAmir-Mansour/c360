'use client';

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  GaugeCircle,
  RefreshCw,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLexFormat } from '@/lib/lex/ksa';
import { formatCaseToken, type LegalCase } from '@/lib/lex/cases';
import { cn } from '@/lib/utils';
import { useCaseLabels } from '../labels';
import { useDetailWorkspaceLabels } from './workspace-labels';
import {
  summarizeDeadlineRisk,
  type DeadlineItem,
  type DeadlineItemType,
  type DeadlineRiskLevel,
} from './workflow-metrics';

interface DeadlineRiskStripProps {
  legalCase: LegalCase;
  items: DeadlineItem[];
  onOpenTimeline: () => void;
}

const DEADLINE_TYPES: DeadlineItemType[] = ['task', 'hearing', 'expert', 'judgment'];

export function DeadlineRiskStrip({ legalCase, items, onOpenTimeline }: DeadlineRiskStripProps) {
  const caseLabels = useCaseLabels();
  const labels = useDetailWorkspaceLabels();
  const f = useLexFormat();
  const t = labels.deadline;
  const summary = summarizeDeadlineRisk(items);
  const visibleItems = items.slice(0, 6);
  const extraCount = Math.max(0, items.length - visibleItems.length);
  const owner = legalCase.responsible_lawyer || null;
  const department = legalCase.department || null;
  const unassigned = !owner && !department;
  const staleDays = daysSince(legalCase.updated_at);
  const stale = staleDays >= 14;
  const missingStrength = !legalCase.strength;
  const weakCase = legalCase.strength === 'weak';
  const strengthLabel = legalCase.strength
    ? caseLabels.filters.strengthOptions[legalCase.strength] ?? formatCaseToken(legalCase.strength)
    : labels.command.notSet;
  const escalation =
    summary.overdueCount > 0 ||
    (summary.criticalCount > 0 && (unassigned || missingStrength || weakCase || stale));
  const signals = [
    unassigned ? { key: 'unassigned', label: t.unassignedWarning, variant: 'warning' as const } : null,
    stale ? { key: 'stale', label: t.staleUpdate(staleDays), variant: 'warning' as const } : null,
    missingStrength ? { key: 'missing-strength', label: t.missingStrength, variant: 'warning' as const } : null,
    weakCase ? { key: 'weak-case', label: t.weakCase, variant: 'destructive' as const } : null,
    escalation ? { key: 'escalation', label: t.escalationHint, variant: 'destructive' as const } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; variant: 'warning' | 'destructive' }>;

  return (
    <div className={cn('rounded-lg border p-4', toneClasses(summary.level))}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-full border bg-card p-2 text-primary">
            {summary.level === 'low' && summary.activeCount === 0 ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{t.title}</p>
              <Badge variant={summary.level === 'critical' ? 'destructive' : summary.level === 'high' ? 'warning' : 'secondary'}>
                {levelLabel(summary.level, t)}
              </Badge>
              {summary.overdueCount > 0 ? <Badge variant="destructive">{summary.overdueCount} {t.overdue}</Badge> : null}
              {summary.criticalCount > 0 ? <Badge variant="destructive">{summary.criticalCount}</Badge> : null}
              {summary.highCount > 0 ? <Badge variant="warning">{summary.highCount}</Badge> : null}
              {summary.mediumCount > 0 ? <Badge variant="outline">{summary.mediumCount}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.activeCount > 0 ? t.activeSummary(summary.activeCount) : t.empty}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onOpenTimeline}>
          <CalendarClock className="me-1.5 h-3.5 w-3.5" />
          {t.viewTimeline}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <RiskFact
          label={t.owner}
          value={owner ?? labels.command.unassigned}
          icon={<UserRound className="h-4 w-4" />}
          tone={unassigned ? 'warning' : 'default'}
        />
        <RiskFact
          label={t.department}
          value={department ?? labels.command.notSet}
          icon={<Building2 className="h-4 w-4" />}
          tone={unassigned ? 'warning' : 'default'}
        />
        <RiskFact
          label={t.strength}
          value={strengthLabel}
          icon={<GaugeCircle className="h-4 w-4" />}
          tone={missingStrength ? 'warning' : weakCase ? 'danger' : 'default'}
        />
        <RiskFact
          label={t.lastUpdate}
          value={<RelativeTime date={legalCase.updated_at} />}
          icon={<RefreshCw className="h-4 w-4" />}
          tone={stale ? 'warning' : 'default'}
        />
      </div>

      {summary.activeCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{t.countsByType}</span>
          {DEADLINE_TYPES.filter((type) => summary.typeCounts[type] > 0).map((type) => (
            <Badge key={type} variant="outline">
              {deadlineTypeLabel(type, labels.timeline)}: {summary.typeCounts[type]}
            </Badge>
          ))}
        </div>
      ) : null}

      {signals.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {signals.map((signal) => (
            <Badge key={signal.key} variant={signal.variant}>
              <ShieldAlert className="me-1 h-3 w-3" />
              {signal.label}
            </Badge>
          ))}
        </div>
      ) : summary.activeCount === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t.allClear}</p>
      ) : null}

      {visibleItems.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => (
            <div key={item.id} className="rounded-md border bg-card/80 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <Badge variant="outline" className="mt-1">
                    {deadlineTypeLabel(item.type, labels.timeline)}
                  </Badge>
                </div>
                <Badge variant={item.severity === 'critical' ? 'destructive' : item.severity === 'high' ? 'warning' : 'outline'}>
                  {deadlineLabel(item.daysUntil, t)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.detail ? `${formatCaseToken(item.detail)} • ` : ''}
                {f.formatDate(item.date)} • {f.formatHijri(item.date)} • <RelativeTime date={item.date} />
              </p>
            </div>
          ))}
          {extraCount > 0 ? (
            <button
              type="button"
              onClick={onOpenTimeline}
              className="rounded-md border border-dashed bg-card/70 px-3 py-2 text-start text-sm font-semibold text-primary hover:bg-primary/5"
            >
              {t.moreDeadlines(extraCount)}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RiskFact({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-md border bg-card/80 px-3 py-2',
        tone === 'warning' && 'border-warning-100 bg-warning-50/70 dark:bg-warning-800/10',
        tone === 'danger' && 'border-error-100 bg-error-50/70 dark:bg-error-700/10',
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function levelLabel(level: DeadlineRiskLevel, labels: ReturnType<typeof useDetailWorkspaceLabels>['deadline']) {
  if (level === 'critical') return labels.critical;
  if (level === 'high') return labels.high;
  if (level === 'medium') return labels.medium;
  return labels.low;
}

function deadlineLabel(daysUntil: number, labels: ReturnType<typeof useDetailWorkspaceLabels>['deadline']) {
  if (daysUntil < 0) return labels.overdue;
  if (daysUntil === 0) return labels.dueToday;
  return labels.dueIn(daysUntil);
}

function deadlineTypeLabel(type: DeadlineItemType, labels: ReturnType<typeof useDetailWorkspaceLabels>['timeline']) {
  if (type === 'task') return labels.task;
  if (type === 'hearing') return labels.hearing;
  if (type === 'expert') return labels.expert;
  return labels.judgment;
}

function toneClasses(level: DeadlineRiskLevel): string {
  if (level === 'critical') return 'border-error-100 bg-error-50/70 dark:bg-error-700/10';
  if (level === 'high') return 'border-warning-100 bg-warning-50/70 dark:bg-warning-800/10';
  if (level === 'medium') return 'border-sky-200 bg-sky-50/70 dark:bg-sky-950/10';
  return 'bg-card';
}

function daysSince(value: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;

  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
}
