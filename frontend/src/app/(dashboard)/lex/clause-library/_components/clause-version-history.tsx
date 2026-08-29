'use client';

import { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, History, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LexClauseLibraryEntry } from '@/types/suites';
import {
  buildClauseCompareFields,
  clauseDisplayTitle,
  formatClauseVersion,
  getClauseVersionReferences,
  resolveDefaultCompareTarget,
  summarizeClauseRelation,
} from './clause-library-utils';
import { useClauseLibraryLabels } from './clause-content-labels';
import { useClauseTaxonomyLabels } from './clause-taxonomy-labels';

export interface ClauseVersionHistoryProps {
  entry: LexClauseLibraryEntry;
  relatedEntries?: LexClauseLibraryEntry[];
}

export function ClauseVersionHistory({
  entry,
  relatedEntries = [],
}: ClauseVersionHistoryProps) {
  const t = useClauseLibraryLabels().versionHistory;
  const taxonomy = useClauseTaxonomyLabels();
  const references = useMemo(
    () => getClauseVersionReferences(entry, relatedEntries, taxonomy),
    [entry, relatedEntries, taxonomy],
  );
  const comparisonOptions = references.filter(
    (reference) => reference.key !== 'current' && reference.entry,
  );
  const defaultCompareTarget = useMemo(
    () => resolveDefaultCompareTarget(entry, relatedEntries),
    [entry, relatedEntries],
  );
  const [compareId, setCompareId] = useState(defaultCompareTarget?.id ?? '');

  useEffect(() => {
    setCompareId(defaultCompareTarget?.id ?? '');
  }, [defaultCompareTarget?.id, entry.id]);

  const compareTarget =
    comparisonOptions.find((reference) => reference.entry?.id === compareId)?.entry ?? null;
  const compareFields = useMemo(
    () => buildClauseCompareFields(entry, compareTarget, taxonomy),
    [entry, compareTarget, taxonomy],
  );

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">{t.lineage}</h3>
        </div>
        <div className="grid gap-2">
          {references.map((reference) => (
            <div
              key={reference.key}
              className="rounded-lg border border-border/70 bg-card/60 px-3 py-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    {reference.label}
                  </p>
                  <p className="mt-1 truncate text-sm">{summarizeClauseRelation(reference, taxonomy)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {taxonomy.compare.captions[reference.field] ?? reference.field}
                  </Badge>
                  {reference.version ? (
                    <Badge variant="secondary">{formatClauseVersion(reference.version, taxonomy)}</Badge>
                  ) : null}
                </div>
              </div>
              {reference.entry ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {reference.entry.code} - {taxonomy.status(reference.entry.status)}
                </p>
              ) : reference.id ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {reference.id}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-medium">{t.compareVersions}</h3>
          </div>
          {comparisonOptions.length > 0 ? (
            <Select value={compareId} onValueChange={setCompareId}>
              <SelectTrigger className="h-9 w-full sm:w-[260px]">
                <SelectValue placeholder={t.selectVersion} />
              </SelectTrigger>
              <SelectContent>
                {comparisonOptions.map((reference) => (
                  <SelectItem key={reference.entry!.id} value={reference.entry!.id}>
                    {reference.label}: {formatClauseVersion(reference.entry!.version, taxonomy)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {compareTarget ? (
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{t.comparingWith}</p>
            <p className="mt-1 text-sm font-medium">
              {formatClauseVersion(compareTarget.version, taxonomy)} - {clauseDisplayTitle(compareTarget)}
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
            {t.loadRelatedHint}
          </p>
        )}

        <div className="overflow-hidden rounded-lg border border-border/70">
          <div className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border/70 bg-muted/40 text-xs font-medium text-muted-foreground">
            <div className="px-3 py-2">{t.field}</div>
            <div className="px-3 py-2">{t.current}</div>
            <div className="px-3 py-2">{t.compared}</div>
          </div>
          {compareFields.map((field) => (
            <div
              key={field.key}
              className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-border/60 last:border-b-0"
            >
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
                {field.label}
              </div>
              <CompareValue value={field.currentValue} changed={field.changed} />
              <CompareValue value={field.comparisonValue} changed={field.changed} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CompareValue({ value, changed }: { value: string; changed: boolean }) {
  return (
    <div
      className={
        changed
          ? 'min-w-0 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:text-warning-300'
          : 'min-w-0 px-3 py-2 text-xs text-foreground'
      }
    >
      <p className="line-clamp-3 whitespace-pre-wrap break-words">{value}</p>
    </div>
  );
}
