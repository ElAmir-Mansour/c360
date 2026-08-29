'use client';

import { Library, Scale, Gavel, GraduationCap, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { LexReferenceLibraryFacets } from '@/types/suites';
import { useLibraryLabels } from '../_lib/library-labels';

/** Canonical corpus order + icon per bucket for the quick-filter tree. */
const CATEGORY_ORDER: Array<{ key: string; icon: LucideIcon }> = [
  { key: 'systems-regulations', icon: Scale },
  { key: 'judicial-journal', icon: Gavel },
  { key: 'research', icon: GraduationCap },
];

/** How many topic chips to surface before truncating. */
const MAX_TOPICS = 12;

interface LibraryFacetTreeProps {
  facets?: LexReferenceLibraryFacets;
  loading?: boolean;
  activeCategory?: string;
  activeDocType?: string;
  activeTag?: string;
  totalCount: number;
  onSelectCategory: (category: string | undefined) => void;
  onSelectDocType: (docType: string | undefined) => void;
  onSelectTag: (tag: string | undefined) => void;
}

/**
 * Corpus quick-filter tree for the reference library: the three corpus classes
 * (with counts) as the primary browse axis, the finer document types, and the
 * top topics as chips. Selecting a facet drives the `category` / `doc_type` /
 * `tag` list filters (toggle to clear). Every label is localized bilingually.
 */
export function LibraryFacetTree({
  facets,
  loading = false,
  activeCategory,
  activeDocType,
  activeTag,
  totalCount,
  onSelectCategory,
  onSelectDocType,
  onSelectTag,
}: LibraryFacetTreeProps) {
  const labels = useLibraryLabels();
  const f = useLexFormat();

  const categoryCount = (key: string): number =>
    facets?.categories.find((c) => c.key === key)?.count ?? 0;
  const docTypes = facets?.doc_types ?? [];
  const topics = (facets?.tags ?? []).slice(0, MAX_TOPICS);

  if (loading) {
    return (
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {labels.facets.categories}
        </p>
        <div className="space-y-1">
          <FacetRow
            icon={Library}
            label={labels.facets.all}
            count={totalCount}
            active={!activeCategory}
            onClick={() => onSelectCategory(undefined)}
          />
          {CATEGORY_ORDER.map(({ key, icon }) => (
            <FacetRow
              key={key}
              icon={icon}
              label={labels.category[key] ?? key}
              count={categoryCount(key)}
              active={activeCategory === key}
              onClick={() =>
                onSelectCategory(activeCategory === key ? undefined : key)
              }
            />
          ))}
        </div>
      </div>

      {docTypes.length > 0 ? (
        <div>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.facets.docTypes}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {docTypes.map((dt) => {
              const active = activeDocType === dt.key;
              return (
                <button
                  key={dt.key}
                  type="button"
                  dir="auto"
                  aria-pressed={active}
                  onClick={() =>
                    onSelectDocType(active ? undefined : dt.key)
                  }
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border/80 bg-card/60 text-foreground hover:border-primary/20 hover:bg-primary/5',
                  )}
                >
                  <span>{labels.docType[dt.key] ?? dt.key}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {f.formatNumber(dt.count)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {topics.length > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Tag className="h-3 w-3" aria-hidden />
            {labels.facets.topics}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topics.map((topic) => {
              const active = activeTag === topic.key;
              return (
                <button
                  key={topic.key}
                  type="button"
                  dir="auto"
                  aria-pressed={active}
                  onClick={() => onSelectTag(active ? undefined : topic.key)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border/60 bg-muted/40 text-muted-foreground hover:border-primary/20 hover:text-foreground',
                  )}
                >
                  <span dir="auto">{topic.key}</span>
                  <span className="tabular-nums opacity-70">
                    {f.formatNumber(topic.count)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FacetRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const f = useLexFormat();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-foreground hover:bg-muted/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {f.formatNumber(count)}
      </span>
    </button>
  );
}
