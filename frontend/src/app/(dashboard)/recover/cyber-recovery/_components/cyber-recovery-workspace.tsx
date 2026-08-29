'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ShieldAlert, Snowflake, Clock, Plus, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { useAuth } from '@/hooks/use-auth';
import { showSuccess, showBackendError } from '@/lib/toast';
import { formatDateTime, formatDuration } from '@/lib/format';
import { fetchCyberRecoveryOverview, selectCleanPoint } from '@/lib/recover-cyber';
import type { CyberCleanPoint } from '@/types/recover-cyber';
import { RecoveryFlowPanel } from './recovery-flow-panel';
import { phaseLabel, phaseVariant, verdictVariant } from './phase';
import { useRecoverT } from '../../_lib/recover-i18n';

/**
 * CyberRecoveryWorkspace
 * ======================
 * The Cyber Recovery sub-solution surface. It composes the real backend
 * /api/recover/cyber-recovery endpoints which themselves compose dr/* services:
 *  - ransomware-detection signals + clean-point freshness (the dashboard),
 *  - the clean-room recovery flow with the MANDATORY integrity gate (the panel).
 *
 * Permissions are resolved server-side; the UI additionally reads the caller's
 * permissions to hide controls they cannot use (approve/return), but the server
 * is the enforcement point.
 */
export function CyberRecoveryWorkspace() {
  const t = useRecoverT();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('dr:admin');
  const canReturn = hasPermission('dr:failover');
  const canStart = hasPermission('dr:write');

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['recover', 'cyber', 'overview'],
    queryFn: fetchCyberRecoveryOverview,
  });

  if (overview.isLoading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton variant="card" />
        <LoadingSkeleton variant="card" />
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  }

  const data = overview.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold">{t('cyber.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('cyber.intro')}</p>
      </header>

      {/* Signal strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SignalCard
          icon={<ShieldAlert className="h-5 w-5 text-error-600" aria-hidden />}
          label={t('cyber.signalRansomware')}
          value={String(data.confirmed_ransomware_signals)}
          tone={data.confirmed_ransomware_signals > 0 ? 'danger' : 'ok'}
        />
        <SignalCard
          icon={<Snowflake className="h-5 w-5 text-primary" aria-hidden />}
          label={t('cyber.signalCleanPoints')}
          value={String(data.clean_points.length)}
        />
        <SignalCard
          icon={<Clock className="h-5 w-5 text-warning-600" aria-hidden />}
          label={t('cyber.signalFreshness')}
          value={
            data.clean_point_freshness_seconds != null
              ? formatDuration(data.clean_point_freshness_seconds)
              : '—'
          }
          tone={data.latest_clean_point ? 'ok' : 'warn'}
        />
        <SignalCard
          icon={<Activity className="h-5 w-5 text-primary" aria-hidden />}
          label={t('cyber.signalAwaiting')}
          value={String(data.flows_awaiting_approval)}
          tone={data.flows_awaiting_approval > 0 ? 'warn' : 'ok'}
        />
      </div>

      {selectedFlowId ? (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedFlowId(null)}>
            {t('cyber.backToFlows')}
          </Button>
          <RecoveryFlowPanel flowId={selectedFlowId} canApprove={canApprove} canReturn={canReturn} />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <FlowsCard
              flows={data.flows}
              onOpen={setSelectedFlowId}
            />
            <RansomwareCard signals={data.ransomware_signals} />
          </div>
          <div className="space-y-6">
            {canStart && (
              <NewFlowCard
                cleanPoints={data.clean_points}
                onCreated={(id) => {
                  void qc.invalidateQueries({ queryKey: ['recover', 'cyber', 'overview'] });
                  setSelectedFlowId(id);
                }}
              />
            )}
            <CleanPointsCard cleanPoints={data.clean_points} />
          </div>
        </div>
      )}
    </div>
  );
}

function SignalCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  const border =
    tone === 'danger'
      ? 'border-error-300/60'
      : tone === 'warn'
        ? 'border-warning-300/60'
        : 'border-border/60';
  return (
    <Card className={border}>
      <CardContent className="flex items-center gap-3 p-4">
        {icon}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FlowsCard({
  flows,
  onOpen,
}: {
  flows: import('@/types/recover-cyber').CyberRecoveryFlow[];
  onOpen: (id: string) => void;
}) {
  const t = useRecoverT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('cyber.recoveryFlows')}</CardTitle>
        <CardDescription>{t('cyber.recoveryFlowsDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {flows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('cyber.noFlows')}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {flows.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onOpen(f.id)}
                  className="flex w-full items-center justify-between gap-4 py-3 text-start hover:bg-muted/30"
                >
                  <div>
                    <p className="text-sm font-medium">{f.target_label}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.target_kind.replace('_', ' ')} · {formatDateTime(f.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.integrity_verdict && (
                      <Badge variant={verdictVariant(f.integrity_verdict)}>
                        {f.integrity_verdict}
                      </Badge>
                    )}
                    <Badge variant={phaseVariant(f.phase)}>{phaseLabel(t, f.phase)}</Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RansomwareCard({
  signals,
}: {
  signals: import('@/types/recover-cyber').CyberRansomwareSignal[];
}) {
  const t = useRecoverT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('cyber.ransomwareSignals')}</CardTitle>
        <CardDescription>{t('cyber.ransomwareSignalsDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('cyber.noRansomwareSignals')}</p>
        ) : (
          <ul className="space-y-2">
            {signals.slice(0, 8).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={s.severity === 'confirmed' ? 'destructive' : 'warning'}>
                    {s.severity}
                  </Badge>
                  <span>{s.kind}</span>
                  <span className="text-xs text-muted-foreground">{s.stream_id}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(s.observed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CleanPointsCard({ cleanPoints }: { cleanPoints: CyberCleanPoint[] }) {
  const t = useRecoverT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('cyber.cleanPoints')}</CardTitle>
        <CardDescription>{t('cyber.cleanPointsDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {cleanPoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('cyber.noCleanPoints')}</p>
        ) : (
          <ul className="space-y-2">
            {cleanPoints.slice(0, 8).map((cp) => (
              <li key={cp.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-mono text-xs">{cp.id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(cp.sealed_at)}</p>
                </div>
                <Badge variant={verdictVariant(cp.latest_scan_verdict)}>
                  {cp.latest_scan_verdict || t('cyber.unscanned')}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NewFlowCard({
  cleanPoints,
  onCreated,
}: {
  cleanPoints: CyberCleanPoint[];
  onCreated: (flowId: string) => void;
}) {
  const t = useRecoverT();
  const cleanOnly = useMemo(
    () => cleanPoints.filter((cp) => cp.latest_scan_verdict === 'clean'),
    [cleanPoints],
  );
  const [cleanPointId, setCleanPointId] = useState('');
  const [targetLabel, setTargetLabel] = useState('');
  const [targetKind, setTargetKind] = useState<'clean_room' | 'bare_metal' | 'isolated_vpc'>(
    'clean_room',
  );

  const create = useMutation({
    mutationFn: () =>
      selectCleanPoint({
        clean_point_id: cleanPointId,
        target_label: targetLabel,
        target_kind: targetKind,
      }),
    onSuccess: (flow) => {
      showSuccess(t('cyber.flowStarted'));
      onCreated(flow.id);
    },
    onError: (e) => showBackendError(e, t('cyber.couldNotStart')),
  });

  const disabled = !cleanPointId || targetLabel.trim().length === 0 || create.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('cyber.startTitle')}</CardTitle>
        <CardDescription>{t('cyber.startDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="cp" className="text-xs font-medium">
            {t('cyber.cleanPointLabel')}
          </label>
          <select
            id="cp"
            value={cleanPointId}
            onChange={(e) => setCleanPointId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">{t('cyber.selectCleanPoint')}</option>
            {cleanOnly.map((cp) => (
              <option key={cp.id} value={cp.id}>
                {cp.id.slice(0, 8)} · {formatDateTime(cp.sealed_at)}
              </option>
            ))}
          </select>
          {cleanOnly.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('cyber.noCleanValidated')}</p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="tl" className="text-xs font-medium">
            {t('cyber.targetLabel')}
          </label>
          <input
            id="tl"
            value={targetLabel}
            onChange={(e) => setTargetLabel(e.target.value)}
            placeholder="bare-metal-01"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="tk" className="text-xs font-medium">
            {t('cyber.targetKind')}
          </label>
          <select
            id="tk"
            value={targetKind}
            onChange={(e) =>
              setTargetKind(e.target.value as 'clean_room' | 'bare_metal' | 'isolated_vpc')
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="clean_room">{t('cyber.kindCleanRoom')}</option>
            <option value="bare_metal">{t('cyber.kindBareMetal')}</option>
            <option value="isolated_vpc">{t('cyber.kindIsolatedVpc')}</option>
          </select>
        </div>
        <Button size="sm" className="w-full" disabled={disabled} onClick={() => create.mutate()}>
          {create.isPending ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="me-2 h-4 w-4" />
          )}
          {t('cyber.startFlow')}
        </Button>
      </CardContent>
    </Card>
  );
}
