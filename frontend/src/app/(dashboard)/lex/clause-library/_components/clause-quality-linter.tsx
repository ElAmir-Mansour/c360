'use client';

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, Pencil, RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { LexClauseLibraryEntry } from '@/types/suites';
import {
  type ClauseLibraryGovernanceIntent,
  type ClauseQualityResult,
  lintClauseLibraryEntry,
  summarizeClauseQuality,
} from './clause-linter-helpers';
import { type ClauseLibraryLabels, useClauseLibraryLabels } from './clause-content-labels';

export interface ClauseQualityLinterProps {
  entries: LexClauseLibraryEntry[];
  selectedIds?: string[];
  maxItems?: number;
  className?: string;
  onEdit?: (entry: LexClauseLibraryEntry) => void;
  onOpenDecision?: (entry: LexClauseLibraryEntry, intent: ClauseLibraryGovernanceIntent) => void;
}

export function ClauseQualityLinter({
  entries,
  selectedIds = [],
  maxItems = 5,
  className,
  onEdit,
  onOpenDecision,
}: ClauseQualityLinterProps) {
  const labels = useClauseLibraryLabels();
  const t = labels.qualityLinter;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const lintEntries = selectedIds.length > 0 ? entries.filter((entry) => selectedSet.has(entry.id)) : entries;
  const summary = useMemo(() => summarizeClauseQuality(lintEntries), [lintEntries]);
  const results = useMemo(
    () =>
      lintEntries
        .map((entry) => lintClauseLibraryEntry(entry, entries))
        .filter((result) => result.issues.length > 0)
        .sort((a, b) => a.score - b.score || b.issues.length - a.issues.length)
        .slice(0, maxItems),
    [entries, lintEntries, maxItems],
  );

  return (
    <SectionCard
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden />
          {t.title}
        </span>
      }
      description={
        selectedIds.length > 0 ? t.descriptionSelected(selectedIds.length) : t.description
      }
      actions={<QualityScorePill score={summary.averageScore} t={t} />}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <QualityMetric label={t.metrics.entries} value={summary.total} />
          <QualityMetric label={t.metrics.clean} value={summary.cleanCount} tone="success" />
          <QualityMetric label={t.metrics.errors} value={summary.errorCount} tone="destructive" />
          <QualityMetric label={t.metrics.warnings} value={summary.warningCount} tone="warning" />
          <QualityMetric label={t.metrics.info} value={summary.infoCount} />
        </div>

        {summary.total === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 px-3 py-6 text-center text-sm text-muted-foreground">
            {t.noClauses}
          </p>
        ) : results.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t.noIssues}
          </div>
        ) : (
          <ul className="space-y-3">
            {results.map((result) => (
              <ClauseQualityResultRow
                key={result.entry.id}
                result={result}
                t={t}
                onEdit={onEdit}
                onOpenDecision={onOpenDecision}
              />
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function ClauseQualityResultRow({
  result,
  t,
  onEdit,
  onOpenDecision,
}: {
  result: ClauseQualityResult;
  t: ClauseLibraryLabels['qualityLinter'];
  onEdit?: (entry: LexClauseLibraryEntry) => void;
  onOpenDecision?: (entry: LexClauseLibraryEntry, intent: ClauseLibraryGovernanceIntent) => void;
}) {
  const { locale } = useLocaleOrDefault();
  const firstIssue = result.issues[0];
  const remaining = result.issues.length - 1;

  return (
    <li className="rounded-lg border border-border/70 bg-card/70 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium" dir="auto">{resolveLocalized({ en: result.entry.title_en, ar: result.entry.title_ar }, locale) || result.entry.code}</p>
            <Badge variant={severityVariant(firstIssue.severity)}>{firstIssue.severity}</Badge>
            <Badge variant="outline">{t.score(result.score)}</Badge>
          </div>
          <div>
            <p className="text-sm font-medium">{firstIssue.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{firstIssue.description}</p>
            {firstIssue.recommendation ? (
              <p className="mt-1 text-xs text-muted-foreground">{t.fixPrefix(firstIssue.recommendation)}</p>
            ) : null}
            {remaining > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">{t.additionalIssues(remaining)}</p>
            ) : null}
          </div>
          <Progress
            value={result.score}
            className="h-1.5"
            indicatorClassName={cn(
              result.state === 'error' && 'bg-destructive',
              result.state === 'warning' && 'bg-yellow-500',
              result.state === 'info' && 'bg-sky-500',
            )}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onOpenDecision ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenDecision(result.entry, 'submit_review')}
            >
              <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {t.review}
            </Button>
          ) : null}
          {onEdit ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(result.entry)}>
              <Pencil className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {t.edit}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function QualityMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'destructive';
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold',
          tone === 'success' && 'text-primary',
          tone === 'warning' && 'text-yellow-600',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function QualityScorePill({
  score,
  t,
}: {
  score: number;
  t: ClauseLibraryLabels['qualityLinter'];
}) {
  const variant = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'destructive';
  return <Badge variant={variant}>{t.scorePill(score)}</Badge>;
}

function severityVariant(severity: 'error' | 'warning' | 'info') {
  if (severity === 'error') return 'destructive';
  if (severity === 'warning') return 'warning';
  return 'outline';
}
