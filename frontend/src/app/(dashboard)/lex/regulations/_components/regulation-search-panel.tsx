'use client';

import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { SearchInput } from '@/components/shared/forms/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useRegulationAuthorityLabel } from '../../contracts/_lib/contracts-labels';
import type { LexRegulation, LexRegulationSearchResult } from '@/types/suites';
import { useRegulationLabels } from './regulation-content-labels';

export interface RegulationSearchPanelProps {
  onSelect?: (regulation: LexRegulation) => void;
}

export function RegulationSearchPanel({ onSelect }: RegulationSearchPanelProps) {
  const labels = useRegulationLabels().search;
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const trimmed = query.trim();
  const enabled = trimmed.length > 0;

  const searchQuery = useQuery({
    queryKey: ['lex-regulations-search', trimmed, semantic],
    queryFn: () => enterpriseApi.lex.searchRegulations({ q: trimmed, semantic, page: 1, per_page: 10 }),
    enabled,
  });

  const results = searchQuery.data?.data ?? [];
  const highlightTerms = useMemo(() => buildHighlightTerms(trimmed), [trimmed]);

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
            {results.map((result) => (
              <RegulationSearchResultRow
                key={result.item.id}
                result={result}
                onSelect={onSelect}
                matchedLabel={labels.matchedFields}
                matchedFieldNames={labels.matchedFieldNames}
                scoreLabel={labels.scoreLabel}
                highlightTerms={highlightTerms}
              />
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

function RegulationSearchResultRow({
  result,
  onSelect,
  matchedLabel,
  matchedFieldNames,
  scoreLabel,
  highlightTerms,
}: {
  result: LexRegulationSearchResult;
  onSelect?: (regulation: LexRegulation) => void;
  matchedLabel: string;
  matchedFieldNames: Record<string, string>;
  scoreLabel: string;
  highlightTerms: string[];
}) {
  const { item } = result;
  const { locale } = useLocaleOrDefault();
  const authorityLabel = useRegulationAuthorityLabel();
  const primaryTitle = resolveLocalized({ en: item.title_en, ar: item.title_ar }, locale);
  const secondaryTitle = locale === 'ar' ? item.title_en : item.title_ar;
  const summary = resolveLocalized({ en: item.description_en, ar: item.description_ar }, locale);
  const content = (
    <div className="flex w-full items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" dir="auto">{primaryTitle || item.code}</p>
        {secondaryTitle ? (
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {secondaryTitle}
          </p>
        ) : null}
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" dir="auto">
          {highlight(summary || (item.authority ? authorityLabel(item.authority) : '') || item.code, highlightTerms)}
        </p>
        {result.matched_fields.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {matchedLabel}:{' '}
            {result.matched_fields
              .map((field) => matchedFieldNames[field] ?? field.replace(/_/g, ' '))
              .join(', ')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant="outline">{item.code}</Badge>
        <span className="text-xs text-muted-foreground">
          {scoreLabel} {(result.score * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );

  return (
    <li>
      {onSelect ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start whitespace-normal rounded-lg border border-border/70 px-4 py-3 text-start"
          onClick={() => onSelect(item)}
        >
          <Search className="me-2 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          {content}
        </Button>
      ) : (
        <div className="rounded-lg border border-border/70 px-4 py-3">{content}</div>
      )}
    </li>
  );
}

/**
 * Splits a raw query into distinct, length-sorted terms for highlighting. Terms
 * shorter than two characters are dropped to avoid noisy single-letter matches,
 * and each term is regex-escaped before use.
 */
function buildHighlightTerms(query: string): string[] {
  const unique = new Set(
    query
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  );
  return Array.from(unique).sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wraps occurrences of any highlight term in a subtle <mark>. Matching is
 * case-insensitive and works for both Latin and Arabic script since it operates
 * on raw substrings rather than word boundaries.
 */
function highlight(text: string, terms: string[]): ReactNode {
  if (!text || terms.length === 0) {
    return text;
  }
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length === 1) {
    return text;
  }
  const lowered = terms.map((term) => term.toLowerCase());
  return parts.map((part, index) =>
    part && lowered.includes(part.toLowerCase()) ? (
      <mark key={index} className="rounded-[2px] bg-primary/15 text-foreground">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
