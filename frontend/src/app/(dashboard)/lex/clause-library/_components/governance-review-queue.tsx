'use client';

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, MessageSquare, Pencil, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { LexClauseLibraryEntry } from '@/types/suites';
import { GovernanceStatusBadge } from '../../_components/governance-badge';
import {
  type ClauseLibraryGovernanceIntent,
  type GovernanceQueueItem,
  buildGovernanceReviewQueue,
} from './clause-linter-helpers';
import { type ClauseLibraryLabels, useClauseLibraryLabels } from './clause-content-labels';
import { useClauseTaxonomyLabels } from './clause-taxonomy-labels';

export interface GovernanceReviewQueueProps {
  entries: LexClauseLibraryEntry[];
  selectedIds?: string[];
  maxItems?: number;
  className?: string;
  onEdit?: (entry: LexClauseLibraryEntry) => void;
  onOpenDecision?: (entry: LexClauseLibraryEntry, intent: ClauseLibraryGovernanceIntent) => void;
}

export function GovernanceReviewQueue({
  entries,
  selectedIds = [],
  maxItems = 8,
  className,
  onEdit,
  onOpenDecision,
}: GovernanceReviewQueueProps) {
  const labels = useClauseLibraryLabels();
  const t = labels.governanceQueue;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const scopedEntries = selectedIds.length > 0 ? entries.filter((entry) => selectedSet.has(entry.id)) : entries;
  const queue = useMemo(
    () => buildGovernanceReviewQueue(scopedEntries, { limit: maxItems }),
    [maxItems, scopedEntries],
  );
  const criticalCount = queue.filter((item) => item.priorityLabel === 'Critical').length;
  const highCount = queue.filter((item) => item.priorityLabel === 'High').length;

  return (
    <SectionCard
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          {t.title}
        </span>
      }
      description={t.description}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={criticalCount > 0 ? 'destructive' : 'outline'}>{t.criticalCount(criticalCount)}</Badge>
          <Badge variant={highCount > 0 ? 'warning' : 'outline'}>{t.highCount(highCount)}</Badge>
        </div>
      }
    >
      {queue.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/80 px-3 py-6 text-center text-sm text-muted-foreground">
          {t.empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {queue.map((item) => (
            <GovernanceReviewQueueRow
              key={item.entry.id}
              item={item}
              labels={labels}
              onEdit={onEdit}
              onOpenDecision={onOpenDecision}
            />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function GovernanceReviewQueueRow({
  item,
  labels,
  onEdit,
  onOpenDecision,
}: {
  item: GovernanceQueueItem;
  labels: ClauseLibraryLabels;
  onEdit?: (entry: LexClauseLibraryEntry) => void;
  onOpenDecision?: (entry: LexClauseLibraryEntry, intent: ClauseLibraryGovernanceIntent) => void;
}) {
  const taxonomy = useClauseTaxonomyLabels();
  const { locale } = useLocaleOrDefault();
  const t = labels.governanceQueue;
  const statusLabel = taxonomy.status(item.status);
  return (
    <li className="rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium" dir="auto">{resolveLocalized({ en: item.entry.title_en, ar: item.entry.title_ar }, locale) || item.entry.code}</p>
            <GovernanceStatusBadge status={item.status} label={statusLabel} />
            <Badge variant={priorityVariant(item.priorityLabel)}>{priorityLabel(item.priorityLabel, t)}</Badge>
            {item.quality.errorCount > 0 ? (
              <Badge variant="destructive">{t.lintError(item.quality.errorCount)}</Badge>
            ) : null}
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">{resolveLocalized({ en: item.entry.text_en, ar: item.entry.text_ar }, locale)}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{item.entry.code}</span>
            <span>{taxonomy.clauseType(item.entry.clause_type)}</span>
            <span>{t.riskSuffix(taxonomy.risk(item.entry.risk_level))}</span>
            <span>{t.ageDays(item.ageDays)}</span>
            <span>{t.qualityScore(item.quality.score)}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {item.availableIntents.map((intent) => (
            <GovernanceIntentButton
              key={intent}
              intent={intent}
              t={t}
              disabled={!onOpenDecision}
              onClick={() => onOpenDecision?.(item.entry, intent)}
            />
          ))}
          {onEdit ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(item.entry)}>
              <Pencil className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {t.edit}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function priorityLabel(
  priority: GovernanceQueueItem['priorityLabel'],
  t: ClauseLibraryLabels['governanceQueue'],
): string {
  switch (priority) {
    case 'Critical':
      return t.priority.critical;
    case 'High':
      return t.priority.high;
    default:
      return t.priority.normal;
  }
}

function GovernanceIntentButton({
  intent,
  t,
  disabled,
  onClick,
}: {
  intent: ClauseLibraryGovernanceIntent;
  t: ClauseLibraryLabels['governanceQueue'];
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = intentIcon(intent);
  return (
    <Button
      type="button"
      size="sm"
      variant={intent === 'reject' ? 'destructive' : 'outline'}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="me-1.5 h-3.5 w-3.5" aria-hidden />
      {intentLabel(intent, t)}
    </Button>
  );
}

function intentIcon(intent: ClauseLibraryGovernanceIntent) {
  switch (intent) {
    case 'approve':
      return CheckCircle2;
    case 'request_changes':
      return MessageSquare;
    case 'reject':
      return XCircle;
    case 'submit_review':
    default:
      return RefreshCw;
  }
}

function intentLabel(
  intent: ClauseLibraryGovernanceIntent,
  t: ClauseLibraryLabels['governanceQueue'],
): string {
  switch (intent) {
    case 'approve':
      return t.intents.approve;
    case 'request_changes':
      return t.intents.changes;
    case 'reject':
      return t.intents.reject;
    case 'submit_review':
    default:
      return t.intents.submit;
  }
}

function priorityVariant(priority: GovernanceQueueItem['priorityLabel']) {
  if (priority === 'Critical') return 'destructive';
  if (priority === 'High') return 'warning';
  return 'outline';
}

export function GovernanceQueueSummary({
  entries,
  className,
}: {
  entries: LexClauseLibraryEntry[];
  className?: string;
}) {
  const labels = useClauseLibraryLabels();
  const t = labels.governanceQueue.summary;
  const queue = useMemo(() => buildGovernanceReviewQueue(entries), [entries]);
  const pending = queue.filter((item) => item.status === 'pending_review').length;
  const inReview = queue.filter((item) => item.status === 'in_review').length;
  const rejected = queue.filter((item) => item.status === 'rejected').length;

  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', className)}>
      <QueueSummaryMetric label={t.queued} value={queue.length} icon={ShieldCheck} />
      <QueueSummaryMetric label={t.pending} value={pending} icon={RefreshCw} />
      <QueueSummaryMetric label={t.inReview} value={inReview} icon={MessageSquare} />
      <QueueSummaryMetric label={t.rejected} value={rejected} icon={AlertTriangle} />
    </div>
  );
}

function QueueSummaryMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof ShieldCheck;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
