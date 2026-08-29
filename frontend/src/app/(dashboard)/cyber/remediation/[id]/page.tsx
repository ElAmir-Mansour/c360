'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  PlayCircle,
  CheckCircle,
  XCircle,
  RotateCcw,
  ClipboardList,
  AlertTriangle,
  Clock,
  Send,
  User,
} from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import { RemediationLifecycleBadge } from '../_components/remediation-lifecycle-badge';
import { RemediationApproveDialog } from '../_components/remediation-approve-dialog';
import { DryRunResultsPanel } from '../_components/dry-run-results-panel';
import { RollbackDialog } from '../_components/rollback-dialog';
import { useApiMutation } from '@/hooks/use-api-mutation';
import type { RemediationAction, RemediationAuditEntry } from '@/types/cyber';
import { useRemediationLabels } from '../_lib/remediation-i18n';

export default function RemediationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const t = useRemediationLabels();

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveMode, setApproveMode] = useState<'approve' | 'reject'>('approve');
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const { data: envelope, isLoading, error, refetch } = useQuery({
    queryKey: [`cyber-remediation-${id}`],
    queryFn: () => apiGet<{ data: RemediationAction }>(`${API_ENDPOINTS.CYBER_REMEDIATION}/${id}`),
    refetchInterval: 60000,
  });

  const { data: auditEnvelope } = useQuery({
    queryKey: [`cyber-remediation-audit-${id}`],
    queryFn: () => apiGet<{ data: RemediationAuditEntry[] }>(`${API_ENDPOINTS.CYBER_REMEDIATION}/${id}/audit-trail`),
  });

  const action = envelope?.data;
  const auditTrail = auditEnvelope?.data ?? [];

  const { mutate: submitForApproval, isPending: submitting } = useApiMutation<unknown, Record<string, never>>(
    'post',
    `${API_ENDPOINTS.CYBER_REMEDIATION}/${id}/submit`,
    { successMessage: t.detail.submittedToast, invalidateKeys: ['cyber-remediation', `cyber-remediation-${id}`], onSuccess: () => void refetch() },
  );

  const { mutate: runDryRun, isPending: dryRunning } = useApiMutation<unknown, Record<string, never>>(
    'post',
    `${API_ENDPOINTS.CYBER_REMEDIATION}/${id}/dry-run`,
    { successMessage: t.detail.dryRunStartedToast, invalidateKeys: ['cyber-remediation', `cyber-remediation-${id}`], onSuccess: () => void refetch() },
  );

  const { mutate: execute, isPending: executing } = useApiMutation<unknown, Record<string, never>>(
    'post',
    `${API_ENDPOINTS.CYBER_REMEDIATION}/${id}/execute`,
    { successMessage: t.detail.executionStartedToast, invalidateKeys: ['cyber-remediation', `cyber-remediation-${id}`], onSuccess: () => void refetch() },
  );

  const canSubmit = action?.status === 'draft' || action?.status === 'revision_requested';
  const canApprove = action?.status === 'pending_approval';
  const canDryRun = action?.status === 'approved' || action?.status === 'dry_run_failed';
  const canExecute = action?.status === 'dry_run_completed' || action?.status === 'approved';
  const canRollback = ['executed', 'verified', 'verification_failed'].includes(action?.status ?? '');

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        {isLoading ? (
          <>
            <div className="h-8 w-64 animate-pulse rounded bg-muted" />
            <LoadingSkeleton variant="card" />
          </>
        ) : error || !action ? (
          <ErrorState message={t.detail.loadError} onRetry={() => refetch()} />
        ) : (
          <>
            <PageHeader
              title={
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => router.back()}
                    className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <span className="truncate">{action.title}</span>
                </div>
              }
              description={
                <div className="flex items-center gap-3 ps-11">
                  <RemediationLifecycleBadge status={action.status} />
                  <SeverityIndicator severity={action.severity} showLabel />
                  <span className="capitalize text-xs text-muted-foreground">{action.type.replace(/_/g, ' ')}</span>
                </div>
              }
              actions={
                <div className="flex items-center gap-2">
                  {canSubmit && (
                    <Button size="sm" onClick={() => submitForApproval({} as Record<string, never>)} disabled={submitting}>
                      {submitting ? t.detail.submitting : <><Send className="me-1.5 h-3.5 w-3.5" /> {t.detail.submitForApproval}</>}
                    </Button>
                  )}
                  {canApprove && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => { setApproveMode('reject'); setApproveOpen(true); }}
                      >
                        <XCircle className="me-1.5 h-3.5 w-3.5" /> {t.detail.reject}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => { setApproveMode('approve'); setApproveOpen(true); }}
                      >
                        <CheckCircle className="me-1.5 h-3.5 w-3.5" /> {t.detail.approve}
                      </Button>
                    </>
                  )}
                  {canDryRun && (
                    <Button variant="outline" size="sm" onClick={() => runDryRun({} as Record<string, never>)} disabled={dryRunning}>
                      {dryRunning ? t.detail.running : <><ClipboardList className="me-1.5 h-3.5 w-3.5" /> {t.detail.dryRun}</>}
                    </Button>
                  )}
                  {canExecute && (
                    <Button size="sm" onClick={() => execute({} as Record<string, never>)} disabled={executing}>
                      {executing ? t.detail.executing : <><PlayCircle className="me-1.5 h-3.5 w-3.5" /> {t.detail.execute}</>}
                    </Button>
                  )}
                  {canRollback && (
                    <Button variant="outline" size="sm" className="text-warning-700 dark:text-warning-300" onClick={() => setRollbackOpen(true)}>
                      <RotateCcw className="me-1.5 h-3.5 w-3.5" /> {t.detail.rollback}
                    </Button>
                  )}
                </div>
              }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Left: main content */}
              <div className="space-y-6 lg:col-span-2">
                {/* Description */}
                <div className="rounded-xl border bg-card p-5">
                  <h3 className="mb-2 text-sm font-semibold">{t.detail.descriptionTitle}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{action.description}</p>
                </div>

                {/* Plan Steps */}
                <div className="rounded-xl border bg-card p-5">
                  <h3 className="mb-4 text-sm font-semibold">{t.detail.executionPlanTitle}</h3>
                  <div className="space-y-3">
                    {action.plan.steps.map((step, idx) => {
                      const stepResult = action.execution_result?.step_results.find(
                        (r) => r.step_number === step.number,
                      );
                      const statusIcon = stepResult
                        ? stepResult.status === 'success'
                          ? <CheckCircle className="h-4 w-4 text-primary" />
                          : stepResult.status === 'failure'
                          ? <XCircle className="h-4 w-4 text-error-500" />
                          : <Clock className="h-4 w-4 text-muted-foreground" />
                        : null;

                      return (
                        <div
                          key={idx}
                          className={`flex gap-4 rounded-lg border p-4 transition-colors ${
                            stepResult?.status === 'success'
                              ? 'border-primary/30 bg-primary/50 dark:border-primary dark:bg-brand-primary-800/20'
                              : stepResult?.status === 'failure'
                              ? 'border-error-100 bg-error-50/50 dark:border-error-700 dark:bg-error-700/20'
                              : 'bg-muted/20'
                          }`}
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background border text-xs font-bold">
                            {statusIcon ?? step.number}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{step.action}</p>
                            {step.target && (
                              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{t.detail.targetPrefix}{step.target}</p>
                            )}
                            {step.description && (
                              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                            )}
                            {stepResult?.output && (
                              <pre className="mt-2 rounded bg-background p-2 text-xs overflow-x-auto">{stepResult.output}</pre>
                            )}
                            {stepResult?.error && (
                              <p className="mt-1 text-xs text-error-500">{stepResult.error}</p>
                            )}
                          </div>
                          {stepResult && (
                            <span className="text-xs text-muted-foreground">{stepResult.duration_ms}ms</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {action.plan.reversible !== undefined && (
                    <div className="mt-4 flex items-center gap-4 border-t pt-4 text-xs text-muted-foreground">
                      <span className={action.plan.reversible ? 'text-primary' : 'text-warning-700 dark:text-warning-300'}>
                        {action.plan.reversible ? t.detail.reversible : t.detail.irreversible}
                      </span>
                      {action.plan.requires_reboot && <span className="text-warning-700 dark:text-warning-300">{t.detail.requiresReboot}</span>}
                      {action.plan.risk_level && <span>{t.detail.riskPrefix}<strong className="capitalize">{action.plan.risk_level}</strong></span>}
                      {action.plan.estimated_downtime && <span>{t.detail.downtimePrefix}<strong>{action.plan.estimated_downtime}</strong></span>}
                    </div>
                  )}
                </div>

                {/* Dry Run Results */}
                {action.dry_run_result && (
                  <DryRunResultsPanel result={action.dry_run_result} />
                )}

                {/* Execution Result */}
                {action.execution_result && (
                  <div className="rounded-xl border bg-card p-5">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                      {t.detail.executionResultTitle}
                      {action.execution_result.success ? (
                        <Badge className="bg-primary/15 text-primary">{t.detail.success}</Badge>
                      ) : (
                        <Badge variant="destructive">{t.detail.failed}</Badge>
                      )}
                    </h3>
                    <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <p className="text-2xl font-bold">{action.execution_result.steps_executed}</p>
                        <p className="text-xs text-muted-foreground">{t.detail.stepsExecuted}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <p className="text-2xl font-bold">{action.execution_result.changes_applied.length}</p>
                        <p className="text-xs text-muted-foreground">{t.detail.changesApplied}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <p className="text-2xl font-bold">{(action.execution_result.duration_ms / 1000).toFixed(1)}s</p>
                        <p className="text-xs text-muted-foreground">{t.detail.duration}</p>
                      </div>
                    </div>
                    {action.execution_result.changes_applied.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">{t.detail.appliedChanges}</p>
                        <div className="space-y-2">
                          {action.execution_result.changes_applied.map((change, i) => (
                            <div key={i} className="rounded-lg border bg-muted/10 p-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium capitalize">{change.change_type.replace(/_/g, ' ')}</span>
                                <span className="text-xs text-muted-foreground">{t.detail.changeOn(change.asset_id)}</span>
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">{change.description}</p>
                              {change.old_value && change.new_value && (
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div className="rounded bg-error-50 p-2 text-xs text-error-600 dark:bg-error-700/30 dark:text-error-300">
                                    {t.detail.before}{change.old_value}
                                  </div>
                                  <div className="rounded bg-primary/10 p-2 text-xs text-primary dark:bg-brand-primary-800/30 dark:text-primary">
                                    {t.detail.after}{change.new_value}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Verification Result */}
                {action.verification_result && (
                  <div className="rounded-xl border bg-card p-5">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                      {t.detail.verificationTitle}
                      {action.verification_result.verified ? (
                        <Badge className="bg-primary/15 text-primary">{t.detail.passed}</Badge>
                      ) : (
                        <Badge variant="destructive">{t.detail.failed}</Badge>
                      )}
                    </h3>
                    <div className="space-y-2">
                      {action.verification_result.checks.map((check, i) => (
                        <div key={i} className={`flex items-start gap-3 rounded-lg border p-3 ${check.passed ? 'border-primary/30 bg-primary/30' : 'border-error-100 bg-error-50/30'}`}>
                          {check.passed ? (
                            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          ) : (
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error-500" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{check.name}</p>
                            <p className="text-xs text-muted-foreground">{t.detail.expected}{check.expected}</p>
                            <p className="text-xs text-muted-foreground">{t.detail.actual}{check.actual}</p>
                            {check.notes && <p className="mt-1 text-xs text-muted-foreground">{check.notes}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {action.verification_result.failure_reason && (
                      <p className="mt-3 text-sm text-error-500">{action.verification_result.failure_reason}</p>
                    )}
                  </div>
                )}

                {/* Audit Trail */}
                {auditTrail.length > 0 && (
                  <div className="rounded-xl border bg-card p-5">
                    <h3 className="mb-4 text-sm font-semibold">{t.detail.auditTrailTitle}</h3>
                    <div className="space-y-3">
                      {auditTrail.map((entry) => (
                        <div key={entry.id} className="flex items-start gap-3 border-b pb-3 last:border-0 last:pb-0">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{entry.actor_name ?? t.detail.systemActor}</span>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{entry.action.replace(/_/g, ' ')}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(entry.created_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: metadata sidebar */}
              <div className="space-y-4">
                <div className="rounded-xl border bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold">{t.detail.detailsTitle}</h3>
                  <dl className="space-y-2.5 text-sm">
                    {[
                      { label: t.detail.dStatus, value: <RemediationLifecycleBadge status={action.status} /> },
                      { label: t.detail.dSeverity, value: <SeverityIndicator severity={action.severity} showLabel /> },
                      { label: t.detail.dType, value: <span className="capitalize">{action.type.replace(/_/g, ' ')}</span> },
                      { label: t.detail.dExecutionMode, value: <span className="capitalize">{action.execution_mode.replace(/_/g, ' ')}</span> },
                      { label: t.detail.dCreatedBy, value: action.created_by_name ?? '—' },
                      { label: t.detail.dCreated, value: timeAgo(action.created_at) },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="text-end">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {action.approved_by && (
                  <div className="rounded-xl border bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold text-primary">{t.detail.approvalTitle}</h3>
                    <div className="space-y-1.5 text-sm">
                      <p className="text-muted-foreground">{t.detail.approvedByPrefix}<strong>{action.approved_by}</strong></p>
                      {action.approved_at && <p className="text-xs text-muted-foreground">{timeAgo(action.approved_at)}</p>}
                    </div>
                  </div>
                )}

                {action.rejected_by && (
                  <div className="rounded-xl border border-error-100 bg-error-50/30 p-4 dark:border-error-700 dark:bg-error-700/10">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-error-500">
                      <XCircle className="h-4 w-4" /> {t.detail.rejectedTitle}
                    </h3>
                    <p className="text-sm text-muted-foreground">{t.detail.rejectedByPrefix}<strong>{action.rejected_by}</strong></p>
                    {action.rejected_at && <p className="text-xs text-muted-foreground mt-1">{timeAgo(action.rejected_at)}</p>}
                  </div>
                )}

                {action.rollback_deadline && (
                  <div className="rounded-xl border border-warning-100 bg-warning-50/30 p-4 dark:border-warning-700 dark:bg-warning-800/10">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning-700 dark:text-warning-300">
                      <AlertTriangle className="h-4 w-4" /> {t.detail.rollbackWindowTitle}
                    </h3>
                    <p className="text-xs text-muted-foreground">{t.detail.rollbackExpires(new Date(action.rollback_deadline).toLocaleString())}</p>
                    {action.rollback_reason && <p className="mt-1 text-xs text-muted-foreground">{action.rollback_reason}</p>}
                  </div>
                )}

                {/* Tags */}
                {action.tags.length > 0 && (
                  <div className="rounded-xl border bg-card p-4">
                    <h3 className="mb-2 text-sm font-semibold">{t.detail.tagsTitle}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {action.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Linked items */}
                {(action.alert_id || action.vulnerability_id) && (
                  <div className="rounded-xl border bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold">{t.detail.linkedItemsTitle}</h3>
                    <div className="space-y-2 text-sm">
                      {action.alert_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{t.detail.linkAlert}</span>
                          <a href={`/cyber/alerts/${action.alert_id}`} className="font-mono text-xs text-primary hover:underline">
                            {action.alert_id.slice(0, 8)}…
                          </a>
                        </div>
                      )}
                      {action.vulnerability_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{t.detail.linkVulnerability}</span>
                          <span className="font-mono text-xs">{action.vulnerability_id.slice(0, 8)}…</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <RemediationApproveDialog
              open={approveOpen}
              onOpenChange={setApproveOpen}
              action={action}
              mode={approveMode}
              onSuccess={() => void refetch()}
            />
            <RollbackDialog
              open={rollbackOpen}
              onOpenChange={setRollbackOpen}
              action={action}
              onSuccess={() => void refetch()}
            />
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
