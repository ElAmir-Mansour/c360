'use client';

/**
 * CatalogGallery (Feature 8) — the "Add integration" entry point.
 *
 * Replaces the bare kind dropdown with a browsable gallery driven by
 * GET /integrations/catalog. When the live catalog is unavailable, it falls back
 * to the static {@link INTEGRATION_KIND_LIST} and shows an unavailable warning.
 * Each card shows the connector icon, bilingual name + blurb, a MATURITY badge
 * (production vs gov-gated), a self-serve flag, KSA context tags, and a
 * prerequisite count.
 *
 * Selecting a card calls `onPick(kind)` — the new-integration page hands that to
 * the SetupWizard (or navigates to `?kind=`). A search box + maturity filter keep
 * the catalog navigable as it grows.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Landmark, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { getCatalogResult, type IntegrationKind } from '@/lib/lex/integrations';
import {
  buildCatalogCards,
  type CatalogCardModel,
} from '../_lib/integration-kinds';
import { useIntegrationLabels, fillToken } from '../_lib/use-integration-labels';

type Labels = ReturnType<typeof useIntegrationLabels>;
type Filter = 'all' | 'self_serve' | 'gov_gated';

interface CatalogGalleryProps {
  /** Invoked with the chosen connector kind when a card is selected. */
  onPick: (kind: IntegrationKind) => void;
}

export function CatalogGallery({ onPick }: CatalogGalleryProps) {
  const t = useIntegrationLabels();
  const { locale, direction } = useLocaleOrDefault();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const catalogQuery = useQuery({
    queryKey: ['lex-integration-catalog'],
    queryFn: () => getCatalogResult(),
    staleTime: 5 * 60_000,
  });

  // The live catalog is additive metadata; buildCatalogCards always yields the
  // full static set folded with whatever the catalog supplied.
  const catalogEntries = catalogQuery.data?.entries ?? [];
  const degraded = catalogQuery.isError || (catalogQuery.data?.degraded ?? false);
  const cards = useMemo(
    () => buildCatalogCards(catalogEntries),
    [catalogEntries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter === 'self_serve' && !c.selfServe) return false;
      if (filter === 'gov_gated' && c.maturity !== 'gov_gated') return false;
      if (!q) return true;
      const haystack = [
        resolveLocalized(c.name, locale),
        resolveLocalized(c.name, locale === 'ar' ? 'en' : 'ar'),
        resolveLocalized(c.blurb, locale),
        c.kind,
        ...c.ksaTags,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [cards, filter, query, locale]);

  if (catalogQuery.isLoading) {
    return (
      <div className="space-y-4" dir={direction} lang={locale}>
        <LoadingSkeleton variant="card" count={6} />
      </div>
    );
  }

  // Hard error only when we genuinely could not build any cards (defensive; the
  // static fallback normally prevents this).
  if (catalogQuery.isError && cards.length === 0) {
    return (
      <ErrorState
        variant="generic"
        title={t.catalogErrorTitle}
        message={t.catalogErrorBody}
        onRetry={() => void catalogQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4" dir={direction} lang={locale}>
      {degraded ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-300/60 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-800/15 dark:text-warning-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium">{t.catalogErrorTitle}</p>
            <p className="text-xs">{t.catalogErrorBody}</p>
          </div>
        </div>
      ) : null}

      {/* Search + maturity filter. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.catalogSearchPlaceholder}
            className="ltr:pl-9 rtl:pr-9"
            aria-label={t.catalogSearchPlaceholder}
          />
        </div>
        <div className="flex overflow-hidden rounded-md border" role="tablist">
          {(
            [
              ['all', t.catalogFilterAll],
              ['self_serve', t.catalogFilterSelfServe],
              ['gov_gated', t.catalogFilterGovGated],
            ] as const
          ).map(([key, label], i) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                i > 0 && 'border-s',
                filter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t.catalogEmptyTitle}
          description={t.catalogEmptyBody}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((card) => (
            <CatalogCard key={card.kind} card={card} t={t} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * One connector card.
 * --------------------------------------------------------------------------- */

interface CatalogCardProps {
  card: CatalogCardModel;
  t: Labels;
  onPick: (kind: IntegrationKind) => void;
}

function CatalogCard({ card, t, onPick }: CatalogCardProps) {
  const { locale } = useLocaleOrDefault();
  const Icon = card.icon;
  const govGated = card.maturity === 'gov_gated';

  return (
    <button
      type="button"
      onClick={() => onPick(card.kind)}
      className="card group flex h-full flex-col gap-3 p-4 text-start transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted">
          <Icon className={cn('h-5 w-5', card.accent)} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate font-medium">{resolveLocalized(card.name, locale)}</p>
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            {resolveLocalized(card.blurb, locale)}
          </p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden />
      </div>

      {/* Badges row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-medium',
            govGated
              ? 'border-warning-300 bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300'
              : 'border-primary/30 bg-primary/10 text-primary',
          )}
          title={govGated ? t.govGatedHint : undefined}
        >
          {govGated ? (
            <Landmark className="h-3 w-3" aria-hidden />
          ) : (
            <ShieldCheck className="h-3 w-3" aria-hidden />
          )}
          {govGated ? t.catalogMaturityGovGated : t.catalogMaturityProduction}
        </span>

        {card.selfServe ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-info-300 bg-info-50 px-2 py-0.5 text-caption font-medium text-info-700 dark:bg-info-700/15 dark:text-info-300"
            title={t.catalogSelfServeHint}
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            {t.catalogSelfServeBadge}
          </span>
        ) : null}

        {card.prerequisites.length > 0 ? (
          <span className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-caption font-medium text-muted-foreground">
            {fillToken(t.catalogPrereqCount, 'n', card.prerequisites.length)}
          </span>
        ) : null}
      </div>

      {/* KSA context tags. */}
      {card.ksaTags.length > 0 ? (
        <div className="flex flex-wrap gap-1" dir="ltr">
          {card.ksaTags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-px text-overline font-medium uppercase text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}

export default CatalogGallery;
