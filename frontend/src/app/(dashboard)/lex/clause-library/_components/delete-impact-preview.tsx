'use client';

import { useMemo } from 'react';
import { AlertTriangle, Archive, Link2, ShieldAlert, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SectionCard } from '@/components/suites/section-card';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { LexClauseLibraryEntry } from '@/types/suites';
import {
  type ClauseDeleteImpact,
  buildClauseDeleteImpact,
} from './clause-linter-helpers';
import { type ClauseLibraryLabels, useClauseLibraryLabels } from './clause-content-labels';
import { useClauseTaxonomyLabels } from './clause-taxonomy-labels';

export interface DeleteImpactPreviewProps {
  entry: LexClauseLibraryEntry | null;
  entries: LexClauseLibraryEntry[];
  open: boolean;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete?: (entry: LexClauseLibraryEntry, impact: ClauseDeleteImpact) => void | Promise<void>;
  onDeprecate?: (entry: LexClauseLibraryEntry, impact: ClauseDeleteImpact) => void | Promise<void>;
}

export function DeleteImpactPreviewDialog({
  entry,
  entries,
  open,
  loading = false,
  onOpenChange,
  onConfirmDelete,
  onDeprecate,
}: DeleteImpactPreviewProps) {
  const labels = useClauseLibraryLabels();
  const { locale } = useLocaleOrDefault();
  const t = labels.deleteImpact;
  const impact = useMemo(() => (entry ? buildClauseDeleteImpact(entry, entries) : null), [entry, entries]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {entry && impact ? (
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.dialogTitle}</DialogTitle>
            <DialogDescription>
              {t.dialogDescription(resolveLocalized({ en: entry.title_en, ar: entry.title_ar }, locale) || entry.code)}
            </DialogDescription>
          </DialogHeader>

          <DeleteImpactPreview impact={impact} labels={labels} />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            {onDeprecate ? (
              <Button type="button" variant="outline" disabled={loading} onClick={() => onDeprecate(entry, impact)}>
                <Archive className="me-1.5 h-4 w-4" aria-hidden />
                {t.deprecateInstead}
              </Button>
            ) : null}
            {onConfirmDelete ? (
              <Button
                type="button"
                variant="destructive"
                disabled={loading || impact.severity === 'blocked'}
                onClick={() => onConfirmDelete(entry, impact)}
              >
                <Trash2 className="me-1.5 h-4 w-4" aria-hidden />
                {t.delete}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function DeleteImpactPreview({
  impact,
  labels: providedLabels,
}: {
  impact: ClauseDeleteImpact;
  labels?: ClauseLibraryLabels;
}) {
  const hookLabels = useClauseLibraryLabels();
  const taxonomy = useClauseTaxonomyLabels();
  const { locale } = useLocaleOrDefault();
  const labels = providedLabels ?? hookLabels;
  const t = labels.deleteImpact;
  return (
    <div className="space-y-4">
      <Alert variant={impactAlertVariant(impact)}>
        <ShieldAlert className="h-4 w-4" aria-hidden />
        <AlertTitle>{impactTitle(impact, t)}</AlertTitle>
        <AlertDescription>
          {t.recommendedAction} <span className="font-medium">{impact.recommendedAction}</span>
        </AlertDescription>
      </Alert>

      <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium" dir="auto">{resolveLocalized({ en: impact.entry.title_en, ar: impact.entry.title_ar }, locale) || impact.entry.code}</p>
          <Badge variant="outline">{impact.entry.code}</Badge>
          <Badge variant="outline">{taxonomy.status(impact.entry.status)}</Badge>
          <Badge variant="outline">{t.riskSuffix(taxonomy.risk(impact.entry.risk_level))}</Badge>
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground" dir="auto">{resolveLocalized({ en: impact.entry.text_en, ar: impact.entry.text_ar }, locale)}</p>
      </div>

      <ImpactReasonList impact={impact} t={t} />
      <ImpactReferenceList impact={impact} t={t} />
      <ReplacementCandidateList impact={impact} t={t} />
    </div>
  );
}

export function DeleteImpactPreviewPanel({
  entry,
  entries,
  className,
}: {
  entry: LexClauseLibraryEntry | null;
  entries: LexClauseLibraryEntry[];
  className?: string;
}) {
  const labels = useClauseLibraryLabels();
  const t = labels.deleteImpact;
  const impact = useMemo(() => (entry ? buildClauseDeleteImpact(entry, entries) : null), [entry, entries]);

  return (
    <SectionCard title={t.panelTitle} description={t.panelDescription} className={className}>
      {impact ? (
        <DeleteImpactPreview impact={impact} labels={labels} />
      ) : (
        <p className="rounded-lg border border-dashed border-border/80 px-3 py-6 text-center text-sm text-muted-foreground">
          {t.panelEmpty}
        </p>
      )}
    </SectionCard>
  );
}

function ImpactReasonList({
  impact,
  t,
}: {
  impact: ClauseDeleteImpact;
  t: ClauseLibraryLabels['deleteImpact'];
}) {
  if (impact.reasons.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t.reasonsHeading}</p>
      <ul className="space-y-2">
        {impact.reasons.map((reason) => (
          <li key={`${reason.title}-${reason.severity}`} className="rounded-lg border border-border/70 px-3 py-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium">{reason.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{reason.description}</p>
              </div>
              <Badge className="ms-auto" variant={reason.severity === 'blocker' ? 'destructive' : 'outline'}>
                {t.severity[reason.severity] ?? reason.severity}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImpactReferenceList({
  impact,
  t,
}: {
  impact: ClauseDeleteImpact;
  t: ClauseLibraryLabels['deleteImpact'];
}) {
  const { locale } = useLocaleOrDefault();
  if (impact.references.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 px-3 py-3 text-sm text-muted-foreground">
        {t.noReferences}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t.referencesHeading}</p>
      <ul className="space-y-2">
        {impact.references.map((reference, index) => (
          <li key={`${reference.kind}-${reference.entry.id}-${index}`} className="rounded-lg border border-border/70 px-3 py-2">
            <div className="flex items-start gap-2">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" dir="auto">{resolveLocalized({ en: reference.entry.title_en, ar: reference.entry.title_ar }, locale) || reference.entry.code}</p>
                <p className="mt-1 text-xs text-muted-foreground">{reference.description}</p>
              </div>
              <Badge className="ms-auto shrink-0" variant={reference.severity === 'blocker' ? 'destructive' : 'outline'}>
                {t.kinds[reference.kind] ?? reference.kind.replace(/_/g, ' ')}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReplacementCandidateList({
  impact,
  t,
}: {
  impact: ClauseDeleteImpact;
  t: ClauseLibraryLabels['deleteImpact'];
}) {
  const taxonomy = useClauseTaxonomyLabels();
  const { locale } = useLocaleOrDefault();
  if (impact.replacementCandidates.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t.replacementsHeading}</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {impact.replacementCandidates.map((candidate) => (
          <li key={candidate.id} className="rounded-lg border border-border/70 px-3 py-2">
            <p className="truncate text-sm font-medium" dir="auto">{resolveLocalized({ en: candidate.title_en, ar: candidate.title_ar }, locale) || candidate.code}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {candidate.code} - {taxonomy.clauseType(candidate.clause_type)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function impactTitle(
  impact: ClauseDeleteImpact,
  t: ClauseLibraryLabels['deleteImpact'],
): string {
  if (impact.severity === 'blocked') {
    return t.titleBlocked;
  }
  if (impact.severity === 'risky') {
    return t.titleRisky;
  }
  return t.titleSafe;
}

function impactAlertVariant(impact: ClauseDeleteImpact) {
  if (impact.severity === 'blocked') return 'destructive';
  if (impact.severity === 'risky') return 'warning';
  return 'success';
}
