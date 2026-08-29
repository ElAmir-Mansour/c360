'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  AlarmClock,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Hand,
  Hourglass,
  LayoutList,
  PauseCircle,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { useLexFormat } from '@/lib/lex/ksa';
import { settlementsApi } from '@/lib/lex/settlements';
import { useSettlementLabels } from '../../settlements/_components/labels';
import { MatterSummaryRow } from '../_components/matter-summary-row';
import { useTimelineExtra } from '../_components/labels';
import { computePortfolioKpis } from '../_components/portfolio-kpis';

const PER_PAGE = 20;

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

type TriageTab = 'on_hold' | 'open_delays' | 'all';

/** The non-pagination filter/sort fields of the timeline-summary query. */
type TimelineFilterParams = Omit<
  NonNullable<Parameters<typeof settlementsApi.listMatterTimelines>[0]>,
  'page' | 'per_page'
>;

/**
 * Query parameters per triage tab. "On hold" filters held matters; "Open
 * delays" filters matters with ≥1 open delay day, sorted by the worst delay
 * first; "All" lists everything by recency. Pagination is applied at the call
 * site.
 */
const TAB_PARAMS: Record<TriageTab, TimelineFilterParams> = {
  on_hold: { on_hold: true, sort: 'updated_at', sort_dir: 'desc' },
  open_delays: { min_open_delay_days: 1, sort: 'open_delay_days', sort_dir: 'desc' },
  all: { sort: 'updated_at', sort_dir: 'desc' },
};

/**
 * Cross-matter case-timeline triage dashboard (feature #15), uplifted to the
 * premium Lex list language. A manager view over
 * {@link settlementsApi.listMatterTimelines}: a KPI strip computed client-side
 * from the fetched page, tabbed by "on hold" / "open delays" / "all", each row
 * an elevated, color-accented {@link MatterSummaryRow} that deep-links into the
 * single-matter timeline (`?matterId=…`). Gated on `lex:read`. Bilingual + RTL
 * via the shared settlement labels, the local extension bundle, and KSA dates.
 */
export default function LexCaseTimelinePortfolioPage() {
  const f = useLexFormat();
  const L = useSettlementLabels();
  const extra = useTimelineExtra();
  const dash = L.timeline.dashboard;

  const [tab, setTab] = useState<TriageTab>('on_hold');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['lex-case-timeline-portfolio', tab, page],
    queryFn: () =>
      settlementsApi.listMatterTimelines({ ...TAB_PARAMS[tab], page, per_page: PER_PAGE }),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => query.data?.data ?? [], [query.data]);
  const meta = query.data?.meta;
  const totalPages = meta?.total_pages ?? 1;

  const kpis = useMemo(() => computePortfolioKpis(rows), [rows]);
  const onHoldShare = percent(kpis.onHold, kpis.total);
  const openDelayShare = percent(kpis.openDelays, kpis.total);
  const overdueShare = percent(kpis.overdue, kpis.total);
  const dueWeekShare = percent(kpis.dueThisWeek, kpis.total);

  const kpiItems = useMemo<LexKpiItem[]>(
    () => [
      {
        id: 'total',
        label: extra.kpi.total,
        value: kpis.total,
        theme: 'primary',
        icon: LayoutList,
        description: dash.description,
        detail: extra.kpi.total,
        detailValue: kpis.total,
        onAction: () => setTab('all'),
        pressed: tab === 'all',
      },
      {
        id: 'on-hold',
        label: extra.kpi.onHold,
        value: kpis.onHold,
        theme: 'amber',
        icon: PauseCircle,
        description: extra.kpi.onHold,
        progress: onHoldShare,
        progressLabel: extra.kpi.total,
        detail: extra.kpi.total,
        detailValue: `${onHoldShare}%`,
        onAction: () => setTab('on_hold'),
        pressed: tab === 'on_hold',
      },
      {
        id: 'open-delays',
        label: extra.kpi.openDelays,
        value: kpis.openDelays,
        theme: 'orange',
        icon: Hand,
        spark: kpis.delaySpark.length > 1 ? kpis.delaySpark : undefined,
        description: extra.kpi.openDelays,
        progress: openDelayShare,
        progressLabel: extra.kpi.total,
        detail: extra.kpi.total,
        detailValue: `${openDelayShare}%`,
        onAction: () => setTab('open_delays'),
        pressed: tab === 'open_delays',
      },
      {
        id: 'overdue',
        label: extra.kpi.overdue,
        value: kpis.overdue,
        theme: 'red',
        icon: AlarmClock,
        description: extra.kpi.overdue,
        progress: overdueShare,
        progressLabel: extra.kpi.total,
        detail: extra.kpi.total,
        detailValue: `${overdueShare}%`,
        onAction: () => setTab('open_delays'),
      },
      {
        id: 'avg-delay',
        label: extra.kpi.avgDelay,
        value: kpis.avgOpenDelay,
        unit: extra.kpi.daysUnit,
        theme: 'primary',
        icon: Hourglass,
        description: extra.kpi.avgDelay,
        detail: extra.kpi.openDelays,
        detailValue: kpis.openDelays,
        onAction: () => setTab('open_delays'),
      },
      {
        id: 'due-week',
        label: extra.kpi.dueThisWeek,
        value: kpis.dueThisWeek,
        theme: 'primary',
        icon: CalendarClock,
        description: extra.kpi.dueThisWeek,
        progress: dueWeekShare,
        progressLabel: extra.kpi.total,
        detail: extra.kpi.total,
        detailValue: `${dueWeekShare}%`,
        onAction: () => setTab('all'),
      },
    ],
    [dash.description, dueWeekShare, extra.kpi, kpis, onHoldShare, openDelayShare, overdueShare, tab],
  );

  const tabItems = useMemo(
    () =>
      [
        { value: 'on_hold' as const, label: dash.mattersOnHold, icon: PauseCircle },
        { value: 'open_delays' as const, label: dash.mattersWithOpenDelays, icon: Hand },
        { value: 'all' as const, label: dash.allMatters, icon: LayoutList },
      ],
    [dash.mattersOnHold, dash.mattersWithOpenDelays, dash.allMatters],
  );

  const onTabChange = (value: string) => {
    setTab(value as TriageTab);
    setPage(1);
  };

  // Empty-state copy is tuned to the active tab so it reads as guidance.
  const isEmpty =
    !query.isLoading && !query.isError && rows.length === 0;

  return (
    <LexRouteGuard route="/lex/case-timeline">
      <LexListShell
        eyebrow={extra.eyebrow}
        title={dash.title}
        description={dash.description}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/lex/case-timeline">
              {/* Logical chevron: leads back to the single-matter workspace. */}
              <ChevronLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
              {L.timeline.title}
            </Link>
          </Button>
        }
        kpi={<LexKpiStrip items={kpiItems} columns={6} />}
        filters={
          <Tabs value={tab} onValueChange={onTabChange}>
            <TabsList>
              {tabItems.map((item) => {
                const Icon = item.icon;
                return (
                  <TabsTrigger key={item.value} value={item.value} className="gap-1.5">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {item.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        }
        loading={query.isLoading}
        skeletonRows={6}
        skeletonCols={4}
        empty={
          isEmpty
            ? {
                icon: CalendarClock,
                title: L.timeline.delayEmptyTitle,
                description: L.timeline.delayEmptyDescription,
                action: {
                  label: extra.empty.browsePortfolio,
                  onClick: () => onTabChange('all'),
                },
              }
            : null
        }
        framedBody={false}
        bodyClassName="space-y-3"
      >
        {query.isError ? (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-elevation-1">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {rows.map((matter, index) => (
                <MatterSummaryRow
                  key={matter.matter_id}
                  matter={matter}
                  labels={L}
                  extra={extra}
                  index={index}
                />
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-2.5">
                <span className="text-sm text-muted-foreground">
                  {L.timeline.pagination.showing(rows.length, meta?.total ?? rows.length)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {L.timeline.pagination.page(page)}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    disabled={page <= 1 || query.isFetching}
                    aria-label={L.timeline.pagination.page(page - 1)}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    disabled={page >= totalPages || query.isFetching}
                    aria-label={L.timeline.pagination.page(page + 1)}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </LexListShell>
    </LexRouteGuard>
  );
}
