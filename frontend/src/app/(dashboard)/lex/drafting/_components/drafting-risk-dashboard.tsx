'use client';

import { Button } from '@/components/ui/button';

import { useId } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, ShieldAlert, ShieldCheck } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useDraftingLabels } from './drafting-shared';
import {
  type DraftingRiskIssue,
  type DraftingRiskSummary,
  extractDraftingRiskSummary,
  formatDraftingScore,
  normalizeScore,
} from './drafting-workspace-utils';

export interface DraftingRiskDashboardProps {
  result?: unknown;
  summary?: Partial<DraftingRiskSummary>;
  confidence?: number | null;
  riskScore?: number | null;
  riskLevel?: string;
  riskShift?: string;
  risks?: string[];
  issues?: DraftingRiskIssue[];
  notes?: string[];
  title?: string;
  description?: string;
  emptyLabel?: string;
  compact?: boolean;
  className?: string;
}

function variantForRisk(value?: string): 'destructive' | 'warning' | 'success' | 'outline' {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'error') {
    return 'destructive';
  }
  if (normalized === 'medium' || normalized === 'warning' || normalized === 'partial') {
    return 'warning';
  }
  if (normalized === 'low' || normalized === 'none' || normalized === 'info') {
    return 'success';
  }
  return 'outline';
}

function progressColor(value: number | undefined, inverse = false): string {
  if (typeof value !== 'number') {
    return 'bg-muted-foreground';
  }
  const highIsGood = inverse ? value <= 35 : value >= 75;
  const medium = inverse ? value <= 65 : value >= 50;
  if (highIsGood) {
    return 'bg-primary';
  }
  if (medium) {
    return 'bg-warning-500';
  }
  return 'bg-error-500';
}

function MetricBlock({
  label,
  value,
  score,
  inverse,
  onAction,
}: {
  label: string;
  value: string;
  score?: number;
  inverse?: boolean;
  onAction: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className="h-auto flex-col items-stretch rounded-lg border bg-muted/20 p-3 text-start font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold">{value}</span>
      </div>
      {typeof score === 'number' ? (
        <Progress value={score} className="mt-3 h-2" indicatorClassName={progressColor(score, inverse)} />
      ) : null}
    </Button>
  );
}

export function DraftingRiskDashboard({
  result,
  summary,
  confidence,
  riskScore,
  riskLevel,
  riskShift,
  risks,
  issues,
  notes,
  title,
  description,
  emptyLabel,
  compact = false,
  className,
}: DraftingRiskDashboardProps) {
  const rd = useDraftingLabels().riskDashboard;
  const resolvedTitle = title ?? rd.title;
  const resolvedDescription = description ?? rd.description;
  const resolvedEmptyLabel = emptyLabel ?? rd.emptyLabel;
  const detailsId = useId();
  const openDetails = () => document.getElementById(detailsId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const extracted = extractDraftingRiskSummary(result);
  const merged: DraftingRiskSummary = {
    confidence: confidence ?? summary?.confidence ?? extracted.confidence,
    riskScore: riskScore ?? summary?.riskScore ?? extracted.riskScore,
    riskLevel: riskLevel ?? summary?.riskLevel ?? extracted.riskLevel,
    riskShift: riskShift ?? summary?.riskShift ?? extracted.riskShift,
    risks: risks ?? summary?.risks ?? extracted.risks,
    issues: issues ?? summary?.issues ?? extracted.issues,
    notes: notes ?? summary?.notes ?? extracted.notes,
  };
  const confidenceScore = normalizeScore(merged.confidence);
  const normalizedRiskScore = normalizeScore(merged.riskScore);
  const hasSignals =
    typeof confidenceScore === 'number' ||
    typeof normalizedRiskScore === 'number' ||
    Boolean(merged.riskLevel) ||
    Boolean(merged.riskShift) ||
    merged.risks.length > 0 ||
    merged.issues.length > 0 ||
    merged.notes.length > 0;

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          {resolvedTitle}
        </span>
      }
      description={resolvedDescription}
      className={className}
      contentClassName={cn('space-y-4', compact && 'space-y-3')}
    >
      {!hasSignals ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {resolvedEmptyLabel}
        </div>
      ) : (
        <>
          <div className={cn('grid gap-3', compact ? 'sm:grid-cols-2' : 'md:grid-cols-3')}>
            <MetricBlock
              label={rd.confidence}
              value={formatDraftingScore(merged.confidence)}
              score={confidenceScore}
              onAction={openDetails}
            />
            <MetricBlock
              label={rd.riskScore}
              value={formatDraftingScore(merged.riskScore)}
              score={normalizedRiskScore}
              inverse
              onAction={openDetails}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={openDetails}
              className="h-auto flex-col items-stretch rounded-lg border bg-muted/20 p-3 text-start font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-full flex-col justify-between gap-3">
                <span className="text-sm font-medium">{rd.riskPosture}</span>
                <div className="flex flex-wrap gap-2">
                  {merged.riskLevel ? (
                    <Badge variant={variantForRisk(merged.riskLevel)}>{merged.riskLevel}</Badge>
                  ) : null}
                  {merged.riskShift ? <Badge variant="outline">{merged.riskShift}</Badge> : null}
                  {!merged.riskLevel && !merged.riskShift ? (
                    <Badge variant="outline">{rd.unspecified}</Badge>
                  ) : null}
                </div>
              </div>
            </Button>
          </div>

          <div id={detailsId} className="scroll-mt-24 space-y-4">
            {merged.issues.length > 0 ? (
              <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldAlert className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden="true" />
                {rd.issues}
              </div>
              <ul className="space-y-2">
                {merged.issues.map((issue, index) => (
                  <li key={issue.id ?? `${issue.label}-${index}`} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium">{issue.label}</p>
                      {issue.severity ? (
                        <Badge variant={variantForRisk(issue.severity)}>{issue.severity}</Badge>
                      ) : null}
                    </div>
                    {issue.description ? (
                      <p className="mt-1 text-muted-foreground">{issue.description}</p>
                    ) : null}
                    {issue.suggestion ? (
                      <p className="mt-2 text-muted-foreground">
                        <span className="font-medium text-foreground">{rd.suggestion}</span>
                        {issue.suggestion}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              </div>
            ) : null}

            {merged.risks.length > 0 ? (
              <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden="true" />
                {rd.residualRisks}
              </div>
              <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                {merged.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
              </div>
            ) : null}

            {merged.notes.length > 0 ? (
              <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                {rd.notes}
              </div>
              <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                {merged.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              </div>
            ) : null}

            {merged.issues.length === 0 && merged.risks.length === 0 && merged.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{resolvedDescription}</p>
            ) : null}
          </div>
        </>
      )}
    </SectionCard>
  );
}
