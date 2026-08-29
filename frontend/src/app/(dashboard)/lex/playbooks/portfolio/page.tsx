'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  ChevronLeft,
  ChevronRight,
  Gauge,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexListSkeleton } from '@/components/lex/list-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexPlaybookPortfolioParams } from '@/types/suites';
import { clampPercent } from '../_components/deviation-meta';
import { usePlaybookLabels } from '../_components/labels';
import { formatToken, CONTRACT_TYPES } from '../_components/playbook-form';
import { PortfolioRow } from '../_components/portfolio-row';

const PER_PAGE = 25;

/** Sentinel for "any contract type" — radix Select disallows an empty value. */
const ANY_TYPE = '__any__';
/** Sentinel for "no threshold" max-score preset. */
const ANY_SCORE = '__any__';

/** Below-X% compliance presets surfaced as a simple max-score control. */
const THRESHOLD_PRESETS = [60, 80, 100] as const;

type Order = 'asc' | 'desc';
type ScoreScope = 'at-risk' | 'healthy';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function LexPlaybookPortfolioPage() {
  const { locale, direction } = useLocale();
  const labels = usePlaybookLabels();
  const f = useLexFormat();

  const [contractType, setContractType] = useState<string>(ANY_TYPE);
  const [maxScore, setMaxScore] = useState<string>(ANY_SCORE);
  // Default to worst-compliance first (the manager triage default).
  const [order, setOrder] = useState<Order>('asc');
  const [page, setPage] = useState(1);
  const [scoreScope, setScoreScope] = useState<ScoreScope | null>(null);

  const params = useMemo<LexPlaybookPortfolioParams>(() => {
    const next: LexPlaybookPortfolioParams = {
      order,
      page,
      per_page: PER_PAGE,
    };
    if (contractType !== ANY_TYPE) {
      next.contract_type = contractType;
    }
    if (maxScore !== ANY_SCORE) {
      const parsed = Number.parseInt(maxScore, 10);
      if (Number.isFinite(parsed)) {
        next.max_score = parsed;
      }
    }
    return next;
  }, [contractType, maxScore, order, page]);

  const portfolioQuery = useQuery({
    queryKey: ['lex-playbook-portfolio', params],
    queryFn: () => enterpriseApi.lex.getPlaybookPortfolio(params),
    placeholderData: keepPreviousData,
  });

  const result = portfolioQuery.data;
  const rows = Array.isArray(result?.data) ? result.data : [];
  const total = result?.total ?? 0;
  const perPage = result?.per_page ?? PER_PAGE;
  const currentPage = result?.page ?? page;
  const truncated = result?.truncated ?? false;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, perPage)));

  // Reset to the first page whenever a filter changes.
  const resetPage = () => setPage(1);

  const handleContractType = (value: string) => {
    setContractType(value);
    resetPage();
  };
  const handleMaxScore = (value: string) => {
    setMaxScore(value);
    resetPage();
  };
  const toggleOrder = () => {
    setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    resetPage();
  };

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
  const rangeEnd = Math.min(total, currentPage * perPage);

  // KPI strip computed from the current page of scored contracts. `total` is the
  // authoritative scored count for the active filters; avg / at-risk / healthy
  // are derived from the visible page (the worst-first default surfaces the most
  // at-risk agreements on page 1).
  const pageScores = rows.map((row) => clampPercent(row.compliance_score));
  const avgScore =
    pageScores.length > 0 ? Math.round(pageScores.reduce((sum, value) => sum + value, 0) / pageScores.length) : null;
  const atRiskCount = pageScores.filter((value) => value < 60).length;
  const healthyCount = pageScores.filter((value) => value >= 85).length;
  const atRiskShare = percent(atRiskCount, pageScores.length);
  const healthyShare = percent(healthyCount, pageScores.length);
  const scopedRows = useMemo(() => {
    if (scoreScope === 'at-risk') {
      return rows.filter((row) => clampPercent(row.compliance_score) < 60);
    }
    if (scoreScope === 'healthy') {
      return rows.filter((row) => clampPercent(row.compliance_score) >= 85);
    }
    return rows;
  }, [rows, scoreScope]);
  const revealScoreScope = (scope: ScoreScope | null) => {
    setScoreScope(scope);
    window.requestAnimationFrame(() => {
      document.getElementById('playbook-portfolio-records')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };
  const visibleLabel = labels.catalog.showing(total === 0 ? 0 : rangeEnd - rangeStart + 1, total);
  const avgTheme = avgScore == null ? 'sky' : avgScore < 60 ? 'red' : avgScore < 85 ? 'amber' : 'emerald';

  const kpiItems: LexKpiItem[] = [
    {
      id: 'scored',
      label: labels.portfolio.scored,
      value: total,
      icon: ListChecks,
      theme: 'primary',
      loading: portfolioQuery.isLoading,
      description: labels.portfolio.description,
      detail: visibleLabel,
      detailValue: labels.portfolio.scored,
      onAction: () => revealScoreScope(null),
    },
    {
      id: 'avg',
      label: labels.portfolio.avgScore,
      value: avgScore == null ? '—' : avgScore,
      unit: avgScore == null ? undefined : '%',
      icon: Gauge,
      theme: avgTheme,
      loading: portfolioQuery.isLoading,
      description: labels.portfolio.avgScore,
      progress: avgScore ?? undefined,
      progressLabel: labels.portfolio.scored,
      detail: visibleLabel,
      detailValue: avgScore == null ? '—' : `${avgScore}%`,
      onAction: () => revealScoreScope(null),
    },
    {
      id: 'at-risk',
      label: labels.portfolio.atRisk,
      value: atRiskCount,
      icon: ShieldAlert,
      theme: atRiskCount > 0 ? 'red' : 'green',
      loading: portfolioQuery.isLoading,
      description: labels.portfolio.atRisk,
      progress: atRiskShare,
      progressLabel: labels.portfolio.scored,
      detail: visibleLabel,
      detailValue: `${atRiskShare}%`,
      onAction: () => revealScoreScope('at-risk'),
      pressed: scoreScope === 'at-risk',
    },
    {
      id: 'healthy',
      label: labels.portfolio.healthy,
      value: healthyCount,
      icon: ShieldCheck,
      theme: 'emerald',
      loading: portfolioQuery.isLoading,
      description: labels.portfolio.healthy,
      progress: healthyShare,
      progressLabel: labels.portfolio.scored,
      detail: visibleLabel,
      detailValue: `${healthyShare}%`,
      onAction: () => revealScoreScope('healthy'),
      pressed: scoreScope === 'healthy',
    },
  ];

  return (
    <LexRouteGuard route="/lex/playbooks">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={null}
          title={labels.portfolio.title}
          description={labels.portfolio.description}
          actions={
            <Button asChild variant="outline">
              <Link href="/lex/playbooks">
                <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
                {labels.page.title}
              </Link>
            </Button>
          }
        />

        <LexKpiStrip items={kpiItems} columns={4} />

        <SectionCard
          title={labels.catalog.viewPortfolio}
          description={labels.portfolio.description}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* Contract-type filter. */}
              <Select value={contractType} onValueChange={handleContractType}>
                <SelectTrigger className="h-9 w-[180px]" aria-label={labels.catalog.filterContractType}>
                  <SelectValue placeholder={labels.catalog.filterContractType} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_TYPE}>{labels.catalog.allTypes}</SelectItem>
                  {CONTRACT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {labels.contractTypeLabels[type] ?? formatToken(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* "Below X%" compliance threshold → max_score. */}
              <Select value={maxScore} onValueChange={handleMaxScore}>
                <SelectTrigger className="h-9 w-[160px]" aria-label={labels.portfolio.maxScore}>
                  <SelectValue placeholder={labels.portfolio.maxScore} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_SCORE}>{labels.portfolio.maxScore}</SelectItem>
                  {THRESHOLD_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={String(preset)}>
                      {labels.portfolio.belowThreshold(preset)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sort by compliance score; worst-first (asc) by default. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={toggleOrder}
                aria-label={labels.portfolio.score}
              >
                {order === 'asc' ? (
                  <ArrowUpNarrowWide className="me-1.5 h-4 w-4" aria-hidden />
                ) : (
                  <ArrowDownNarrowWide className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {labels.portfolio.score}
              </Button>
            </div>
          }
        >
          {truncated ? (
            <div className="mb-4 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-800/50 dark:bg-warning-800/40 dark:text-warning-300">
              {TRUNCATED_NOTICE[locale] ?? TRUNCATED_NOTICE.en}
            </div>
          ) : null}

          {portfolioQuery.isLoading ? (
            <LexListSkeleton rows={6} cols={8} />
          ) : portfolioQuery.isError ? (
            <ErrorState error={portfolioQuery.error} onRetry={() => void portfolioQuery.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title={labels.portfolio.emptyTitle}
              description={labels.portfolio.empty}
              action={{ label: labels.portfolio.emptyCta, href: '/lex/playbooks' }}
            />
          ) : (
            <>
              <div
                id="playbook-portfolio-records"
                className="scroll-mt-24 overflow-hidden rounded-xl border border-border/60 shadow-elevation-1"
              >
                <Table className="table-premium">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{labels.portfolio.contract}</TableHead>
                      <TableHead>{labels.portfolio.playbook}</TableHead>
                      <TableHead>{labels.portfolio.score}</TableHead>
                      <TableHead>{labels.portfolio.missing}</TableHead>
                      <TableHead>{labels.portfolio.altered}</TableHead>
                      <TableHead>{labels.portfolio.extra}</TableHead>
                      <TableHead>{labels.deviations.generatedAt}</TableHead>
                      <TableHead className="text-end">{labels.portfolio.viewReview}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scopedRows.map((row) => (
                      <PortfolioRow key={`${row.contract_id}-${row.playbook_id}`} row={row} labels={labels} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {labels.catalog.showing(total === 0 ? 0 : rangeEnd - rangeStart + 1, total)}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage <= 1 || portfolioQuery.isFetching}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">{labels.catalog.page(currentPage)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= totalPages || portfolioQuery.isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Button>
                </div>
              </div>
            </>
          )}
        </SectionCard>
      </div>
    </LexRouteGuard>
  );
}

/**
 * The portfolio backend caps the candidate scan at ~200 contracts
 * (service.PortfolioMaxScan). No seeded label key covers this exact notice, so we
 * inline a bilingual copy here rather than editing the shared `labels.ts`
 * (owned by another agent). See report.
 */
const TRUNCATED_NOTICE: Record<string, string> = {
  en: 'Results were capped at the first 200 contracts scanned — narrow the filters to see the rest.',
  ar: 'اقتُصرت النتائج على أول 200 عقد جرى فحصها — ضيّق عوامل التصفية لعرض الباقي.',
};
