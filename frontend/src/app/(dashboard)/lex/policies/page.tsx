'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { SearchInput } from '@/components/shared/forms/search-input';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import type { FetchParams } from '@/types/table';
import type { LexRegulation } from '@/types/suites';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { usePolicyHubCopy } from './_components/policy-copy';

export default function PolicyHubPage() {
  const { locale, direction } = useLocaleOrDefault();
  const copy = usePolicyHubCopy();
  const {
    data,
    tableProps,
    searchValue,
    setSearch,
    activeFilters,
    setFilter,
  } = useDataTable<LexRegulation>({
    queryKey: 'lex-policy-hub',
    fetchFn: (params: FetchParams) =>
      enterpriseApi.lex.listRegulations(params),
    defaultPageSize: 12,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  const currentType = Array.isArray(activeFilters.regulation_type)
    ? activeFilters.regulation_type[0]
    : activeFilters.regulation_type;
  const types = useMemo(
    () =>
      Array.from(
        new Set(
          data
            .map((item) => item.regulation_type?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).slice(0, 5),
    [data],
  );
  const pageCount = Math.max(
    1,
    Math.ceil(tableProps.totalRows / tableProps.pageSize),
  );

  return (
    <LexRouteGuard route="/lex/policies">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader title={copy.title} description={copy.description} />

        <Card className="overflow-hidden">
          <div className="border-b border-border bg-clario-dark-teal px-6 py-5 text-white">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-xl font-bold">{copy.title}</h2>
                <p className="mt-1 text-sm text-white/70">
                  {copy.description}
                </p>
              </div>
            </div>
          </div>
          <CardContent className="p-0">
            <div className="grid min-h-[520px] md:grid-cols-[190px_minmax(0,1fr)]">
              <aside className="border-b border-border bg-muted/25 p-3 md:border-b-0 md:border-e">
                <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-1">
                  <PolicyTypeButton
                    active={!currentType}
                    label={copy.all}
                    onClick={() => setFilter('regulation_type', undefined)}
                  />
                  {types.map((type) => (
                    <PolicyTypeButton
                      key={type}
                      active={currentType === type}
                      label={type}
                      onClick={() => setFilter('regulation_type', type)}
                    />
                  ))}
                </nav>
              </aside>

              <div className="space-y-4 p-4 md:p-6">
                <SearchInput
                  value={searchValue}
                  onChange={setSearch}
                  placeholder={copy.search}
                  loading={tableProps.isLoading}
                />

                {tableProps.error ? (
                  <ErrorState
                    error={tableProps.error}
                    onRetry={tableProps.onRetry}
                    className="min-h-72 rounded-xl border border-dashed border-border px-6"
                  />
                ) : tableProps.isLoading ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {[0, 1, 2, 3, 4, 5].map((item) => (
                      <Skeleton key={item} className="h-44 rounded-xl" />
                    ))}
                  </div>
                ) : data.length === 0 ? (
                  <div className="grid min-h-72 place-items-center rounded-xl border border-dashed p-8 text-center">
                    <div>
                      <ShieldCheck
                        className="mx-auto h-9 w-9 text-muted-foreground"
                        aria-hidden
                      />
                      <h2 className="mt-3 font-semibold">{copy.emptyTitle}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {copy.emptyDescription}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {data.map((regulation) => (
                      <PolicyCard
                        key={regulation.id}
                        regulation={regulation}
                        locale={locale}
                        copy={copy}
                      />
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {copy.page(tableProps.page, pageCount)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        tableProps.onPageChange(
                          Math.max(1, tableProps.page - 1),
                        )
                      }
                      disabled={tableProps.page <= 1}
                    >
                      <ChevronLeft
                        className={cn(
                          'me-1 h-4 w-4',
                          direction === 'rtl' && 'rotate-180',
                        )}
                        aria-hidden
                      />
                      {copy.previous}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        tableProps.onPageChange(
                          Math.min(pageCount, tableProps.page + 1),
                        )
                      }
                      disabled={tableProps.page >= pageCount}
                    >
                      {copy.next}
                      <ChevronRight
                        className={cn(
                          'ms-1 h-4 w-4',
                          direction === 'rtl' && 'rotate-180',
                        )}
                        aria-hidden
                      />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </LexRouteGuard>
  );
}

function PolicyTypeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-start',
        active && 'bg-primary/10 text-primary hover:bg-primary/15',
      )}
      onClick={onClick}
    >
      <BookOpen className="me-2 h-4 w-4 shrink-0" aria-hidden />
      {label}
    </Button>
  );
}

function PolicyCard({
  regulation,
  locale,
  copy,
}: {
  regulation: LexRegulation;
  locale: 'en' | 'ar';
  copy: ReturnType<typeof usePolicyHubCopy>;
}) {
  const title = resolveLocalized(
    { en: regulation.title_en, ar: regulation.title_ar },
    locale,
  );
  const description = resolveLocalized(
    {
      en: regulation.description_en,
      ar: regulation.description_ar,
    },
    locale,
  );
  const status = regulation.status.toLowerCase();

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold" dir="auto">
            {title || regulation.code}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {regulation.code} · {regulation.regulation_type}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            status === 'active' &&
              'border-success-300 bg-success-50 text-success-700',
            (status === 'pending' || status === 'draft') &&
              'border-warning-300 bg-warning-50 text-warning-700',
          )}
        >
          {copy.status[status] ?? regulation.status}
        </Badge>
      </div>
      {description ? (
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-4 text-xs">
        <div>
          <dt className="flex items-center gap-1 text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" aria-hidden />
            {copy.authority}
          </dt>
          <dd className="mt-1 truncate font-medium" dir="auto">
            {regulation.authority || '—'}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {copy.jurisdiction}
          </dt>
          <dd className="mt-1 truncate font-medium" dir="auto">
            {regulation.jurisdiction || '—'}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {copy.version} {regulation.version}
        </span>
        <Button variant="link" className="h-auto px-0" asChild>
          <Link
            href={`/lex/regulations?search=${encodeURIComponent(
              regulation.code,
            )}`}
          >
            {copy.open}
          </Link>
        </Button>
      </div>
    </article>
  );
}
