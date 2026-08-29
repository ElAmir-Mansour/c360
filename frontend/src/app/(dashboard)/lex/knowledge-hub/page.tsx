'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  FileText,
  Files,
  GraduationCap,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { enterpriseApi } from '@/lib/enterprise';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { useKnowledgeHubCopy } from './_components/knowledge-hub-copy';

const LIST_PARAMS = {
  page: 1,
  per_page: 6,
  sort: 'updated_at',
  order: 'desc' as const,
};

export default function KnowledgeHubPage() {
  const router = useRouter();
  const { locale, direction } = useLocaleOrDefault();
  const copy = useKnowledgeHubCopy();
  const [search, setSearch] = useState('');

  const clauses = useQuery({
    queryKey: ['knowledge-hub', 'clauses'],
    queryFn: () => enterpriseApi.lex.listClauseLibrary(LIST_PARAMS),
  });
  const playbooks = useQuery({
    queryKey: ['knowledge-hub', 'playbooks'],
    queryFn: () => enterpriseApi.lex.listPlaybooks(LIST_PARAMS),
  });
  const regulations = useQuery({
    queryKey: ['knowledge-hub', 'regulations'],
    queryFn: () => enterpriseApi.lex.listRegulations(LIST_PARAMS),
  });
  const references = useQuery({
    queryKey: ['knowledge-hub', 'references'],
    queryFn: () => enterpriseApi.lex.referenceLibrary.list(LIST_PARAMS),
  });

  const categories = [
    {
      key: 'clauses',
      icon: FileText,
      copy: copy.categories.clauses,
      href: '/lex/clause-library',
      count: clauses.data?.meta.total,
    },
    {
      key: 'playbooks',
      icon: BookOpen,
      copy: copy.categories.playbooks,
      href: '/lex/playbooks',
      count: playbooks.data?.meta.total,
    },
    {
      key: 'templates',
      icon: Files,
      copy: copy.categories.templates,
      href: '/lex/documents',
    },
    {
      key: 'policies',
      icon: ShieldCheck,
      copy: copy.categories.policies,
      href: '/lex/policies',
      count: regulations.data?.meta.total,
    },
    {
      key: 'precedents',
      icon: BriefcaseBusiness,
      copy: copy.categories.precedents,
      href: '/lex/library?category=judicial-journal',
      count: references.data?.meta.total,
    },
    {
      key: 'learning',
      icon: GraduationCap,
      copy: copy.categories.learning,
      href: '/lex/learning-centre',
      count: 3,
    },
  ];

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    router.push(
      value
        ? `/lex/library?search=${encodeURIComponent(value)}`
        : '/lex/library',
    );
  }

  return (
    <LexRouteGuard route="/lex/knowledge-hub">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          title={copy.breadcrumb}
          description={copy.description}
        />

        <section className="rounded-2xl bg-clario-dark-teal px-6 py-10 text-center text-white md:px-12">
          <h2 className="text-2xl font-bold md:text-3xl">{copy.title}</h2>
          <p className="mx-auto mt-2 max-w-3xl text-sm leading-6 text-white/70">
            {copy.description}
          </p>
          <form
            onSubmit={submitSearch}
            className="mx-auto mt-7 flex max-w-2xl flex-col gap-2 rounded-xl bg-white p-2 shadow-lg sm:flex-row"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="border-0 ps-10 shadow-none focus-visible:ring-0"
                aria-label={copy.searchPlaceholder}
              />
            </div>
            <Button
              type="submit"
              className="bg-brand-primary-600 text-white hover:bg-brand-primary-700"
            >
              {copy.find}
            </Button>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((category) => (
            <KnowledgeCategoryCard
              key={category.key}
              icon={category.icon}
              title={category.copy[0]}
              metric={
                category.count === undefined
                  ? category.copy[1]
                  : `${category.count} · ${category.copy[1]}`
              }
              description={category.copy[2]}
              href={category.href}
              rtl={direction === 'rtl'}
            />
          ))}
        </section>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>{copy.recent}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.recentDescription}
              </p>
            </div>
            <Button variant="link" asChild>
              <Link href="/lex/library">{copy.viewAll}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {references.isError ? (
              <ErrorState
                error={references.error}
                onRetry={() => void references.refetch()}
                className="min-h-48 rounded-xl border border-dashed border-border px-6"
              />
            ) : references.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((item) => (
                  <Skeleton key={item} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : references.data?.data.length ? (
              <div className="divide-y divide-border rounded-xl border border-border">
                {references.data.data.slice(0, 4).map((document) => {
                  const title = resolveLocalized(
                    { en: document.title_en, ar: document.title_ar },
                    locale,
                  );
                  return (
                    <div
                      key={document.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold" dir="auto">
                          {title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {document.doc_type} · {document.authority || '—'}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/lex/library/${document.id}`}>
                          {copy.openResource}
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {copy.emptyRecent}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" aria-hidden />
                {copy.recommended}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {copy.recommendedDescription}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {copy.recommendations.map(
                ([title, description, href, action]) => (
                  <div
                    key={href}
                    className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4"
                  >
                    <p className="font-semibold">{title}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {description}
                    </p>
                    <Button variant="link" className="mt-1 h-auto px-0" asChild>
                      <Link href={href}>
                        {action}
                        <ArrowRight
                          className={cn(
                            'ms-1 h-4 w-4',
                            direction === 'rtl' && 'rotate-180',
                          )}
                          aria-hidden
                        />
                      </Link>
                    </Button>
                  </div>
                ),
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{copy.mostUsed}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {copy.mostUsedDescription}
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {categories.slice(0, 5).map((category, index) => (
                <Link
                  key={category.key}
                  href={category.href}
                  className="flex items-center gap-3 rounded-lg border-b border-border/70 px-2 py-3 transition-colors last:border-0 hover:bg-muted/40"
                >
                  <span className="w-6 font-mono text-sm font-semibold text-primary">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {category.copy[0]}
                  </span>
                  <category.icon
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </LexRouteGuard>
  );
}

function KnowledgeCategoryCard({
  icon: Icon,
  title,
  metric,
  description,
  href,
  rtl,
}: {
  icon: LucideIcon;
  title: string;
  metric: string;
  description: string;
  href: string;
  rtl: boolean;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="rounded-full bg-info-50 px-2.5 py-1 text-xs font-semibold text-info-700 dark:bg-info-700/15 dark:text-info-300">
          {metric}
        </span>
      </div>
      <h2 className="mt-4 font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <ArrowRight
        className={cn(
          'mt-4 h-4 w-4 text-primary transition-transform group-hover:translate-x-1',
          rtl && 'rotate-180 group-hover:-translate-x-1',
        )}
        aria-hidden
      />
    </Link>
  );
}
