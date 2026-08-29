/**
 * Watheeq (Lex) compliance dashboard breakdown charts + compliance-score gauge
 * (Features 3 + 4).
 *
 * Two self-contained, strongly typed exports:
 *
 *   - <ComplianceBreakdownCharts dashboard={...} />  — a responsive grid of
 *     SectionCards charting the dashboard's `active_alerts_by_severity`
 *     (unresolved-only severity-toned donut, falling back to the lifetime
 *     `alerts_by_severity` on older payloads), `alerts_by_status` (status bar),
 *     and `rules_by_type` (rule-type bar). Empty/zero maps render a muted
 *     "no data" line instead of an empty chart.
 *
 *   - <ComplianceScoreGauge score={...} />  — a half-gauge with red / amber /
 *     green threshold bands from the shared `COMPLIANCE_SCORE_THRESHOLDS`
 *     (<75 red, 75-89 amber, >=90 green) and a target caption. Augments /
 *     replaces the flat "Compliance Score" KPI.
 *
 * Bilingual: this file OWNS its labels via a `LexBilingual<ChartLabels>` bundle
 * + `useComplianceChartLabels()` hook, following the canonical lex contract
 * (`../../_lib/lex-i18n.ts`). English reads naturally; Arabic uses the suite
 * glossary (الامتثال / لائحة / عقد / تنبيه / الحوكمة). Enum keys are mapped to
 * localized display strings before being handed to the charts.
 *
 * RTL-correct: only logical Tailwind props (ms-/me-/ps-/pe-/start-/end-). Visual
 * primitives are reused from the shared design system (SectionCard, the chart
 * wrappers); no new primitives are invented.
 */

'use client';

import { Button } from '@/components/ui/button';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { AppLocale } from '@/lib/i18n';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { SectionCard } from '@/components/suites/section-card';
import { cn } from '@/lib/utils';
import {
  SEVERITY_COLORS as DS_SEVERITY_COLORS,
  STATUS_COLORS as DS_STATUS_COLORS,
  CHART_COLORS,
} from '@/lib/design-tokens';
import type { LexComplianceDashboard } from '@/types/suites';
import {
  COMPLIANCE_SCORE_TARGET,
  COMPLIANCE_SCORE_THRESHOLDS,
} from '../../_lib/compliance-score';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// Bilingual labels (self-contained — this file owns its copy).
// ---------------------------------------------------------------------------

export interface ComplianceChartLabels {
  severity: {
    title: string;
    description: string;
    empty: string;
    center: string;
  };
  status: {
    title: string;
    description: string;
    empty: string;
    seriesLabel: string;
  };
  ruleType: {
    title: string;
    description: string;
    empty: string;
    seriesLabel: string;
  };
  gauge: {
    title: string;
    description: string;
    label: string;
    target: (target: number) => string;
    band: (label: string) => string;
    /**
     * Band legend copy, generated from the shared thresholds so the wording
     * always agrees with the gauge's inclusive `pct >= good` boundary.
     */
    bands: {
      healthy: (good: number) => string;
      watch: (warning: number, good: number) => string;
      atRisk: (warning: number) => string;
    };
  };
  /** Enum-key → display maps. Both locales carry the SAME key set. */
  severities: Record<string, string>;
  statuses: Record<string, string>;
  ruleTypes: Record<string, string>;
}

export const complianceChartLabels: LexBilingual<ComplianceChartLabels> = {
  en: {
    severity: {
      title: 'Alerts by Severity',
      description: 'Distribution of unresolved (active) compliance alerts across severity tiers.',
      empty: 'No alerts to chart yet.',
      center: 'Alerts',
    },
    status: {
      title: 'Alerts by Status',
      description: 'Where compliance alerts sit in the resolution workflow.',
      empty: 'No alerts to chart yet.',
      seriesLabel: 'Alerts',
    },
    ruleType: {
      title: 'Rules by Type',
      description: 'Coverage of the regulation library across rule types.',
      empty: 'No rules configured yet.',
      seriesLabel: 'Rules',
    },
    gauge: {
      title: 'Compliance Score',
      description: 'Portfolio compliance health against the target threshold.',
      label: 'Compliance score',
      target: (target) => `Target ${target}%`,
      band: (label) => label,
      bands: {
        healthy: (good) => `Healthy (>=${good}%)`,
        watch: (warning, good) => `Watch (${warning}-${good - 1}%)`,
        atRisk: (warning) => `At risk (<${warning}%)`,
      },
    },
    severities: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Info',
    },
    statuses: {
      open: 'Open',
      acknowledged: 'Acknowledged',
      investigating: 'Investigating',
      resolved: 'Resolved',
      dismissed: 'Dismissed',
    },
    ruleTypes: {
      expiry_warning: 'Expiry warning',
      missing_clause: 'Missing clause',
      risk_threshold: 'Risk threshold',
      review_overdue: 'Review overdue',
      unsigned_contract: 'Unsigned contract',
      value_threshold: 'Value threshold',
      jurisdiction_check: 'Jurisdiction check',
      data_protection_required: 'Data protection required',
      custom: 'Custom',
    },
  },
  ar: {
    severity: {
      title: 'التنبيهات حسب الخطورة',
      description: 'توزيع تنبيهات الامتثال غير المحلولة (النشطة) على مستويات الخطورة.',
      empty: 'لا توجد تنبيهات للعرض بعد.',
      center: 'التنبيهات',
    },
    status: {
      title: 'التنبيهات حسب الحالة',
      description: 'موضع تنبيهات الامتثال في سير عمل المعالجة.',
      empty: 'لا توجد تنبيهات للعرض بعد.',
      seriesLabel: 'التنبيهات',
    },
    ruleType: {
      title: 'القواعد حسب النوع',
      description: 'تغطية مكتبة اللوائح عبر أنواع القواعد.',
      empty: 'لم تتم تهيئة أي قواعد بعد.',
      seriesLabel: 'القواعد',
    },
    gauge: {
      title: 'درجة الامتثال',
      description: 'صحة امتثال المحفظة مقابل حدّ الهدف.',
      label: 'درجة الامتثال',
      target: (target) => `الهدف ${target}%`,
      band: (label) => label,
      bands: {
        healthy: (good) => `سليم (>=${good}%)`,
        watch: (warning, good) => `مراقبة (${warning}-${good - 1}%)`,
        atRisk: (warning) => `في خطر (<${warning}%)`,
      },
    },
    severities: {
      critical: 'حرج',
      high: 'مرتفع',
      medium: 'متوسط',
      low: 'منخفض',
      info: 'معلومة',
    },
    statuses: {
      open: 'مفتوح',
      acknowledged: 'مُقَر به',
      investigating: 'قيد التحقيق',
      resolved: 'محلول',
      dismissed: 'مرفوض',
    },
    ruleTypes: {
      expiry_warning: 'تنبيه انتهاء',
      missing_clause: 'بند مفقود',
      risk_threshold: 'حدّ المخاطر',
      review_overdue: 'مراجعة متأخرة',
      unsigned_contract: 'عقد غير موقّع',
      value_threshold: 'حدّ القيمة',
      jurisdiction_check: 'فحص الاختصاص',
      data_protection_required: 'حماية البيانات مطلوبة',
      custom: 'مخصّص',
    },
  },
};

export function useComplianceChartLabels(): ComplianceChartLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(complianceChartLabels, locale), [locale]);
}

/** Pure resolver for non-React callers / tests. */
export function resolveComplianceChartLabels(locale: AppLocale = 'en'): ComplianceChartLabels {
  return resolveLexBilingual(complianceChartLabels, locale === 'ar' ? 'ar' : 'en');
}

// ---------------------------------------------------------------------------
// Color tokens.
//
// Recharts needs raw color strings (not Tailwind class names / CSS vars), so we
// pull the RESOLVED design-system values from `@/lib/design-tokens` (the single
// source of truth kept in sync with the `:root` block) instead of re-hardcoding
// hex here. Severity uses the canonical ramp (critical→red, high→orange,
// medium→amber, low→green, info→sky); alert status maps onto the semantic status
// tones; rule-type bars use the brand-led categorical series.
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, string> = { ...DS_SEVERITY_COLORS };

const STATUS_COLORS: Record<string, string> = {
  open: DS_STATUS_COLORS.error, // needs attention
  acknowledged: DS_STATUS_COLORS.warning,
  investigating: DS_STATUS_COLORS.info,
  resolved: DS_STATUS_COLORS.success,
  dismissed: DS_STATUS_COLORS.neutral, // closed-out
};

/** Categorical series for rule-type bars (no semantic severity ordering). */
const RULE_TYPE_PALETTE = CHART_COLORS;

const FALLBACK_COLOR = DS_STATUS_COLORS.neutral;

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const STATUS_ORDER = ['open', 'acknowledged', 'investigating', 'resolved', 'dismissed'];

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function formatToken(token: string): string {
  return token.replace(/_/g, ' ');
}

function hasData(map: Record<string, number> | undefined | null): boolean {
  if (!map) return false;
  return Object.values(map).some((v) => typeof v === 'number' && v > 0);
}

/** Stable-orders known keys first (by the provided order), then any extras. */
function orderedEntries(
  map: Record<string, number>,
  order: readonly string[],
): Array<[string, number]> {
  const entries = Object.entries(map).filter(([, v]) => typeof v === 'number' && v > 0);
  return entries.sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** A muted, centered "no data" line matching the page's empty-state copy tone. */
function NoData({ message }: { message: string }) {
  return (
    <div className="flex h-[180px] items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature 3 — breakdown charts.
// ---------------------------------------------------------------------------

export interface ComplianceBreakdownChartsProps {
  dashboard: LexComplianceDashboard;
  onAlertSeveritySelect?: (severity: string) => void;
  onAlertStatusSelect?: (status: string) => void;
  onRuleTypeSelect?: (ruleType: string) => void;
  className?: string;
}

/**
 * ComplianceBreakdownCharts renders the dashboard's three breakdown maps as a
 * responsive grid of charts. Each chart degrades to a muted "no data" line when
 * its map is empty or all-zero.
 */
export function ComplianceBreakdownCharts({
  dashboard,
  onAlertSeveritySelect,
  onAlertStatusSelect,
  onRuleTypeSelect,
  className,
}: ComplianceBreakdownChartsProps) {
  const labels = useComplianceChartLabels();
  const f = useLexFormat();

  // Prefer the unresolved-only breakdown; fall back to the lifetime map on
  // payloads from backends that don't emit `active_alerts_by_severity` yet.
  const severityMap = dashboard.active_alerts_by_severity ?? dashboard.alerts_by_severity;

  const severityData = useMemo(
    () =>
      orderedEntries(severityMap ?? {}, SEVERITY_ORDER).map(([key, value]) => ({
        key,
        name: labels.severities[key] ?? formatToken(key),
        value,
        color: SEVERITY_COLORS[key] ?? FALLBACK_COLOR,
      })),
    [severityMap, labels.severities],
  );

  const statusData = useMemo(
    () =>
      orderedEntries(dashboard.alerts_by_status ?? {}, STATUS_ORDER).map(([key, value]) => ({
        key,
        bucket: labels.statuses[key] ?? formatToken(key),
        value,
        color: STATUS_COLORS[key] ?? FALLBACK_COLOR,
      })),
    [dashboard.alerts_by_status, labels.statuses],
  );

  const ruleTypeData = useMemo(
    () =>
      orderedEntries(dashboard.rules_by_type ?? {}, []).map(([key, value], idx) => ({
        key,
        bucket: labels.ruleTypes[key] ?? formatToken(key),
        value,
        color: RULE_TYPE_PALETTE[idx % RULE_TYPE_PALETTE.length],
      })),
    [dashboard.rules_by_type, labels.ruleTypes],
  );

  const severityTotal = severityData.reduce((sum, d) => sum + d.value, 0);

  const severityHasData = hasData(severityMap);
  const statusHasData = hasData(dashboard.alerts_by_status);
  const ruleTypeHasData = hasData(dashboard.rules_by_type);

  return (
    <div className={cn('grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3', className)}>
      <SectionCard title={labels.severity.title} description={labels.severity.description}>
        {severityHasData ? (
          <PieChart
            data={severityData}
            height={260}
            centerValue={f.formatNumber(severityTotal)}
            centerLabel={labels.severity.center}
            onItemSelect={(name) => {
              const item = severityData.find((entry) => entry.name === name);
              if (item) onAlertSeveritySelect?.(item.key);
            }}
          />
        ) : (
          <NoData message={labels.severity.empty} />
        )}
      </SectionCard>

      <SectionCard title={labels.status.title} description={labels.status.description}>
        {statusHasData ? (
          <BarChart
            data={statusData}
            xKey="bucket"
            yKeys={[{ key: 'value', label: labels.status.seriesLabel, color: STATUS_COLORS.open }]}
            cellColors={statusData.map((d) => d.color)}
            showLegend={false}
            height={260}
            onItemSelect={(datum) => onAlertStatusSelect?.(String(datum.key ?? ''))}
          />
        ) : (
          <NoData message={labels.status.empty} />
        )}
      </SectionCard>

      <SectionCard title={labels.ruleType.title} description={labels.ruleType.description}>
        {ruleTypeHasData ? (
          <BarChart
            data={ruleTypeData}
            xKey="bucket"
            yKeys={[
              { key: 'value', label: labels.ruleType.seriesLabel, color: RULE_TYPE_PALETTE[0] },
            ]}
            cellColors={ruleTypeData.map((d) => d.color)}
            layout="horizontal"
            showLegend={false}
            height={260}
            onItemSelect={(datum) => onRuleTypeSelect?.(String(datum.key ?? ''))}
          />
        ) : (
          <NoData message={labels.ruleType.empty} />
        )}
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature 4 — compliance-score gauge.
// ---------------------------------------------------------------------------

export interface ComplianceScoreGaugeProps {
  /** 0-100 compliance score. */
  score: number;
  /** Target threshold caption, in percent. Defaults to the shared target. */
  target?: number;
  className?: string;
  onAction?: () => void;
}

/**
 * ComplianceScoreGauge renders the compliance score on a half-gauge with
 * red / amber / green threshold bands from the shared
 * {@link COMPLIANCE_SCORE_THRESHOLDS} (<75 red, 75-89 amber, >=90 green) plus a
 * target caption (default {@link COMPLIANCE_SCORE_TARGET}%). It augments /
 * replaces the flat KPI tile.
 *
 * The shared GaugeChart resolves its arc color from `thresholds` expressed as
 * percentages of `max`: pct >= good → success (green), >= warning → warning
 * (amber), else error (red) — matching the legend's inclusive band wording.
 */
export function ComplianceScoreGauge({
  score,
  target = COMPLIANCE_SCORE_TARGET,
  className,
  onAction,
}: ComplianceScoreGaugeProps) {
  const labels = useComplianceChartLabels();
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;

  const gauge = (
    <SectionCard
      title={labels.gauge.title}
      description={labels.gauge.description}
      className={className}
    >
      <div className="flex flex-col items-center gap-4">
        <GaugeChart
          value={safeScore}
          max={100}
          thresholds={COMPLIANCE_SCORE_THRESHOLDS}
          label={labels.gauge.label}
          format="percentage"
          size={220}
        />

        {/* Target caption + threshold-band legend (generated from the shared
            thresholds so copy and arc color can never diverge). */}
        <div className="flex w-full flex-col items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {labels.gauge.target(target)}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <BandKey
              color={DS_STATUS_COLORS.success}
              label={labels.gauge.bands.healthy(COMPLIANCE_SCORE_THRESHOLDS.good)}
            />
            <BandKey
              color={DS_STATUS_COLORS.warning}
              label={labels.gauge.bands.watch(
                COMPLIANCE_SCORE_THRESHOLDS.warning,
                COMPLIANCE_SCORE_THRESHOLDS.good,
              )}
            />
            <BandKey
              color={DS_STATUS_COLORS.error}
              label={labels.gauge.bands.atRisk(COMPLIANCE_SCORE_THRESHOLDS.warning)}
            />
          </div>
        </div>
      </div>
    </SectionCard>
  );

  if (!onAction) return gauge;
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className="h-auto w-full items-stretch justify-start rounded-xl p-0 text-start font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {gauge}
    </Button>
  );
}

function BandKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}
