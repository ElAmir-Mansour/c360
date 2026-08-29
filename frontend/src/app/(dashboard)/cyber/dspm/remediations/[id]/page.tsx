'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
  AlertTriangle,
  User,
  Bot,
  Settings2,
  CalendarClock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { toast } from 'sonner';
import { useDspmLabels } from '../../_lib/dspm-i18n';
import type { DSPMRemediation, DSPMRemediationHistory, CyberSeverity } from '@/types/cyber';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  in_progress: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  awaiting_approval: 'bg-status-pending/10 text-status-pending dark:bg-status-pending/20',
  completed: 'bg-primary/15 text-primary',
  failed: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  cancelled: 'bg-secondary text-foreground/70',
  rolled_back: 'bg-severity-high/10 text-severity-high',
  exception_granted: 'bg-brand-teal-50 text-brand-teal-700 dark:bg-brand-teal-700/15 dark:text-brand-teal-200',
};

const STEP_ICONS: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  running: Loader2,
  failed: XCircle,
  pending: Circle,
  skipped: Circle,
};

const STEP_COLORS: Record<string, string> = {
  completed: 'text-primary',
  running: 'text-status-info animate-spin',
  failed: 'text-status-error',
  pending: 'text-muted-foreground',
  skipped: 'text-foreground/45',
};

const ACTOR_ICONS: Record<string, typeof User> = {
  user: User,
  system: Bot,
  policy_engine: Settings2,
  scheduler: CalendarClock,
};

export default function RemediationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useDspmLabels().remediationDetail;
  const id = params?.id ?? '';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cyber-dspm-remediation', id],
    queryFn: () => apiGet<{ data: DSPMRemediation }>(API_ENDPOINTS.CYBER_DSPM_REMEDIATIONS + '/' + id),
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['cyber-dspm-remediation-history', id],
    queryFn: () => apiGet<{ data: DSPMRemediationHistory[] }>(API_ENDPOINTS.CYBER_DSPM_REMEDIATIONS + '/' + id + '/history'),
  });

  const remediation = data?.data;
  const history = historyData?.data ?? [];

  async function handleApprove() {
    try {
      await apiPost(API_ENDPOINTS.CYBER_DSPM_REMEDIATIONS + '/' + id + '/approve');
      toast.success(t.approvedToast);
      await refetch();
    } catch {
      toast.error(t.approveFailed);
    }
  }

  async function handleCancel() {
    const reason = window.prompt(t.cancelPrompt);
    if (!reason) return;
    try {
      await apiPost(API_ENDPOINTS.CYBER_DSPM_REMEDIATIONS + '/' + id + '/cancel', { reason });
      toast.success(t.cancelledToast);
      await refetch();
    } catch {
      toast.error(t.cancelFailed);
    }
  }

  async function handleRollback() {
    const reason = window.prompt(t.rollbackPrompt);
    if (!reason) return;
    try {
      await apiPost(API_ENDPOINTS.CYBER_DSPM_REMEDIATIONS + '/' + id + '/rollback', { reason });
      toast.success(t.rollbackToast);
      await refetch();
    } catch {
      toast.error(t.rollbackFailed);
    }
  }

  function formatSlaStatus(r: DSPMRemediation): { text: string; color: string } {
    if (r.sla_breached) return { text: t.slaBreached, color: 'text-status-error' };
    if (!r.sla_due_at) return { text: t.noSla, color: 'text-muted-foreground' };
    const now = new Date();
    const due = new Date(r.sla_due_at);
    const diffMs = due.getTime() - now.getTime();
    if (diffMs <= 0) return { text: t.slaBreached, color: 'text-status-error' };
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return { text: t.daysHoursRemaining(days, hours % 24), color: days <= 1 ? 'text-warning-700 dark:text-warning-300' : 'text-primary' };
    }
    return { text: t.hoursRemaining(hours), color: hours <= 4 ? 'text-warning-700 dark:text-warning-300' : 'text-primary' };
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        {isLoading ? (
          <>
            <div className="h-8 w-64 animate-pulse rounded bg-muted" />
            <LoadingSkeleton variant="card" count={3} />
          </>
        ) : error || !remediation ? (
          <ErrorState message={t.loadError} onRetry={() => void refetch()} />
        ) : (
          <>
            <PageHeader
              title={
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => router.push('/cyber/dspm/remediations')}
                    className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <span className="truncate">{remediation.title}</span>
                </div>
              }
              description={
                <div className="flex flex-wrap items-center gap-3 ps-11">
                  <SeverityIndicator severity={remediation.severity} size="sm" />
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[remediation.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {remediation.status.replace(/_/g, ' ')}
                  </span>
                  {(() => {
                    const sla = formatSlaStatus(remediation);
                    return (
                      <span className={`flex items-center gap-1 text-xs font-medium ${sla.color}`}>
                        <Clock className="h-3 w-3" />
                        {sla.text}
                      </span>
                    );
                  })()}
                </div>
              }
              actions={
                <div className="flex items-center gap-2">
                  {remediation.status === 'awaiting_approval' && (
                    <Button size="sm" onClick={handleApprove}>
                      <ShieldCheck className="me-1.5 h-4 w-4" />
                      {t.approve}
                    </Button>
                  )}
                  {remediation.rollback_available && !remediation.rolled_back && remediation.status === 'completed' && (
                    <Button variant="outline" size="sm" onClick={handleRollback}>
                      <RotateCcw className="me-1.5 h-4 w-4" />
                      {t.rollback}
                    </Button>
                  )}
                  {['open', 'in_progress', 'awaiting_approval'].includes(remediation.status) && (
                    <Button variant="destructive" size="sm" onClick={handleCancel}>
                      <XCircle className="me-1.5 h-4 w-4" />
                      {t.cancel}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => void refetch()}>
                    <RefreshCw className="me-1.5 h-4 w-4" />
                    {t.refresh}
                  </Button>
                </div>
              }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              <DetailStatCard
                label={t.statFindingType}
                tone="slate"
                value={<span className="capitalize">{remediation.finding_type.replace(/_/g, ' ')}</span>}
                className=""
              />
              <DetailStatCard
                label={t.statAsset}
                tone="slate"
                value={<span className="block truncate">{remediation.data_asset_name ?? '--'}</span>}
                className=""
              />
              <DetailStatCard
                label={t.statAssignedTo}
                tone="slate"
                value={remediation.assigned_to ?? t.unassigned}
                className=""
              />
              <DetailStatCard
                label={t.statRiskBefore}
                tone="rose"
                value={<span className="tabular-nums">{remediation.risk_score_before?.toFixed(0) ?? '--'}</span>}
                className=""
              />
              <DetailStatCard
                label={t.statRiskAfter}
                tone="emerald"
                value={<span className="tabular-nums">{remediation.risk_score_after?.toFixed(0) ?? '--'}</span>}
                className=""
              />
              <DetailStatCard
                label={t.statReduction}
                tone="emerald"
                value={<span className="tabular-nums">{remediation.risk_reduction?.toFixed(1) ?? '--'}</span>}
                className=""
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t.stepsTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative space-y-0">
                  {(remediation.steps ?? []).map((step, idx) => {
                    const Icon = STEP_ICONS[step.status] ?? Circle;
                    const iconColor = STEP_COLORS[step.status] ?? 'text-muted-foreground';
                    const isLast = idx === remediation.steps.length - 1;
                    return (
                      <div key={step.step_id} className="relative flex gap-4 pb-6">
                        {!isLast && (
                          <div className="absolute start-[11px] top-6 h-full w-px bg-border" />
                        )}
                        <div className="relative z-10 mt-0.5 flex-shrink-0">
                          <Icon className={`h-6 w-6 ${iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">
                              <span className="text-muted-foreground me-2">{t.stepLabel(step.order)}</span>
                              {step.action.replace(/_/g, ' ')}
                            </p>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                              step.status === 'completed' ? 'bg-primary/15 text-primary'
                              : step.status === 'running' ? 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300'
                              : step.status === 'failed' ? 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300'
                              : 'bg-muted text-muted-foreground'
                            }`}>
                              {step.status}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                          {step.started_at && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t.startedAt(new Date(step.started_at).toLocaleString())}
                              {step.completed_at && t.completedAt(new Date(step.completed_at).toLocaleString())}
                            </p>
                          )}
                          {step.error && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-status-error">
                              <AlertTriangle className="h-3 w-3" />
                              {step.error}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t.auditHistoryTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <LoadingSkeleton variant="list-item" count={4} />
                ) : history.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">{t.noHistory}</p>
                ) : (
                  <div className="space-y-4">
                    {history.map((entry) => {
                      const ActorIcon = ACTOR_ICONS[entry.actor_type] ?? User;
                      return (
                        <div key={entry.id} className="flex gap-3 rounded-lg border p-3">
                          <div className="mt-0.5 flex-shrink-0">
                            <ActorIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium capitalize">{entry.action.replace(/_/g, ' ')}</p>
                              <span className="text-xs text-muted-foreground">
                                {new Date(entry.created_at).toLocaleString()}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {t.byActor(entry.actor_type.replace(/_/g, ' '))}
                              {entry.actor_id ? ` (${entry.actor_id.slice(0, 8)}...)` : ''}
                            </p>
                            {entry.details && Object.keys(entry.details).length > 0 && (
                              <div className="mt-2 rounded bg-muted/40 p-2 text-xs font-mono text-muted-foreground">
                                {Object.entries(entry.details).map(([key, val]) => (
                                  <div key={key}>
                                    <span className="font-medium">{key}:</span> {String(val)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {(remediation.compliance_tags ?? []).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">{t.complianceTagsTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {(remediation.compliance_tags ?? []).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
