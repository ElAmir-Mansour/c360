'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  Lock,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { showSuccess, showBackendError } from '@/lib/toast';
import { formatDateTime } from '@/lib/format';
import {
  fetchCyberRecoveryFlow,
  provisionFlow,
  runFlowRecovery,
  runIntegrityCheck,
  requestApproval,
  approveFlow,
  returnToProduction,
  abortFlow,
} from '@/lib/recover-cyber';
import type { CyberRecoveryFlow } from '@/types/recover-cyber';
import {
  FLOW_STEPS,
  integrityPassed,
  isTerminalPhase,
  phaseLabel,
  phaseVariant,
  verdictVariant,
} from './phase';
import { useRecoverT } from '../../_lib/recover-i18n';

interface RecoveryFlowPanelProps {
  flowId: string;
  /** Whether the current user may sign off the integrity gate (dr:admin). */
  canApprove: boolean;
  /** Whether the current user may return to production (dr:failover). */
  canReturn: boolean;
}

/**
 * RecoveryFlowPanel
 * =================
 * Drives ONE clean-room recovery flow through its real server-side state
 * machine: select clean point -> provision -> run recovery -> MANDATORY
 * integrity gate -> approval -> return to production.
 *
 * The integrity gate is rendered as a HARD blocker: the "Return to production
 * network" control is disabled — and the server REJECTS it — until the
 * clean-room scan verdict is CLEAN *and* an authorized approver has signed off.
 * The UI mirrors the server rule (it never grants what the server would deny);
 * the server remains the source of truth.
 */
export function RecoveryFlowPanel({ flowId, canApprove, canReturn }: RecoveryFlowPanelProps) {
  const t = useRecoverT();
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const detail = useQuery({
    queryKey: ['recover', 'cyber', 'flow', flowId],
    queryFn: () => fetchCyberRecoveryFlow(flowId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['recover', 'cyber', 'flow', flowId] });
    void qc.invalidateQueries({ queryKey: ['recover', 'cyber', 'overview'] });
    void qc.invalidateQueries({ queryKey: ['recover', 'cyber', 'flows'] });
  };

  // One mutation factory, called unconditionally at the top level for each
  // action (Rules of Hooks). Each refreshes the flow + dashboard on success and
  // surfaces the backend's typed error (e.g. the 409 gate refusal) on failure.
  const useFlowAction = (label: string, fn: () => Promise<CyberRecoveryFlow>) =>
    useMutation({
      mutationFn: fn,
      onSuccess: () => {
        showSuccess(label);
        invalidate();
      },
      onError: (e) => showBackendError(e, t('cyber.actionFailed', { label })),
    });

  const provision = useFlowAction(t('cyber.provisionedTo'), () => provisionFlow(flowId));
  const recover = useFlowAction(t('cyber.recoveryComplete'), () => runFlowRecovery(flowId));
  const integrity = useFlowAction(t('cyber.integrityEvaluated'), () => runIntegrityCheck(flowId));
  const askApproval = useFlowAction(t('cyber.approvalRequested'), () => requestApproval(flowId));
  const approve = useFlowAction(t('cyber.returnApproved'), () => approveFlow(flowId, note));
  const promote = useFlowAction(t('cyber.returnedToProduction'), () => returnToProduction(flowId));
  const abort = useFlowAction(t('cyber.flowAborted'), () => abortFlow(flowId, t('cyber.abortReason')));

  if (detail.isLoading) return <LoadingSkeleton variant="card" />;
  if (detail.isError || !detail.data) {
    return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  }

  const flow = detail.data.flow;
  const events = detail.data.events;
  const passed = integrityPassed(flow.integrity_verdict);
  const approved =
    !!flow.approved_by &&
    !!flow.approved_for_scan_id &&
    flow.approved_for_scan_id === flow.integrity_scan_id;
  const gateOpen = passed && approved;
  const busy =
    provision.isPending ||
    recover.isPending ||
    integrity.isPending ||
    askApproval.isPending ||
    approve.isPending ||
    promote.isPending;

  const activeStepIndex = FLOW_STEPS.findIndex((s) => s.phase === flow.phase);

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>{flow.target_label}</CardTitle>
              <CardDescription>
                {flow.target_kind.replace('_', ' ')} · {t('cyber.cleanPointShort', { id: flow.clean_point_id.slice(0, 8) })}
              </CardDescription>
            </div>
            <Badge variant={phaseVariant(flow.phase)}>{phaseLabel(t, flow.phase)}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FLOW_STEPS.map((step, i) => {
              const done = activeStepIndex >= i && activeStepIndex !== -1;
              return (
                <li
                  key={step.phase}
                  className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs"
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-border" aria-hidden />
                  )}
                  <span className={done ? 'font-medium' : 'text-muted-foreground'}>{t(step.labelKey)}</span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {/* MANDATORY integrity gate */}
      <Card
        className={
          passed
            ? 'border-success-300/60'
            : flow.integrity_verdict
              ? 'border-error-300/60'
              : 'border-warning-300/60'
        }
      >
        <CardHeader>
          <div className="flex items-center gap-2">
            {passed ? (
              <ShieldCheck className="h-5 w-5 text-success-600" aria-hidden />
            ) : (
              <ShieldAlert className="h-5 w-5 text-warning-600" aria-hidden />
            )}
            <CardTitle className="text-base">{t('cyber.mandatoryGate')}</CardTitle>
          </div>
          <CardDescription>
            {t('cyber.mandatoryGateDescPre')}
            <strong>{t('cyber.mandatoryGateAnd')}</strong>
            {t('cyber.mandatoryGateDescPost')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">{t('cyber.integrityScan')}</span>
            {flow.integrity_verdict ? (
              <Badge variant={verdictVariant(flow.integrity_verdict)}>
                {flow.integrity_verdict}
              </Badge>
            ) : (
              <Badge variant="outline">{t('cyber.notRun')}</Badge>
            )}
            {flow.integrity_checked_at && (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(flow.integrity_checked_at)}
              </span>
            )}
          </div>
          {flow.integrity_detail && (
            <p className="text-xs text-muted-foreground">{flow.integrity_detail}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">{t('cyber.approvalLabel')}</span>
            {approved ? (
              <Badge variant="success">
                {t('cyber.signedOffBy', { who: flow.approved_by_email || t('cyber.approver') })}
              </Badge>
            ) : (
              <Badge variant="outline">{t('cyber.pending')}</Badge>
            )}
            {flow.approved_at && (
              <span className="text-xs text-muted-foreground">{formatDateTime(flow.approved_at)}</span>
            )}
          </div>

          {/* Approval control (dr:admin) */}
          {canApprove && passed && !approved && !isTerminalPhase(flow.phase) && (
            <div className="space-y-2 rounded-md bg-muted/40 p-3">
              <label htmlFor="approval-note" className="text-xs font-medium">
                {t('cyber.signoffNote')}
              </label>
              <textarea
                id="approval-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder={t('cyber.signoffPlaceholder')}
              />
              <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
                {approve.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                {t('cyber.approveReturn')}
              </Button>
            </div>
          )}
          {!canApprove && passed && !approved && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              {t('cyber.awaitingSignoffAdmin')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Flow actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cyber.actions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {flow.phase === 'clean_point_selected' && (
            <Button size="sm" disabled={busy} onClick={() => provision.mutate()}>
              {t('cyber.provisionToTarget')}
            </Button>
          )}
          {(flow.phase === 'provisioned' || flow.phase === 'integrity_failed') && (
            <Button size="sm" disabled={busy} onClick={() => recover.mutate()}>
              {t('cyber.runRunbookRecovery')}
            </Button>
          )}
          {(flow.phase === 'recovered' ||
            flow.phase === 'integrity_failed' ||
            flow.phase === 'integrity_passed' ||
            flow.phase === 'awaiting_approval' ||
            flow.phase === 'approved') && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => integrity.mutate()}>
              {integrity.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {t('cyber.runIntegrityCheck')}
            </Button>
          )}
          {flow.phase === 'integrity_passed' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => askApproval.mutate()}>
              {t('cyber.requestApproval')}
            </Button>
          )}

          {/* HARD-gated return-to-production: disabled unless the gate is open. */}
          {canReturn && !isTerminalPhase(flow.phase) && (
            <Button
              size="sm"
              disabled={busy || !gateOpen}
              title={gateOpen ? t('cyber.returnGateOpen') : t('cyber.returnGateBlocked')}
              onClick={() => promote.mutate()}
            >
              {!gateOpen ? <Lock className="me-2 h-4 w-4" aria-hidden /> : null}
              {t('cyber.returnToProduction')}
            </Button>
          )}

          {!isTerminalPhase(flow.phase) && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => abort.mutate()}>
              <XCircle className="me-2 h-4 w-4" aria-hidden />
              {t('cyber.abort')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Append-only transition log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cyber.decisionTrail')}</CardTitle>
          <CardDescription>{t('cyber.decisionTrailDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('cyber.noTransitions')}</p>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="text-xs text-muted-foreground">{formatDateTime(e.created_at)}</span>
                  <Badge variant="outline">{e.to_phase}</Badge>
                  {e.actor_email && <span className="text-xs text-muted-foreground">{e.actor_email}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {flow.returned_at && (
        <p className="text-xs text-muted-foreground">
          {t('cyber.returnedOn', { when: formatDateTime(flow.returned_at) })}
        </p>
      )}
    </div>
  );
}
