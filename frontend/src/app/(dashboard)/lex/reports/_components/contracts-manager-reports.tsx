'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, SlidersHorizontal } from 'lucide-react';

import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { useLocale } from '@/components/providers/locale-provider';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadBlob, titleCase } from '@/lib/format';
import {
  lexReportsApi,
  type LexConsultationReport,
  type LexContractAnalyticsReport,
  type LexCountBucket,
  type LexReportQuery,
  type LexValueBucket,
} from '@/lib/lex/reports';
import {
  PrintableReport,
  ReportExportMenu,
  ReportPeriodControl,
} from '@/components/lex/reports';

type ReportDomain = 'contracts' | 'consultations';
type PeriodPreset = 'today' | '7d' | '30d' | 'all';

const COPY = {
  en: {
    title: 'Contracts & consultations reports',
    description: 'Portfolio, lifecycle, value, timing, and consultation delivery metrics.',
    contracts: 'Contracts',
    consultations: 'Consultations',
    today: 'Today',
    sevenDays: '7 days',
    thirtyDays: '30 days',
    allTime: 'All time',
    from: 'From',
    to: 'To',
    printPdf: 'Download PDF',
    exportCsv: 'Export CSV',
    exportXlsx: 'Export Excel',
    builder: 'Report builder',
    totalContracts: 'Total contracts',
    reviewTime: 'Average review time',
    reviewSample: 'Reviewed contracts',
    totalValue: 'Portfolio value',
    cycleAverage: 'Average cycle time',
    cycleMedian: 'Median cycle time',
    cycleP90: 'P90 cycle time',
    totalConsultations: 'Total consultations',
    completionTime: 'Average completion time',
    completionSample: 'Completed consultations',
    byStatus: 'By status',
    byType: 'By type',
    byDepartment: 'By department',
    spendByType: 'Spend by contract type',
    spendByDepartment: 'Spend by department',
    detailedRecords: 'Detailed contract and consultation records',
    detailedRecordsDescription:
      'Open the report builder for searchable rows, record-level filters, saved definitions, and full exports.',
    openBuilder: 'Open detailed report builder',
    expiryCliff: '24-month expiry cliff',
    expiryDescription: 'Contracts due to expire by month, including recorded value.',
    generated: 'Generated',
    noData: 'No data in this period.',
    hours: (value: number) => `${value.toFixed(1)} hrs`,
    days: (value: number) => `${value.toFixed(1)} days`,
  },
  ar: {
    title: 'تقارير العقود والاستشارات',
    description: 'مؤشرات المحفظة ودورة الحياة والقيمة والتوقيت وإنجاز الاستشارات.',
    contracts: 'العقود',
    consultations: 'الاستشارات',
    today: 'اليوم',
    sevenDays: '٧ أيام',
    thirtyDays: '٣٠ يومًا',
    allTime: 'كل الفترات',
    from: 'من',
    to: 'إلى',
    printPdf: 'تنزيل PDF',
    exportCsv: 'تصدير CSV',
    exportXlsx: 'تصدير Excel',
    builder: 'منشئ التقارير',
    totalContracts: 'إجمالي العقود',
    reviewTime: 'متوسط وقت المراجعة',
    reviewSample: 'العقود المراجعة',
    totalValue: 'قيمة المحفظة',
    cycleAverage: 'متوسط دورة العقد',
    cycleMedian: 'وسيط دورة العقد',
    cycleP90: 'المئين ٩٠ لدورة العقد',
    totalConsultations: 'إجمالي الاستشارات',
    completionTime: 'متوسط وقت الإنجاز',
    completionSample: 'الاستشارات المكتملة',
    byStatus: 'حسب الحالة',
    byType: 'حسب النوع',
    byDepartment: 'حسب الإدارة',
    spendByType: 'الإنفاق حسب نوع العقد',
    spendByDepartment: 'الإنفاق حسب الإدارة',
    detailedRecords: 'سجلات العقود والاستشارات التفصيلية',
    detailedRecordsDescription:
      'افتح منشئ التقارير للصفوف القابلة للبحث ومرشحات السجلات والتعريفات المحفوظة والتصدير الكامل.',
    openBuilder: 'فتح منشئ التقارير التفصيلي',
    expiryCliff: 'استحقاقات الانتهاء خلال ٢٤ شهرًا',
    expiryDescription: 'العقود التي يحين انتهاؤها شهريًا مع قيمتها المسجلة.',
    generated: 'تاريخ الإنشاء',
    noData: 'لا توجد بيانات في هذه الفترة.',
    hours: (value: number) => `${value.toFixed(1)} ساعة`,
    days: (value: number) => `${value.toFixed(1)} يوم`,
  },
} as const;

export function ContractsManagerReports() {
  const { locale, direction } = useLocale();
  const copy = COPY[locale === 'ar' ? 'ar' : 'en'];
  const [domain, setDomain] = useState<ReportDomain>('contracts');
  const [range, setRange] = useState(() => presetRange('30d'));
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const reportQuery = useMemo<LexReportQuery>(
    () => ({ from: range.from || undefined, to: range.to || undefined }),
    [range],
  );

  const contracts = useQuery({
    queryKey: ['contracts-manager-reports', 'contracts', reportQuery],
    queryFn: () => lexReportsApi.getContractAnalytics(reportQuery),
  });
  const consultations = useQuery({
    queryKey: ['contracts-manager-reports', 'consultations', reportQuery],
    queryFn: () => lexReportsApi.getConsultationReport(reportQuery),
  });

  const activeQuery = domain === 'contracts' ? contracts : consultations;

  const exportReport = async (kind: 'csv' | 'xlsx') => {
    setExporting(kind);
    try {
      const blob = domain === 'contracts'
        ? kind === 'csv'
          ? await lexReportsApi.exportContractAnalyticsCsv(reportQuery)
          : await lexReportsApi.exportContractAnalyticsXlsx(reportQuery)
        : kind === 'csv'
          ? await lexReportsApi.exportConsultationReportCsv(reportQuery)
          : await lexReportsApi.exportConsultationReportXlsx(reportQuery);
      downloadBlob(
        blob,
        `watheeq-${domain}-report-${new Date().toISOString().slice(0, 10)}.${kind}`,
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6" dir={direction} lang={locale}>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <div className="contracts-manager-report-no-print flex flex-wrap items-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/lex/reports/builder">
                <SlidersHorizontal className="me-1.5 h-4 w-4" />
                {copy.builder}
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
            >
              <Printer className="me-1.5 h-4 w-4" aria-hidden />
              {copy.printPdf}
            </Button>
            <ReportExportMenu
              disabled={Boolean(exporting) || activeQuery.isLoading}
              exporting={exporting}
              onCsv={() => exportReport('csv')}
              onXlsx={() => exportReport('xlsx')}
            />
          </div>
        }
      />

      <div className="contracts-manager-report-no-print flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {([
            ['today', copy.today],
            ['7d', copy.sevenDays],
            ['30d', copy.thirtyDays],
            ['all', copy.allTime],
          ] as const).map(([preset, label]) => (
            <Button
              key={preset}
              size="sm"
              variant={sameRange(range, presetRange(preset)) ? 'default' : 'outline'}
              onClick={() => setRange(presetRange(preset))}
            >
              {label}
            </Button>
          ))}
        </div>
        <ReportPeriodControl
          value={{ from: parseDate(range.from), to: parseDate(range.to) }}
          onChange={(next) =>
            setRange({
              from: next.from ? isoDate(next.from) : '',
              to: next.to ? isoDate(next.to) : '',
            })
          }
        />
      </div>

      <Tabs value={domain} onValueChange={(value) => setDomain(value as ReportDomain)}>
        <TabsList className="contracts-manager-report-no-print">
          <TabsTrigger value="contracts">{copy.contracts}</TabsTrigger>
          <TabsTrigger value="consultations">{copy.consultations}</TabsTrigger>
        </TabsList>
        <TabsContent value="contracts" className="contracts-manager-report-print mt-5">
          <PrintableReport
            title={`${copy.title} — ${copy.contracts}`}
            period={{ from: range.from, to: range.to, label: range.from || range.to ? undefined : copy.allTime }}
          >
          <ReportState query={contracts}>
            {(report) => <ContractReport report={report} copy={copy} locale={locale} />}
          </ReportState>
          </PrintableReport>
        </TabsContent>
        <TabsContent value="consultations" className="contracts-manager-report-print mt-5">
          <PrintableReport
            title={`${copy.title} — ${copy.consultations}`}
            period={{ from: range.from, to: range.to, label: range.from || range.to ? undefined : copy.allTime }}
          >
          <ReportState query={consultations}>
            {(report) => <ConsultationReport report={report} copy={copy} locale={locale} />}
          </ReportState>
          </PrintableReport>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ContractReport({ report, copy, locale }: {
  report: LexContractAnalyticsReport;
  copy: typeof COPY.en | typeof COPY.ar;
  locale: string;
}) {
  const currencyValue = formatPortfolioValue(report, locale);
  return (
    <div className="space-y-5">
      <MetricGrid items={[
        [copy.totalContracts, formatNumber(report.total, locale)],
        [copy.reviewTime, copy.hours(report.avg_review_duration_hours)],
        [copy.reviewSample, formatNumber(report.review_sample_size, locale)],
        [copy.totalValue, currencyValue],
        [copy.cycleAverage, copy.days(report.cycle_time?.avg_days ?? 0)],
        [copy.cycleMedian, copy.days(report.cycle_time?.p50_days ?? 0)],
        [copy.cycleP90, copy.days(report.cycle_time?.p90_days ?? 0)],
      ]} />
      <BreakdownGrid
        sections={[
          [copy.byStatus, report.by_status],
          [copy.byType, report.by_type],
          [copy.byDepartment, report.by_department],
        ]}
        total={report.total}
        empty={copy.noData}
        locale={locale}
      />
      <ValueBreakdownGrid
        sections={[
          [copy.spendByType, report.spend_by_type ?? []],
          [copy.spendByDepartment, report.spend_by_department ?? []],
        ]}
        empty={copy.noData}
        locale={locale}
      />
      <div data-report-section="true">
      <SectionCard title={copy.expiryCliff} description={copy.expiryDescription}>
        {(report.expiry_cliff ?? []).some((point) => point.count > 0) ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {(report.expiry_cliff ?? []).filter((point) => point.count > 0).map((point) => (
              <div key={point.month} className="rounded-lg border p-3">
                <p className="text-sm font-semibold">{point.month}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(point.count, locale)} · {formatNumber(point.value, locale)}
                </p>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">{copy.noData}</p>}
      </SectionCard>
      </div>
      <GeneratedAt value={report.generated_at} label={copy.generated} locale={locale} />
      <DetailedRecordsCallout copy={copy} />
    </div>
  );
}

function ConsultationReport({ report, copy, locale }: {
  report: LexConsultationReport;
  copy: typeof COPY.en | typeof COPY.ar;
  locale: string;
}) {
  return (
    <div className="space-y-5">
      <MetricGrid items={[
        [copy.totalConsultations, formatNumber(report.total, locale)],
        [copy.completionTime, copy.hours(report.avg_completion_time_hours)],
        [copy.completionSample, formatNumber(report.completion_sample_size, locale)],
      ]} />
      <BreakdownGrid
        sections={[
          [copy.byStatus, report.by_status],
          [copy.byType, report.by_type],
          [copy.byDepartment, report.by_department],
        ]}
        total={report.total}
        empty={copy.noData}
        locale={locale}
      />
      <GeneratedAt value={report.generated_at} label={copy.generated} locale={locale} />
      <DetailedRecordsCallout copy={copy} />
    </div>
  );
}

function ValueBreakdownGrid({ sections, empty, locale }: {
  sections: Array<readonly [string, LexValueBucket[]]>;
  empty: string;
  locale: string;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2" data-report-section="true">
      {sections.map(([title, buckets]) => (
        <SectionCard key={title} title={title}>
          {buckets.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
            <div className="space-y-2">
              {buckets.map((bucket) => (
                <div key={bucket.key} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{titleCase(bucket.key)}</p>
                    <p className="text-xs text-muted-foreground">{formatNumber(bucket.count, locale)}</p>
                  </div>
                  <p className="text-end text-sm font-semibold">
                    {formatValueBucket(bucket, locale)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      ))}
    </div>
  );
}

function DetailedRecordsCallout({ copy }: { copy: typeof COPY.en | typeof COPY.ar }) {
  return (
    <div data-report-no-print="true">
    <SectionCard title={copy.detailedRecords} description={copy.detailedRecordsDescription}>
      <Button variant="outline" asChild>
        <Link href="/lex/reports/builder">
          <SlidersHorizontal className="me-1.5 h-4 w-4" />
          {copy.openBuilder}
        </Link>
      </Button>
    </SectionCard>
    </div>
  );
}

function ReportState<T>({ query, children }: {
  query: { data?: T; isLoading: boolean; isError: boolean; refetch: () => unknown };
  children: (data: T) => React.ReactNode;
}) {
  if (query.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton.Card key={index} />)}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState message="Unable to load this report." onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}

function MetricGrid({ items }: { items: Array<readonly [string, string]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
        </div>
      ))}
    </div>
  );
}

function BreakdownGrid({ sections, total, empty, locale }: {
  sections: Array<readonly [string, LexCountBucket[]]>;
  total: number;
  empty: string;
  locale: string;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-3" data-report-section="true">
      {sections.map(([title, buckets]) => (
        <SectionCard key={title} title={title}>
          {buckets.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
            <div className="space-y-3">
              {buckets.map((bucket) => {
                const pct = total > 0 ? Math.round((bucket.count / total) * 100) : 0;
                return (
                  <div key={bucket.key} className="space-y-1.5">
                    <div className="flex justify-between gap-3 text-sm">
                      <span>{titleCase(bucket.key)}</span>
                      <span className="font-medium">{formatNumber(bucket.count, locale)} · {pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      ))}
    </div>
  );
}

function GeneratedAt({ value, label, locale }: { value: string; label: string; locale: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {label}: {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
        dateStyle: 'medium', timeStyle: 'short',
      }).format(new Date(value))}
    </p>
  );
}

function formatPortfolioValue(report: LexContractAnalyticsReport, locale: string): string {
  const byCurrency = Object.entries(report.total_value_by_currency ?? {});
  if (byCurrency.length > 0) {
    return byCurrency
      .map(([currency, value]) => `${currency} ${formatNumber(value, locale)}`)
      .join(' · ');
  }
  return formatNumber(report.total_value ?? 0, locale);
}

function formatValueBucket(bucket: LexValueBucket, locale: string): string {
  const values = Object.entries(bucket.by_currency ?? {});
  if (values.length > 0) {
    return values
      .map(([currency, value]) => `${currency} ${formatNumber(value, locale)}`)
      .join(' · ');
  }
  return formatNumber(bucket.total_value, locale);
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    maximumFractionDigits: 2,
  }).format(value);
}

function isoDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function presetRange(preset: PeriodPreset): { from: string; to: string } {
  if (preset === 'all') return { from: '', to: '' };
  const to = new Date();
  const from = new Date(to);
  if (preset === '7d') from.setDate(from.getDate() - 6);
  if (preset === '30d') from.setDate(from.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

function sameRange(left: { from: string; to: string }, right: { from: string; to: string }): boolean {
  return left.from === right.from && left.to === right.to;
}
