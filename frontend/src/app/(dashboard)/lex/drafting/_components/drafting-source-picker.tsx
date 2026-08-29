'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, FileText, Loader2, RefreshCw, ScrollText, X } from 'lucide-react';
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
import { formatDateTime, parseApiError, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LexContractRecord, LexDocument, LexDocumentSearchHit } from '@/types/suites';
import type { FetchParams } from '@/types/table';

export type DraftingSourceKind = 'contract' | 'document';

export type DraftingSourceRecord = LexContractRecord | LexDocument;

export interface DraftingSourceSelection {
  kind: DraftingSourceKind;
  id: string;
  label: string;
  summary: string;
  preview?: string;
  record: DraftingSourceRecord;
  text?: string;
}

export interface DraftingSourcePickerLabels {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  contractTab: string;
  documentTab: string;
  selectedLabel: string;
  clear: string;
  retry: string;
  loading: string;
  noResults: string;
  errorPrefix: string;
  updatedPrefix: string;
}

export interface DraftingSourcePickerProps {
  value?: DraftingSourceSelection | null;
  onChange: (selection: DraftingSourceSelection | null) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  allowedKinds?: DraftingSourceKind[];
  pageSize?: number;
  contractParams?: Partial<FetchParams>;
  documentParams?: Partial<FetchParams>;
  labels?: Partial<DraftingSourcePickerLabels>;
  showSelectedSummary?: boolean;
  onError?: (error: unknown) => void;
}

const DEFAULT_PAGE_SIZE = 8;
const DEFAULT_SOURCE_KINDS: DraftingSourceKind[] = ['contract', 'document'];

const DEFAULT_LABELS: DraftingSourcePickerLabels = {
  label: 'Source document',
  placeholder: 'Select contract or document',
  searchPlaceholder: 'Search sources...',
  contractTab: 'Contracts',
  documentTab: 'Documents',
  selectedLabel: 'Selected',
  clear: 'Clear',
  retry: 'Retry',
  loading: 'Loading sources...',
  noResults: 'No sources found.',
  errorPrefix: 'Unable to load sources:',
  updatedPrefix: 'Updated',
};

export function DraftingSourcePicker({
  value,
  onChange,
  id = 'drafting-source-picker',
  label,
  placeholder,
  searchPlaceholder,
  disabled = false,
  className,
  triggerClassName,
  allowedKinds = DEFAULT_SOURCE_KINDS,
  pageSize = DEFAULT_PAGE_SIZE,
  contractParams,
  documentParams,
  labels,
  showSelectedSummary = true,
  onError,
}: DraftingSourcePickerProps) {
  const resolvedLabels = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
  const sourceLabel = label ?? resolvedLabels.label;
  const resolvedPlaceholder = placeholder ?? resolvedLabels.placeholder;
  const resolvedSearchPlaceholder = searchPlaceholder ?? resolvedLabels.searchPlaceholder;
  const normalizedKinds = useMemo(() => normalizeKinds(allowedKinds), [allowedKinds]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeKind, setActiveKind] = useState<DraftingSourceKind>(() =>
    normalizedKinds.includes(value?.kind ?? 'contract') ? value?.kind ?? normalizedKinds[0] : normalizedKinds[0],
  );

  useEffect(() => {
    if (value?.kind && normalizedKinds.includes(value.kind)) {
      setActiveKind(value.kind);
    }
  }, [normalizedKinds, value?.kind]);

  const trimmedQuery = query.trim();
  const baseParams = useMemo<FetchParams>(
    () => ({
      page: 1,
      per_page: pageSize,
      order: 'desc',
      search: trimmedQuery || undefined,
    }),
    [pageSize, trimmedQuery],
  );

  const contractQuery = useQuery({
    queryKey: ['lex-drafting-source-picker', 'contracts', baseParams, contractParams],
    queryFn: () => enterpriseApi.lex.listContracts({ ...baseParams, ...contractParams }),
    enabled: open && !disabled && activeKind === 'contract' && normalizedKinds.includes('contract'),
  });

  const documentQuery = useQuery({
    queryKey: ['lex-drafting-source-picker', 'documents', baseParams, documentParams],
    queryFn: () => fetchDocumentSources(baseParams, documentParams),
    enabled: open && !disabled && activeKind === 'document' && normalizedKinds.includes('document'),
  });

  const activeQuery = activeKind === 'contract' ? contractQuery : documentQuery;
  const options = useMemo(
    () =>
      activeKind === 'contract'
        ? (contractQuery.data?.data ?? []).map((contract) => contractToSelection(contract, resolvedLabels))
        : (documentQuery.data?.data ?? []).map((document) => documentToSelection(document, resolvedLabels)),
    [activeKind, contractQuery.data?.data, documentQuery.data?.data, resolvedLabels],
  );

  useEffect(() => {
    if (activeQuery.isError) {
      onError?.(activeQuery.error);
    }
  }, [activeQuery.error, activeQuery.isError, onError]);

  const selectedLabel = value?.label ?? '';

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{sourceLabel}</Label>
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
            {normalizedKinds.length > 1 ? (
              <div className="grid grid-cols-2 gap-1 border-b p-1">
                <SourceKindButton
                  active={activeKind === 'contract'}
                  label={resolvedLabels.contractTab}
                  icon={<ScrollText className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => setActiveKind('contract')}
                />
                <SourceKindButton
                  active={activeKind === 'document'}
                  label={resolvedLabels.documentTab}
                  icon={<FileText className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => setActiveKind('document')}
                />
              </div>
            ) : null}
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={resolvedSearchPlaceholder}
            />
            <CommandList>
              {activeQuery.isLoading || activeQuery.isFetching ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {resolvedLabels.loading}
                </div>
              ) : activeQuery.isError ? (
                <div className="space-y-3 px-3 py-4 text-sm">
                  <p className="text-destructive">
                    {resolvedLabels.errorPrefix} {parseApiError(activeQuery.error)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void activeQuery.refetch()}
                  >
                    <RefreshCw className="me-1.5 h-4 w-4" aria-hidden="true" />
                    {resolvedLabels.retry}
                  </Button>
                </div>
              ) : options.length === 0 ? (
                <CommandEmpty>{resolvedLabels.noResults}</CommandEmpty>
              ) : (
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={`${option.kind}:${option.id}`}
                      value={`${option.kind}:${option.id}`}
                      onSelect={() => {
                        onChange(option);
                        setOpen(false);
                      }}
                      className="items-start gap-2 py-3"
                    >
                      <Check
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          value?.kind === option.kind && value.id === option.id ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden="true"
                      />
                      <SourceOption option={option} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showSelectedSummary && value ? (
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="tracking-normal normal-case">
              {value.kind === 'contract' ? resolvedLabels.contractTab : resolvedLabels.documentTab}
            </Badge>
            <span className="font-medium">{resolvedLabels.selectedLabel}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{value.summary}</span>
          </div>
          {value.preview ? (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
              {value.preview}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function contractToSelection(
  contract: LexContractRecord,
  labels: Pick<DraftingSourcePickerLabels, 'updatedPrefix'> = DEFAULT_LABELS,
): DraftingSourceSelection {
  const preview = compactPreview(contract.description || contract.document_text);
  return {
    kind: 'contract',
    id: contract.id,
    label: contract.title,
    summary: [
      contract.party_b_name,
      titleCase(contract.type),
      titleCase(contract.status),
      contract.updated_at ? `${labels.updatedPrefix} ${formatDateTime(contract.updated_at)}` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    preview,
    record: contract,
    text: contract.document_text || undefined,
  };
}

export function documentToSelection(
  document: LexDocument | LexDocumentSearchHit,
  labels: Pick<DraftingSourcePickerLabels, 'updatedPrefix'> = DEFAULT_LABELS,
): DraftingSourceSelection {
  const preview = compactPreview(documentSnippet(document) || document.description);
  return {
    kind: 'document',
    id: document.id,
    label: document.title,
    summary: [
      titleCase(document.type),
      document.category || undefined,
      titleCase(document.status),
      document.updated_at ? `${labels.updatedPrefix} ${formatDateTime(document.updated_at)}` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    preview,
    record: document,
    text: document.description || undefined,
  };
}

export function getDraftingSourceText(selection: DraftingSourceSelection | null | undefined): string {
  return selection?.text?.trim() ?? '';
}

function normalizeKinds(kinds: DraftingSourceKind[]): DraftingSourceKind[] {
  const unique = Array.from(new Set(kinds)).filter((kind): kind is DraftingSourceKind =>
    kind === 'contract' || kind === 'document',
  );
  return unique.length > 0 ? unique : ['contract', 'document'];
}

function fetchDocumentSources(
  baseParams: FetchParams,
  documentParams?: Partial<FetchParams>,
) {
  const params = { ...baseParams, ...documentParams };
  const query = params.search?.trim() ?? '';
  if (!query) {
    return enterpriseApi.lex.listDocuments(params);
  }
  const filters = params.filters ?? {};
  return enterpriseApi.lex.searchDocuments(
    {
      query,
      type: firstFilter(filters.type),
      status: firstFilter(filters.status),
      confidentiality: firstFilter(filters.confidentiality),
      category: firstFilter(filters.category),
    },
    params.page,
    params.per_page,
  );
}

function firstFilter(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function documentSnippet(document: LexDocument | LexDocumentSearchHit): string | undefined {
  if ('snippet' in document && typeof document.snippet === 'string') {
    return stripPreviewMarkup(document.snippet);
  }
  return metadataString(document.metadata, ['snippet', 'summary', 'excerpt', 'text']);
}

function metadataString(metadata: LexDocument['metadata'], keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function compactPreview(value: string | undefined, maxLength = 260): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function stripPreviewMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function SourceKindButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      className="h-9 justify-center gap-2"
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

function SourceOption({ option }: { option: DraftingSourceSelection }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        {option.kind === 'contract' ? (
          <ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="truncate font-medium">{option.label}</span>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{option.summary}</p>
      {option.preview ? (
        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
          {option.preview}
        </p>
      ) : null}
    </div>
  );
}
