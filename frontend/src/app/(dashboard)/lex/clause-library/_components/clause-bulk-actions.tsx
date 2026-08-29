'use client';

import { useMemo, useState } from 'react';
import { Archive, CheckCircle2, Download, RefreshCw, Tags, Trash2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { downloadTextFile } from '@/lib/utils';
import type { BulkAction } from '@/types/table';
import type { LexClauseLibraryEntry, LexUpdateClauseLibraryEntryPayload } from '@/types/suites';
import {
  type ClauseBulkUpdateRequest,
  buildBulkUpdateRequest,
  formatClauseToken,
  getSelectedClauseEntries,
} from './clause-linter-helpers';
import {
  type ClauseLibraryLabels,
  resolveClauseLibraryLabels,
  useClauseLibraryLabels,
} from './clause-content-labels';
import { type ClauseTaxonomyLabels, useClauseTaxonomyLabels } from './clause-taxonomy-labels';

export interface ClauseBulkActionsPanelProps {
  entries: LexClauseLibraryEntry[];
  selectedIds: string[];
  loading?: boolean;
  className?: string;
  onBulkUpdate?: (request: ClauseBulkUpdateRequest) => void | Promise<void>;
  onBulkDelete?: (entries: LexClauseLibraryEntry[]) => void | Promise<void>;
  onClearSelection?: () => void;
}

export interface ClauseLibraryBulkActionCallbacks {
  entries: LexClauseLibraryEntry[];
  onBulkUpdate?: (request: ClauseBulkUpdateRequest) => void | Promise<void>;
  onBulkDelete?: (entries: LexClauseLibraryEntry[]) => void | Promise<void>;
  onExport?: (entries: LexClauseLibraryEntry[]) => void | Promise<void>;
  /** Resolved clause-library labels; defaults to the English surface. */
  labels?: ClauseLibraryLabels;
}

const BULK_STATUS_OPTIONS = ['draft', 'active', 'deprecated', 'archived'] as const;
const BULK_GOVERNANCE_OPTIONS = ['pending_review', 'in_review', 'approved', 'rejected'] as const;

export function ClauseBulkActionsPanel({
  entries,
  selectedIds,
  loading = false,
  className,
  onBulkUpdate,
  onBulkDelete,
  onClearSelection,
}: ClauseBulkActionsPanelProps) {
  const labels = useClauseLibraryLabels();
  const taxonomy = useClauseTaxonomyLabels();
  const t = labels.bulkOps;
  const [status, setStatus] = useState<string>('deprecated');
  const [governanceStatus, setGovernanceStatus] = useState<string>('pending_review');
  const [tagsText, setTagsText] = useState('');
  const selectedEntries = useMemo(() => getSelectedClauseEntries(entries, selectedIds), [entries, selectedIds]);
  const selectedCount = selectedEntries.length;
  const canApply = selectedCount > 0 && !loading;

  const submitUpdate = (patch: LexUpdateClauseLibraryEntryPayload) => {
    if (!onBulkUpdate || selectedIds.length === 0) {
      return;
    }
    void onBulkUpdate(buildBulkUpdateRequest(entries, selectedIds, patch));
  };

  const tags = tagsText
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return (
    <SectionCard
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <Tags className="h-4 w-4 text-primary" aria-hidden />
          {t.title}
        </span>
      }
      description={t.description}
      actions={<Badge variant={selectedCount > 0 ? 'success' : 'outline'}>{t.selected(selectedCount)}</Badge>}
    >
      <div className="space-y-4">
        {selectedCount === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 px-3 py-6 text-center text-sm text-muted-foreground">
            {t.emptyHint}
          </p>
        ) : (
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <p className="text-sm font-medium">{t.selectionSummary}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {summarizeSelectedEntries(selectedEntries, labels, taxonomy).map((item) => (
                <Badge key={item} variant="outline">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="space-y-2 rounded-lg border border-border/70 p-3">
            <p className="text-sm font-medium">{t.statusHeading}</p>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label={t.statusAria}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BULK_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.filters.statusOptions[option] ?? formatClauseToken(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!canApply || !onBulkUpdate}
              onClick={() => submitUpdate({ status })}
            >
              <Archive className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {t.applyStatus}
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-border/70 p-3">
            <p className="text-sm font-medium">{t.governanceHeading}</p>
            <Select value={governanceStatus} onValueChange={setGovernanceStatus}>
              <SelectTrigger aria-label={t.governanceAria}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BULK_GOVERNANCE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.filters.governanceOptions[option] ?? formatClauseToken(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!canApply || !onBulkUpdate}
              onClick={() => submitUpdate({ governance_status: governanceStatus })}
            >
              <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {t.applyGovernance}
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-border/70 p-3">
            <p className="text-sm font-medium">{t.tagsHeading}</p>
            <Textarea
              rows={2}
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder={t.tagsPlaceholder}
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!canApply || !onBulkUpdate || tags.length === 0}
              onClick={() => submitUpdate({ tags })}
            >
              <Tags className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {t.replaceTags}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={selectedCount === 0}
            onClick={() => exportClauseEntries(selectedEntries)}
          >
            <Download className="me-1.5 h-4 w-4" aria-hidden />
            {t.exportJson}
          </Button>
          {onBulkDelete ? (
            <Button
              type="button"
              variant="destructive"
              disabled={!canApply}
              onClick={() => void onBulkDelete(selectedEntries)}
            >
              <Trash2 className="me-1.5 h-4 w-4" aria-hidden />
              {t.deleteSelected}
            </Button>
          ) : null}
          {onClearSelection ? (
            <Button type="button" variant="ghost" disabled={selectedCount === 0} onClick={onClearSelection}>
              {t.clearSelection}
            </Button>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

export function createClauseLibraryBulkActions({
  entries,
  onBulkUpdate,
  onBulkDelete,
  onExport,
  labels = resolveClauseLibraryLabels('en'),
}: ClauseLibraryBulkActionCallbacks): BulkAction[] {
  const t = labels.bulkOps.actions;
  return [
    {
      label: t.submitReview,
      icon: RefreshCw,
      onClick: async (selectedIds) => {
        await onBulkUpdate?.(
          buildBulkUpdateRequest(entries, selectedIds, { governance_status: 'pending_review' }),
        );
      },
    },
    {
      label: t.approveMetadata,
      icon: CheckCircle2,
      onClick: async (selectedIds) => {
        await onBulkUpdate?.(
          buildBulkUpdateRequest(entries, selectedIds, { governance_status: 'approved' }),
        );
      },
    },
    {
      label: t.deprecate,
      icon: Archive,
      onClick: async (selectedIds) => {
        await onBulkUpdate?.(buildBulkUpdateRequest(entries, selectedIds, { status: 'deprecated' }));
      },
    },
    {
      label: t.exportJson,
      icon: Download,
      onClick: async (selectedIds) => {
        const selectedEntries = getSelectedClauseEntries(entries, selectedIds);
        if (onExport) {
          await onExport(selectedEntries);
          return;
        }
        exportClauseEntries(selectedEntries);
      },
    },
    ...(onBulkDelete
      ? [
          {
            label: t.delete,
            icon: Trash2,
            variant: 'destructive' as const,
            onClick: async (selectedIds: string[]) => {
              await onBulkDelete(getSelectedClauseEntries(entries, selectedIds));
            },
          },
        ]
      : []),
  ];
}

export function exportClauseEntries(entries: LexClauseLibraryEntry[]): void {
  const suffix = new Date().toISOString().slice(0, 10);
  downloadTextFile(JSON.stringify(entries, null, 2), `clause-library-${suffix}.json`);
}

function summarizeSelectedEntries(
  entries: LexClauseLibraryEntry[],
  labels: ClauseLibraryLabels,
  taxonomy: ClauseTaxonomyLabels,
): string[] {
  const statuses = countBy(entries, (entry) => taxonomy.status(entry.status));
  const governance = countBy(entries, (entry) => taxonomy.status(entry.governance_status));
  const risks = countBy(entries, (entry) =>
    labels.bulkOps.riskSuffix(taxonomy.risk(entry.risk_level)),
  );
  return [
    ...topCounts(statuses, 2),
    ...topCounts(governance, 2),
    ...topCounts(risks, 2),
  ];
}

function countBy<T>(items: T[], getKey: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topCounts(counts: Map<string, number>, limit: number): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => `${count} ${label}`);
}
