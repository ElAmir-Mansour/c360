/**
 * Matters portfolio analytics + proper report export (FEATURE 4).
 *
 * Renders the `getMatterReport(params)` payload (`LexMatterReport`) as a premium,
 * RTL-aware analytics panel: matters by type, by status, by priority, top owners,
 * plus derived aging / cycle-time signals (the report has no dedicated aging or
 * owner aggregate, so those are computed defensively from `report.matters`).
 *
 * It also surfaces an "at-risk" tile group (open matters that are overdue or long
 * running). The task allowed an optional cross-reference to
 * `listMatterTimelineSummaries()` (external holds) IF that client method exists —
 * it does NOT exist on `enterpriseApi.lex`, so this panel derives the at-risk
 * signal from the report itself rather than calling a method that would not
 * compile. The hook below is written so a future timeline-summaries method can be
 * wired in without touching the chart layout.
 *
 * The "Export full report (CSV)" button is the PROPER server-side report export
 * (`exportMatterReportCsv(params)` -> Blob, downloaded via `downloadBlob`), which
 * is distinct from the list page's existing selected-rows client CSV.
 *
 * Self-contained bilingual labels (English + professional MSA) follow the
 * canonical lex bilingual contract. Legal glossary: قضية/مهمة قانونية (matter),
 * مهلة (deadline), التزام (obligation), مستند (document).
 */

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Download,
  Hourglass,
  Layers,
  Loader2,
} from 'lucide-react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { SectionCard } from '@/components/suites/section-card';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { StatTile } from '@/components/shared/stat-tile';
import {
  SourceRecordsDrilldown,
  type AnalyticsSourceSelection,
} from '../../analytics/_components/source-records-drilldown';
import { Button } from '@/components/ui/button';
import {
  CHART_COLORS,
  SEVERITY_COLORS,
  STATUS_COLORS as STATUS_TONE_COLORS,
} from '@/lib/design-tokens';
import { enterpriseApi } from '@/lib/enterprise';
import { useLexFormat } from '@/lib/lex/ksa';
import { downloadBlob } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexMatterReport, LexMatterSummary } from '@/types/suites';
import type { FetchParams } from '@/types/table';
import type { AppLocale } from '@/lib/i18n';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Bilingual labels — self-contained per the lex contract.
 * ------------------------------------------------------------------------- */

interface MatterAnalyticsLabels {
  title: string;
  description: string;
  generatedAt: (date: string) => string;
  totalMatters: (count: string) => string;
  export: string;
  exporting: string;
  exportFileName: string;
  loadError: string;
  retry: string;
  emptyTitle: string;
  emptyDescription: string;
  byType: { title: string; description: string };
  byStatus: { title: string; description: string };
  byPriority: { title: string; description: string };
  topOwners: { title: string; description: string; mattersAxis: string; empty: string };
  aging: {
    title: string;
    description: string;
    openMatters: string;
    closedMatters: string;
    overdue: string;
    overdueHelper: string;
    avgCycleTime: string;
    avgCycleTimeHelper: string;
    oldestOpen: string;
    oldestOpenHelper: string;
    days: (n: string) => string;
    none: string;
  };
  atRisk: {
    title: string;
    description: string;
    empty: string;
    overdueBy: (n: string) => string;
    openFor: (n: string) => string;
    owner: string;
    noOwner: string;
  };
  statusOptions: Record<string, string>;
  typeOptions: Record<string, string>;
  priorityOptions: Record<string, string>;
}

const matterAnalyticsLabelsBundle: LexBilingual<MatterAnalyticsLabels> = {
  en: {
    title: 'Portfolio Analytics',
    description: 'Distribution, ownership, and aging signals across the matter portfolio.',
    generatedAt: (date) => `Generated ${date}`,
    totalMatters: (count) => `${count} matters in scope`,
    export: 'Export full report (CSV)',
    exporting: 'Exporting...',
    exportFileName: 'matters-report',
    loadError: 'Failed to load matter analytics.',
    retry: 'Retry',
    emptyTitle: 'No matters in scope',
    emptyDescription: 'No matters matched the current filters, so there is nothing to chart.',
    byType: { title: 'Matters by Type', description: 'Portfolio mix across matter types.' },
    byStatus: { title: 'Matters by Status', description: 'Lifecycle distribution of all matters.' },
    byPriority: { title: 'Matters by Priority', description: 'Triage weighting across the portfolio.' },
    topOwners: {
      title: 'Top Owners',
      description: 'Matters concentrated by responsible owner.',
      mattersAxis: 'Matters',
      empty: 'No ownership data available.',
    },
    aging: {
      title: 'Aging & Cycle Time',
      description: 'Open volume, overdue load, and how long matters take to close.',
      openMatters: 'Open matters',
      closedMatters: 'Closed matters',
      overdue: 'Overdue',
      overdueHelper: 'Open matters past their due date',
      avgCycleTime: 'Avg cycle time',
      avgCycleTimeHelper: 'Open to close, closed matters',
      oldestOpen: 'Oldest open',
      oldestOpenHelper: 'Longest-running open matter',
      days: (n) => `${n} days`,
      none: '—',
    },
    atRisk: {
      title: 'At-Risk Matters',
      description: 'Open matters that are overdue or have run the longest.',
      empty: 'No at-risk matters in scope.',
      overdueBy: (n) => `Overdue by ${n} days`,
      openFor: (n) => `Open ${n} days`,
      owner: 'Owner',
      noOwner: 'Unassigned',
    },
    statusOptions: {
      intake: 'Intake',
      open: 'Open',
      in_review: 'In Review',
      waiting_on_business: 'Waiting on Business',
      on_hold: 'On Hold',
      closed: 'Closed',
      cancelled: 'Cancelled',
    },
    typeOptions: {
      general: 'General',
      contract: 'Contract',
      litigation: 'Litigation',
      regulatory: 'Regulatory',
      employment: 'Employment',
      dispute: 'Dispute',
      advisory: 'Advisory',
      other: 'Other',
    },
    priorityOptions: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
  },
  ar: {
    title: 'تحليلات المحفظة',
    description: 'توزيع القضايا ومسؤوليتها ومؤشرات تقادمها عبر محفظة القضايا.',
    generatedAt: (date) => `أُنشئ في ${date}`,
    totalMatters: (count) => `${count} قضية ضمن النطاق`,
    export: 'تصدير التقرير الكامل (CSV)',
    exporting: 'جارٍ التصدير...',
    exportFileName: 'تقرير-القضايا',
    loadError: 'تعذّر تحميل تحليلات القضايا.',
    retry: 'إعادة المحاولة',
    emptyTitle: 'لا توجد قضايا ضمن النطاق',
    emptyDescription: 'لا توجد قضايا مطابقة للمرشّحات الحالية، لذا لا توجد بيانات للعرض.',
    byType: { title: 'القضايا حسب النوع', description: 'مزيج المحفظة عبر أنواع القضايا.' },
    byStatus: { title: 'القضايا حسب الحالة', description: 'توزيع جميع القضايا على دورة الحياة.' },
    byPriority: { title: 'القضايا حسب الأولوية', description: 'ترجيح الفرز عبر المحفظة.' },
    topOwners: {
      title: 'أبرز المسؤولين',
      description: 'القضايا مُجمّعة حسب المسؤول.',
      mattersAxis: 'القضايا',
      empty: 'لا توجد بيانات مسؤولية متاحة.',
    },
    aging: {
      title: 'التقادم وزمن الدورة',
      description: 'حجم القضايا المفتوحة وعبء المتأخّرة والمدة اللازمة لإغلاقها.',
      openMatters: 'القضايا المفتوحة',
      closedMatters: 'القضايا المغلقة',
      overdue: 'متأخّرة',
      overdueHelper: 'قضايا مفتوحة تجاوزت تاريخ استحقاقها',
      avgCycleTime: 'متوسط زمن الدورة',
      avgCycleTimeHelper: 'من الفتح إلى الإغلاق، للقضايا المغلقة',
      oldestOpen: 'الأقدم المفتوحة',
      oldestOpenHelper: 'أطول قضية مفتوحة مدةً',
      days: (n) => `${n} يومًا`,
      none: '—',
    },
    atRisk: {
      title: 'القضايا المعرّضة للخطر',
      description: 'قضايا مفتوحة متأخّرة أو الأطول مدةً.',
      empty: 'لا توجد قضايا معرّضة للخطر ضمن النطاق.',
      overdueBy: (n) => `متأخّرة بمقدار ${n} يومًا`,
      openFor: (n) => `مفتوحة منذ ${n} يومًا`,
      owner: 'المسؤول',
      noOwner: 'غير مُسند',
    },
    statusOptions: {
      intake: 'استقبال',
      open: 'مفتوحة',
      in_review: 'قيد المراجعة',
      waiting_on_business: 'بانتظار جهة العمل',
      on_hold: 'معلّقة',
      closed: 'مغلقة',
      cancelled: 'ملغاة',
    },
    typeOptions: {
      general: 'عام',
      contract: 'عقد',
      litigation: 'تقاضٍ',
      regulatory: 'تنظيمي',
      employment: 'عمالي',
      dispute: 'نزاع',
      advisory: 'استشاري',
      other: 'أخرى',
    },
    priorityOptions: {
      critical: 'حرجة',
      high: 'مرتفعة',
      medium: 'متوسطة',
      low: 'منخفضة',
    },
  },
};

function resolveMatterAnalyticsLabels(locale: AppLocale = 'en'): MatterAnalyticsLabels {
  return resolveLexBilingual(matterAnalyticsLabelsBundle, locale);
}

function useMatterAnalyticsLabels(): MatterAnalyticsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveMatterAnalyticsLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Derivation helpers.
 * ------------------------------------------------------------------------- */

const STATUS_COLORS: Record<string, string> = {
  intake: CHART_COLORS[4],
  open: CHART_COLORS[0],
  in_review: CHART_COLORS[2],
  waiting_on_business: CHART_COLORS[3],
  on_hold: STATUS_TONE_COLORS.neutral,
  closed: CHART_COLORS[1],
  cancelled: STATUS_TONE_COLORS.error,
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: SEVERITY_COLORS.critical,
  high: SEVERITY_COLORS.high,
  medium: SEVERITY_COLORS.medium,
  low: SEVERITY_COLORS.low,
};

const TYPE_PALETTE = CHART_COLORS;

const OWNER_COLOR = CHART_COLORS[0];

/** Series colour for the status-distribution bar chart (brand teal). */
const STATUS_BAR_COLOR: string = CHART_COLORS[0];

const OPEN_STATUSES = new Set([
  'intake',
  'open',
  'in_review',
  'waiting_on_business',
  'on_hold',
]);
const CLOSED_STATUSES = new Set(['closed', 'cancelled']);
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function formatToken(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function recordToPie(
  record: Record<string, number> | undefined,
  labels: Record<string, string>,
  colorFor: (key: string, index: number) => string,
): Array<{ name: string; value: number; color: string }> {
  if (!record) {
    return [];
  }
  return Object.entries(record)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value], index) => ({
      name: labels[key] ?? formatToken(key),
      value,
      color: colorFor(key, index),
    }));
}

function diffInDays(from: string | null | undefined, to: Date): number | null {
  if (!from) {
    return null;
  }
  const start = new Date(from);
  if (Number.isNaN(start.valueOf())) {
    return null;
  }
  return Math.floor((to.getTime() - start.getTime()) / MS_PER_DAY);
}

interface AtRiskEntry {
  matter: LexMatterSummary;
  overdueDays: number | null;
  openDays: number | null;
}

interface DerivedAnalytics {
  ownerBars: Array<Record<string, unknown>>;
  ownerColors: string[];
  openCount: number;
  closedCount: number;
  overdueCount: number;
  avgCycleDays: number | null;
  oldestOpenDays: number | null;
  atRisk: AtRiskEntry[];
}

function deriveAnalytics(matters: LexMatterSummary[]): DerivedAnalytics {
  const now = new Date();

  // Top owners by matter count (the report has no owner aggregate).
  const ownerCounts = new Map<string, number>();
  for (const matter of matters) {
    const name = matter.owner_name?.trim();
    if (!name) {
      continue;
    }
    ownerCounts.set(name, (ownerCounts.get(name) ?? 0) + 1);
  }
  const ownerBars = Array.from(ownerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([owner, count]) => ({ owner, count }));
  const ownerColors = ownerBars.map(() => OWNER_COLOR);

  let openCount = 0;
  let closedCount = 0;
  let overdueCount = 0;
  let cycleSum = 0;
  let cycleN = 0;
  let oldestOpenDays: number | null = null;

  const atRiskCandidates: AtRiskEntry[] = [];

  for (const matter of matters) {
    const status = matter.status;
    const isOpen = OPEN_STATUSES.has(status);
    const isClosed = CLOSED_STATUSES.has(status);

    if (isOpen) {
      openCount += 1;
      const openDays = diffInDays(matter.opened_at, now);
      if (openDays !== null && (oldestOpenDays === null || openDays > oldestOpenDays)) {
        oldestOpenDays = openDays;
      }
      // Overdue = open and past its due date.
      let overdueDays: number | null = null;
      if (matter.due_date) {
        const due = new Date(matter.due_date);
        if (!Number.isNaN(due.valueOf()) && due.getTime() < now.getTime()) {
          overdueDays = Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY);
          overdueCount += 1;
        }
      }
      if (overdueDays !== null || (openDays !== null && openDays > 0)) {
        atRiskCandidates.push({ matter, overdueDays, openDays });
      }
    }

    if (isClosed) {
      closedCount += 1;
      if (matter.closed_at) {
        const cycle = diffInDays(matter.opened_at, new Date(matter.closed_at));
        if (cycle !== null && cycle >= 0) {
          cycleSum += cycle;
          cycleN += 1;
        }
      }
    }
  }

  // Rank at-risk: overdue first (by overdue days), then long-running open.
  const atRisk = atRiskCandidates
    .sort((a, b) => {
      const ao = a.overdueDays ?? -1;
      const bo = b.overdueDays ?? -1;
      if (ao !== bo) {
        return bo - ao;
      }
      return (b.openDays ?? 0) - (a.openDays ?? 0);
    })
    .slice(0, 6);

  return {
    ownerBars,
    ownerColors,
    openCount,
    closedCount,
    overdueCount,
    avgCycleDays: cycleN > 0 ? Math.round(cycleSum / cycleN) : null,
    oldestOpenDays,
    atRisk,
  };
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface MatterAnalyticsPanelProps {
  /**
   * The active list FetchParams (filters/search/sort). The report mirrors what
   * the user is viewing. Defaults to a single page request when omitted.
   */
  params?: FetchParams;
  /** When true the panel renders collapsed and can be expanded inline. */
  defaultCollapsed?: boolean;
  className?: string;
}

const DEFAULT_PARAMS: FetchParams = { page: 1, per_page: 200 };

export function MatterAnalyticsPanel({
  params,
  defaultCollapsed = false,
  className,
}: MatterAnalyticsPanelProps) {
  const labels = useMatterAnalyticsLabels();
  const { direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const reportParams = params ?? DEFAULT_PARAMS;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [exporting, setExporting] = useState(false);
  const [selection, setSelection] = useState<AnalyticsSourceSelection | null>(null);

  const query = useQuery<LexMatterReport>({
    queryKey: ['lex-matters', 'analytics', reportParams],
    queryFn: () => enterpriseApi.lex.getMatterReport(reportParams),
    enabled: !collapsed,
  });

  const report = query.data;

  const typePie = useMemo(
    () =>
      recordToPie(
        report?.by_type,
        labels.typeOptions,
        (_key, index) => TYPE_PALETTE[index % TYPE_PALETTE.length],
      ),
    [report?.by_type, labels.typeOptions],
  );

  const statusBars = useMemo(() => {
    const pie = recordToPie(
      report?.by_status,
      labels.statusOptions,
      (key) => STATUS_COLORS[key] ?? STATUS_TONE_COLORS.neutral,
    );
    return {
      data: pie.map((entry) => ({ status: entry.name, count: entry.value })),
      colors: pie.map((entry) => entry.color),
    };
  }, [report?.by_status, labels.statusOptions]);

  const priorityPie = useMemo(
    () =>
      recordToPie(
        report?.by_priority,
        labels.priorityOptions,
        (key) => PRIORITY_COLORS[key] ?? STATUS_TONE_COLORS.neutral,
      ),
    [report?.by_priority, labels.priorityOptions],
  );

  const derived = useMemo(
    () => deriveAnalytics(report?.matters ?? []),
    [report?.matters],
  );

  const hasData = (report?.total ?? 0) > 0 || (report?.matters?.length ?? 0) > 0;
  const errorMessage = query.isError ? labels.loadError : undefined;
  const openRecords = (
    title: string,
    predicate: (matter: LexMatterSummary) => boolean,
  ) => {
    setSelection({
      title,
      records: (report?.matters ?? []).filter(predicate).map((matter) => ({
        id: matter.id,
        href: `/lex/matters/${matter.id}`,
        eyebrow: matter.matter_number,
        title: matter.title,
        status: matter.status,
        details: [
          { label: labels.atRisk.owner, value: matter.owner_name || labels.atRisk.noOwner },
          { label: labels.byPriority.title, value: labels.priorityOptions[matter.priority] ?? formatToken(matter.priority) },
        ],
      })),
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await enterpriseApi.lex.exportMatterReportCsv(reportParams);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `${labels.exportFileName}-${stamp}.csv`);
      showSuccess(labels.export);
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(false);
    }
  };

  const generatedLine = report?.generated_at
    ? `${labels.generatedAt(f.formatDate(report.generated_at))} · ${labels.totalMatters(f.formatNumber(report.total))}`
    : labels.description;

  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? (
          <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="me-2 h-4 w-4" aria-hidden />
        )}
        {exporting ? labels.exporting : labels.export}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        <ChevronDown
          className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          aria-hidden
        />
      </Button>
    </div>
  );

  return (
    <SectionCard
      title={labels.title}
      description={generatedLine}
      actions={actions}
      className={className}
      contentClassName="space-y-6"
    >
      {collapsed ? null : query.isError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive/60" aria-hidden />
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            {labels.retry}
          </Button>
        </div>
      ) : !query.isLoading && !hasData ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/40" aria-hidden />
          <p className="text-sm font-medium">{labels.emptyTitle}</p>
          <p className="text-sm text-muted-foreground">{labels.emptyDescription}</p>
        </div>
      ) : (
        <>
          {/* Distribution charts. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-4">
              <h3 className="mb-1 text-sm font-semibold">{labels.byType.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{labels.byType.description}</p>
              <PieChart
                data={typePie}
                loading={query.isLoading}
                height={260}
                centerValue={report ? f.formatNumber(report.total) : undefined}
                centerLabel={labels.title}
                onItemSelect={(name) => {
                  const type = Object.keys(labels.typeOptions).find(
                    (value) => (labels.typeOptions[value] ?? formatToken(value)) === name,
                  );
                  if (type) openRecords(name, (matter) => matter.type === type);
                }}
              />
            </div>
            <div className="rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-4">
              <h3 className="mb-1 text-sm font-semibold">{labels.byStatus.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{labels.byStatus.description}</p>
              <BarChart
                data={statusBars.data}
                xKey="status"
                yKeys={[{ key: 'count', label: labels.byStatus.title, color: STATUS_BAR_COLOR }]}
                cellColors={statusBars.colors}
                layout="horizontal"
                showLegend={false}
                loading={query.isLoading}
                height={260}
                yFormatter={(value) => f.formatNumber(value)}
                onItemSelect={(datum) => {
                  const status = Object.keys(labels.statusOptions).find(
                    (value) => (labels.statusOptions[value] ?? formatToken(value)) === datum.status,
                  );
                  if (status) openRecords(String(datum.status), (matter) => matter.status === status);
                }}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-4">
              <h3 className="mb-1 text-sm font-semibold">{labels.byPriority.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{labels.byPriority.description}</p>
              <PieChart
                data={priorityPie}
                loading={query.isLoading}
                height={260}
                onItemSelect={(name) => {
                  const priority = Object.keys(labels.priorityOptions).find(
                    (value) => (labels.priorityOptions[value] ?? formatToken(value)) === name,
                  );
                  if (priority) {
                    openRecords(name, (matter) => matter.priority === priority);
                  }
                }}
              />
            </div>
            <div className="rounded-xl border border-[color:var(--panel-border)] bg-card/50 p-4">
              <h3 className="mb-1 text-sm font-semibold">{labels.topOwners.title}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{labels.topOwners.description}</p>
              {derived.ownerBars.length === 0 && !query.isLoading ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                  {labels.topOwners.empty}
                </div>
              ) : (
                <BarChart
                  data={derived.ownerBars}
                  xKey="owner"
                  yKeys={[
                    { key: 'count', label: labels.topOwners.mattersAxis, color: OWNER_COLOR },
                  ]}
                  cellColors={derived.ownerColors}
                  layout="horizontal"
                  showLegend={false}
                  loading={query.isLoading}
                  height={260}
                  yFormatter={(value) => f.formatNumber(value)}
                  onItemSelect={(datum) =>
                    openRecords(
                      String(datum.owner),
                      (matter) => matter.owner_name?.trim() === datum.owner,
                    )
                  }
                />
              )}
            </div>
          </div>

          {/* Aging & cycle time. */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{labels.aging.title}</h3>
              <p className="text-xs text-muted-foreground">{labels.aging.description}</p>
            </div>
            <div className="matter-analytics-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatTile
                themeClass="kpi-theme-primary"
                icon={Layers}
                label={labels.aging.openMatters}
                value={f.formatNumber(derived.openCount)}
                size="md"
                appearance="operational"
                className="matter-analytics-kpi-card"
                onAction={() =>
                  openRecords(labels.aging.openMatters, (matter) => OPEN_STATUSES.has(matter.status))
                }
              />
              <StatTile
                themeClass="kpi-theme-emerald"
                icon={Layers}
                label={labels.aging.closedMatters}
                value={f.formatNumber(derived.closedCount)}
                size="md"
                appearance="operational"
                className="matter-analytics-kpi-card"
                onAction={() =>
                  openRecords(labels.aging.closedMatters, (matter) => CLOSED_STATUSES.has(matter.status))
                }
              />
              <StatTile
                themeClass="kpi-theme-red"
                icon={AlertTriangle}
                label={labels.aging.overdue}
                value={f.formatNumber(derived.overdueCount)}
                size="md"
                appearance="operational"
                className="matter-analytics-kpi-card"
                onAction={() => {
                  const now = Date.now();
                  openRecords(labels.aging.overdue, (matter) => {
                    if (!OPEN_STATUSES.has(matter.status) || !matter.due_date) return false;
                    const due = new Date(matter.due_date).getTime();
                    return Number.isFinite(due) && due < now;
                  });
                }}
              />
              <StatTile
                themeClass="kpi-theme-amber"
                icon={Clock}
                label={labels.aging.avgCycleTime}
                value={
                  derived.avgCycleDays === null
                    ? labels.aging.none
                    : labels.aging.days(f.formatNumber(derived.avgCycleDays))
                }
                size="md"
                appearance="operational"
                className="matter-analytics-kpi-card"
                onAction={() =>
                  openRecords(
                    labels.aging.avgCycleTime,
                    (matter) => CLOSED_STATUSES.has(matter.status) && Boolean(matter.closed_at),
                  )
                }
              />
              <StatTile
                themeClass="kpi-theme-primary"
                icon={Hourglass}
                label={labels.aging.oldestOpen}
                value={
                  derived.oldestOpenDays === null
                    ? labels.aging.none
                    : labels.aging.days(f.formatNumber(derived.oldestOpenDays))
                }
                size="md"
                appearance="operational"
                className="matter-analytics-kpi-card"
                onAction={() =>
                  openRecords(labels.aging.oldestOpen, (matter) => {
                    if (!OPEN_STATUSES.has(matter.status) || derived.oldestOpenDays === null) {
                      return false;
                    }
                    return diffInDays(matter.opened_at, new Date()) === derived.oldestOpenDays;
                  })
                }
              />
            </div>
          </div>

          {/* At-risk matters (derived; no timeline-summaries client method exists). */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{labels.atRisk.title}</h3>
              <p className="text-xs text-muted-foreground">{labels.atRisk.description}</p>
            </div>
            {derived.atRisk.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[color:var(--panel-border)] bg-card/30 px-4 py-6 text-center text-sm text-muted-foreground">
                {labels.atRisk.empty}
              </p>
            ) : (
              <ul className="space-y-2">
                {derived.atRisk.map((entry) => {
                  const signal =
                    entry.overdueDays !== null
                      ? labels.atRisk.overdueBy(f.formatNumber(entry.overdueDays))
                      : labels.atRisk.openFor(f.formatNumber(entry.openDays ?? 0));
                  return (
                    <li key={entry.matter.id}>
                    <Link
                      href={`/lex/matters/${entry.matter.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--panel-border)] bg-card/50 px-4 py-3 transition-colors hover:border-primary/30 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{entry.matter.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {entry.matter.matter_number} · {labels.atRisk.owner}:{' '}
                          {entry.matter.owner_name || labels.atRisk.noOwner}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          entry.overdueDays !== null
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-warning-500/10 text-warning-700 dark:text-warning-300'
                        }`}
                        dir={direction}
                      >
                        {signal}
                      </span>
                    </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      <SourceRecordsDrilldown
        selection={selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      />
    </SectionCard>
  );
}

export default MatterAnalyticsPanel;
