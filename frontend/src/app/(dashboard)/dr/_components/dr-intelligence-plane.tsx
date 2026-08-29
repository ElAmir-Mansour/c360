'use client';

import {
  Bot,
  BrainCircuit,
  FileSearch,
  ListChecks,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Siren,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type {
  DRCleanRoomScan,
  DRPrediction,
  DRRansomwareSignal,
  DRRegistryRunbookVersion,
  DRStreamForecast,
} from '@/types/clario-dr';
import { useIntelligencePlaneLabels } from './dr-intelligence-plane-labels';

export function DRIntelligencePlane({
  activeStreamId,
  cleanRoomScan,
  error,
  forecast,
  latestRecoveryPointId,
  loading,
  predictions,
  ransomwareSignals,
  registryRunbook,
  registryVersions,
  selectedGroupName,
  streamSignals,
  onRetry,
}: {
  activeStreamId?: string | null;
  cleanRoomScan?: DRCleanRoomScan | null;
  error: unknown;
  forecast?: DRStreamForecast | null;
  latestRecoveryPointId?: string | null;
  loading: boolean;
  predictions: DRPrediction[];
  ransomwareSignals: DRRansomwareSignal[];
  registryRunbook?: DRRegistryRunbookVersion | null;
  registryVersions: DRRegistryRunbookVersion[];
  selectedGroupName?: string | null;
  streamSignals: DRRansomwareSignal[];
  onRetry: () => void;
}) {
  const L = useIntelligencePlaneLabels();
  if (loading && predictions.length === 0 && ransomwareSignals.length === 0 && !registryRunbook && !cleanRoomScan) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && predictions.length === 0 && ransomwareSignals.length === 0 && !registryRunbook && !cleanRoomScan) {
    return <ErrorState message={L.loadError} onRetry={onRetry} />;
  }

  const breachPredictions = predictions.filter((prediction) => prediction.breach_forecast);
  const throughputCollapse = predictions.filter((prediction) => prediction.throughput_collapse).length;
  const confirmedSignals = ransomwareSignals.filter((signal) => normalizeStatus(signal.severity) === 'confirmed');
  const currentPrediction = forecast?.prediction ?? predictions.find((prediction) => prediction.stream_id === activeStreamId) ?? predictions[0] ?? null;
  const cleanVerdict = normalizeStatus(cleanRoomScan?.verdict);
  const cleanRoomReady = cleanVerdict === 'clean';
  const runbookDiff = registryRunbook?.diff;
  const groupName = selectedGroupName ?? registryRunbook?.asset_snapshot?.group_name ?? L.selectedGroupFallback;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <IntelligenceMetric
          title={L.metricPredictiveRpo}
          value={breachPredictions.length}
          detail={currentPrediction?.predicted_breach_seconds ? L.nextBreachIn(formatDuration(currentPrediction.predicted_breach_seconds)) : L.streamsForecast(predictions.length)}
          icon={BrainCircuit}
          tone={breachPredictions.length > 0 ? 'warning' : 'success'}
        />
        <IntelligenceMetric
          title={L.metricRansomwareSignals}
          value={confirmedSignals.length}
          detail={L.recentSignalsDetail(ransomwareSignals.length, streamSignals.length)}
          icon={Siren}
          tone={confirmedSignals.length > 0 ? 'critical' : ransomwareSignals.length > 0 ? 'warning' : 'success'}
        />
        <IntelligenceMetric
          title={L.metricCleanroom}
          value={cleanRoomScan?.verdict ?? L.na}
          detail={latestRecoveryPointId ? L.bytesScanned(formatBytes(cleanRoomScan?.bytes_scanned)) : L.noRecoveryPointSelected}
          icon={ShieldCheck}
          tone={cleanRoomReady ? 'success' : cleanRoomScan ? 'warning' : 'neutral'}
        />
        <IntelligenceMetric
          title={L.metricRegistryRunbook}
          value={registryRunbook?.version ?? L.na}
          detail={registryRunbook ? L.generatedSteps(registryRunbook.steps.length) : L.noRunbookReturned}
          icon={ListChecks}
          tone={registryRunbook ? 'info' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.forecastTitle}</CardTitle>
              <CardDescription>{L.forecastDescription}</CardDescription>
            </div>
            <StatusBadge status={currentPrediction?.breach_forecast ? 'warning' : 'healthy'} label={currentPrediction?.breach_forecast ? L.breachForecast() : L.steady} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.colStream} value={currentPrediction?.stream_id ?? activeStreamId ?? L.na} />
              <MiniDatum label={L.colLag} value={formatDuration(currentPrediction?.smoothed_lag_seconds)} />
              <MiniDatum label={L.colTrend} value={formatNumber(currentPrediction?.lag_trend_slope)} />
              <MiniDatum label={L.colSamples} value={forecast?.samples?.length ?? currentPrediction?.sample_count ?? 0} />
            </div>
            <Progress
              value={forecastRiskPercent(currentPrediction)}
              className="h-2"
              indicatorClassName={currentPrediction?.breach_forecast ? 'bg-amber-500' : 'bg-primary'}
            />
            <div className="space-y-2">
              {predictions.slice(0, 5).map((prediction) => (
                <div key={prediction.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{prediction.stream_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {L.predictionRow(prediction.group_label, formatDateTime(prediction.updated_at))}
                      </div>
                    </div>
                    <StatusBadge status={prediction.breach_forecast ? 'warning' : prediction.throughput_collapse ? 'degraded' : 'healthy'} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                    <MiniDatum label={L.colObjective} value={formatDuration(prediction.rpo_objective_seconds)} />
                    <MiniDatum label={L.colLag} value={formatDuration(prediction.smoothed_lag_seconds)} />
                    <MiniDatum label={L.breachInLabel()} value={formatDuration(prediction.predicted_breach_seconds)} />
                  </div>
                </div>
              ))}
              {predictions.length === 0 ? <EmptyLine icon={Radar} text={L.noPredictionRecords} /> : null}
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {L.throughputCollapseDetected(throughputCollapse)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.ransomwareTitle}</CardTitle>
              <CardDescription>{L.ransomwareDescription}</CardDescription>
            </div>
            <Badge variant="outline">{L.signalsBadge(ransomwareSignals.length)}</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{L.colSignal}</TableHead>
                    <TableHead>{L.colStreamR}</TableHead>
                    <TableHead>{L.colRatio}</TableHead>
                    <TableHead>{L.colCleanPoint}</TableHead>
                    <TableHead>{L.colObserved}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ransomwareSignals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        {L.noRansomwareSignals}
                      </TableCell>
                    </TableRow>
                  ) : (
                    ransomwareSignals.slice(0, 8).map((signal) => (
                      <TableRow key={signal.id}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={signal.severity} />
                            <span className="font-medium">{signal.kind}</span>
                          </div>
                          <div className="mt-1 max-w-[18rem] truncate text-xs text-muted-foreground">{signal.detail}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{signal.stream_id}</TableCell>
                        <TableCell>{L.ratioX(formatNumber(signal.ratio))}</TableCell>
                        <TableCell className="font-mono text-xs">{signal.curated_recovery_point_id ?? L.pending}</TableCell>
                        <TableCell>{formatDateTime(signal.observed_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{L.cleanroomTitle}</CardTitle>
            <CardDescription>{L.cleanroomDescription(latestRecoveryPointId ?? L.notSelected)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniDatum label={L.colVerdict} value={cleanRoomScan?.verdict ?? L.na} />
              <MiniDatum label={L.colScanner} value={cleanRoomScan?.scanner ?? L.na} />
              <MiniDatum label={L.colChunks} value={cleanRoomScan?.chunks_scanned ?? 0} />
              <MiniDatum label={L.colBytes} value={formatBytes(cleanRoomScan?.bytes_scanned)} />
            </div>
            <StatusPanel
              icon={cleanRoomReady ? ShieldCheck : ShieldAlert}
              status={cleanRoomScan?.verdict ?? 'empty'}
              title={cleanRoomReady ? L.cleanPointAvailable : L.cleanPointNotConfirmed}
              detail={cleanRoomScan?.detail ?? L.noCleanroomScan}
            />
            <div className="space-y-2">
              {(cleanRoomScan?.findings ?? []).slice(0, 3).map((finding) => (
                <div key={`${finding.stream_id}-${finding.object_key}`} className="rounded-lg border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate font-mono text-xs">{finding.object_key}</div>
                    <StatusBadge status={finding.clean && finding.integrity_ok ? 'clean' : 'warning'} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(finding.bytes)} / {finding.threat ?? L.noThreatDetected}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{L.registryTitle}</CardTitle>
            <CardDescription>{L.registryDescription(groupName)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniDatum label={L.colVersion} value={registryRunbook?.version ?? L.na} />
              <MiniDatum label={L.colTrigger} value={registryRunbook?.trigger ?? L.na} />
              <MiniDatum label={L.colMembers} value={registryRunbook?.asset_snapshot?.members?.length ?? 0} />
              <MiniDatum label={L.colHash} value={shortHash(registryRunbook?.content_hash)} />
            </div>
            <div className="space-y-2">
              {(registryRunbook?.steps ?? []).slice(0, 5).map((step) => (
                <div key={step.key} className="flex items-start gap-3 rounded-lg border px-3 py-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                    {step.order}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{step.title}</div>
                    <div className="text-xs text-muted-foreground">{step.kind} / {step.gate ?? L.noGate}</div>
                  </div>
                </div>
              ))}
              {(registryRunbook?.steps ?? []).length === 0 ? <EmptyLine icon={ListChecks} text={L.noGeneratedRunbook} /> : null}
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-sm font-medium">{L.latestDiff}</div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                <MiniDatum label={L.diffAdded} value={runbookDiff?.added?.length ?? 0} />
                <MiniDatum label={L.diffChanged} value={runbookDiff?.changed?.length ?? 0} />
                <MiniDatum label={L.diffRemoved} value={runbookDiff?.removed?.length ?? 0} />
                <MiniDatum label={L.diffReordered} value={runbookDiff?.reordered?.length ?? 0} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{L.copilotTitle}</CardTitle>
            <CardDescription>{L.copilotDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <StatusPanel
              icon={Bot}
              status="ready"
              title={L.copilotApiWired}
              detail={L.copilotApiDetail}
            />
            <div className="grid grid-cols-2 gap-3">
              <MiniDatum label={L.colVersions} value={registryVersions.length} />
              <MiniDatum label={L.colLastVersion} value={registryVersions[0]?.version ?? registryRunbook?.version ?? L.na} />
              <MiniDatum label={L.colSignals} value={streamSignals.length} />
              <MiniDatum label={L.colRecoveryPoint} value={latestRecoveryPointId ?? L.na} />
            </div>
            <div className="space-y-2">
              {(registryVersions.length > 0 ? registryVersions : registryRunbook ? [registryRunbook] : []).slice(0, 3).map((version) => (
                <div key={version.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-xs">{L.runbookVersion(String(version.version))}</div>
                    <StatusBadge status={version.trigger} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(version.created_at)} / {shortHash(version.content_hash)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Bridge the dynamic state tone onto the materialized `.kpi-theme-*` semantic
// palette: RAG preserved (success→emerald, warning→gold/amber, critical→
// rose/red), `info`→sky (count/quantity), `neutral`→flat.
const INTELLIGENCE_TONE_THEME: Record<'success' | 'warning' | 'critical' | 'info' | 'neutral', string> = {
  success: 'kpi-theme-emerald',
  warning: 'kpi-theme-amber',
  critical: 'kpi-theme-red',
  info: 'kpi-theme-sky',
  neutral: '',
};

function IntelligenceMetric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral';
}) {
  if (tone === 'neutral') {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-overline font-semibold uppercase text-muted-foreground">{title}</div>
              <div className="mt-3 truncate text-3xl font-semibold tracking-tight">{value}</div>
            </div>
            <div className={cn('rounded-lg p-2.5', toneClass(tone, 'soft'))}>
              <Icon className={cn('h-5 w-5', toneClass(tone, 'text'))} />
            </div>
          </div>
          <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className={cn('kpi-card-themed', INTELLIGENCE_TONE_THEME[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-overline font-semibold uppercase text-[color:var(--kpi-accent)]">
            {title}
          </div>
          <div className="mt-3 truncate text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        </div>
        <div className="kpi-icon-badge shrink-0">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </div>
      <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function StatusPanel({
  icon: Icon,
  status,
  title,
  detail,
}: {
  icon: LucideIcon;
  status?: string | null;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function MiniDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'confirmed' || normalized === 'malware' || normalized === 'integrity_failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'degraded' || normalized === 'throughput_collapse'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'ready' || normalized === 'clean' || normalized === 'manual' || normalized === 'recovery_point'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? normalized.replace(/_/g, ' ')}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span>{text}</span>
    </div>
  );
}

function forecastRiskPercent(prediction?: DRPrediction | null) {
  if (!prediction) return 0;
  if (prediction.breach_forecast) return 88;
  if (prediction.throughput_collapse) return 72;
  const objective = Math.max(1, prediction.rpo_objective_seconds);
  return Math.max(4, Math.min(100, Math.round((prediction.smoothed_lag_seconds / objective) * 100)));
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function toneClass(tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral', part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
    critical: { soft: 'bg-error-50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300' },
    info: { soft: 'bg-sky-50 dark:bg-sky-950/25', text: 'text-sky-700 dark:text-sky-300' },
    neutral: { soft: 'bg-muted', text: 'text-muted-foreground' },
  } as const;
  return styles[tone][part];
}

function formatDuration(seconds?: number | null) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
}

function formatBytes(bytes?: number | null) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function formatNumber(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return 'n/a';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}
