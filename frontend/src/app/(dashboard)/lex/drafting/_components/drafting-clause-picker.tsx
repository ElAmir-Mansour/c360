'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, Check, ChevronsUpDown, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  LexClauseLibraryEntry,
  LexClauseLibrarySearchParams,
  LexClauseLibrarySearchResult,
} from '@/types/suites';

export type DraftingClauseLanguagePreference = 'en' | 'ar' | 'bilingual';

export interface DraftingClauseSelection {
  id: string;
  code: string;
  title: string;
  text: string;
  entry: LexClauseLibraryEntry;
}

export interface DraftingClausePickerLabels {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  selectedLabel: string;
  clear: string;
  retry: string;
  loading: string;
  noResults: string;
  errorPrefix: string;
  score: string;
  insert: string;
}

export interface DraftingClausePickerProps {
  value?: DraftingClauseSelection | null;
  onChange: (selection: DraftingClauseSelection | null) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  pageSize?: number;
  filters?: Partial<LexClauseLibrarySearchParams>;
  languagePreference?: DraftingClauseLanguagePreference;
  labels?: Partial<DraftingClausePickerLabels>;
  showSelectedText?: boolean;
  onInsertText?: (text: string, entry: LexClauseLibraryEntry) => void;
  onError?: (error: unknown) => void;
}

const DEFAULT_PAGE_SIZE = 8;

const DEFAULT_LABELS: DraftingClausePickerLabels = {
  label: 'Clause library',
  placeholder: 'Select library clause',
  searchPlaceholder: 'Search clauses...',
  selectedLabel: 'Selected clause',
  clear: 'Clear',
  retry: 'Retry',
  loading: 'Loading clauses...',
  noResults: 'No clauses found.',
  errorPrefix: 'Unable to load clauses:',
  score: 'Score',
  insert: 'Insert',
};

export function DraftingClausePicker({
  value,
  onChange,
  id = 'drafting-clause-picker',
  label,
  placeholder,
  searchPlaceholder,
  disabled = false,
  className,
  triggerClassName,
  pageSize = DEFAULT_PAGE_SIZE,
  filters,
  languagePreference = 'en',
  labels,
  showSelectedText = true,
  onInsertText,
  onError,
}: DraftingClausePickerProps) {
  const resolvedLabels = { ...DEFAULT_LABELS, ...labels };
  const pickerLabel = label ?? resolvedLabels.label;
  const resolvedPlaceholder = placeholder ?? resolvedLabels.placeholder;
  const resolvedSearchPlaceholder = searchPlaceholder ?? resolvedLabels.searchPlaceholder;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();

  const params = useMemo<LexClauseLibrarySearchParams>(
    () => ({
      page: 1,
      per_page: pageSize,
      status: 'active',
      ...filters,
      q: trimmedQuery || filters?.q || filters?.query || undefined,
    }),
    [filters, pageSize, trimmedQuery],
  );

  const clauseQuery = useQuery({
    queryKey: ['lex-drafting-clause-picker', params],
    queryFn: () => enterpriseApi.lex.searchClauseLibrary(params),
    enabled: open && !disabled,
  });

  useEffect(() => {
    if (clauseQuery.isError) {
      onError?.(clauseQuery.error);
    }
  }, [clauseQuery.error, clauseQuery.isError, onError]);

  const results = clauseQuery.data?.data ?? [];
  const selectedLabel = value?.title ?? '';

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{pickerLabel}</Label>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            <X className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {resolvedLabels.clear}
          </Button>
        ) : null}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn('min-h-[44px] w-full justify-between font-normal', triggerClassName)}
          >
            <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
              {selectedLabel || resolvedPlaceholder}
            </span>
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={resolvedSearchPlaceholder}
            />
            <CommandList>
              {clauseQuery.isLoading || clauseQuery.isFetching ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {resolvedLabels.loading}
                </div>
              ) : clauseQuery.isError ? (
                <div className="space-y-3 px-3 py-4 text-sm">
                  <p className="text-destructive">
                    {resolvedLabels.errorPrefix} {parseApiError(clauseQuery.error)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void clauseQuery.refetch()}
                  >
                    <RefreshCw className="me-1.5 h-4 w-4" aria-hidden="true" />
                    {resolvedLabels.retry}
                  </Button>
                </div>
              ) : results.length === 0 ? (
                <CommandEmpty>{resolvedLabels.noResults}</CommandEmpty>
              ) : (
                <CommandGroup>
                  {results.map((result) => {
                    const selection = clauseSearchResultToSelection(result, languagePreference);
                    return (
                      <CommandItem
                        key={selection.id}
                        value={selection.id}
                        onSelect={() => {
                          onChange(selection);
                          setOpen(false);
                        }}
                        className="items-start gap-2 py-3"
                      >
                        <Check
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            value?.id === selection.id ? 'opacity-100' : 'opacity-0',
                          )}
                          aria-hidden="true"
                        />
                        <ClauseOption
                          result={result}
                          selection={selection}
                          scoreLabel={resolvedLabels.score}
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value && showSelectedText ? (
        <div className="space-y-2 rounded-lg border bg-muted/20 px-3 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{value.code}</Badge>
            <span className="font-medium">{resolvedLabels.selectedLabel}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {titleCase(String(value.entry.clause_type))}
            </span>
            {onInsertText ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => onInsertText(value.text, value.entry)}
                disabled={disabled}
              >
                <BookMarked className="me-1.5 h-4 w-4" aria-hidden="true" />
                {resolvedLabels.insert}
              </Button>
            ) : null}
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{value.text}</p>
        </div>
      ) : null}
    </div>
  );
}

export function clauseSearchResultToSelection(
  result: LexClauseLibrarySearchResult,
  languagePreference: DraftingClauseLanguagePreference = 'en',
): DraftingClauseSelection {
  return clauseEntryToSelection(result.item, languagePreference);
}

export function clauseEntryToSelection(
  entry: LexClauseLibraryEntry,
  languagePreference: DraftingClauseLanguagePreference = 'en',
): DraftingClauseSelection {
  const title = preferredClauseTitle(entry, languagePreference);
  return {
    id: entry.id,
    code: entry.code,
    title,
    text: preferredClauseText(entry, languagePreference),
    entry,
  };
}

export function preferredClauseTitle(
  entry: LexClauseLibraryEntry,
  languagePreference: DraftingClauseLanguagePreference = 'en',
): string {
  if (languagePreference === 'ar') {
    return entry.title_ar || entry.title_en || entry.code;
  }
  if (languagePreference === 'bilingual' && entry.title_ar) {
    return `${entry.title_en || entry.code} / ${entry.title_ar}`;
  }
  return entry.title_en || entry.title_ar || entry.code;
}

export function preferredClauseText(
  entry: LexClauseLibraryEntry,
  languagePreference: DraftingClauseLanguagePreference = 'en',
): string {
  if (languagePreference === 'ar') {
    return entry.text_ar || entry.text_en;
  }
  if (languagePreference === 'bilingual' && entry.text_ar) {
    return [entry.text_en, entry.text_ar].filter(Boolean).join('\n\n');
  }
  return entry.text_en || entry.text_ar;
}

function ClauseOption({
  result,
  selection,
  scoreLabel,
}: {
  result: LexClauseLibrarySearchResult;
  selection: DraftingClauseSelection;
  scoreLabel: string;
}) {
  const { entry } = selection;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate font-medium">{selection.title}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className="tracking-normal normal-case">
          {entry.code}
        </Badge>
        <span>{titleCase(String(entry.clause_type))}</span>
        {entry.risk_level ? <span>{titleCase(String(entry.risk_level))}</span> : null}
        {Number.isFinite(result.score) ? (
          <span>
            {scoreLabel} {Math.round(result.score * 100)}%
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{selection.text}</p>
    </div>
  );
}
