'use client';

import { useMemo } from 'react';
import {
  AlarmClockOff,
  CheckCircle2,
  Clock,
  MessageCircleQuestion,
  MessagesSquare,
  Send,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type { LexKpiItem } from '@/components/lex/kpi-strip';
import { StatTile } from '@/components/shared/stat-tile';
import { useLexFormat } from '@/lib/lex/ksa';
import { useConsultationLabels } from './labels';

/**
 * Aggregate consultation counts rendered by the KPI strip.
 *
 * STABLE CONTRACT — extend with new fields but never remove the existing four.
 * The list page now feeds these from the dataset-wide `GET /consultations/stats`
 * rollup (filtered to match the active table filters), so the cards reflect the
 * whole filtered dataset rather than the visible page. `breachingSoon` and
 * `breached` are SLA-risk rollups (`due_soon` / `breached`); `avgRespondMinutes`
 * is the mean answer duration over the stats response sample.
 */
export interface ConsultationsStats {
  total: number;
  open: number;
  responded: number;
  approved: number;
  /** SLA: consultations about to breach (#3/#4 — backend `due_soon`). */
  breachingSoon: number;
  /** SLA: consultations already in breach (#3/#4 — backend `breached`). */
  breached: number;
  /** Bonus: mean minutes to first response over the stats sample. */
  avgRespondMinutes?: number;
}

/** SLA-risk filter applied when a risk tile is clicked (#3). */
export type ConsultationSlaTile = 'due_soon' | 'breached';
export type ConsultationLifecycleTile = 'all' | 'open' | 'responded' | 'approved';

export interface ConsultationsKpisProps {
  stats: ConsultationsStats;
  /** When true (and counts not yet known) each tile renders its skeleton. */
  loading?: boolean;
  /**
   * Currently-active `sla_risk` filter, so the matching tile reads as selected.
   */
  activeSlaRisk?: ConsultationSlaTile | null;
  activeLifecycle?: ConsultationLifecycleTile | null;
  /**
   * Clicking an SLA tile toggles the corresponding `sla_risk` filter (#3).
   * Passing `null` clears it (when the active tile is clicked again).
   */
  onSlaTileClick?: (risk: ConsultationSlaTile | null) => void;
  onLifecycleTileClick?: (scope: ConsultationLifecycleTile) => void;
}

/** Compact "minutes → 1h 23m" formatter for the avg-respond line. */
function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/**
 * ConsultationsKpis — KPI strip for the consultations list.
 *
 * Presentational: it owns no queries. The parent passes the already-computed
 * dataset-wide `stats` and a `loading` flag. All six metrics share one compact,
 * responsive grid; the two SLA-risk tiles stay interactive so clicking applies
 * (or clears) the corresponding `sla_risk` filter.
 */
export function ConsultationsKpis({
  stats,
  loading = false,
  activeSlaRisk = null,
  activeLifecycle = null,
  onSlaTileClick,
  onLifecycleTileClick,
}: ConsultationsKpisProps) {
  const labels = useConsultationLabels();
  const f = useLexFormat();

  const dueSoonActive = activeSlaRisk === 'due_soon';
  const breachedActive = activeSlaRisk === 'breached';
  const total = Math.max(0, stats.total);
  const avgResponse = (stats.avgRespondMinutes ?? 0) > 0 ? formatMinutes(stats.avgRespondMinutes ?? 0) : '—';

  // Keep the shared item contract, while rendering locally so lifecycle and SLA
  // metrics can occupy one balanced six-card grid. Values are formatted below
  // with the same KSA formatter used by LexKpiStrip.
  const lifecycleItems: LexKpiItem[] = useMemo(
    () => [
      {
        id: 'total',
        label: labels.stats.total,
        value: stats.total,
        theme: 'primary',
        icon: MessagesSquare,
        progress: total > 0 ? 100 : 0,
        progressLabel: labels.statDetails.workloadShare,
        detail: labels.statDetails.fullQueue,
        detailValue: f.formatNumber(stats.total),
        loading,
        ...(onLifecycleTileClick
          ? { onAction: () => onLifecycleTileClick('all'), pressed: activeLifecycle === 'all' }
          : { href: '/lex/consultations' }),
      },
      {
        id: 'open',
        label: labels.stats.open,
        value: stats.open,
        theme: 'amber',
        icon: MessageCircleQuestion,
        progress: percent(stats.open, total),
        progressLabel: labels.statDetails.workloadShare,
        detail: labels.statDetails.activeQueue,
        detailValue: `${f.formatNumber(percent(stats.open, total))}%`,
        loading,
        ...(onLifecycleTileClick
          ? { onAction: () => onLifecycleTileClick('open'), pressed: activeLifecycle === 'open' }
          : { href: '/lex/consultations?status=submitted%2Cclassified%2Crouted' }),
      },
      {
        id: 'responded',
        label: labels.stats.responded,
        value: stats.responded,
        theme: 'teal',
        icon: Send,
        progress: percent(stats.responded, total),
        progressLabel: labels.statDetails.responseCoverage,
        detail: labels.statDetails.avgResponse,
        detailValue: avgResponse,
        loading,
        ...(onLifecycleTileClick
          ? { onAction: () => onLifecycleTileClick('responded'), pressed: activeLifecycle === 'responded' }
          : { href: '/lex/consultations?status=responded' }),
      },
      {
        id: 'approved',
        label: labels.stats.approved,
        value: stats.approved,
        theme: 'emerald',
        icon: CheckCircle2,
        progress: percent(stats.approved, total),
        progressLabel: labels.statDetails.closureRate,
        detail: labels.statDetails.closureRate,
        detailValue: `${f.formatNumber(percent(stats.approved, total))}%`,
        loading,
        ...(onLifecycleTileClick
          ? { onAction: () => onLifecycleTileClick('approved'), pressed: activeLifecycle === 'approved' }
          : { href: '/lex/consultations?status=approved%2Carchived' }),
      },
    ],
    [
      activeLifecycle,
      avgResponse,
      f,
      labels.statDetails,
      labels.stats,
      loading,
      onLifecycleTileClick,
      stats.approved,
      stats.open,
      stats.responded,
      stats.total,
      total,
    ],
  );

  return (
    <div className="space-y-3">
      <div className="consultations-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        {lifecycleItems.map((item) => (
          <StatTile
            key={item.id ?? item.label}
            label={item.label}
            value={typeof item.value === 'number' ? f.formatNumber(item.value) : item.value}
            themeClass={`kpi-theme-${item.theme ?? 'primary'}`}
            icon={item.icon}
            progress={item.progress}
            progressLabel={item.progressLabel}
            detail={item.detail}
            detailValue={item.detailValue}
            loading={item.loading}
            onAction={item.onAction}
            href={item.href}
            pressed={item.pressed}
            size="md"
            appearance="operational"
          />
        ))}

        <SlaTile
          title={labels.stats.breachingSoon}
          value={f.formatNumber(stats.breachingSoon)}
          progress={percent(stats.breachingSoon, total)}
          progressLabel={labels.statDetails.riskShare}
          detail={labels.sla.dueSoon}
          detailValue={`${f.formatNumber(percent(stats.breachingSoon, total))}%`}
          theme="amber"
          icon={AlarmClockOff}
          loading={loading}
          active={dueSoonActive}
          onClick={onSlaTileClick ? () => onSlaTileClick(dueSoonActive ? null : 'due_soon') : undefined}
        />
        <SlaTile
          title={labels.stats.breached}
          value={f.formatNumber(stats.breached)}
          progress={percent(stats.breached, total)}
          progressLabel={labels.statDetails.breachShare}
          detail={labels.sla.breached}
          detailValue={`${f.formatNumber(percent(stats.breached, total))}%`}
          theme="red"
          icon={Timer}
          loading={loading}
          active={breachedActive}
          onClick={onSlaTileClick ? () => onSlaTileClick(breachedActive ? null : 'breached') : undefined}
        />
      </div>

      {!loading && (stats.avgRespondMinutes ?? 0) > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{labels.analytics.timeToRespond}:</span>
          <span className="font-medium text-foreground">{formatMinutes(stats.avgRespondMinutes ?? 0)}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * SlaTile — an interactive KPI tile that doubles as the `sla_risk` filter
 * control. Wraps {@link StatTile} in a button when `onClick` is supplied so the
 * whole card is keyboard-focusable and toggles the filter; the active state
 * gets a ring + spring-pop so the selected risk segment reads as applied. The
 * pre-formatted (KSA) value passes straight through, so Arabic mode shows
 * Arabic-Indic digits like the strip beside it.
 */
function SlaTile({
  title,
  value,
  progress,
  progressLabel,
  detail,
  detailValue,
  theme,
  icon,
  loading,
  active,
  onClick,
}: {
  title: string;
  value: string;
  progress: number;
  progressLabel: string;
  detail: string;
  detailValue: string;
  theme: 'amber' | 'red';
  icon: LucideIcon;
  loading: boolean;
  active: boolean;
  onClick?: () => void;
}) {
  const card = (
    <StatTile
      label={title}
      value={value}
      themeClass={`kpi-theme-${theme}`}
      icon={icon}
      progress={progress}
      progressLabel={progressLabel}
      detail={detail}
      detailValue={detailValue}
      loading={loading}
      size="md"
      appearance="operational"
      onAction={onClick}
      href={
        onClick
          ? undefined
          : theme === 'amber'
            ? '/lex/consultations?sla_risk=due_soon'
            : '/lex/consultations?sla_risk=breached'
      }
      pressed={active}
    />
  );

  return card;
}
