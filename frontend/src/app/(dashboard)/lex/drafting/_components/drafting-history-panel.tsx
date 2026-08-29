'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { History, RotateCcw, Trash2, X } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import { useDraftingLabels } from './drafting-shared';
import {
  type DraftingHistoryEntry,
  type DraftingHistoryStorageOptions,
  addDraftingHistoryEntry,
  clearDraftingHistory,
  formatDraftingScore,
  loadDraftingHistory,
  removeDraftingHistoryEntry,
} from './drafting-workspace-utils';

export interface UseDraftingWorkspaceHistoryOptions extends DraftingHistoryStorageOptions {
  autoload?: boolean;
}

export function useDraftingWorkspaceHistory({
  autoload = true,
  ...storageOptions
}: UseDraftingWorkspaceHistoryOptions = {}) {
  const [entries, setEntries] = useState<DraftingHistoryEntry[]>([]);
  const { key, maxEntries, scope } = storageOptions;
  const resolvedStorageOptions = useMemo(
    () => ({ key, maxEntries, scope }),
    [key, maxEntries, scope],
  );

  const refresh = useCallback(() => {
    const next = loadDraftingHistory(resolvedStorageOptions);
    setEntries(next);
    return next;
  }, [resolvedStorageOptions]);

  useEffect(() => {
    if (autoload) {
      refresh();
    }
  }, [autoload, refresh]);

  const addEntry = useCallback(
    (entry: Parameters<typeof addDraftingHistoryEntry>[0]) => {
      const next = addDraftingHistoryEntry(entry, resolvedStorageOptions);
      setEntries(next);
      return next;
    },
    [resolvedStorageOptions],
  );

  const removeEntry = useCallback(
    (id: string) => {
      const next = removeDraftingHistoryEntry(id, resolvedStorageOptions);
      setEntries(next);
      return next;
    },
    [resolvedStorageOptions],
  );

  const clearEntries = useCallback(() => {
    clearDraftingHistory(resolvedStorageOptions);
    setEntries([]);
  }, [resolvedStorageOptions]);

  return { entries, addEntry, removeEntry, clearEntries, refresh, setEntries };
}

export interface DraftingHistoryPanelProps {
  entries?: DraftingHistoryEntry[];
  storageOptions?: DraftingHistoryStorageOptions;
  title?: ReactNode;
  description?: ReactNode;
  emptyLabel?: ReactNode;
  activeEntryId?: string;
  maxVisible?: number;
  className?: string;
  contentClassName?: string;
  showClear?: boolean;
  onSelect?: (entry: DraftingHistoryEntry) => void;
  onRestore?: (entry: DraftingHistoryEntry) => void;
  onDelete?: (entry: DraftingHistoryEntry) => void;
  onClear?: () => void;
  renderPreview?: (entry: DraftingHistoryEntry) => ReactNode;
  renderActions?: (entry: DraftingHistoryEntry) => ReactNode;
}

function defaultPreview(entry: DraftingHistoryEntry): ReactNode {
  const preview = entry.primaryText ?? entry.subtitle;
  if (!preview) {
    return null;
  }
  return <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{preview}</p>;
}

export function DraftingHistoryPanel({
  entries: controlledEntries,
  storageOptions,
  title,
  description,
  emptyLabel,
  activeEntryId,
  maxVisible,
  className,
  contentClassName,
  showClear = true,
  onSelect,
  onRestore,
  onDelete,
  onClear,
  renderPreview = defaultPreview,
  renderActions,
}: DraftingHistoryPanelProps) {
  const f = useLexFormat();
  const workspaceLabels = useDraftingLabels().workspace;
  const resolvedTitle = title ?? workspaceLabels.historyTitle;
  const resolvedDescription = description ?? workspaceLabels.historyDescription;
  const resolvedEmptyLabel = emptyLabel ?? workspaceLabels.historyEmpty;
  const history = useDraftingWorkspaceHistory({ ...storageOptions, autoload: !controlledEntries });
  const entries = controlledEntries ?? history.entries;
  const visibleEntries = useMemo(
    () => (typeof maxVisible === 'number' ? entries.slice(0, maxVisible) : entries),
    [entries, maxVisible],
  );

  const handleDelete = (entry: DraftingHistoryEntry) => {
    onDelete?.(entry);
    if (!controlledEntries) {
      history.removeEntry(entry.id);
    }
  };

  const handleClear = () => {
    onClear?.();
    if (!controlledEntries) {
      history.clearEntries();
    }
  };

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <History className="h-4 w-4" aria-hidden="true" />
          {resolvedTitle}
        </span>
      }
      description={resolvedDescription}
      actions={
        showClear && entries.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
            <X className="me-1.5 h-4 w-4" aria-hidden="true" />
            {workspaceLabels.historyClear}
          </Button>
        ) : null
      }
      className={className}
      contentClassName={cn('space-y-3', contentClassName)}
    >
      {visibleEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {resolvedEmptyLabel}
        </div>
      ) : (
        <ol className="max-h-[32rem] space-y-3 overflow-y-auto pe-1">
          {visibleEntries.map((entry) => {
            const isActive = activeEntryId === entry.id;
            return (
              <li
                key={entry.id}
                className={cn(
                  'card-interactive p-3',
                  isActive && 'ring-1 ring-primary/40',
                )}
              >
                <button
                  type="button"
                  className="block w-full text-start"
                  onClick={() => onSelect?.(entry)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium leading-6">{entry.title}</p>
                        <Badge variant="outline" className="normal-case tracking-normal">
                          {entry.task}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {f.formatRelative(entry.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {entry.riskLevel ? (
                        <Badge variant="outline" className="normal-case tracking-normal">
                          Risk: {entry.riskLevel}
                        </Badge>
                      ) : null}
                      {typeof entry.confidence === 'number' ? (
                        <Badge variant="outline" className="normal-case tracking-normal">
                          Confidence: {formatDraftingScore(entry.confidence)}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2">{renderPreview(entry)}</div>
                  {entry.tags?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entry.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="normal-case tracking-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </button>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  {onRestore ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => onRestore(entry)}>
                      <RotateCcw className="me-1.5 h-4 w-4" aria-hidden="true" />
                      Restore
                    </Button>
                  ) : null}
                  {renderActions?.(entry)}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ms-auto"
                    onClick={() => handleDelete(entry)}
                  >
                    <Trash2 className="me-1.5 h-4 w-4" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
