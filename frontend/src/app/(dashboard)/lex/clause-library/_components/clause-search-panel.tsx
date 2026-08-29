'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, SlidersHorizontal } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { SearchInput } from '@/components/shared/forms/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Switch } from '@/components/ui/switch';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import type {
  LexClauseLibraryEntry,
  LexClauseLibrarySearchParams,
  LexClauseLibrarySearchResult,
} from '@/types/suites';
import { useClauseLibraryLabels } from './clause-content-labels';
import { type ClauseTaxonomyLabels, useClauseTaxonomyLabels } from './clause-taxonomy-labels';

const ALL_FILTER_VALUE = '__all__';
const DEFAULT_PER_PAGE = 10;

const CLAUSE_TYPE_OPTIONS = [
  'indemnification',
  'termination',
  'limitation_of_liability',
  'confidentiality',
  'ip_ownership',
  'non_compete',
  'payment_terms',
  'warranty',
  'force_majeure',
  'dispute_resolution',
  'data_protection',
  'governing_law',
  'assignment',
  'insurance',
  'audit_rights',
  'sla',
  'auto_renewal',
  'representations',
  'non_solicitation',
  'other',
] as const;

const RISK_LEVEL_OPTIONS = ['none', 'low', 'medium', 'high', 'critical'] as const;
const LANGUAGE_OPTIONS = ['en', 'ar', 'bilingual'] as const;
const CLAUSE_STATUS_OPTIONS = ['draft', 'active', 'deprecated', 'archived'] as const;
const GOVERNANCE_STATUS_OPTIONS = ['pending_review', 'in_review', 'approved', 'rejected'] as const;

type ClauseSearchFilterKey =
  | 'clause_type'
  | 'category'
  | 'jurisdiction'
  | 'risk_level'
  | 'language'
  | 'status'
  | 'governance_status'
  | 'tags';

type ClauseSearchSelectFilterKey = Exclude<ClauseSearchFilterKey, 'tags'>;

type ClauseSearchFilterState = Record<ClauseSearchFilterKey, string>;

export type ClauseSearchFilters = Pick<
  LexClauseLibrarySearchParams,
  'clause_type' | 'category' | 'jurisdiction' | 'risk_level' | 'language' | 'status' | 'governance_status'
> & {
  tags?: string[];
};

export interface ClauseSearchFilterOption {
  value: string;
  label: string;
}

export type ClauseSearchFilterOptions = Partial<
  Record<ClauseSearchSelectFilterKey, ClauseSearchFilterOption[]>
>;

export interface ClauseSearchPanelProps {
  onSelect?: (entry: LexClauseLibraryEntry) => void;
  initialFilters?: Partial<ClauseSearchFilters>;
  filterOptions?: ClauseSearchFilterOptions;
  perPage?: number;
}

const SEARCH_COPY = {
  en: {
    advancedFilters: 'Advanced filters',
    clearFilters: 'Clear filters',
    allLabel: 'All',
    activeFilters: (count: number) => `${count} active`,
    filters: {
      clause_type: 'Clause type',
      category: 'Category',
      jurisdiction: 'Jurisdiction',
      risk_level: 'Risk level',
      language: 'Language',
      status: 'Status',
      governance_status: 'Governance',
      tags: 'Tags',
    },
    placeholders: {
      category: 'Any category',
      jurisdiction: 'Any jurisdiction',
      tags: 'confidentiality, nda',
    },
    snippetFallbackField: 'Clause text',
    snippetFields: {
      code: 'Code',
      title_en: 'Title (English)',
      title_ar: 'Title (Arabic)',
      text_en: 'Text (English)',
      text_ar: 'Text (Arabic)',
      category: 'Category',
      tags: 'Tags',
      jurisdiction: 'Jurisdiction',
      clause_type: 'Clause type',
      status: 'Status',
      governance_status: 'Governance',
      risk_level: 'Risk level',
      language: 'Language',
      source: 'Source',
    },
    // Language names as autonyms so they never surface as a raw English token.
    optionLabels: {
      en: 'الإنجليزية',
      ar: 'العربية',
      bilingual: 'ثنائي اللغة',
    },
  },
  ar: {
    advancedFilters: 'عوامل التصفية المتقدمة',
    clearFilters: 'مسح عوامل التصفية',
    allLabel: 'الكل',
    activeFilters: (count: number) => `${count} نشطة`,
    filters: {
      clause_type: 'نوع البند',
      category: 'الفئة',
      jurisdiction: 'الاختصاص',
      risk_level: 'مستوى المخاطر',
      language: 'اللغة',
      status: 'الحالة',
      governance_status: 'الحوكمة',
      tags: 'الوسوم',
    },
    placeholders: {
      category: 'أي فئة',
      jurisdiction: 'أي اختصاص',
      tags: 'السرية، اتفاقية عدم إفصاح',
    },
    snippetFallbackField: 'نص البند',
    snippetFields: {
      code: 'الرمز',
      title_en: 'العنوان (بالإنجليزية)',
      title_ar: 'العنوان (بالعربية)',
      text_en: 'النص (بالإنجليزية)',
      text_ar: 'النص (بالعربية)',
      category: 'الفئة',
      tags: 'الوسوم',
      jurisdiction: 'الاختصاص',
      clause_type: 'نوع البند',
      status: 'الحالة',
      governance_status: 'الحوكمة',
      risk_level: 'مستوى المخاطر',
      language: 'اللغة',
      source: 'المصدر',
    },
    optionLabels: {
      en: 'الإنجليزية',
      ar: 'العربية',
      bilingual: 'ثنائي اللغة',
    },
  },
} as const;

export function ClauseSearchPanel({
  onSelect,
  initialFilters,
  filterOptions,
  perPage = DEFAULT_PER_PAGE,
}: ClauseSearchPanelProps) {
  const labels = useClauseLibraryLabels().search;
  const taxonomy = useClauseTaxonomyLabels();
  const { locale } = useLocaleOrDefault();
  const copy = SEARCH_COPY[locale];
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  // Advanced filters are collapsible to declutter the panel. Default open so the
  // view is unchanged on first load; the active-count badge + Clear button live
  // in the header so applied filters stay visible even when the grid is hidden.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [filters, setFilters] = useState<ClauseSearchFilterState>(() =>
    clauseSearchFilterDefaults(initialFilters),
  );
  const trimmed = query.trim();
  const tagTerms = useMemo(() => parseTagInput(filters.tags), [filters.tags]);
  const searchText = useMemo(() => buildSearchText(trimmed, tagTerms), [tagTerms, trimmed]);
  const normalizedFilters = useMemo(() => normalizeFilters(filters), [filters]);
  const searchParams = useMemo<LexClauseLibrarySearchParams>(
    () => ({
      q: searchText || undefined,
      semantic,
      page: 1,
      per_page: perPage,
      ...normalizedFilters,
    }),
    [normalizedFilters, perPage, searchText, semantic],
  );
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const enabled = searchText.length > 0 || hasAdvancedFilters(normalizedFilters);
  const highlightTerms = useMemo(
    () => buildHighlightTerms(trimmed, tagTerms),
    [tagTerms, trimmed],
  );

  const searchQuery = useQuery({
    queryKey: ['lex-clause-library-search', searchParams],
    queryFn: () => enterpriseApi.lex.searchClauseLibrary(searchParams),
    enabled,
  });

  const results = searchQuery.data?.data ?? [];
  const resolvedFilterOptions = useMemo(
    () => buildFilterOptions(filterOptions, copy.optionLabels, taxonomy),
    [copy.optionLabels, filterOptions, taxonomy],
  );

  const updateFilter = (key: ClauseSearchFilterKey, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(clauseSearchFilterDefaults());
  };

  return (
    <SectionCard
      title={labels.title}
      description={labels.description}
      actions={
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={semantic} onCheckedChange={setSemantic} aria-label={labels.semanticLabel} />
          {labels.semanticLabel}
        </label>
      }
    >
      <div className="space-y-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={labels.placeholder}
          loading={enabled && searchQuery.isFetching}
        />

        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-controls="clause-search-advanced-filters"
              className="-m-1 h-auto gap-2 p-1 text-sm font-medium text-foreground hover:bg-transparent hover:text-primary"
            >
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span>{copy.advancedFilters}</span>
              {activeFilterCount > 0 ? (
                <Badge variant="secondary" className="tracking-normal normal-case">
                  {copy.activeFilters(activeFilterCount)}
                </Badge>
              ) : null}
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform duration-fast',
                  filtersOpen && 'rotate-180',
                )}
                aria-hidden
              />
            </Button>
            {activeFilterCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2.5"
                onClick={clearFilters}
              >
                {copy.clearFilters}
              </Button>
            ) : null}
          </div>

          {filtersOpen ? (
          <div
            id="clause-search-advanced-filters"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <ClauseSearchSelectFilter
              id="clause-search-clause-type"
              label={copy.filters.clause_type}
              value={filters.clause_type}
              allLabel={copy.allLabel}
              options={resolvedFilterOptions.clause_type}
              onChange={(value) => updateFilter('clause_type', value)}
            />
            <ClauseSearchTextFilter
              id="clause-search-category"
              label={copy.filters.category}
              value={filters.category}
              placeholder={copy.placeholders.category}
              options={resolvedFilterOptions.category}
              allLabel={copy.allLabel}
              onChange={(value) => updateFilter('category', value)}
            />
            <ClauseSearchTextFilter
              id="clause-search-jurisdiction"
              label={copy.filters.jurisdiction}
              value={filters.jurisdiction}
              placeholder={copy.placeholders.jurisdiction}
              options={resolvedFilterOptions.jurisdiction}
              allLabel={copy.allLabel}
              onChange={(value) => updateFilter('jurisdiction', value)}
            />
            <ClauseSearchSelectFilter
              id="clause-search-risk-level"
              label={copy.filters.risk_level}
              value={filters.risk_level}
              allLabel={copy.allLabel}
              options={resolvedFilterOptions.risk_level}
              onChange={(value) => updateFilter('risk_level', value)}
            />
            <ClauseSearchSelectFilter
              id="clause-search-language"
              label={copy.filters.language}
              value={filters.language}
              allLabel={copy.allLabel}
              options={resolvedFilterOptions.language}
              onChange={(value) => updateFilter('language', value)}
            />
            <ClauseSearchSelectFilter
              id="clause-search-status"
              label={copy.filters.status}
              value={filters.status}
              allLabel={copy.allLabel}
              options={resolvedFilterOptions.status}
              onChange={(value) => updateFilter('status', value)}
            />
            <ClauseSearchSelectFilter
              id="clause-search-governance-status"
              label={copy.filters.governance_status}
              value={filters.governance_status}
              allLabel={copy.allLabel}
              options={resolvedFilterOptions.governance_status}
              onChange={(value) => updateFilter('governance_status', value)}
            />
            <ClauseSearchTextFilter
              id="clause-search-tags"
              label={copy.filters.tags}
              value={filters.tags}
              placeholder={copy.placeholders.tags}
              onChange={(value) => updateFilter('tags', value)}
            />
          </div>
          ) : null}
        </div>

        {!enabled ? (
          <p className="text-sm text-muted-foreground">{labels.emptyPrompt}</p>
        ) : searchQuery.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {labels.loading}
          </p>
        ) : searchQuery.isError ? (
          <p className="text-sm text-destructive">
            {labels.errorTitle} {parseApiError(searchQuery.error)}
          </p>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.noResults}</p>
        ) : (
          <ul className="space-y-2">
            {results.map((result, index) => (
              <ClauseSearchResultRow
                key={result.item.id}
                rank={index + 1}
                result={result}
                onSelect={onSelect}
                matchedLabel={labels.matchedFields}
                scoreLabel={labels.scoreLabel}
                fallbackFieldLabel={copy.snippetFallbackField}
                fieldLabels={copy.snippetFields}
                highlightTerms={highlightTerms}
              />
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function scoreTier(score: number): { bar: string; ring: string; label: 'strong' | 'good' | 'weak' } {
  // 0..1 relevance → a tier that tints the bar + rank ring. Strong matches read
  // as brand/emerald, weaker ones cool down so the ranking is glanceable.
  if (score >= 0.75) {
    return { bar: 'bg-[hsl(var(--ds-success-500))]', ring: 'bg-success-500/12 text-success-700 dark:text-success-300', label: 'strong' };
  }
  if (score >= 0.45) {
    return { bar: 'bg-[hsl(var(--ds-brand-primary))]', ring: 'bg-[hsl(var(--ds-brand-primary)/0.12)] text-primary', label: 'good' };
  }
  return { bar: 'bg-[hsl(var(--ds-warning-500))]', ring: 'bg-warning-500/14 text-warning-700 dark:text-warning-300', label: 'weak' };
}

function ClauseSearchResultRow({
  rank,
  result,
  onSelect,
  matchedLabel,
  scoreLabel,
  fallbackFieldLabel,
  fieldLabels,
  highlightTerms,
}: {
  rank: number;
  result: LexClauseLibrarySearchResult;
  onSelect?: (entry: LexClauseLibraryEntry) => void;
  matchedLabel: string;
  scoreLabel: string;
  fallbackFieldLabel: string;
  fieldLabels: Partial<Record<string, string>>;
  highlightTerms: string[];
}) {
  const f = useLexFormat();
  const { item } = result;
  const snippets = getResultSnippets(result, fallbackFieldLabel);
  const pct = Math.max(0, Math.min(1, result.score));
  const tier = scoreTier(pct);
  const content = (
    <div className="flex w-full items-start gap-3">
      {/* Rank chip — relevance order at a glance, score-tier tinted. */}
      <span
        className={cn(
          'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums',
          tier.ring,
        )}
        aria-hidden
      >
        {f.formatNumber(rank)}
      </span>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.title_en}</p>
          {item.title_ar ? (
            <p className="truncate text-xs text-muted-foreground" dir="rtl">
              {item.title_ar}
            </p>
          ) : null}
          <div className="mt-2 space-y-1.5">
            {snippets.map((snippet) => (
              <p
                key={`${item.id}-${snippet.field}`}
                className="line-clamp-2 text-xs leading-5 text-muted-foreground"
                dir={isArabicField(snippet.field) ? 'rtl' : undefined}
              >
                <span className="font-medium text-foreground/80">
                  {fieldLabels[snippet.field] ?? snippet.fieldLabel ?? formatSnippetField(snippet.field)}
                </span>
                : <HighlightedSnippet text={snippet.text} terms={highlightTerms} />
              </p>
            ))}
          </div>
          {result.matched_fields.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {matchedLabel}:{' '}
              {result.matched_fields
                .map((field) => fieldLabels[field] ?? formatSnippetField(field))
                .join(', ')}
            </p>
          ) : null}
        </div>
        <div className="flex w-28 shrink-0 flex-col items-end gap-1.5">
          <Badge variant="outline">{item.code}</Badge>
          <span className="text-xs font-medium text-muted-foreground">
            {scoreLabel} {f.formatPercent(pct)}
          </span>
          {/* Relevance bar — RTL-safe via logical alignment of its container. */}
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70" aria-hidden>
            <span
              className={cn('block h-full rounded-full transition-[width] duration-normal ease-emphasized', tier.bar)}
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <li>
      {onSelect ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start whitespace-normal rounded-lg border border-border/70 bg-card/40 px-4 py-3 text-start transition-[box-shadow,background-color] duration-fast ease-standard hover:bg-card/70 hover:shadow-elevation-2"
          onClick={() => onSelect(item)}
        >
          {content}
        </Button>
      ) : (
        <div className="rounded-lg border border-border/70 bg-card/40 px-4 py-3">{content}</div>
      )}
    </li>
  );
}

function ClauseSearchSelectFilter({
  id,
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: ClauseSearchFilterOption[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value || ALL_FILTER_VALUE}
        onValueChange={(nextValue) => onChange(nextValue === ALL_FILTER_VALUE ? '' : nextValue)}
      >
        <SelectTrigger id={id} className="h-10 rounded-lg bg-card/80 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ClauseSearchTextFilter({
  id,
  label,
  value,
  placeholder,
  options,
  allLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  options?: ClauseSearchFilterOption[];
  allLabel?: string;
  onChange: (value: string) => void;
}) {
  if (options?.length) {
    return (
      <ClauseSearchSelectFilter
        id={id}
        label={label}
        value={value}
        options={options}
        allLabel={allLabel ?? 'All'}
        onChange={onChange}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg bg-card/80 text-xs"
      />
    </div>
  );
}

function HighlightedSnippet({ text, terms }: { text: string; terms: string[] }) {
  return <>{renderHighlightedSnippet(text, terms)}</>;
}

function clauseSearchFilterDefaults(initialFilters?: Partial<ClauseSearchFilters>): ClauseSearchFilterState {
  return {
    clause_type: initialFilters?.clause_type ?? '',
    category: initialFilters?.category ?? '',
    jurisdiction: initialFilters?.jurisdiction ?? '',
    risk_level: initialFilters?.risk_level ?? '',
    language: initialFilters?.language ?? '',
    status: initialFilters?.status ?? '',
    governance_status: initialFilters?.governance_status ?? '',
    tags: initialFilters?.tags?.join(', ') ?? '',
  };
}

function buildFilterOptions(
  overrides: ClauseSearchFilterOptions | undefined,
  languageLabels: Readonly<Record<'en' | 'ar' | 'bilingual', string>>,
  taxonomy: ClauseTaxonomyLabels,
): Record<ClauseSearchSelectFilterKey, ClauseSearchFilterOption[]> {
  return {
    clause_type:
      overrides?.clause_type ??
      CLAUSE_TYPE_OPTIONS.map((value) => ({ value, label: taxonomy.clauseType(value) })),
    category: overrides?.category ?? [],
    jurisdiction: overrides?.jurisdiction ?? [],
    risk_level:
      overrides?.risk_level ??
      RISK_LEVEL_OPTIONS.map((value) => ({ value, label: taxonomy.risk(value) })),
    language:
      overrides?.language ??
      LANGUAGE_OPTIONS.map((value) => ({
        value,
        label: languageLabels[value],
      })),
    status:
      overrides?.status ??
      CLAUSE_STATUS_OPTIONS.map((value) => ({ value, label: taxonomy.status(value) })),
    governance_status:
      overrides?.governance_status ??
      GOVERNANCE_STATUS_OPTIONS.map((value) => ({ value, label: taxonomy.status(value) })),
  };
}

function normalizeFilters(filters: ClauseSearchFilterState): Omit<
  LexClauseLibrarySearchParams,
  'q' | 'query' | 'page' | 'per_page' | 'semantic'
> {
  return {
    clause_type: normalizeOptionalFilter(filters.clause_type),
    category: normalizeOptionalFilter(filters.category),
    jurisdiction: normalizeOptionalFilter(filters.jurisdiction),
    risk_level: normalizeOptionalFilter(filters.risk_level),
    language: normalizeOptionalFilter(filters.language),
    status: normalizeOptionalFilter(filters.status),
    governance_status: normalizeOptionalFilter(filters.governance_status),
  };
}

function normalizeOptionalFilter(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function hasAdvancedFilters(filters: ReturnType<typeof normalizeFilters>): boolean {
  return Object.values(filters).some(Boolean);
}

function countActiveFilters(filters: ClauseSearchFilterState): number {
  return Object.entries(filters).reduce((count, [key, value]) => {
    if (key === 'tags') {
      return count + parseTagInput(value).length;
    }
    return count + (value.trim().length > 0 ? 1 : 0);
  }, 0);
}

function parseTagInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildSearchText(query: string, tags: string[]): string {
  return uniqueTerms([query, ...tags]).join(' ');
}

function buildHighlightTerms(query: string, tags: string[]): string[] {
  const queryTerms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  return uniqueTerms([query, ...queryTerms, ...tags]).sort((left, right) => right.length - left.length);
}

function uniqueTerms(values: string[]): string[] {
  const terms = new Map<string, string>();

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    terms.set(normalized.toLocaleLowerCase(), normalized);
  }

  return Array.from(terms.values());
}

function getResultSnippets(
  result: LexClauseLibrarySearchResult,
  fallbackFieldLabel: string,
): Array<{ field: string; fieldLabel?: string; text: string }> {
  const snippetEntries = Object.entries(result.snippets ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .slice(0, 3)
    .map(([field, text]) => ({ field, text }));

  if (snippetEntries.length > 0) {
    return snippetEntries;
  }

  return [
    {
      field: 'text_en',
      fieldLabel: fallbackFieldLabel,
      text: result.item.text_en,
    },
  ];
}

function renderHighlightedSnippet(text: string, terms: string[]): ReactNode[] {
  if (hasSnippetMarkup(text)) {
    return renderSnippetMarkup(text, terms);
  }

  return renderPlainHighlight(hasHtmlMarkup(text) ? stripHtmlTags(text) : text, terms);
}

function hasSnippetMarkup(text: string): boolean {
  return /<\/?(?:mark|em|strong|b)(?:\s[^>]*)?>/i.test(text);
}

function hasHtmlMarkup(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text);
}

function renderSnippetMarkup(text: string, terms: string[]): ReactNode[] {
  const parts = text.split(/(<\/?(?:mark|em|strong|b)(?:\s[^>]*)?>)/gi);
  const nodes: ReactNode[] = [];
  let highlightDepth = 0;

  parts.forEach((part, index) => {
    const tag = part.toLocaleLowerCase();

    if (/^<(?:mark|em|strong|b)(?:\s[^>]*)?>$/.test(tag)) {
      highlightDepth += 1;
      return;
    }

    if (/^<\/(?:mark|em|strong|b)>$/.test(tag)) {
      highlightDepth = Math.max(0, highlightDepth - 1);
      return;
    }

    const safeText = stripHtmlTags(part);
    if (!safeText) return;

    if (highlightDepth > 0) {
      nodes.push(
        <mark key={`marked-${index}`} className="rounded bg-warning-100/80 px-0.5 text-foreground">
          {safeText}
        </mark>,
      );
      return;
    }

    nodes.push(...renderPlainHighlight(safeText, terms, `plain-${index}`));
  });

  return nodes;
}

function renderPlainHighlight(text: string, terms: string[], keyPrefix = 'term'): ReactNode[] {
  const normalizedTerms = terms
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  if (normalizedTerms.length === 0) {
    return [text];
  }

  const expression = new RegExp(`(${normalizedTerms.map(escapeRegExp).join('|')})`, 'gi');
  return text.split(expression).filter(Boolean).map((part, index) => {
    const isMatch = normalizedTerms.some(
      (term) => part.toLocaleLowerCase() === term.toLocaleLowerCase(),
    );

    if (!isMatch) {
      return part;
    }

    return (
      <mark key={`${keyPrefix}-${index}`} className="rounded bg-warning-100/80 px-0.5 text-foreground">
        {part}
      </mark>
    );
  });
}

function stripHtmlTags(value: string): string {
  return value.replace(/<\/?[^>]+>/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatSnippetField(field: string): string {
  return formatToken(field);
}

function formatToken(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function isArabicField(field: string): boolean {
  return field.endsWith('_ar') || field === 'arabic';
}
