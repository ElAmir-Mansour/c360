'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { AlertTriangle, GitBranch, CheckSquare, BarChart3 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatNumber } from '@/lib/format/numerals';
import { API_ENDPOINTS } from '@/lib/constants';
import { KpiCard } from './kpi-card';
import { SparkLine } from './spark-line';
import { useDashboardRealtimeData } from './use-dashboard-realtime-data';
import { useDashboardText } from './dashboard-i18n';
import { DashboardDataStatus } from './dashboard-data-status';
import { KpiLiveAnnouncer } from './kpi-live-announcer';
import { severityVar, statusVar } from '@/lib/design-tokens';
import { KPI_GRID_CLASS, shouldShowPendingTaskKpi } from './kpi-grid-policy';

/** Backend wraps responses in {"data": ...} envelope */
interface AlertCountEnvelope { data: { count: number; trend?: number; history?: number[] } }
interface PipelineCountEnvelope { data: { count: number; history?: number[] } }
interface TaskCount { pending: number; overdue: number }
interface QualityScoreEnvelope { data: { overall_score: number; trend?: string; pass_rate?: number; history?: number[] } }

export function KpiGrid() {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const t = useDashboardText();
  const hasCyber = hasPermission('cyber:read');
  const hasData = hasPermission('data:read');
  /** Locale-aware integer formatting; passes undefined through so StatTile shows "—". */
  const fmt = (n: number | undefined) =>
    n === undefined ? undefined : formatNumber(n, locale);

  const {
    data: alertEnvelope,
    isLoading: alertLoading,
    isValidating: alertValidating,
    error: alertError,
    lastUpdate: alertUpdate,
    mutate: refreshAlerts,
  } =
    useDashboardRealtimeData<AlertCountEnvelope>(API_ENDPOINTS.CYBER_ALERTS_COUNT, {
      params: { status: 'new,acknowledged' },
      wsTopics: ['alert.created', 'alert.escalated', 'alert.resolved'],
      enabled: hasCyber,
    });
  const alertData = alertEnvelope?.data;

  const {
    data: pipelineEnvelope,
    isLoading: pipelineLoading,
    isValidating: pipelineValidating,
    error: pipelineError,
    lastUpdate: pipelineUpdate,
    mutate: refreshPipelines,
  } = useDashboardRealtimeData<PipelineCountEnvelope>(API_ENDPOINTS.DATA_PIPELINES_COUNT, {
    params: { status: 'failed' },
    wsTopics: ['pipeline.failed', 'pipeline.completed'],
    enabled: hasData,
  });
  const pipelineData = pipelineEnvelope?.data;

  const {
    data: taskData,
    isLoading: taskLoading,
    error: taskError,
    isPermissionDenied: taskPermissionDenied,
    isValidating: taskValidating,
    lastUpdate: taskUpdate,
    mutate: refreshTasks,
    connectionStatus,
    isFallbackPolling,
  } = useDashboardRealtimeData<TaskCount>(API_ENDPOINTS.WORKFLOWS_TASKS_COUNT, {
    wsTopics: [
      'task.assigned',
      'task.completed',
      'task.escalated',
      'workflow.task.created',
      'workflow.task.completed',
      'workflow.task.escalated',
    ],
  });

  const {
    data: qualityEnvelope,
    isLoading: qualityLoading,
    isValidating: qualityValidating,
    error: qualityError,
    lastUpdate: qualityUpdate,
    mutate: refreshQuality,
  } = useDashboardRealtimeData<QualityScoreEnvelope>(API_ENDPOINTS.DATA_QUALITY_SCORE, {
    wsTopics: ['data_quality.issue_detected'],
    enabled: hasData,
  });
  const qualityData = qualityEnvelope?.data;

  const alertDelta = useLiveDelta(alertData?.count);
  const pipelineDelta = useLiveDelta(pipelineData?.count);
  const taskDelta = useLiveDelta(taskData?.pending);
  const qualityDelta = useLiveDelta(qualityData?.overall_score);

  // Build sparkline history from data (use provided history or build from live deltas)
  const alertHistory = useSparkHistory(alertData?.count, alertData?.history);
  const pipelineHistory = useSparkHistory(pipelineData?.count, pipelineData?.history);
  const qualityHistory = useSparkHistory(qualityData?.overall_score, qualityData?.history);

  // A zero task tile immediately followed by an empty My Tasks list repeats the
  // same fact. Keep the actionable list as the zero-state and surface this KPI
  // only while loading/failed or when work actually needs attention.
  const showTaskCard = shouldShowPendingTaskKpi({
    permissionDenied: taskPermissionDenied,
    isLoading: taskLoading,
    hasError: Boolean(taskError),
    pending: taskData?.pending,
    overdue: taskData?.overdue,
  });
  const visibleCardCount =
    (hasCyber ? 1 : 0) + (hasData ? 2 : 0) + (showTaskCard ? 1 : 0);
  const announcementItems = [
    { id: 'alerts', label: t.kpi.openAlerts, value: alertData?.count },
    { id: 'pipelines', label: t.kpi.failedPipelines, value: pipelineData?.count },
    { id: 'tasks', label: t.kpi.pendingTasks, value: taskData?.pending },
    { id: 'quality', label: t.kpi.dataQuality, value: qualityData?.overall_score },
  ];

  const successfulUpdates = [
    hasCyber ? alertUpdate : null,
    hasData ? pipelineUpdate : null,
    showTaskCard ? taskUpdate : null,
    hasData ? qualityUpdate : null,
  ].filter((date): date is Date => date !== null);
  // The whole strip is only as fresh as its oldest visible data source.
  const lastUpdated = successfulUpdates.length > 0
    ? new Date(Math.min(...successfulUpdates.map((date) => date.getTime())))
    : null;
  const isRefreshing =
    alertValidating || pipelineValidating || taskValidating || qualityValidating;
  const refreshVisibleCards = () => {
    const refreshes: Promise<void>[] = [];
    if (hasCyber) refreshes.push(refreshAlerts());
    if (hasData) refreshes.push(refreshPipelines(), refreshQuality());
    if (showTaskCard) refreshes.push(refreshTasks());
    void Promise.all(refreshes);
  };

  let cardIndex = 0;

  return (
    <>
      <KpiLiveAnnouncer items={announcementItems} />
      {visibleCardCount > 0 && (
        <section aria-label={t.kpi.sectionLabel} className="space-y-2.5">
          <DashboardDataStatus
            lastUpdated={lastUpdated}
            connectionStatus={connectionStatus}
            isFallbackPolling={isFallbackPolling}
            isRefreshing={isRefreshing}
            onRefresh={refreshVisibleCards}
          />
          <div className={KPI_GRID_CLASS}>
            {hasCyber && (
              <KpiCard
                title={t.kpi.openAlerts}
                value={fmt(alertData?.count)}
                icon={AlertTriangle}
                iconColor="text-destructive"
                tone="rose"
                href="/cyber/alerts"
                isLoading={alertLoading}
                isError={Boolean(alertError)}
                highlightKey={alertUpdate?.getTime() ?? null}
                liveDelta={alertDelta}
                index={cardIndex++}
                trend={
                  alertData?.trend !== undefined
                    ? {
                        value: alertData.trend,
                        label: t.kpi.trend24h,
                        direction:
                          alertData.trend > 0 ? 'up' : alertData.trend < 0 ? 'down' : 'neutral',
                        sentiment: alertData.trend > 0 ? 'bad' : 'good',
                      }
                    : undefined
                }
              >
                {alertHistory.length >= 2 && (
                  <SparkLine data={alertHistory} color={severityVar('critical')} />
                )}
              </KpiCard>
            )}
            {hasData && (
              <KpiCard
                title={t.kpi.failedPipelines}
                value={fmt(pipelineData?.count)}
                icon={GitBranch}
                iconColor="text-warning-700 dark:text-warning-300"
                tone="gold"
                href="/data/pipelines"
                isLoading={pipelineLoading}
                isError={Boolean(pipelineError)}
                highlightKey={pipelineUpdate?.getTime() ?? null}
                liveDelta={pipelineDelta}
                index={cardIndex++}
              >
                {pipelineHistory.length >= 2 && (
                  <SparkLine data={pipelineHistory} color={severityVar('high')} />
                )}
              </KpiCard>
            )}
            {showTaskCard && (
              <KpiCard
                title={t.kpi.pendingTasks}
                value={fmt(taskData?.pending)}
                icon={CheckSquare}
                iconColor="text-blue-500"
                tone="sky"
                href="/workflows/tasks"
                isLoading={taskLoading}
                isError={Boolean(taskError)}
                highlightKey={taskUpdate?.getTime() ?? null}
                liveDelta={taskDelta}
                index={cardIndex++}
                trend={
                  taskData?.overdue !== undefined && taskData.overdue > 0
                    ? {
                        value: taskData.overdue,
                        label: t.kpi.trendOverdue,
                        direction: 'up',
                        sentiment: 'bad',
                      }
                    : undefined
                }
              />
            )}
            {hasData && (
              <KpiCard
                title={t.kpi.dataQuality}
                value={
                  qualityData?.overall_score !== undefined
                    ? formatNumber(qualityData.overall_score, locale, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })
                    : undefined
                }
                unit="%"
                icon={BarChart3}
                iconColor="text-primary"
                tone="emerald"
                href="/data/quality"
                isLoading={qualityLoading}
                isError={Boolean(qualityError)}
                highlightKey={qualityUpdate?.getTime() ?? null}
                liveDelta={qualityDelta}
                index={cardIndex++}
                trend={
                  qualityData?.pass_rate !== undefined
                    ? {
                        value: Math.round(qualityData.pass_rate),
                        label: t.kpi.trendPassRate,
                        direction: qualityData.pass_rate >= 90 ? 'up' : 'down',
                        sentiment: qualityData.pass_rate >= 80 ? 'good' : 'bad',
                      }
                    : undefined
                }
              >
                {qualityHistory.length >= 2 && (
                  <SparkLine data={qualityHistory} color={statusVar('success')} />
                )}
              </KpiCard>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function useLiveDelta(value: number | undefined): number | null {
  const previousValue = useRef<number | undefined>(value);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    if (value === undefined || previousValue.current === undefined) {
      previousValue.current = value;
      return;
    }

    const nextDelta = value - previousValue.current;
    previousValue.current = value;
    if (nextDelta !== 0) {
      setDelta(nextDelta);
      const timeout = window.setTimeout(() => setDelta(null), 3000);
      return () => window.clearTimeout(timeout);
    }
  }, [value]);

  return delta;
}

/** Builds a rolling sparkline history from live value changes or initial history array */
function useSparkHistory(currentValue: number | undefined, serverHistory?: number[]): number[] {
  const historyRef = useRef<number[]>([]);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    // If server provides history, use it as the base
    if (serverHistory && serverHistory.length > 0) {
      historyRef.current = [...serverHistory];
      setHistory(historyRef.current);
      return;
    }

    // Otherwise build incrementally from live values
    if (currentValue !== undefined) {
      const next = [...historyRef.current, currentValue].slice(-12);
      historyRef.current = next;
      setHistory(next);
    }
  }, [currentValue, serverHistory]);

  return history;
}
