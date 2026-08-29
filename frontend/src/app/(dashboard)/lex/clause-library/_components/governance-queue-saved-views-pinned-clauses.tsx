'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Pin, PinOff, Save, Trash2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { LexClauseLibraryEntry } from '@/types/suites';
import {
  type ClauseLibrarySavedView,
  type ClauseLibrarySavedViewState,
  deleteClauseLibrarySavedView,
  pinnedClauseEntries,
  readClauseLibrarySavedViews,
  readPinnedClauseIds,
  togglePinnedClauseId,
  upsertClauseLibrarySavedView,
  writePinnedClauseIds,
} from './clause-linter-helpers';
import { useClauseLibraryLabels } from './clause-content-labels';

export interface SavedViewsPinnedClausesProps {
  entries: LexClauseLibraryEntry[];
  currentView: ClauseLibrarySavedViewState;
  selectedEntry?: LexClauseLibraryEntry | null;
  className?: string;
  onSavedViewApply?: (state: ClauseLibrarySavedViewState, view: ClauseLibrarySavedView) => void;
  onClauseOpen?: (entry: LexClauseLibraryEntry) => void;
}

export function useClauseLibrarySavedViewsAndPins(entries: LexClauseLibraryEntry[]) {
  const [savedViews, setSavedViews] = useState<ClauseLibrarySavedView[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  useEffect(() => {
    setSavedViews(readClauseLibrarySavedViews());
    setPinnedIds(readPinnedClauseIds());
  }, []);

  const saveView = useCallback((name: string, state: ClauseLibrarySavedViewState) => {
    setSavedViews(upsertClauseLibrarySavedView(name, state));
  }, []);

  const deleteView = useCallback((viewId: string) => {
    setSavedViews(deleteClauseLibrarySavedView(viewId));
  }, []);

  const togglePinned = useCallback((entryId: string) => {
    setPinnedIds(togglePinnedClauseId(entryId));
  }, []);

  const clearPins = useCallback(() => {
    writePinnedClauseIds([]);
    setPinnedIds([]);
  }, []);

  const pinnedEntries = useMemo(() => pinnedClauseEntries(entries, pinnedIds), [entries, pinnedIds]);
  const isPinned = useCallback((entryId: string) => pinnedIds.includes(entryId), [pinnedIds]);

  return {
    savedViews,
    pinnedIds,
    pinnedEntries,
    saveView,
    deleteView,
    togglePinned,
    clearPins,
    isPinned,
  };
}

export function SavedViewsPinnedClauses({
  entries,
  currentView,
  selectedEntry,
  className,
  onSavedViewApply,
  onClauseOpen,
}: SavedViewsPinnedClausesProps) {
  const t = useClauseLibraryLabels().savedViews;
  const { locale } = useLocaleOrDefault();
  const [viewName, setViewName] = useState('');
  const {
    savedViews,
    pinnedEntries,
    saveView,
    deleteView,
    togglePinned,
    clearPins,
    isPinned,
  } = useClauseLibrarySavedViewsAndPins(entries);

  const handleSaveView = () => {
    if (!viewName.trim()) {
      return;
    }
    saveView(viewName, currentView);
    setViewName('');
  };

  return (
    <SectionCard
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-primary" aria-hidden />
          {t.panelTitle}
        </span>
      }
      description={t.panelDescription}
      actions={<Badge variant="outline">{t.countPinned(pinnedEntries.length)}</Badge>}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t.saveCurrent}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
              placeholder={t.namePlaceholder}
              aria-label={t.nameAria}
            />
            <Button type="button" onClick={handleSaveView} disabled={!viewName.trim()}>
              <Save className="me-1.5 h-4 w-4" aria-hidden />
              {t.save}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t.savedHeading}</p>
          {savedViews.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
              {t.panelEmpty}
            </p>
          ) : (
            <ul className="space-y-2">
              {savedViews.map((view) => (
                <li key={view.id} className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    onClick={() => onSavedViewApply?.(view.state, view)}
                  >
                    <span className="block truncate text-sm font-medium">{view.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {view.state.search ? t.searchPrefix(view.state.search) : t.noSearchText}
                    </span>
                  </button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => deleteView(view.id)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    <span className="sr-only">{t.deleteView}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t.pinnedHeading}</p>
            {selectedEntry ? (
              <Button type="button" size="sm" variant="outline" onClick={() => togglePinned(selectedEntry.id)}>
                {isPinned(selectedEntry.id) ? (
                  <PinOff className="me-1.5 h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Pin className="me-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {isPinned(selectedEntry.id) ? t.unpinSelected : t.pinSelected}
              </Button>
            ) : null}
          </div>

          {pinnedEntries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
              {t.pinnedEmptyPanel}
            </p>
          ) : (
            <ul className="space-y-2">
              {pinnedEntries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    onClick={() => onClauseOpen?.(entry)}
                  >
                    <span className="block truncate text-sm font-medium" dir="auto">{resolveLocalized({ en: entry.title_en, ar: entry.title_ar }, locale) || entry.code}</span>
                    <span className="block text-xs text-muted-foreground">{entry.code}</span>
                  </button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => togglePinned(entry.id)}>
                    <PinOff className="h-4 w-4" aria-hidden />
                    <span className="sr-only">{t.unpinClause}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {pinnedEntries.length > 0 ? (
            <Button type="button" size="sm" variant="ghost" onClick={clearPins}>
              {t.clearPinned}
            </Button>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
